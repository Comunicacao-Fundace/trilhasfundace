-- =====================================================================
-- Hub Trilhas Fundace USP — cadastro universal com inscrição por trilha
-- =====================================================================
-- Migration ADITIVA e idempotente (pode rodar de novo sem efeito colateral).
--
-- O que faz:
--   1. Cria a "tag" de inscrição por trilha (public.trilha_inscricoes):
--      uma linha por pessoa + trilha, com origem e data da primeira inscrição.
--   2. Guarda cada envio de formulário (legado ou hub) em public.leads_historico,
--      preservando os valores originais que o capture_lead sobrescreve em leads.
--   3. Registra certificados com código de validação (public.certificados).
--   4. Restringe RPCs legadas que expunham dados de qualquer e-mail para anon.
--
-- O que NÃO faz:
--   - não altera, renomeia nem remove tabelas/colunas legadas;
--   - não altera capture_lead (os formulários antigos continuam idênticos);
--   - não chama ActiveCampaign, Ploomes nem qualquer serviço externo.
--
-- Ordem segura: rodar este arquivo -> deploy das Edge Functions alteradas ->
-- publicar frontend -> rodar supabase/hub_backfill_inscricoes.sql.
-- Rollback: supabase/hub_cadastro_universal_rollback.sql (preserva os dados).
-- =====================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Guarda de versão: as 4 funções legadas reescritas no item 8 precisam
--    estar exatamente como no repositório (ou já na versão desta migration).
--    Se produção tiver uma versão diferente, nada é aplicado.
-- ---------------------------------------------------------------------
do $$
declare
  v_esperado jsonb := '{
    "public.get_lead_offer_context(text)": ["a5f708ba17940d1d662c78ab89a191ba","b6273ee4ee5c27d7c0f430c25eb2f209"],
    "public.record_lead_offer_response(text,boolean,boolean)": ["255aa210618be4d158b317f54a131273","eaf041c8df8e4559a06a58ad5f7c313a"],
    "public.record_trilha_nps_resposta(text,text,integer,text,text)": ["b20596150ea080081e5d90a230cc811c","23998fc3ff39c69256773c3ae18ab82f"],
    "public.has_answered_trilha_nps(text,text)": ["491e753d474682170b6e14bf0c81063b","e4f6b6d03351ee72d622e331a9172bec"]
  }'::jsonb;
  v_funcao text;
  v_hashes jsonb;
  v_atual text;
begin
  for v_funcao, v_hashes in select key, value from jsonb_each(v_esperado) loop
    select md5(btrim(replace(p.prosrc, E'\r', '')))
      into v_atual
      from pg_proc p
     where p.oid = to_regprocedure(v_funcao);

    if v_atual is null then
      raise exception 'Abortado: função % não existe neste banco. Revise antes de aplicar.', v_funcao;
    end if;

    if not v_hashes ? v_atual then
      raise exception 'Abortado: % em produção difere do repositório (md5 %). Atualize esta migration a partir de pg_get_functiondef antes de aplicar.', v_funcao, v_atual;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Identificador canônico de trilha
--    Canônico = id do curso no player (Index.html): id fixo das trilhas de
--    supabase/trilhas-estaticas.js ou public.trilhas.slug das dinâmicas.
--    Os formulários gravam nome_trilha (texto), o cadastro de senha grava
--    slugs curtos e o SDR usa outro slug — tudo converge aqui.
-- ---------------------------------------------------------------------
create table if not exists public.trilhas_alias (
  alias text primary key,
  trilha_slug text not null,
  observacao text,
  criado_em timestamptz not null default now(),
  constraint trilhas_alias_normalizado_check check (alias = lower(btrim(alias)))
);

alter table public.trilhas_alias enable row level security;
revoke all on public.trilhas_alias from anon, authenticated;

drop policy if exists "Admins can read trilhas alias" on public.trilhas_alias;
create policy "Admins can read trilhas alias"
on public.trilhas_alias for select to authenticated
using (public.is_admin());

grant select on public.trilhas_alias to authenticated;

