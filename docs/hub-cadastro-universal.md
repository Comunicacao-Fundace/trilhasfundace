# Hub Trilhas Fundace USP — cadastro universal

O hub (`hub.html`, rota `/hub`) é a vitrine pública das trilhas. A pessoa escolhe uma trilha, entra ou se cadastra uma única vez e vai direto para as aulas. Usa o **mesmo Supabase** do projeto antigo: mesmas contas, mesmo progresso, mesmas tabelas. As páginas antigas (`/gedat`, `/financas`, …) continuam funcionando sem mudança de comportamento.

## Modelo de dados

| Conceito | Onde fica | Observação |
|---|---|---|
| Conta (identidade) | `auth.users` | Uma por e-mail. O hub e o player legado usam a mesma. |
| Cadastro (perfil) | `public.leads` | Um por e-mail, **última versão vale** (regra do `capture_lead`, mantida). |
| Histórico do cadastro | `public.leads_historico` | **Novo.** Cada envio de formulário (legado, hub ou admin) com os valores originais e a origem. Só inclusão. |
| Inscrição por trilha (tag) | `public.trilha_inscricoes` | **Novo.** Uma linha por e-mail + trilha, com origem e data da primeira inscrição. |
| Progresso | `public.user_lesson_progress` | Sem mudança. IDs de aula: fixos (`supabase/trilhas-estaticas.js`) ou `aulas.id`. |
| Feedback | `public.trilha_nps_respostas` | Sem mudança no schema. |
| Certificado | `public.certificados` | **Novo.** Registro com código de validação (`/validar-certificado`). |

Identificador da trilha (`trilha_slug`) = o `id` do curso no player: id fixo das trilhas estáticas ou `public.trilhas.slug`. `public.trilhas_alias` converte `nome_trilha` dos formulários e slugs antigos (ex.: `marketing-nova` → `trilha-nova-de-marketing`).

### Como a tag é gravada

- **Formulário legado ou cadastro do hub:** trigger em `public.leads` (`leads_registrar_historico`). O `capture_lead` não muda. Se o trigger falhar, o formulário segue funcionando (só gera WARNING no log do Postgres).
- **Mais uma trilha para quem já tem cadastro (hub ou botão do player):** Edge Function `trilha-self-enroll`.
- **Convites por link de senha (`scripts/gerar-convites-trilha.mjs`):** o script grava a tag com origem `admin` depois de matricular cada aluno.
- **Histórico anterior à implantação:** `select * from public.hub_backfill_inscricoes(true);`.

A tag recebe o `user_id` somente quando o e-mail da conta está confirmado no Auth. Nunca há vinculação por nome.

## O que mudou no legado

| Arquivo | Mudança | Efeito para quem usa o legado |
|---|---|---|
| `Index.html` | Catálogo estático movido para `supabase/trilhas-estaticas.js` (texto idêntico) | Nenhum |
| `Index.html` | Trilhas liberadas = regra antiga **+** tags do banco | Quem perdia a trilha anterior ao preencher outro formulário volta a vê-la. Ninguém é bloqueado. |
| `Index.html` | Certificado gerado por `supabase/certificado.js` com registro e código | Mesmo layout, com uma linha de código de validação. A data passa a ser a da primeira emissão. Se o registro falhar, o PDF sai como antes. |
| `trilha-self-enroll` | Grava a tag. GEDAT e Marketing Nova corrigidas (antes: "Trilha inválida" e lista 35 no lugar da 72) | Correção |
| `activecampaign-sync-lead` | Só sincroniza e-mail com envio de formulário nos últimos 30 min. E-mail mascarado nos logs | Formulários seguem iguais. Terceiros não conseguem mais reinscrever leads antigos em listas. |
| `ac-click-webhook` | Segredo opcional (`AC_CLICK_WEBHOOK_REQUIRE_SECRET=true`) | Desligado até a URL do webhook ser atualizada no ActiveCampaign |
| RPCs `get_lead_offer_context`, `record_lead_offer_response` | Só o dono logado, um admin ou quem enviou o formulário nas últimas 2 h | `cadastrar-senha.html` continua funcionando |
| RPCs de NPS | Só o próprio aluno logado | Player continua funcionando |
| `update_lead_*_sync` | Só `service_role` (Edge Functions) | Nenhum |

