// Ponta a ponta na HOMOLOGAÇÃO (Supabase real: PostgREST, Auth, RLS, Edge
// Functions). Mesmas chamadas do hub e do legado. Só contas @example.test.
// Uso (de tests/): node homologacao/e2e.mjs  — lê ../.env.local; recusa produção.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local"), "utf8")
  .split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "").trim()]));
const STG = env.SUPABASE_STAGING_REF;
if (!STG || STG === env.SUPABASE_PROD_REF) throw new Error("Recusado: não é a homologação.");
const mgmt = async p => (await fetch(`https://api.supabase.com${p}`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })).json();
const keys = await mgmt(`/v1/projects/${STG}/api-keys?reveal=true`);
const ANON = keys.find(k => k.name === "anon").api_key;
const SERVICE = keys.find(k => k.name === "service_role").api_key;
const URL = `https://${STG}.supabase.co`;

const novoCliente = headers => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: headers ? { headers } : undefined });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Date.now().toString(36);

const resultados = [];
async function cenario(nome, fn) {
  try { await fn(); resultados.push(["OK", nome]); }
  catch (e) { resultados.push(["FALHOU", nome + " — " + e.message]); }
}
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };
const capture = (cli, email, nomeTrilha, extra = {}) => cli.rpc("capture_lead", {
  p_nome: "Pessoa Sintética", p_email: email, p_cidade: null, p_telefone: "16999990000",
  p_possui_formacao_superior: true, p_area_formacao: "Administração e Gestão", p_empresa: "Empresa Sintética",
  p_cargo: "Analista", p_pretende_pos: "sim_agora", p_nome_trilha: nomeTrilha, ...extra,
});
const fn = (nome, token, body) => fetch(`${URL}/functions/v1/${nome}`, {
  method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const tagsDe = async email => (await admin.from("trilha_inscricoes").select("trilha_slug, origem, user_id").eq("lead_email", email)).data;
async function entrar(email, password) {
  const cli = novoCliente();
  const { data, error } = await cli.auth.signInWithPassword({ email, password });
  if (error) throw new Error("login: " + error.message);
  return { cli, session: data.session };
}

// 1. Formulário antigo continua funcionando e grava a tag da trilha.
const legado = `legado.${run}@example.test`;
await cenario("1. formulário antigo (capture_lead + ActiveCampaign) continua funcionando", async () => {
  const anon = novoCliente();
  const { error } = await capture(anon, legado, "Trilha de Gestão Estratégica");
  exigir(!error, "capture_lead: " + error?.message);
  const ac = await fn("activecampaign-sync-lead", ANON, { nome: "Pessoa Sintética", email: legado, telefone: "16999990000", nome_trilha: "Trilha de Gestão Estratégica" });
  exigir(ac.status !== 403, "envio recente deveria ser aceito, veio 403");
  const { data: lead } = await admin.from("leads").select("activecampaign_sync_status, activecampaign_sync_error").eq("email", legado).single();
  exigir(lead.activecampaign_sync_status === "error" && /ac-homologacao|fetch|dns|invalid/i.test(lead.activecampaign_sync_error || ""),
    "esperava falha só no ActiveCampaign falso; veio " + JSON.stringify(lead));
});

await cenario("2. novo registro no legado fica associado à trilha certa (tag + histórico)", async () => {
  const tags = await tagsDe(legado);
  exigir(tags.length === 1 && tags[0].trilha_slug === "gedat" && tags[0].origem === "formulario_legado", JSON.stringify(tags));
  const { data: h } = await admin.from("leads_historico").select("origem, lead_id").eq("email", legado);
  exigir(h.length === 1 && /^[0-9a-f-]{36}$/.test(h[0].lead_id), "histórico: " + JSON.stringify(h));
  const anon = novoCliente();
  await capture(anon, legado, "Trilha de Finanças", { p_cargo: "Coordenadora" });
  const tags2 = (await tagsDe(legado)).map(t => t.trilha_slug).sort();
  exigir(JSON.stringify(tags2) === '["financas","gedat"]', "segunda trilha: " + JSON.stringify(tags2));
  const { data: l } = await admin.from("leads").select("nome_trilha, cargo").eq("email", legado).single();
  exigir(l.nome_trilha === "Trilha de Finanças" && l.cargo === "Coordenadora", "regra legada (mais recente vale) mudou");
});

await cenario("1b. ActiveCampaign recusa e-mail sem envio recente (proteção nova)", async () => {
  const r = await fn("activecampaign-sync-lead", ANON, { nome: "X", email: "bruno.semconta@example.test", telefone: "16999990000" });
  exigir(r.status === 403, "esperava 403, veio " + r.status);
});

await cenario("1c. cadastrar-senha.html: contexto da oferta só para quem acabou de enviar", async () => {
  const anon = novoCliente();
  const recente = await anon.rpc("get_lead_offer_context", { p_email: legado });
  exigir(recente.data?.length === 1, "fluxo legado quebrou: " + JSON.stringify(recente));
  const antigo = await anon.rpc("get_lead_offer_context", { p_email: "bruno.semconta@example.test" });
  exigir((antigo.data || []).length === 0, "anon ainda lê lead antigo");
});

// 3. Aluna antiga acessa o histórico.
const ANA = "ana.antiga@example.test";
const senhaAna = "Senha-Sintetica-" + run;
await cenario("3. aluna antiga entra e vê as duas trilhas (inclusive a sobrescrita) e o progresso", async () => {
  const { data: u } = await admin.auth.admin.listUsers();
  const ana = u.users.find(x => x.email === ANA);
  await admin.auth.admin.updateUserById(ana.id, { password: senhaAna });
  const { cli } = await entrar(ANA, senhaAna);
  const { data: minhas, error } = await cli.rpc("hub_minhas_inscricoes");
  exigir(!error, error?.message);
  exigir(JSON.stringify(minhas.map(m => m.trilha_slug).sort()) === '["financas","ifrs"]', JSON.stringify(minhas));
  const { data: prog } = await cli.from("user_lesson_progress").select("lesson_id");
  exigir(prog.length === 9, "progresso: " + prog.length);
});

// 4. Novo aluno pelo hub: cadastro único, várias trilhas.
const novo = `hub.${run}@example.test`;
const senhaNovo = "Senha-Sintetica-" + run;
let sessaoNovo;
await cenario("4. novo aluno pelo hub: cadastro, primeira trilha e segunda trilha sem novo cadastro", async () => {
  const hubCli = novoCliente({ "x-fundace-origem": "hub" });
  const { error: e1 } = await capture(hubCli, novo, "Trilha de Gestão Estratégica");
  exigir(!e1, "capture_lead hub: " + e1?.message);
  const cli = novoCliente();
  const { data: s, error: e2 } = await cli.auth.signUp({ email: novo, password: senhaNovo, options: { data: { name: "Novo Sintético", trilha: "gedat", trilhas: ["gedat"] } } });
  exigir(!e2 && s.session, "signUp: " + (e2?.message || "sem sessão"));
  sessaoNovo = s.session;
  const { data: m1 } = await cli.rpc("hub_minhas_inscricoes");
  exigir(m1.length === 1 && m1[0].trilha_slug === "gedat" && m1[0].origem === "hub", "primeira trilha: " + JSON.stringify(m1));
  const r = await fn("trilha-self-enroll", s.session.access_token, { trilhaSlug: "trilha-nova-de-marketing", origem: "hub" });
  exigir(r.status === 200 && r.body.ok, "self-enroll: " + JSON.stringify(r));
  const r2 = await fn("trilha-self-enroll", s.session.access_token, { trilhaSlug: "trilha-nova-de-marketing", origem: "hub" });
  exigir(r2.status === 200, "repetição: " + r2.status);
  const tags = await tagsDe(novo);
  exigir(tags.length === 2 && tags.every(t => t.user_id === s.user.id), "tags: " + JSON.stringify(tags));
});

// 5 e 7. Progresso e certificado por trilha; validação pública.
await cenario("5/7. certificado: conferido no servidor, independente por trilha, validável e sem duplicar", async () => {
  const cli = novoCliente();
  await cli.auth.setSession({ access_token: sessaoNovo.access_token, refresh_token: sessaoNovo.refresh_token });
  const { data: gedat } = await admin.from("trilhas").select("id, aulas(id)").eq("slug", "gedat").single();
  const antes = await cli.rpc("emitir_certificado", { p_trilha_slug: "gedat", p_origem: "hub" });
  exigir(antes.error && /conclu/i.test(antes.error.message), "emitiu sem concluir");
  for (const a of gedat.aulas) {
    const { error } = await cli.from("user_lesson_progress").upsert({ user_id: sessaoNovo.user.id, lesson_id: a.id }, { onConflict: "user_id,lesson_id" });
    exigir(!error, "progresso: " + error?.message);
  }
  const c1 = await cli.rpc("emitir_certificado", { p_trilha_slug: "gedat", p_origem: "hub" });
  const c2 = await cli.rpc("emitir_certificado", { p_trilha_slug: "gedat", p_origem: "hub" });
  exigir(!c1.error && c1.data.codigo === c2.data.codigo, "código instável: " + JSON.stringify([c1, c2]));
  const outra = await cli.rpc("emitir_certificado", { p_trilha_slug: "trilha-nova-de-marketing" });
  exigir(outra.error, "trilha não concluída emitiu certificado");
  const val = await novoCliente().rpc("validar_certificado", { p_codigo: c1.data.codigo.toLowerCase() });
  exigir(val.data?.[0]?.trilha_titulo === "Trilha de Gestão Estratégica", "validação: " + JSON.stringify(val));
});

// 6. Cada aluno só vê os próprios dados.
await cenario("6. isolamento: cada aluno só vê os próprios dados; visitante não lê nada privado", async () => {
  const { cli } = await entrar(ANA, senhaAna);
  const { data: t } = await cli.from("trilha_inscricoes").select("lead_email");
  exigir(t.length > 0 && t.every(x => x.lead_email === ANA), "tags alheias visíveis");
  const { data: c } = await cli.from("certificados").select("lead_email");
  exigir((c || []).every(x => x.lead_email === ANA), "certificados alheios visíveis");
  const { data: h } = await cli.from("leads_historico").select("id");
  exigir((h || []).length === 0, "histórico visível para aluno");
  const anon = novoCliente();
  for (const tabela of ["trilha_inscricoes", "certificados", "leads_historico", "leads"]) {
    const { data, error } = await anon.from(tabela).select("*").limit(1);
    exigir(error || (data || []).length === 0, `anon leu ${tabela}`);
  }
  const nps = await cli.rpc("record_trilha_nps_resposta", { p_email: "carla.marketing@example.test", p_trail_slug: "ifrs", p_score: 0 });
  exigir(nps.error && /negado/i.test(nps.error.message), "NPS em nome de outra pessoa foi aceito");
  const sync = await anon.rpc("update_lead_activecampaign_sync", { p_email: legado, p_status: "synced" });
  exigir(sync.error, "anon alterou status de sincronização");
});

// 8. Repetir não duplica (formulário repetido).
await cenario("8. repetir operações não duplica tags nem certificados", async () => {
  const anon = novoCliente();
  await capture(anon, legado, "Trilha de Finanças");
  await capture(anon, legado, "Trilha de Finanças");
  const tags = await tagsDe(legado);
  exigir(tags.length === 2, "tags duplicadas: " + tags.length);
  const { count } = await admin.from("certificados").select("*", { count: "exact", head: true }).eq("lead_email", novo);
  exigir(count === 1, "certificados: " + count);
});

// GDE: conta que só existe por user_metadata + inscricoes_ia_direito.
await cenario("3b. aluna da GDE (sem lead) tem a trilha reconhecida", async () => {
  const tags = await tagsDe("gabi.direito@example.test");
  exigir(tags.length === 1 && tags[0].trilha_slug === "semana-ia-no-direito" && tags[0].user_id, JSON.stringify(tags));
});

for (const [s, n] of resultados) console.log(s.padEnd(7), n);
console.log(`\n${resultados.filter(r => r[0] === "OK").length}/${resultados.length} cenários ok`);