insert into public.trilhas_alias (alias, trilha_slug, observacao) values
  ('trilha contifrs', 'ifrs', 'nome_trilha do formulário IFRS'),
  ('ifrs', 'ifrs', 'slug do cadastro de senha'),
  ('trilha de gestão de produção com ia', 'gestao', 'nome_trilha do formulário'),
  ('gestao', 'gestao', 'slug do cadastro de senha'),
  ('trilha de gestão de projetos', 'gestao-projetos', 'nome_trilha do formulário'),
  ('gestao-projetos', 'gestao-projetos', 'slug do cadastro de senha'),
  ('trilha de finanças', 'financas', 'nome_trilha do formulário'),
  ('financas', 'financas', 'slug do cadastro de senha'),
  ('trilha pocket gestão estratégica de ti', 'gestao-estrategica-ti', 'nome_trilha do formulário'),
  ('gestao-estrategica-ti', 'gestao-estrategica-ti', 'slug do cadastro de senha'),
  ('semana ia no direito', 'semana-ia-no-direito', 'nome_trilha do formulário GDE'),
  ('semana-ia-no-direito', 'semana-ia-no-direito', 'slug em public.trilhas'),
  ('gde', 'semana-ia-no-direito', 'nome da pasta da captação'),
  ('trilha de gestão estratégica', 'gedat', 'nome_trilha do formulário GEDAT'),
  ('gedat', 'gedat', 'slug em public.trilhas'),
  ('mini curso estratégias de marketing para o mercado em transformação', 'trilha-nova-de-marketing', 'nome_trilha do formulário — slug usado pelo NPS e SDR'),
  ('trilha nova de marketing', 'trilha-nova-de-marketing', 'nome_trilha antigo encontrado em produção'),
  ('marketing-nova', 'trilha-nova-de-marketing', 'slug do cadastro de senha'),
  ('trilha-nova-de-marketing', 'trilha-nova-de-marketing', 'slug em public.trilhas (NPS/SDR)'),
  ('trilha de marketing estratégico', 'trilha-de-marketing-estrategico', 'nome_trilha do formulário (trilha antiga)'),
  ('trilha-de-marketing-estrategico', 'trilha-de-marketing-estrategico', 'slug em public.trilhas'),
  ('marketing', 'trilha-de-marketing-estrategico', 'slug do cadastro de senha')
on conflict (alias) do nothing;
-- Slugs conferidos em produção em 2026-10-16 (public.trilhas).

