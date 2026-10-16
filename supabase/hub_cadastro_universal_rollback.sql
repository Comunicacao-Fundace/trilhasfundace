-- =====================================================================
-- ROLLBACK de supabase/hub_cadastro_universal.sql
-- =====================================================================
-- Volta o comportamento do banco ao legado SEM apagar dados:
--   - remove o trigger em leads (o legado volta a gravar só em leads);
--   - restaura as 4 RPCs legadas exatamente como em capture_lead.sql e
--     trilha_nps.sql (texto copiado desses arquivos);
--   - devolve os grants originais das RPCs de status de sincronização;
--   - tira o acesso do navegador às RPCs novas.
-- As tabelas novas (trilha_inscricoes, leads_historico, certificados,
-- trilhas_alias, trilhas_estaticas, trilha_aulas_estaticas) e os dados
-- gravados nelas depois da implantação são MANTIDOS, para auditoria e
-- para uma reimplantação futura. Nada do legado depende delas.
-- Arquivo gerado a partir do repositório; não edite as funções à mão.
-- =====================================================================

begin;

drop trigger if exists leads_registrar_historico_trg on public.leads;

revoke all on function public.hub_minhas_inscricoes() from authenticated;
revoke all on function public.hub_meu_cadastro() from authenticated;
revoke all on function public.emitir_certificado(text, text) from authenticated;
-- validar_certificado continua público para que certificados já emitidos
-- com código sigam verificáveis.

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

revoke all on function public.record_trilha_nps_resposta(text, text, integer, text, text) from public;
grant execute on function public.record_trilha_nps_resposta(text, text, integer, text, text) to anon, authenticated;

create or replace function public.has_answered_trilha_nps(
  p_email text,
  p_trail_slug text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trilha_nps_respostas
    where lead_email = lower(trim(coalesce(p_email, '')))
      and trail_slug = trim(coalesce(p_trail_slug, ''))
  );
$$;

revoke all on function public.has_answered_trilha_nps(text, text) from public;
grant execute on function public.has_answered_trilha_nps(text, text) to anon, authenticated;

revoke all on function public.update_lead_activecampaign_sync(text, text, text, text, text) from public;
grant execute on function public.update_lead_activecampaign_sync(text, text, text, text, text) to anon, authenticated;

revoke all on function public.update_lead_ploomes_sync(text, text, text, text, text, text, text) from public;
grant execute on function public.update_lead_ploomes_sync(text, text, text, text, text, text, text) to anon, authenticated;

commit;
