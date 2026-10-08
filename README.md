# Fundace — Sistema de Trilhas, Captação e CRM de SDR

## O que é
Sistema completo de geração e trabalho de leads da Fundace via trilhas gratuitas de conteúdo. Cobre o funil inteiro:

1. **Captação**: uma landing page por trilha (`trilhas/<nome>/captacao.html`), cada uma com formulário próprio.
2. **Acesso à trilha**: criação de senha, login, e um player de aulas com progresso e certificado em PDF (`Index.html`).
3. **Oferta de upsell**: popup de interesse no MBA pago relacionado, ao final do cadastro.
4. **Sincronização automática** de cada lead com ActiveCampaign (e-mail marketing) e Ploomes (CRM comercial).
5. **CRM de SDR interno** (`admin-sdr-marketing.html`): painel kanban pra time comercial trabalhar os leads mais quentes, com automação de nutrição por e-mail e pontuação de prioridade.
6. **Painel admin** (`admin.html`): gestão de trilhas, aulas e usuários.

## Quem usa
- **Leads/alunos**: público externo, se cadastra nas trilhas gratuitas e usa o player de aulas.
- **Time de SDR/comercial da Fundace**: usa `admin-sdr-marketing.html` pra fazer o primeiro contato com os leads qualificados.
- **Admin/marketing**: usa `admin.html` pra cadastrar trilhas/aulas novas e gerenciar usuários com acesso.

## URL de produção
`[PREENCHER]` (provavelmente `https://trilhasfundace.vercel.app`, mas confirme o domínio ativo no painel da Vercel).

## Onde está hospedado
- **Frontend**: Vercel (deploy automático a partir do branch `main` do GitHub, repositório `brunojuvencio/trilhasfundace`).
- **Backend**: Supabase (projeto `hasptpxcyavfdzxtwpws`) — banco Postgres, autenticação, e Edge Functions (Deno).

## Trilhas ativas hoje
IFRS (Contabilidade), Gestão (Produção com IA), Gestão de Projetos, Marketing Estratégico (antiga), Marketing Nova ("Mercado em Transformação"), Finanças, Semana IA no Direito (GDE), Gestão Estratégica Baseada em Dados (GEDAT). Cada uma tem sua própria pasta em `trilhas/`.

## Variáveis de ambiente
Ver `.env.example` — todas comentadas por seção (Supabase, ActiveCampaign, Ploomes, Meta, GA4, Vercel).

⚠️ As variáveis de ambiente das **Edge Functions** (as que importam, pra elas rodarem) ficam configuradas direto no painel do Supabase (Project Settings → Edge Functions → Secrets), **não** só no `.env` local — o `.env` local é usado por scripts manuais/administrativos, não pelo runtime em produção.

## Como rodar localmente
Não há bundler nem servidor Node — é HTML/JS estático servido direto. Pra testar localmente:
```bash
npx serve .
# ou: python -m http.server 8000
```
As Edge Functions rodam isoladas no Supabase; pra testar uma localmente, use a Supabase CLI:
```bash
supabase functions serve <nome-da-funcao> --env-file .env
```

## Integrações
- **Supabase**: banco de dados, autenticação de usuários, Edge Functions, Storage.
- **ActiveCampaign**: uma lista de e-mail por trilha + automação de nutrição ("TRILHA MKT", id 137) pra quem qualifica na Situação A do CRM de SDR.
- **Ploomes**: cada lead vira um negócio (deal) no funil comercial, com pipeline específico pra trilhas de marketing.
- **Meta (Facebook/Instagram) Conversions API**: eventos de conversão (Lead, qualify_lead).
- **Google Analytics 4** (Measurement Protocol): evento `qualify_lead`.
- **LinkedIn Insight Tag**: pixel de conversão nas páginas de captação.

## Responsável atual
`[PREENCHER]`

## Documentação adicional
- [`docs/arquitetura.md`](docs/arquitetura.md) — como as peças se conectam
- [`docs/deploy.md`](docs/deploy.md) — como publicar uma alteração
- [`DEPLOY-VERCEL.md`](DEPLOY-VERCEL.md) — notas específicas de configuração da Vercel (rewrites, headers)
