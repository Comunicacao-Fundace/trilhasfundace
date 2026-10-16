// Fluxos do hub.html num navegador simulado (jsdom) com um Supabase falso
// que registra cada chamada. Valida o encaminhamento para a trilha
// escolhida, a gravação do cadastro/inscrição e o certificado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hubHtml = readFileSync(join(repo, "hub.html"), "utf8");
const scriptHub = [...hubHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const htmlSemScripts = hubHtml.replace(/<script\b[\s\S]*?<\/script>/g, "");
const catalogo = readFileSync(join(repo, "supabase", "trilhas-estaticas.js"), "utf8");

const ALIAS = {
  "Trilha CONTIFRS": "ifrs",
  "Trilha de Finanças": "financas",
  "Trilha de Gestão Estratégica": "gedat",
};

function criarBackend({ contas = {}, leads = {}, tags = {}, progresso = {}, sessao = null } = {}) {
  const log = [];
  const state = { contas, leads, tags, progresso, sessao: null, nps: new Set() };
  const trilhasDb = [
    { id: "t1", nome: "Trilha de Gestão Estratégica", slug: "gedat", aulas: [
      { id: "g2", titulo: "Aula B", vimeo_id: "dQw4w9WgXcQ", video_provider: "youtube", ordem: 2 },
      { id: "g1", titulo: "Aula A", vimeo_id: "111", video_provider: "vimeo", ordem: 1 },
    ] },
  ];
  const sessionFor = email => ({
    access_token: "token-" + email,
    user: { id: "uid-" + email, email, user_metadata: state.contas[email].metadata },
  });
  if (sessao) state.sessao = sessionFor(sessao);

  const auth = {
    async getSession() { return { data: { session: state.sessao } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      log.push(["signIn", email]);
      const conta = state.contas[email];
      if (!conta || conta.password !== password) return { data: {}, error: { message: "Invalid login credentials" } };
      state.sessao = sessionFor(email);
      return { data: { session: state.sessao }, error: null };
    },
    async signUp({ email, password, options }) {
      log.push(["signUp", email, options]);
      if (state.contas[email]) return { data: { user: { identities: [] }, session: null }, error: null };
      state.contas[email] = { password, metadata: options.data };
      state.sessao = sessionFor(email);
      return { data: { user: { identities: [{}] }, session: state.sessao }, error: null };
    },
    async signOut() { state.sessao = null; return { error: null }; },
    async updateUser({ data }) {
      log.push(["updateUser", data]);
      const email = state.sessao.user.email;
      state.contas[email].metadata = { ...state.contas[email].metadata, ...data };
      state.sessao.user.user_metadata = state.contas[email].metadata;
      return { data: {}, error: null };
    },
    async resetPasswordForEmail(email, opts) { log.push(["reset", email, opts]); return { error: null }; },
  };

  function rpc(nome, params, cliente) {
    log.push(["rpc", nome, params, cliente]);
    const email = state.sessao?.user.email;
    switch (nome) {
      case "capture_lead":
        state.leads[params.p_email] = params;
        (state.tags[params.p_email] ||= new Set()).add(ALIAS[params.p_nome_trilha]);
        return { data: {}, error: null };
      case "hub_minhas_inscricoes":
        return { data: [...(state.tags[email] || [])].map(s => ({ trilha_slug: s })), error: null };
      case "hub_meu_cadastro":
        return { data: [{ tem_cadastro: Boolean(state.leads[email]), nome: null }], error: null };
      case "has_answered_trilha_nps":
        return { data: state.nps.has(`${email}|${params.p_trail_slug}`), error: null };
      case "record_trilha_nps_resposta":
        state.nps.add(`${email}|${params.p_trail_slug}`);
        return { data: null, error: null };
      case "emitir_certificado":
        return { data: { codigo: "FDC-AAAA-BBBB-CCCC", nome_impresso: "Nome Impresso", trilha_titulo: "Título do Servidor", emitido_em: "2026-10-16T00:00:00Z" }, error: null };
      case "track_lesson_view":
        return { data: null, error: null };
      default:
        throw new Error("RPC inesperada: " + nome);
    }
  }

  function from(tabela) {
    return {
      select() {
        return {
          async eq(coluna, valor) {
            if (tabela === "trilhas") return { data: trilhasDb, error: null };
            if (tabela === "user_lesson_progress") return { data: [...(state.progresso[valor] || [])].map(id => ({ lesson_id: id })), error: null };
            throw new Error("select inesperado " + tabela);
          },
        };
      },
      async upsert(linha) {
        log.push(["upsert", tabela, linha]);
        (state.progresso[linha.user_id] ||= new Set()).add(linha.lesson_id);
        return { error: null };
      },
    };
  }

  const createClient = (_url, _key, opts = {}) => {
    const cliente = opts.global?.headers?.["x-fundace-origem"] === "hub" ? "cadastro-hub" : "principal";
    return { auth, rpc: async (nome, params) => rpc(nome, params, cliente), from };
  };

  async function fetchFalso(url, init) {
    const corpo = JSON.parse(init.body);
    const funcao = url.split("/functions/v1/")[1];
    log.push(["function", funcao, corpo, init.headers.Authorization]);
    if (funcao === "trilha-self-enroll") {
      (state.tags[state.sessao.user.email] ||= new Set()).add(corpo.trilhaSlug);
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }

  return { log, state, createClient, fetch: fetchFalso };
}

const esperar = () => new Promise(resolve => setTimeout(resolve, 40));

async function abrirHub(backend, url = "https://trilhas.example.test/hub") {
  const dom = new JSDOM(htmlSemScripts, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.alert = mensagem => backend.log.push(["alert", mensagem]);
  w.SUPABASE_CONFIG = { url: "https://projeto.example.test", anonKey: "chave-anon-publica" };
  w.supabase = { createClient: backend.createClient };
  w.fetch = backend.fetch;
  w.FundaceCertificado = { baixar: async opts => backend.log.push(["pdf", opts]) };
  w.eval(catalogo);
  w.eval(scriptHub);
  await esperar();
  const doc = w.document;
  return {
    w,
    doc,
    tela: () => doc.querySelector(".screen.active").id,
    texto: id => doc.getElementById(id).textContent,
    clicar: async seletor => { doc.querySelector(seletor).click(); await esperar(); },
    enviar: async formId => { doc.getElementById(formId).requestSubmit(); await esperar(); },
    preencher: valores => Object.entries(valores).forEach(([id, valor]) => { doc.getElementById(id).value = valor; }),
    marcar: (nome, valor) => { doc.querySelector(`input[name="${nome}"][value="${valor}"]`).checked = true; },
  };
}

function preencherCadastro(hub, email) {
  hub.marcar("superior", "Sim");
  hub.marcar("mba", "Sim, imediatamente");
  hub.preencher({
    "full-name": "Pessoa Sintética", "reg-email": email, city: "Ribeirão Preto",
    phone: "+55 16 99999-0000", area: "Administração e Gestão", company: "Empresa Sintética",
    role: "Analista", "reg-password": "senha-sintetica", "confirm-password": "senha-sintetica",
  });
}

// Objetos vindos do jsdom têm outro protótipo; compara só os dados.
const plano = valor => JSON.parse(JSON.stringify(valor));

const chamadas = (backend, tipo, nome) => backend.log.filter(l => l[0] === tipo && (!nome || l[1] === nome));

test("visitante escolhe a trilha, faz o cadastro e cai direto nela", async () => {
  const backend = criarBackend();
  const hub = await abrirHub(backend);
  assert.equal(hub.doc.querySelectorAll("#trails-track > .trail").length, 9);

  await hub.clicar('[data-trilha="gedat"]');
  assert.equal(hub.tela(), "login");
  assert.match(hub.doc.querySelector("#login .muted").textContent, /Gestão Estratégica Baseada em Dados/);

  await hub.clicar('#login [data-page="register"]');
  preencherCadastro(hub, "nova@example.test");
  await hub.enviar("register-form");

  assert.equal(hub.tela(), "lesson");
  assert.equal(hub.texto("lesson-title"), "Aula A", "aulas na ordem do banco");
  assert.match(hub.w.location.search, /trilha=gedat/);
  assert.match(hub.doc.querySelector(".lesson-player iframe").src, /player\.vimeo\.com\/video\/111/);

  const [captura] = chamadas(backend, "rpc", "capture_lead");
  assert.equal(captura[3], "cadastro-hub", "cadastro marcado com origem hub");
  assert.equal(captura[2].p_nome_trilha, "Trilha de Gestão Estratégica");
  assert.equal(captura[2].p_pretende_pos, "sim_agora");
  assert.equal(captura[2].p_possui_formacao_superior, true);
  assert.equal(captura[2].p_telefone, "5516999990000");

  const [ac] = chamadas(backend, "function", "activecampaign-sync-lead");
  assert.equal(ac[2].nome_trilha, "Trilha de Gestão Estratégica");

  const [cadastro] = chamadas(backend, "signUp");
  assert.deepEqual(plano(cadastro[2].data), { name: "Pessoa Sintética", trilha: "gedat", trilhas: ["gedat"] });
  assert.equal(cadastro[2].emailRedirectTo, "https://trilhas.example.test/hub?trilha=gedat");
  assert.equal(chamadas(backend, "function", "trilha-self-enroll").length, 0, "primeira trilha não usa auto-inscrição");
});

test("ao concluir as aulas: feedback obrigatório e certificado com código", async () => {
  const backend = criarBackend();
  const hub = await abrirHub(backend);
  await hub.clicar('[data-trilha="gedat"]');
  await hub.clicar('#login [data-page="register"]');
  preencherCadastro(hub, "nova@example.test");
  await hub.enviar("register-form");

  assert.equal(hub.doc.getElementById("lesson-finish").hidden, true);
  await hub.clicar("#mark-done");
  await hub.clicar("#next-lesson");
  assert.match(hub.doc.querySelector(".lesson-player iframe").src, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  await hub.clicar("#mark-done");
  assert.equal(hub.texto("lesson-progress-label"), "2 de 2 aulas concluídas");
  assert.equal(hub.doc.getElementById("lesson-finish").hidden, false);

  await hub.clicar("#certificate-btn");
  assert.match(hub.texto("finish-status"), /nota de 0 a 10/);
  assert.equal(chamadas(backend, "pdf").length, 0);

  await hub.clicar('#nps-scale [data-score="9"]');
  await hub.clicar("#certificate-btn");
  const [nps] = chamadas(backend, "rpc", "record_trilha_nps_resposta");
  assert.equal(nps[2].p_trail_slug, "gedat");
  assert.equal(nps[2].p_score, 9);
  const [emissao] = chamadas(backend, "rpc", "emitir_certificado");
  assert.deepEqual(plano(emissao[2]), { p_trilha_slug: "gedat", p_origem: "hub" });
  const [pdf] = chamadas(backend, "pdf");
  assert.equal(pdf[1].codigo, "FDC-AAAA-BBBB-CCCC");
  assert.equal(pdf[1].curso.title, "Título do Servidor", "título vem do servidor");
  assert.equal(hub.doc.getElementById("finish-feedback").hidden, true);
});

test("aluno antigo entra por outra trilha: login leva à trilha, mantém progresso e cria a tag", async () => {
  const backend = criarBackend({
    contas: { "ana@example.test": { password: "senha-da-ana", metadata: { name: "Ana", trilha: "financas" } } },
    leads: { "ana@example.test": {} },
    tags: { "ana@example.test": new Set(["financas"]) },
    progresso: { "uid-ana@example.test": new Set(["lesson-1", "lesson-2"]) },
  });
  const hub = await abrirHub(backend);
  await hub.clicar('[data-trilha="ifrs"]');
  hub.preencher({ "login-email": "ana@example.test", "login-password": "senha-da-ana" });
  await hub.enviar("login-form");

  assert.equal(hub.tela(), "lesson");
  assert.equal(hub.texto("lesson-progress-label"), "2 de 8 aulas concluídas");
  assert.equal(hub.texto("lesson-index"), "AULA 3 DE 8", "abre na primeira aula pendente");
  const [inscricao] = chamadas(backend, "function", "trilha-self-enroll");
  assert.deepEqual(inscricao[2], { trilhaSlug: "ifrs", origem: "hub" });
  assert.equal(inscricao[3], "Bearer token-ana@example.test");
  assert.equal(chamadas(backend, "rpc", "capture_lead").length, 0, "não pede o cadastro de novo");
  assert.equal(chamadas(backend, "upsert").length, 0, "não reescreve progresso existente");
});

test("link com ?trilha= e sessão ativa abre a trilha sem novo login nem nova inscrição", async () => {
  const backend = criarBackend({
    contas: { "ana@example.test": { password: "x", metadata: { name: "Ana" } } },
    leads: { "ana@example.test": {} },
    tags: { "ana@example.test": new Set(["financas"]) },
    sessao: "ana@example.test",
  });
  const hub = await abrirHub(backend, "https://trilhas.example.test/hub?trilha=financas");
  assert.equal(hub.tela(), "lesson");
  assert.equal(chamadas(backend, "signIn").length, 0);
  assert.equal(chamadas(backend, "function", "trilha-self-enroll").length, 0);
  assert.equal(hub.texto("welcome"), "Olá, Ana");
});

test("cadastro com e-mail que já tem conta: entra com a senha e segue para a trilha", async () => {
  const backend = criarBackend({
    contas: { "nova@example.test": { password: "senha-sintetica", metadata: { name: "Pessoa" } } },
  });
  const hub = await abrirHub(backend);
  await hub.clicar('[data-trilha="gedat"]');
  await hub.clicar('#login [data-page="register"]');
  preencherCadastro(hub, "nova@example.test");
  await hub.enviar("register-form");
  assert.equal(hub.tela(), "lesson");
  assert.equal(chamadas(backend, "signIn").length, 1);
});

test("cadastro sem trilha escolhida: o perfil vai para leads junto com a primeira trilha", async () => {
  const backend = criarBackend();
  const hub = await abrirHub(backend);
  await hub.clicar("#hub-enter");
  await hub.clicar('#login [data-page="register"]');
  preencherCadastro(hub, "semtrilha@example.test");
  await hub.enviar("register-form");

  assert.equal(hub.tela(), "hub");
  assert.equal(chamadas(backend, "rpc", "capture_lead").length, 0);
  const [cadastro] = chamadas(backend, "signUp");
  assert.equal(cadastro[2].data.hub_perfil.cargo, "Analista");
  assert.equal(cadastro[2].data.hub_perfil.email, undefined, "e-mail fica só na conta");

  await hub.clicar('[data-trilha="gedat"]');
  assert.equal(hub.tela(), "lesson");
  const [captura] = chamadas(backend, "rpc", "capture_lead");
  assert.equal(captura[2].p_email, "semtrilha@example.test");
  assert.equal(captura[2].p_nome_trilha, "Trilha de Gestão Estratégica");
  assert.deepEqual(plano(chamadas(backend, "updateUser")[0][1]), { hub_perfil: null });
});

test("sair limpa a sessão e a trilha da URL", async () => {
  const backend = criarBackend({
    contas: { "ana@example.test": { password: "x", metadata: { name: "Ana" } } },
    leads: { "ana@example.test": {} },
    tags: { "ana@example.test": new Set(["financas"]) },
    sessao: "ana@example.test",
  });
  const hub = await abrirHub(backend, "https://trilhas.example.test/hub?trilha=financas");
  await hub.clicar("#back-hub");
  await hub.clicar("#logout");
  assert.equal(hub.tela(), "hub");
  assert.equal(hub.w.location.search, "");
  assert.equal(hub.doc.getElementById("hub-enter").hidden, false);
});
