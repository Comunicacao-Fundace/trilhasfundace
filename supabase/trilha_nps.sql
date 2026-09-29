-- Pesquisa de NPS ao final da trilha: exibida antes de liberar o download do
-- certificado (hoje só na trilha "Mini Curso Estratégias de Marketing para o
-- Mercado em Transformação"), pra conseguir medir satisfação sem depender de
-- um canal separado. Resposta fica ligada ao e-mail do lead que respondeu.

create extension if not exists citext;

create table if not exists public.trilha_nps_respostas (
  id bigint generated always as identity primary key,
  trail_slug text not null,
  lead_email citext not null,
  lead_nome text,
  score integer not null check (score between 0 and 10),
  comentario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trilha_nps_respostas_unique'
      and conrelid = 'public.trilha_nps_respostas'::regclass
  ) then
    alter table public.trilha_nps_respostas
      add constraint trilha_nps_respostas_unique unique (trail_slug, lead_email);
  end if;
end $$;

alter table public.trilha_nps_respostas enable row level security;

drop policy if exists "Admins can read trilha nps respostas" on public.trilha_nps_respostas;
create policy "Admins can read trilha nps respostas"
on public.trilha_nps_respostas
for select
to authenticated
using (public.is_admin());

create index if not exists trilha_nps_respostas_trail_idx
  on public.trilha_nps_respostas (trail_slug, created_at desc);

-- Chamada pelo portal da trilha (Index.html) antes de liberar o download do
-- certificado. Sem select direto liberado pra anon/authenticated — só existe
-- essa porta de entrada, controlada (score 0-10, e-mail obrigatório).
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

-- Chamada antes de exibir a pesquisa, pra não perguntar de novo pra quem já
-- respondeu (em outro dispositivo/sessão, por exemplo).
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
