# Deploy

## Fluxo normal (alteração em página HTML/JS estático)
1. Edite o arquivo direto (não há build).
2. Teste localmente servindo a pasta (`npx serve .`) ou abrindo o HTML direto no navegador — a maior parte das páginas funciona em `file://`, exceto fluxos que dependem de sessão/redirect.
3. Commit e push pro branch `main`:
   ```bash
   git add <arquivos>
   git commit -m "mensagem clara do que mudou"
   git push
   ```
4. A Vercel detecta o push no GitHub e publica automaticamente em produção — não precisa rodar nenhum comando de deploy manual.

## Alteração em Edge Function
1. Edite o arquivo em `supabase/functions/<nome>/index.ts`.
2. Teste localmente (opcional, mas recomendado pra mudanças de lógica):
   ```bash
   supabase functions serve <nome> --env-file .env
   ```
3. Deploy pra produção:
   ```bash
   supabase functions deploy <nome> --project-ref hasptpxcyavfdzxtwpws
   ```
   (precisa estar logado na Supabase CLI com uma conta que tenha acesso ao projeto — `supabase login`.)
4. Se a função usa uma variável de ambiente nova, configure também no painel: **Supabase Dashboard → Project Settings → Edge Functions → Secrets** (não basta só adicionar no `.env` local).
5. Commit o código da função normalmente (push não aciona redeploy da função — isso só acontece com o comando `supabase functions deploy`).

## Alteração no banco (SQL)
Não há sistema de migrations numeradas — os arquivos em `supabase/*.sql` (ex: `sdr_marketing_nova.sql`, `capture_lead.sql`) são escritos pra serem **idempotentes** (podem rodar de novo sem quebrar nada: `create table if not exists`, `create or replace function`, etc.). Pra aplicar uma alteração:

1. Edite o arquivo `.sql` correspondente ao que você está mudando (ou crie um novo arquivo, se for uma feature nova).
2. Aplique no banco de produção via **SQL Editor do painel do Supabase** (colar e rodar), ou via Management API:
   ```bash
   curl -X POST "https://api.supabase.com/v1/projects/hasptpxcyavfdzxtwpws/database/query" \
     -H "Authorization: Bearer <token de acesso pessoal do Supabase>" \
     -H "Content-Type: application/json" \
     --data-binary @payload.json
   ```
   (o token é gerado em supabase.com/dashboard/account/tokens — não é o mesmo que a `SUPABASE_SERVICE_ROLE_KEY`.)
3. Teste a mudança (RPC, policy de RLS, etc.) antes de considerar concluído — uma resposta vazia `[]` da Management API só significa "sem erro de sintaxe", não significa "a lógica está certa".

## Adicionando uma trilha nova
Resumo do checklist (a trilha GEDAT foi a última adicionada seguindo esse fluxo):
1. Criar a trilha + aulas no banco (`insert into trilhas`, `insert into aulas` — ou pelo painel admin).
2. Criar `trilhas/<slug-da-trilha>/captacao.html` (copiar a estrutura de uma trilha parecida como ponto de partida).
3. Adicionar o rewrite da URL amigável em `vercel.json`.
4. Se a trilha tiver popup de oferta de MBA com texto próprio, adicionar um branch em `currentTrailSlug()`/`updateTrailCopy()` dentro de `cadastrar-senha.html`.
5. Se o nome da trilha colidir com alguma checagem de substring já existente em `normalizeTrailSlug()` (`Index.html`) — testar manualmente contra todos os nomes de trilha reais antes de subir (já aconteceu uma colisão real: uma trilha de "Gestão Estratégica" quase caiu por engano na trilha antiga de "Gestão").
6. Criar a lista correspondente no ActiveCampaign e adicionar a constante em `activecampaign-sync-lead/index.ts`.
7. Se a trilha gerar negócio no Ploomes, adicionar o pipeline/estágio em `ploomes-sync-lead/index.ts`.
