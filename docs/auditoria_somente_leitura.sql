-- =====================================================================
-- AUDITORIA SOMENTE LEITURA — banco de produção das trilhas Fundace
-- Objetivo: comparar o estado real do banco com o repositório legado.
-- Regras: apenas SELECT em catálogo e contagens agregadas.
--         Nenhuma consulta abaixo retorna e-mail, nome, telefone ou outro dado pessoal.
-- Execute dentro de uma transação somente leitura:
begin transaction read only;
-- =====================================================================

-- 1. Tabelas e views dos schemas relevantes
select table_schema, table_name, table_type
from information_schema.tables
where table_schema in ('public', 'storage')
order by 1, 2;

-- 2. Colunas (tipo, nulidade, default)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 3. Constraints (PK, FK, UNIQUE, CHECK) com definição
select conrelid::regclass as tabela, conname, contype, pg_get_constraintdef(oid) as definicao
from pg_constraint
where connamespace = 'public'::regnamespace
order by 1, 2;

-- 4. Índices
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by 1, 2;

-- 5. RLS habilitado por tabela
select relname as tabela, relrowsecurity as rls_ativo, relforcerowsecurity as rls_forcado
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by 1;

-- 6. Políticas RLS (inclui storage.objects)
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by 1, 2, 3;

-- 7. Privilégios de tabela para anon / authenticated
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2
order by 1, 2;

-- 8. Funções/RPCs: assinatura, SECURITY DEFINER e quem pode executar
select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_executa,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1, 2;

-- 8b. Corpo das funções que tocam leads/inscrição (para comparar com o repositório)
select p.proname, pg_get_functiondef(p.oid) as definicao
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('capture_lead', 'get_lead_offer_context', 'record_lead_offer_response',
                    'update_lead_activecampaign_sync', 'update_lead_ploomes_sync',
                    'record_trilha_nps_resposta', 'has_answered_trilha_nps', 'is_admin',
                    'track_lesson_view');

-- 9. Triggers (fora os internos)
select event_object_schema, event_object_table, trigger_name, action_timing,
       event_manipulation, action_statement
from information_schema.triggers
where event_object_schema in ('public', 'auth', 'storage')
order by 1, 2, 3;

-- 10. Extensões instaladas (pg_net, pg_cron, http, supabase_vault...)
select extname, extversion from pg_extension order by 1;

-- 11. Jobs agendados (só se pg_cron existir — ignore o erro caso não exista)
-- select jobid, schedule, command, active from cron.job;

-- 12. Database Webhooks (supabase_functions.hooks, se existir)
select table_schema, table_name
from information_schema.tables
where table_schema = 'supabase_functions';

-- 13. Buckets de Storage
select id, name, public, created_at from storage.buckets order by 1;
select bucket_id, count(*) as arquivos from storage.objects group by 1 order by 1;

-- 14. Divergências já suspeitas entre código e repositório
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'trilhas'
  and column_name in ('permite_auto_inscricao', 'slug');

-- =====================================================================
-- CONTAGENS AGREGADAS (sem dados pessoais) — linha de base "antes"
-- =====================================================================

-- 15. Volume por tabela principal
select 'leads' as tabela, count(*) from public.leads
union all select 'auth.users', count(*) from auth.users
union all select 'user_lesson_progress', count(*) from public.user_lesson_progress
union all select 'trilhas', count(*) from public.trilhas
union all select 'aulas', count(*) from public.aulas
union all select 'trilha_nps_respostas', count(*) from public.trilha_nps_respostas
union all select 'sdr_contact_triggers', count(*) from public.sdr_contact_triggers
union all select 'comments', count(*) from public.comments
union all select 'lesson_views', count(*) from public.lesson_views;

-- 16. Leads por trilha (última trilha gravada — capture_lead sobrescreve)
select nome_trilha, count(*) from public.leads group by 1 order by 2 desc;

