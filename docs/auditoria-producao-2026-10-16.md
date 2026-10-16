# Auditoria de produção — 16/10/2026

Feita só com leitura: Management API do Supabase em transação read-only, API da Vercel só com GET. Apenas estrutura e contagens agregadas; nenhum dado pessoal foi extraído.

## Confirmado

- **Projeto:** `hasptpxcyavfdzxtwpws` (us-west-2). **Sem PITR**; backups diários ativos. Restaurar um backup diário perderia as inscrições do dia, então ele não serve como rollback.
- **Funções reescritas pela migration** (`get_lead_offer_context`, `record_lead_offer_response`, `record_trilha_nps_resposta`, `has_answered_trilha_nps`): o hash em produção é idêntico ao do repositório. A guarda de versão deixa aplicar.
- **Schema legado igual ao repositório**, com uma diferença: `trilhas.permite_auto_inscricao` existe em produção e não está nos SQLs.
- **Slugs reais:** `gedat`, `semana-ia-no-direito`, `trilha-nova-de-marketing`, `trilha-de-marketing-estrategico` (a Marketing antiga não usa `marketing`).
- **Sem pg_net, pg_cron, Database Webhooks ou buckets de Storage.** Certificados nunca foram arquivados.
- **Vercel:** projeto `trilhasfundace`, branch de produção `main`. As prévias exigem login (`all_except_custom_domains`).

## Volumes (linha de base)

| Item | Total |
|---|---|
| `leads` | 9.509 (8.615 com conta no Auth, 894 sem conta) |
| `auth.users` | 13.209 (4.594 sem lead; 0 e-mails duplicados) |
| `user_lesson_progress` | 6.122 (4.343 em aulas fixas, 1.779 em aulas do banco) |
| Alunos com progresso em mais de uma trilha dinâmica | 26 |
| `trilha_nps_respostas` | 12 (só `trilha-nova-de-marketing`) |
| `sdr_contact_triggers` | 494 |

Contas com `user_metadata.trilhas`: 5.125. Valor mais frequente: `semana-ia-no-direito`, com 4.634.

## Divergências e riscos

1. **Confirmação de e-mail desligada** (`mailer_autoconfirm = true`; 0 contas não confirmadas). Qualquer pessoa pode criar conta com o e-mail de outra. A regra "só vincula o histórico se o e-mail estiver confirmado" não protege nada enquanto isso estiver desligado. O legado já tem a mesma exposição hoje.
2. **`activecampaign-sync-lead` em produção está atrás do repositório.** Falta o tratamento de Gestão Estratégica de TI. Como o nome contém "estratégica", hoje os leads de Gestão de TI caem na lista do GEDAT (75). Publicar a versão do repositório passa a mandá-los para a lista 77.
3. **`trilha-self-enroll` em produção está à frente do repositório.** Tem o mapeamento `gedat` sem commit. A versão desta branch já o inclui, com o mesmo valor.
4. **Auto-inscrição na Marketing Nova** (201 contas) entrou na lista 35 (Marketing antiga) em vez da 72. A branch corrige isso para as próximas inscrições.
5. **Tabelas fora do repositório:** `inscricoes` (366), `inscricoes_ia_direito` (407), `inscricoes_vendas` (641), `Base GEPOS` e `GEPOS - RH do Futuro`. São gravadas por outras páginas. `inscricoes_ia_direito` entra como evidência no backfill da GDE; as outras não são tocadas.
6. **`Base GEPOS` tem policy de SELECT para `anon` com `true`.** E-mails e telefones podem ser lidos por qualquer pessoa com a chave pública. Fora do escopo do hub, mas é uma exposição atual.
7. **Edge Functions sem código no repositório:** `capture-lead-tracking`, `admin-leads`, `site-event-tracking`, `ia-direito-sync-lead`, `ia-direito-lead-event`, `ploomes-explore-tecorp`. Conferi todas as funções implantadas. Só `activecampaign-sync-lead` e `ploomes-sync-lead` chamam RPCs que a migration restringe (as de status de sincronização), e as duas usam a chave `service_role`, que continua autorizada.
8. **Sem SMTP próprio.** Produção usa o e-mail padrão do Supabase: 2 mensagens por hora, entregues só a membros da equipe. A recuperação de senha do legado já sofre com esse limite. Ligar a confirmação de e-mail sem SMTP próprio bloquearia os cadastros.
9. **Tipos diferentes do repositório:** `leads.id` e `comments.id` são `uuid`; `leads.email` é `text`. `tests/banco/ajustes_producao.sql` reproduz essas e outras diferenças nos testes e na homologação.
10. **Existem duas versões de `capture_lead`** (9 e 19 parâmetros). A migration não mexe em nenhuma; o trigger cobre gravações das duas.