create or replace function public.resolver_trilha_slug(p_valor text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with v as (select lower(btrim(coalesce(p_valor, ''))) as k)
  select coalesce(
    (select a.trilha_slug from public.trilhas_alias a, v where a.alias = v.k),
    (select t.slug from public.trilhas t, v where lower(t.slug) = v.k limit 1),
    (select t.slug from public.trilhas t, v
      where lower(btrim(t.nome)) = v.k and t.slug is not null
      order by t.criada_em limit 1),
    nullif((select k from v), '')
  );
$$;

revoke all on function public.resolver_trilha_slug(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Aulas obrigatórias das trilhas estáticas (espelho de
--    supabase/trilhas-estaticas.js, usado para validar conclusão no servidor)
-- ---------------------------------------------------------------------
create table if not exists public.trilhas_estaticas (
  slug text primary key,
  titulo text not null
);

create table if not exists public.trilha_aulas_estaticas (
  trilha_slug text not null references public.trilhas_estaticas (slug) on delete cascade,
  lesson_id text not null,
  ordem integer not null,
  primary key (trilha_slug, lesson_id)
);

alter table public.trilhas_estaticas enable row level security;
alter table public.trilha_aulas_estaticas enable row level security;
revoke all on public.trilhas_estaticas, public.trilha_aulas_estaticas from anon, authenticated;

insert into public.trilhas_estaticas (slug, titulo) values
  ('ifrs', 'Trilha Contabilidade em IFRS'),
  ('gestao', 'Trilha de Gestão de Produção com IA'),
  ('gestao-projetos', 'Trilha de Gestão de Projetos'),
  ('gestao-estrategica-ti', 'Trilha Pocket Gestão Estratégica de TI'),
  ('financas', 'Trilha de Finanças')
on conflict (slug) do nothing;

insert into public.trilha_aulas_estaticas (trilha_slug, lesson_id, ordem) values
  ('ifrs', 'lesson-1', 1), ('ifrs', 'lesson-2', 2), ('ifrs', 'lesson-3', 3), ('ifrs', 'lesson-4', 4),
  ('ifrs', 'lesson-5', 5), ('ifrs', 'lesson-6', 6), ('ifrs', 'lesson-7', 7), ('ifrs', 'lesson-8', 8),
  ('gestao', 'gestao-1', 1), ('gestao', 'gestao-2', 2), ('gestao', 'gestao-3', 3),
  ('gestao', 'gestao-4', 4), ('gestao', 'gestao-5', 5), ('gestao', 'gestao-6', 6),
  ('gestao-projetos', 'gestao-projetos-1', 1), ('gestao-projetos', 'gestao-projetos-2', 2),
  ('gestao-projetos', 'gestao-projetos-3', 3),
  ('gestao-estrategica-ti', 'gestao-estrategica-ti-1', 1), ('gestao-estrategica-ti', 'gestao-estrategica-ti-2', 2),
  ('financas', 'financas-1', 1), ('financas', 'financas-2', 2), ('financas', 'financas-3', 3)
on conflict (trilha_slug, lesson_id) do nothing;

-- Mesmo critério do player: trilha estática usa a lista fixa; trilha
-- dinâmica usa todas as aulas de public.aulas daquela trilha.
create or replace function public.trilha_aulas_obrigatorias(p_trilha_slug text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select e.lesson_id
    from public.trilha_aulas_estaticas e
   where e.trilha_slug = p_trilha_slug
  union
  select a.id::text
    from public.aulas a
    join public.trilhas t on t.id = a.trilha_id
   where t.slug = p_trilha_slug
     and not exists (select 1 from public.trilhas_estaticas s where s.slug = p_trilha_slug);
$$;

revoke all on function public.trilha_aulas_obrigatorias(text) from public, anon, authenticated;

create or replace function public.trilha_titulo(p_trilha_slug text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.titulo from public.trilhas_estaticas s where s.slug = p_trilha_slug),
    (select t.nome from public.trilhas t where t.slug = p_trilha_slug limit 1),
    p_trilha_slug
  );
$$;

revoke all on function public.trilha_titulo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Histórico de envios de formulário (somente inclusão)
--    capture_lead faz upsert por e-mail e sobrescreve os dados anteriores;
--    aqui fica cada versão enviada, com a origem (formulário legado, hub ou admin).
-- ---------------------------------------------------------------------
create table if not exists public.leads_historico (
  id bigint generated always as identity primary key,
  -- Texto: em produção leads.id é uuid; no repositório, bigint.
  lead_id text,
  email citext not null,
  operacao text not null,
  origem text not null,
  trilha_slug text,
  nome_trilha text,
  nome text,
  cidade text,
  telefone text,
  possui_formacao_superior boolean,
  area_formacao text,
  empresa text,
  cargo text,
  pretende_pos text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  fbclid text,
  landing_page_url text,
  referrer_url text,
  registrado_em timestamptz not null default now()
);

create index if not exists leads_historico_email_idx on public.leads_historico (email, registrado_em desc);
create index if not exists leads_historico_trilha_idx on public.leads_historico (trilha_slug, registrado_em desc);

alter table public.leads_historico enable row level security;
revoke all on public.leads_historico from anon, authenticated;

drop policy if exists "Admins can read leads historico" on public.leads_historico;
create policy "Admins can read leads historico"
on public.leads_historico for select to authenticated
using (public.is_admin());

grant select on public.leads_historico to authenticated;

-- ---------------------------------------------------------------------
-- 4. Tag de inscrição por trilha
--    Cadastro universal != matrícula universal: cada trilha que a pessoa
--    faz vira uma linha própria. Chave = e-mail do lead + trilha, porque há
--    leads sem conta no Auth; user_id é preenchido quando a conta existe e
--    o e-mail está confirmado.
-- ---------------------------------------------------------------------
create table if not exists public.trilha_inscricoes (
  id bigint generated always as identity primary key,
  lead_email citext not null,
  user_id uuid references auth.users (id) on delete set null,
  trilha_slug text not null,
  nome_trilha text,
  origem text not null,
  ultima_origem text not null,
  inscrito_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  evidencias jsonb not null default '[]'::jsonb,
  constraint trilha_inscricoes_unique unique (lead_email, trilha_slug),
  constraint trilha_inscricoes_origem_check
    check (origem in ('formulario_legado', 'hub', 'auto_inscricao', 'admin', 'reconstrucao')),
  constraint trilha_inscricoes_ultima_origem_check
    check (ultima_origem in ('formulario_legado', 'hub', 'auto_inscricao', 'admin', 'reconstrucao'))
);

create index if not exists trilha_inscricoes_user_idx on public.trilha_inscricoes (user_id);
create index if not exists trilha_inscricoes_trilha_idx on public.trilha_inscricoes (trilha_slug, inscrito_em desc);

alter table public.trilha_inscricoes enable row level security;
revoke all on public.trilha_inscricoes from anon, authenticated;

drop policy if exists "Users can read own trilha inscricoes" on public.trilha_inscricoes;
create policy "Users can read own trilha inscricoes"
on public.trilha_inscricoes for select to authenticated
using (user_id = auth.uid() or public.is_admin());

grant select on public.trilha_inscricoes to authenticated;

-- Única porta de escrita da tag. Idempotente: repetir a chamada não cria
-- outra linha, não troca a primeira origem nem a data da primeira inscrição,
-- e nunca troca um user_id já vinculado.
create or replace function public.registrar_inscricao_trilha(
  p_email text,
  p_trilha text,
  p_origem text,
  p_user_id uuid default null,
  p_nome_trilha text default null,
  p_evidencia jsonb default null,
  p_inscrito_em timestamptz default null
)
returns public.trilha_inscricoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext := lower(btrim(coalesce(p_email, '')));
  v_slug text := public.resolver_trilha_slug(coalesce(nullif(btrim(coalesce(p_trilha, '')), ''), p_nome_trilha));
  v_evidencias jsonb := case when p_evidencia is null then '[]'::jsonb else jsonb_build_array(p_evidencia) end;
  v_row public.trilha_inscricoes;
begin
  if v_email = '' then
    raise exception 'E-mail é obrigatório.';
  end if;

  if v_slug is null then
    raise exception 'Trilha é obrigatória.';
  end if;

  insert into public.trilha_inscricoes as i (
    lead_email, user_id, trilha_slug, nome_trilha, origem, ultima_origem, inscrito_em, evidencias
  )
  values (
    v_email, p_user_id, v_slug, nullif(btrim(coalesce(p_nome_trilha, '')), ''),
    p_origem, p_origem, coalesce(p_inscrito_em, now()), v_evidencias
  )
  on conflict (lead_email, trilha_slug) do update
  set
    user_id = coalesce(i.user_id, excluded.user_id),
    nome_trilha = coalesce(excluded.nome_trilha, i.nome_trilha),
    ultima_origem = excluded.ultima_origem,
    inscrito_em = least(i.inscrito_em, excluded.inscrito_em),
    atualizado_em = now(),
    evidencias = case
      when p_evidencia is null or i.evidencias @> v_evidencias then i.evidencias
      else i.evidencias || v_evidencias
    end
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.registrar_inscricao_trilha(text, text, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_inscricao_trilha(text, text, text, uuid, text, jsonb, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 5. Trigger em leads: todo envio de formulário (legado ou hub) grava o
--    histórico e a tag da trilha. Não altera o que o capture_lead faz e
--    nunca derruba o cadastro: em caso de erro só registra um WARNING.
-- ---------------------------------------------------------------------
create or replace function public.leads_registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_origem text := 'formulario_legado';
  v_slug text;
  v_user_id uuid;
begin
  begin
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
      v_headers := null;
    end;

    if lower(coalesce(v_headers ->> 'x-fundace-origem', '')) = 'hub' then
      v_origem := 'hub';
    elsif public.is_admin() then
      v_origem := 'admin';
    end if;

    v_slug := public.resolver_trilha_slug(new.nome_trilha);

    insert into public.leads_historico (
      lead_id, email, operacao, origem, trilha_slug, nome_trilha, nome, cidade, telefone,
      possui_formacao_superior, area_formacao, empresa, cargo, pretende_pos,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid,
      landing_page_url, referrer_url
    ) values (
      new.id::text, new.email, lower(tg_op), v_origem, v_slug, new.nome_trilha, new.nome, new.cidade, new.telefone,
      new.possui_formacao_superior, new.area_formacao, new.empresa, new.cargo, new.pretende_pos,
      new.utm_source, new.utm_medium, new.utm_campaign, new.utm_term, new.utm_content, new.gclid, new.fbclid,
      new.landing_page_url, new.referrer_url
    );

    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = lower(new.email::text)
       and u.email_confirmed_at is not null
     limit 1;

    perform public.registrar_inscricao_trilha(
      new.email, v_slug, v_origem, v_user_id, new.nome_trilha,
      jsonb_build_object('fonte', 'leads'), null
    );
  exception when others then
    raise warning '[leads_registrar_historico] lead %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.leads_registrar_historico() from public, anon, authenticated;

drop trigger if exists leads_registrar_historico_trg on public.leads;
create trigger leads_registrar_historico_trg
after insert or update of nome, email, cidade, telefone, possui_formacao_superior, area_formacao,
  empresa, cargo, nome_trilha, pretende_pos
on public.leads
for each row execute function public.leads_registrar_historico();

-- ---------------------------------------------------------------------
-- 6. Leitura das inscrições pelo aluno (hub e player legado)
--    Vincula as tags do e-mail à conta somente se o e-mail estiver
--    confirmado no Auth. Nunca vincula por nome.
-- ---------------------------------------------------------------------
create or replace function public.hub_minhas_inscricoes()
returns table (
  trilha_slug text,
  nome_trilha text,
  origem text,
  inscrito_em timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmado timestamptz;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmado
    from auth.users u where u.id = v_uid;

  if v_email is not null and v_confirmado is not null then
    update public.trilha_inscricoes i
       set user_id = v_uid, atualizado_em = now()
     where i.lead_email = lower(v_email)::citext
       and i.user_id is null;
  end if;

  return query
  select i.trilha_slug, i.nome_trilha, i.origem, i.inscrito_em
    from public.trilha_inscricoes i
   where i.user_id = v_uid
   order by i.inscrito_em;
end;
$$;

revoke all on function public.hub_minhas_inscricoes() from public, anon, authenticated;
grant execute on function public.hub_minhas_inscricoes() to authenticated;

-- O hub usa para decidir entre gravar o cadastro (primeira trilha) ou só
-- inscrever em mais uma trilha. Retorna apenas dados do próprio usuário.
create or replace function public.hub_meu_cadastro()
returns table (
  tem_cadastro boolean,
  nome text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Usuário não autenticado.';
  end if;

  return query
  select exists (select 1 from public.leads l where l.email = v_email::citext),
         (select l.nome from public.leads l where l.email = v_email::citext limit 1);
end;
$$;

revoke all on function public.hub_meu_cadastro() from public, anon, authenticated;
grant execute on function public.hub_meu_cadastro() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Certificados com código de validação
--    Emissão idempotente: um certificado por conta + trilha; repetir devolve
--    o mesmo código. Conclusão conferida no servidor contra as aulas
--    obrigatórias. Nome e título vêm do servidor (não do navegador).
-- ---------------------------------------------------------------------
create table if not exists public.certificados (
  id bigint generated always as identity primary key,
  codigo text not null,
  user_id uuid references auth.users (id) on delete set null,
  lead_email citext not null,
  trilha_slug text not null,
  trilha_titulo text not null,
  nome_impresso text not null,
  total_aulas integer not null,
  concluido_em timestamptz not null,
  emitido_em timestamptz not null default now(),
  origem text not null,
  constraint certificados_codigo_unique unique (codigo),
  constraint certificados_user_trilha_unique unique (user_id, trilha_slug),
  constraint certificados_origem_check check (origem in ('hub', 'player_legado'))
);

alter table public.certificados enable row level security;
revoke all on public.certificados from anon, authenticated;

drop policy if exists "Users can read own certificados" on public.certificados;
create policy "Users can read own certificados"
on public.certificados for select to authenticated
using (user_id = auth.uid() or public.is_admin());

grant select on public.certificados to authenticated;

create or replace function public.gerar_codigo_certificado()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(12);
  v_codigo text := '';
  i integer;
begin
  for i in 0..11 loop
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i in (3, 7) then
      v_codigo := v_codigo || '-';
    end if;
  end loop;
  return 'FDC-' || v_codigo;
end;
$$;

revoke all on function public.gerar_codigo_certificado() from public, anon, authenticated;

create or replace function public.emitir_certificado(
  p_trilha_slug text,
  p_origem text default 'hub'
)
returns public.certificados
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_nome text;
  v_slug text := public.resolver_trilha_slug(p_trilha_slug);
  v_origem text := case when p_origem = 'player_legado' then 'player_legado' else 'hub' end;
  v_obrigatorias text[];
  v_concluidas integer;
  v_concluido_em timestamptz;
  v_row public.certificados;
  v_tentativa integer := 0;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select * into v_row from public.certificados c where c.user_id = v_uid and c.trilha_slug = v_slug;
  if found then
    return v_row;
  end if;

  v_obrigatorias := array(select public.trilha_aulas_obrigatorias(v_slug));
  if coalesce(cardinality(v_obrigatorias), 0) = 0 then
    raise exception 'Trilha sem aulas cadastradas para certificação.';
  end if;

  select count(distinct p.lesson_id), max(p.completed_at)
    into v_concluidas, v_concluido_em
    from public.user_lesson_progress p
   where p.user_id = v_uid
     and p.lesson_id = any (v_obrigatorias);

  if v_concluidas < cardinality(v_obrigatorias) then
    raise exception 'Trilha ainda não concluída.';
  end if;

  select u.email, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email)
    into v_email, v_nome
    from auth.users u where u.id = v_uid;

  loop
    begin
      insert into public.certificados (
        codigo, user_id, lead_email, trilha_slug, trilha_titulo, nome_impresso,
        total_aulas, concluido_em, origem
      ) values (
        public.gerar_codigo_certificado(), v_uid, lower(v_email), v_slug, public.trilha_titulo(v_slug),
        left(v_nome, 200), cardinality(v_obrigatorias), v_concluido_em, v_origem
      )
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      select * into v_row from public.certificados c where c.user_id = v_uid and c.trilha_slug = v_slug;
      if found then
        return v_row;
      end if;
      v_tentativa := v_tentativa + 1;
      if v_tentativa >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.emitir_certificado(text, text) from public, anon, authenticated;
grant execute on function public.emitir_certificado(text, text) to authenticated;

-- Validação pública por código: devolve só o que está impresso no certificado.
create or replace function public.validar_certificado(p_codigo text)
returns table (
  codigo text,
  nome_impresso text,
  trilha_titulo text,
  total_aulas integer,
  concluido_em timestamptz,
  emitido_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.codigo, c.nome_impresso, c.trilha_titulo, c.total_aulas, c.concluido_em, c.emitido_em
    from public.certificados c
   where c.codigo = upper(btrim(coalesce(p_codigo, '')))
   limit 1;
$$;

revoke all on function public.validar_certificado(text) from public;
grant execute on function public.validar_certificado(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Correções de segurança em RPCs legadas (mesma assinatura e retorno)
-- ---------------------------------------------------------------------

-- Quem pode consultar/alterar dados de lead pelo e-mail: o próprio dono
-- logado, um admin, ou o navegador que acabou de enviar o formulário
-- (envio registrado nas últimas 2 horas — fluxo do cadastrar-senha.html).
create or replace function public.lead_acesso_permitido(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (coalesce(auth.jwt() ->> 'email', '') <> ''
      and lower(auth.jwt() ->> 'email') = lower(btrim(coalesce(p_email, ''))))
    or public.is_admin()
    or exists (
      select 1 from public.leads_historico h
       where h.email = lower(btrim(coalesce(p_email, '')))::citext
         and h.registrado_em > now() - interval '2 hours'
    );
$$;

revoke all on function public.lead_acesso_permitido(text) from public, anon, authenticated;

create or replace function public.get_lead_offer_context(
  p_email text
)
returns table (
  email citext,
  nome text,
  nome_trilha text,
  possui_formacao_superior boolean,
  pretende_pos text,
  mba_offer_shown_at timestamptz,
  mba_offer_acknowledged boolean,
  consultor_contact_opt_in boolean,
  consultor_contact_answered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    raise exception 'E-mail é obrigatório.';
  end if;

  -- Sem permissão devolve vazio (o frontend trata como "sem contexto").
  if not public.lead_acesso_permitido(v_email::text) then
    return;
  end if;

  return query
  select
    l.email::citext,
    l.nome,
    l.nome_trilha,
    l.possui_formacao_superior,
    l.pretende_pos,
    l.mba_offer_shown_at,
    l.mba_offer_acknowledged,
    l.consultor_contact_opt_in,
    l.consultor_contact_answered_at
  from public.leads l
  where l.email = v_email
  limit 1;
end;
$$;

revoke all on function public.get_lead_offer_context(text) from public;
grant execute on function public.get_lead_offer_context(text) to anon, authenticated;

create or replace function public.record_lead_offer_response(
  p_email text,
  p_consultor_contact_opt_in boolean,
  p_mba_offer_acknowledged boolean default true
)
returns public.leads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext := lower(trim(coalesce(p_email, '')));
  v_lead public.leads;
begin
  if v_email = '' then
    raise exception 'E-mail é obrigatório.';
  end if;

  if not public.lead_acesso_permitido(v_email::text) then
    raise exception 'Acesso negado.';
  end if;

  update public.leads
  set
    mba_offer_shown_at = coalesce(mba_offer_shown_at, now()),
    mba_offer_acknowledged = coalesce(p_mba_offer_acknowledged, true),
    consultor_contact_opt_in = p_consultor_contact_opt_in,
    consultor_contact_answered_at = now()
  where email = v_email
  returning * into v_lead;

  if v_lead.id is null then
    raise exception 'Lead não encontrado.';
  end if;

  return v_lead;
end;
$$;

revoke all on function public.record_lead_offer_response(text, boolean, boolean) from public;
grant execute on function public.record_lead_offer_response(text, boolean, boolean) to anon, authenticated;

-- NPS: só o próprio aluno logado responde/consulta a própria resposta.
create or replace function public.record_trilha_nps_resposta(
  p_email text,
  p_trail_slug text,
  p_score integer,
  p_nome text default null,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext := lower(trim(coalesce(p_email, '')));
  v_trail_slug text := trim(coalesce(p_trail_slug, ''));
begin
  if v_email = '' then
    raise exception 'E-mail é obrigatório.';
  end if;

  if auth.uid() is null
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(v_email::text) then
    raise exception 'Acesso negado.';
  end if;

  if v_trail_slug = '' then
    raise exception 'Trilha é obrigatória.';
  end if;

  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Nota precisa ser de 0 a 10.';
  end if;

  insert into public.trilha_nps_respostas (trail_slug, lead_email, lead_nome, score, comentario)
  values (v_trail_slug, v_email, nullif(trim(coalesce(p_nome, '')), ''), p_score, nullif(trim(coalesce(p_comentario, '')), ''))
  on conflict on constraint trilha_nps_respostas_unique do update
  set score = excluded.score,
      comentario = excluded.comentario,
      lead_nome = coalesce(excluded.lead_nome, public.trilha_nps_respostas.lead_nome),
      updated_at = now();
end;
$$;

revoke all on function public.record_trilha_nps_resposta(text, text, integer, text, text) from public, anon;
grant execute on function public.record_trilha_nps_resposta(text, text, integer, text, text) to authenticated;

create or replace function public.has_answered_trilha_nps(
  p_email text,
  p_trail_slug text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = lower(trim(coalesce(p_email, '')))
    and exists (
      select 1
      from public.trilha_nps_respostas
      where lead_email = lower(trim(coalesce(p_email, '')))
        and trail_slug = trim(coalesce(p_trail_slug, ''))
    );
$$;

revoke all on function public.has_answered_trilha_nps(text, text) from public, anon;
grant execute on function public.has_answered_trilha_nps(text, text) to authenticated;

-- Status de sincronização só pode ser gravado pelas Edge Functions
-- (service_role). Antes qualquer visitante podia alterar.
revoke all on function public.update_lead_activecampaign_sync(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_lead_activecampaign_sync(text, text, text, text, text) to service_role;

revoke all on function public.update_lead_ploomes_sync(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_lead_ploomes_sync(text, text, text, text, text, text, text) to service_role;
