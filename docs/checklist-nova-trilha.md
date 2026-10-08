# Checklist e playbook — lançamento de nova trilha

Guia de verificação antes de divulgar uma trilha nova (ou reabrir uma trilha antiga). Baseado no fluxo real do código — não é genérico, cada item aqui corresponde a um ponto específico do sistema que já causou problema em produção ou que é fácil de esquecer.

## 0. Antes de codificar
- [ ] Definir o `slug` da trilha (ex.: `gedat`) — vai virar nome de pasta, rota curta e valor de `trilha` no fluxo de cadastro de senha
- [ ] Definir o `nome_trilha` exato que vai pro banco (usado por ActiveCampaign e Ploomes pra identificar a trilha — ver seções 4 e 5)
- [ ] Confirmar se já existe lista no ActiveCampaign pra essa trilha, ou se precisa criar uma
- [ ] Confirmar se essa trilha deve virar negócio no Ploomes (hoje **só a trilha `marketing-nova` sincroniza com Ploomes** — ver aviso na seção 5)
- [ ] Confirmar o Pixel ID do Meta a usar (pode reaproveitar o de outra trilha ou ser específico da campanha)
- [ ] Reunir materiais: fotos dos professores, vídeos das aulas, textos

## 1. Página de captação (`trilhas/<slug>/captacao.html`)
- [ ] Criar a pasta `trilhas/<slug>/` com `captacao.html` e os arquivos próprios da trilha (fotos, etc.) dentro dela
- [ ] Recursos **compartilhados** entre trilhas (logo, `supabase/config.js`, `supabase/tracking.js`, `Index.html`, `login.html`, `cadastrar-senha.html`) usam caminho relativo `../../`
- [ ] Recursos **próprios** da trilha (fotos de professor, imagens locais) usam caminho **absoluto a partir da raiz** (`/trilhas/<slug>/arquivo.png`) — **nunca** caminho relativo cru (`src="arquivo.png"`)
  > ⚠️ Isso já quebrou em produção nas trilhas GEDAT, GDE e Finanças: a URL curta (`/gedat`) é um *rewrite*, não um *redirect* — o navegador continua vendo `/gedat` na barra de endereço e resolve caminhos relativos a partir dali (raiz do site), não a partir da pasta real do arquivo. Caminho absoluto resolve certo nos dois casos.
- [ ] A variável `TRILHA_NOME` (ou equivalente) no JS da página bate exatamente com o `nome_trilha` esperado nas integrações (seções 4 e 5)
- [ ] `fbq('init', 'ID_DO_PIXEL')` está com o Pixel ID correto
- [ ] Redirecionamento final do formulário aponta pra `../../cadastrar-senha.html?email=...&nome=...&trilha=<slug>`

## 2. Roteamento (`vercel.json`)
- [ ] Adicionar o rewrite: `{ "source": "/<slug>", "destination": "/trilhas/<slug>/captacao.html" }`
- [ ] Validar o JSON antes de commitar: `node -e "JSON.parse(require('fs').readFileSync('vercel.json'))"`

## 3. Fluxo pós-cadastro (`cadastrar-senha.html`)
- [ ] Adicionar o slug no objeto `fallbackMap` (usado quando a página é aberta sem parâmetro de trilha), apontando pra `./trilhas/<slug>/captacao.html`
- [ ] Conferir que nenhum link estático (`back-link`, etc.) ficou apontando pra outra trilha por engano

## 4. ActiveCampaign (`supabase/functions/activecampaign-sync-lead/index.ts`)
- [ ] Criar a variável de ambiente `ACTIVECAMPAIGN_<SLUG>_LIST_ID` (Supabase Edge Function secrets) com o ID da lista certa
- [ ] Adicionar no código a função de detecção da trilha (padrão existente: `isXTrail(lead)` comparando `normalizeText(nome_trilha)`) e o branch que resolve pra essa lista nova — **sem isso o lead cai no comportamento padrão e pode ir pra lista errada**
- [ ] Confirmar que a automação/tag de boas-vindas dessa lista já está configurada no ActiveCampaign

## 5. Ploomes (`supabase/functions/ploomes-sync-lead/index.ts`)
> ⚠️ **Hoje o Ploomes só sincroniza leads da trilha `marketing-nova`** (ver `isMarketingNovaTrail` / mensagem de log "fora do escopo atual" no código). Toda trilha nova é ignorada pelo Ploomes por padrão.
- [ ] Decidir se essa trilha deve virar negócio no Ploomes
- [ ] Se sim: alterar a função pra incluir essa trilha no escopo, e revisar `meetsMarketingNovaCriteria` (ou equivalente) pros critérios de qualificação certos
- [ ] Confirmar `PLOOMES_DEAL_PIPELINE_ID` / `PLOOMES_DEAL_STAGE_ID` corretos pro funil dessa trilha

## 6. Teste de ponta a ponta (antes de divulgar)
- [ ] Acessar a trilha pelos **dois caminhos**: link curto (`/<slug>`) e caminho completo (`/trilhas/<slug>/captacao.html`) — conferir que fotos e logo carregam nos dois
- [ ] Preencher o formulário com um e-mail de teste real, incluindo `?utm_source=teste&utm_campaign=teste` na URL
- [ ] Conferir no Supabase (tabela `leads`) que a linha foi criada com `nome_trilha` certo e os UTMs preenchidos
- [ ] Conferir no Meta Events Manager que o evento `Lead` chegou (pode levar alguns minutos)
- [ ] Conferir no Google Analytics 4 (tempo real) que o evento `generate_lead` chegou
- [ ] Conferir no ActiveCampaign que o contato foi criado/atualizado e está na lista certa
- [ ] Se a trilha sincroniza com Ploomes: conferir que o negócio foi criado no funil certo
- [ ] Testar o fluxo de criação de senha e o login subsequente
- [ ] Testar em um celular de verdade (a maior parte do tráfego de anúncio vem de mobile)

## 7. Divulgação
- [ ] O link usado em anúncios/e-mails é o link curto (`/<slug>`), com UTMs
- [ ] Cuidado com cache de imagem: arquivos de imagem têm `Cache-Control: immutable` por 1 ano (`vercel.json`). Se precisar trocar uma foto/imagem depois do primeiro deploy, suba com **nome de arquivo diferente** — senão quem já acessou continua vendo a versão antiga indefinidamente