## Ordem de implantação

Nada disso foi aplicado em produção. Cada passo depende de autorização.

1. **Pré-checagens (somente leitura).** Rodar `docs/auditoria_somente_leitura.sql` e conferir:
   - os slugs reais em `public.trilhas` (principalmente GDE, GEDAT e Marketing antiga) contra `trilhas_alias`;
   - se `trilhas.permite_auto_inscricao` existe (o player já lê essa coluna);
   - se a confirmação de e-mail está ligada no Auth.
2. **Backup:** PITR, se o plano tiver, ou `supabase db dump` (schema + dados) e exportação de `auth.users`. Guardar também o código das Edge Functions implantadas e a configuração de Auth (URLs, templates).
3. **Homologação:** projeto Supabase separado com o **schema real** de produção (dump de schema) e dados sintéticos. Testar a restauração do backup nesse projeto.
4. **SQL:** aplicar `supabase/hub_cadastro_universal.sql`. Se as funções de produção diferirem do repositório, a guarda de versão aborta sem aplicar nada. Nesse caso, atualizar a migration a partir de `pg_get_functiondef` e rodar `npm run hashes` em `tests/`.
5. **Edge Functions:** `supabase functions deploy` de `trilha-self-enroll`, `activecampaign-sync-lead` e `ac-click-webhook`. O workflow do GitHub só cobre a primeira.
6. **Auth → URL Configuration:** incluir `https://<domínio>/hub` e `https://<domínio>/hub?trilha=*` em Redirect URLs (retorno do e-mail de confirmação).
7. **Frontend:** merge da branch e deploy na Vercel.
8. **Histórico:** `select * from public.hub_backfill_inscricoes(false);` (simulação), revisar slugs não reconhecidos e depois rodar com `true`. Pode ser rodado de novo sem efeito.
9. **Verificação:** comparar as contagens de `auditoria_somente_leitura.sql` com a linha de base. As tabelas legadas só podem ter crescido pelas gravações normais do período.

## Rollback

`supabase/hub_cadastro_universal_rollback.sql`:

- remove o trigger;
- restaura as 4 RPCs legadas exatamente como no repositório e devolve os grants;
- **mantém** as tabelas novas e os dados criados depois da implantação.

Contas criadas pelo hub continuam válidas no legado: são contas comuns do Supabase Auth com `user_metadata.trilha`, como as do `cadastrar-senha.html`. Para o frontend, basta reverter o deploy na Vercel. As Edge Functions voltam com `supabase functions deploy` a partir do commit anterior. Não há restauração de backup antigo, e nada criado depois da implantação é descartado.

## Testes

```bash
cd tests
npm install
npm test        # banco (PGlite, schema legado + migration) e hub (jsdom)
```

Os testes de banco aplicam todos os SQLs do repositório num Postgres local. Os do hub simulam o Supabase. Nenhum dos dois acessa produção.

Em unidade de rede (ex.: `Y:`), o `npm install` fica muito lento. Rode os testes numa cópia do repositório em disco local.

## Ao criar uma trilha nova

Além de `docs/checklist-nova-trilha.md`:

- adicionar o `nome_trilha` do formulário em `public.trilhas_alias`, se ele não for igual ao `trilhas.nome`;
- trilha com aulas fixas no código: incluir as aulas em `supabase/trilhas-estaticas.js` **e** em `public.trilhas_estaticas` / `public.trilha_aulas_estaticas`;
- adicionar o card em `hub.html` (`data-trilha` = slug) e o `nome_trilha` em `HUB_TRILHAS`;
- adicionar a trilha no mapa `TRILHAS` de `trilha-self-enroll`.
