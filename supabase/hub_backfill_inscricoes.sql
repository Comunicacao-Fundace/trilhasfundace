-- =====================================================================
-- Reconstrução das tags de inscrição a partir do histórico legado
-- =====================================================================
-- Pré-requisito: supabase/hub_cadastro_universal.sql já aplicado.
--
-- Uso:
--   select * from public.hub_backfill_inscricoes(false);  -- simulação (não grava nada)
--   select * from public.hub_backfill_inscricoes(true);   -- aplica (idempotente)
--
-- Fontes (todas internas ao banco; nada é enviado ao ActiveCampaign/Ploomes):
--   leads.nome_trilha            -> última trilha do formulário (o legado sobrescreve as anteriores)
--   auth.users user_metadata     -> "trilha" (texto) e "trilhas" (lista da auto-inscrição)
--   user_lesson_progress         -> aulas concluídas, convertidas em trilha
--   trilha_nps_respostas         -> trilha da pesquisa de satisfação
--   sdr_contact_triggers         -> trilha do CRM de SDR
--   inscricoes_ia_direito        -> Semana IA no Direito (se a tabela existir)
--
-- Regras:
--   - nenhuma vinculação por nome; só por e-mail exato (minúsculo, sem espaços);
--   - user_id só é preenchido quando o e-mail da conta está confirmado;
--   - data da inscrição = evidência mais antiga que não seja leads.created_at
--     (essa é a data do primeiro cadastro do e-mail, não da trilha); se só
--     houver essa evidência, ela é usada e marcada como aproximada;
--   - linhas já existentes mantêm a primeira origem; só ganham evidência e,
--     se for o caso, uma data de inscrição mais antiga.
-- =====================================================================