-- 17. Relação leads x contas de Auth (apenas contagens)
select
  count(*) filter (where u.id is not null)                       as leads_com_conta,
  count(*) filter (where u.id is null)                           as leads_sem_conta
from public.leads l
left join auth.users u on lower(u.email) = lower(l.email::text);

select
  count(*) filter (where l.id is null)                           as contas_sem_lead,
  count(*) filter (where u.email_confirmed_at is null)           as contas_nao_confirmadas,
  count(*) filter (where u.raw_user_meta_data ? 'trilhas')       as contas_com_array_trilhas,
  count(*) filter (where u.raw_user_meta_data ? 'trilha')        as contas_com_trilha_texto
from auth.users u
left join public.leads l on lower(l.email::text) = lower(u.email);

-- 18. E-mails duplicados por variação de caixa/espaço em auth.users
select count(*) as grupos_duplicados
from (select lower(trim(email)) from auth.users group by 1 having count(*) > 1) d;

-- 19. Valores de trilha registrados em user_metadata (slugs, não pessoas)
select coalesce(raw_user_meta_data ->> 'trilha', '(sem)') as trilha_texto, count(*)
from auth.users group by 1 order by 2 desc;

select t.valor as trilha_array, count(*)
from auth.users u, jsonb_array_elements_text(u.raw_user_meta_data -> 'trilhas') as t(valor)
where jsonb_typeof(u.raw_user_meta_data -> 'trilhas') = 'array'
group by 1 order by 2 desc;

-- 20. Progresso: IDs de aula estáticos (Index.html) x UUIDs da tabela aulas
select
  case when a.id is not null then 'aulas.id (dinâmica)' else 'id estático/órfão' end as tipo,
  count(*) as registros,
  count(distinct ulp.user_id) as usuarios
from public.user_lesson_progress ulp
left join public.aulas a on a.id::text = ulp.lesson_id
group by 1;

select ulp.lesson_id, count(*) as registros
from public.user_lesson_progress ulp
left join public.aulas a on a.id::text = ulp.lesson_id
where a.id is null
group by 1 order by 1;

-- 21. Quantos usuários têm progresso em mais de uma trilha (dinâmicas)
select count(*) as usuarios_multitrilha
from (
  select ulp.user_id
  from public.user_lesson_progress ulp
  join public.aulas a on a.id::text = ulp.lesson_id
  group by 1 having count(distinct a.trilha_id) > 1
) x;

-- 22. Trilhas e aulas publicadas (sem dados pessoais)
select t.slug, t.nome, t.status, count(a.id) as aulas
from public.trilhas t left join public.aulas a on a.trilha_id = t.id
group by 1, 2, 3 order by 1;

-- 23. Slugs usados no NPS e no SDR
select trail_slug, count(*) from public.trilha_nps_respostas group by 1;
select trail_slug, trigger_type, count(*) from public.sdr_contact_triggers group by 1, 2;


-- =====================================================================
-- PÓS-IMPLANTAÇÃO (rode só depois de hub_cadastro_universal.sql)
-- =====================================================================

-- 24. Tags por trilha e origem
select trilha_slug, origem, count(*) as tags, count(user_id) as com_conta
from public.trilha_inscricoes group by 1, 2 order by 1, 2;

-- 25. Envios registrados no histórico por origem
select origem, count(*) from public.leads_historico group by 1 order by 1;

-- 26. Certificados emitidos por trilha
select trilha_slug, origem, count(*) from public.certificados group by 1, 2 order by 1, 2;

-- 27. Leads sem nenhuma tag (deve ser 0 depois do backfill)
select count(*) as leads_sem_tag
from public.leads l
where not exists (select 1 from public.trilha_inscricoes i where i.lead_email = l.email);

-- 28. Simulação do backfill: usa tabelas temporárias, então rode FORA desta
--     transação somente leitura (ela não grava nada nas tabelas reais):
--     select * from public.hub_backfill_inscricoes(false);

rollback;