create or replace function public.hub_backfill_inscricoes(p_aplicar boolean default false)
returns table (
  trilha_slug text,
  slug_reconhecido boolean,
  candidatos bigint,
  ja_existentes bigint,
  novas bigint,
  com_conta_confirmada bigint,
  data_aproximada bigint,
  fontes text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tem_nps boolean := to_regclass('public.trilha_nps_respostas') is not null;
  v_tem_sdr boolean := to_regclass('public.sdr_contact_triggers') is not null;
  v_sql text;
  r record;
begin
  create temporary table if not exists tmp_backfill_evidencias (
    email citext,
    trilha_slug text,
    fonte text,
    evidencia_em timestamptz
  ) on commit drop;
  truncate tmp_backfill_evidencias;

  -- leads.nome_trilha
  insert into tmp_backfill_evidencias
  select lower(btrim(l.email::text)), public.resolver_trilha_slug(l.nome_trilha), 'leads.nome_trilha', l.created_at
    from public.leads l
   where coalesce(btrim(l.nome_trilha), '') <> '';

  -- user_metadata.trilha (texto)
  insert into tmp_backfill_evidencias
  select lower(btrim(u.email)), public.resolver_trilha_slug(u.raw_user_meta_data ->> 'trilha'), 'auth.metadata.trilha', u.created_at
    from auth.users u
   where coalesce(btrim(u.email), '') <> ''
     and coalesce(btrim(u.raw_user_meta_data ->> 'trilha'), '') <> '';

  -- user_metadata.trilhas (lista)
  insert into tmp_backfill_evidencias
  select lower(btrim(u.email)), public.resolver_trilha_slug(t.valor), 'auth.metadata.trilhas', u.created_at
    from auth.users u
   cross join lateral jsonb_array_elements_text(
     case when jsonb_typeof(u.raw_user_meta_data -> 'trilhas') = 'array'
          then u.raw_user_meta_data -> 'trilhas' else '[]'::jsonb end
   ) as t(valor)
   where coalesce(btrim(u.email), '') <> ''
     and coalesce(btrim(t.valor), '') <> '';

  -- progresso em trilhas estáticas
  insert into tmp_backfill_evidencias
  select lower(btrim(u.email)), e.trilha_slug, 'user_lesson_progress', min(p.completed_at)
    from public.user_lesson_progress p
    join public.trilha_aulas_estaticas e on e.lesson_id = p.lesson_id
    join auth.users u on u.id = p.user_id
   where coalesce(btrim(u.email), '') <> ''
   group by 1, 2;

  -- progresso em trilhas dinâmicas
  insert into tmp_backfill_evidencias
  select lower(btrim(u.email)), t.slug, 'user_lesson_progress', min(p.completed_at)
    from public.user_lesson_progress p
    join public.aulas a on a.id::text = p.lesson_id
    join public.trilhas t on t.id = a.trilha_id
    join auth.users u on u.id = p.user_id
   where coalesce(btrim(u.email), '') <> ''
     and t.slug is not null
   group by 1, 2;

  if v_tem_nps then
    insert into tmp_backfill_evidencias
    select lower(btrim(n.lead_email::text)), public.resolver_trilha_slug(n.trail_slug), 'trilha_nps_respostas', n.created_at
      from public.trilha_nps_respostas n;
  end if;

  -- Inscrições da Semana IA no Direito gravadas fora de public.leads
  -- (tabela criada fora deste repositório; usada só se existir).
  if to_regclass('public.inscricoes_ia_direito') is not null then
    execute $q$
      insert into tmp_backfill_evidencias
      select lower(btrim(d.email)), 'semana-ia-no-direito', 'inscricoes_ia_direito', min(d.created_at)
        from public.inscricoes_ia_direito d
       where coalesce(btrim(d.email), '') <> ''
       group by 1
    $q$;
  end if;

  if v_tem_sdr then
    insert into tmp_backfill_evidencias
    select lower(btrim(s.lead_email::text)), public.resolver_trilha_slug(s.trail_slug), 'sdr_contact_triggers', min(s.created_at)
      from public.sdr_contact_triggers s
     group by 1, 2;
  end if;

  delete from tmp_backfill_evidencias where email is null or email = '' or trilha_slug is null;

  create temporary table if not exists tmp_backfill_candidatos (
    email citext,
    trilha_slug text,
    inscrito_em timestamptz,
    data_aproximada boolean,
    fontes text[],
    user_id uuid,
    ja_existe boolean,
    slug_reconhecido boolean
  ) on commit drop;
  truncate tmp_backfill_candidatos;

  insert into tmp_backfill_candidatos
  select
    ev.email,
    ev.trilha_slug,
    coalesce(min(ev.evidencia_em) filter (where ev.fonte <> 'leads.nome_trilha'), min(ev.evidencia_em)),
    bool_and(ev.fonte = 'leads.nome_trilha'),
    array_agg(distinct ev.fonte order by ev.fonte),
    (select u.id from auth.users u
      where lower(u.email) = lower(ev.email::text) and u.email_confirmed_at is not null limit 1),
    exists (select 1 from public.trilha_inscricoes i
             where i.lead_email = ev.email and i.trilha_slug = ev.trilha_slug),
    exists (select 1 from public.trilhas_estaticas s where s.slug = ev.trilha_slug)
      or exists (select 1 from public.trilhas t where t.slug = ev.trilha_slug)
  from tmp_backfill_evidencias ev
  group by ev.email, ev.trilha_slug;

  if p_aplicar then
    for r in select * from tmp_backfill_candidatos c where c.slug_reconhecido loop
      perform public.registrar_inscricao_trilha(
        r.email::text,
        r.trilha_slug,
        'reconstrucao',
        r.user_id,
        null,
        jsonb_build_object(
          'fonte', 'reconstrucao',
          'fontes', to_jsonb(r.fontes),
          'data_aproximada', r.data_aproximada
        ),
        r.inscrito_em
      );
    end loop;
  end if;

  -- Relatório agregado (sem e-mails). Slugs não reconhecidos NÃO são
  -- gravados: aparecem aqui para revisão manual do alias.
  return query
  select
    c.trilha_slug,
    c.slug_reconhecido,
    count(*)::bigint,
    count(*) filter (where c.ja_existe)::bigint,
    count(*) filter (where not c.ja_existe)::bigint,
    count(*) filter (where c.user_id is not null)::bigint,
    count(*) filter (where c.data_aproximada)::bigint,
    (select string_agg(distinct f, ', ' order by f)
       from tmp_backfill_candidatos c2, unnest(c2.fontes) f
      where c2.trilha_slug = c.trilha_slug)
  from tmp_backfill_candidatos c
  group by c.trilha_slug, c.slug_reconhecido
  order by c.slug_reconhecido, c.trilha_slug;
end;
$$;

revoke all on function public.hub_backfill_inscricoes(boolean) from public, anon, authenticated;
