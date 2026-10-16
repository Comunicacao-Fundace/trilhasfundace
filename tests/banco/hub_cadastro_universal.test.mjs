// Testes do cadastro universal sobre o schema legado do repositório.
// Dados 100% sintéticos (domínio example.test). Rode com: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  criarBancoLegado, lerSql, hashesDasFuncoes,
  comoAnon, comoServico, comoUsuario, criarUsuario, chamarCaptureLead,
} from "./ambiente.mjs";

const MIGRATION = lerSql("hub_cadastro_universal.sql");
const BACKFILL = lerSql("hub_backfill_inscricoes.sql");
const ROLLBACK = lerSql("hub_cadastro_universal_rollback.sql");
const HUB = { "x-fundace-origem": "hub" };

const EMAILS = {
  ana: "ana@example.test",       // aluna antiga com conta, duas trilhas no legado
  bruno: "bruno@example.test",   // lead antigo sem conta
  carla: "carla@example.test",   // aluna antiga de trilha dinâmica + NPS
  davi: "davi@example.test",     // conta com e-mail não confirmado
  eva: "eva@example.test",       // nova inscrição pelo formulário legado após a implantação
  fabio: "fabio@example.test",   // novo aluno pelo hub
};

const TABELAS_LEGADAS = [
  "public.leads", "auth.users", "public.user_lesson_progress", "public.trilha_nps_respostas",
  "public.sdr_contact_triggers", "public.trilhas", "public.aulas", "public.comments", "public.lesson_views",
];

async function contagens(db) {
  const saida = {};
  for (const t of TABELAS_LEGADAS) {
    const { rows } = await db.query(`select count(*)::int as n from ${t}`);
    saida[t] = rows[0].n;
  }
  const { rows } = await db.query(
    "select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) as h from public.leads l",
  );
  saida.conteudo_leads = rows[0].h;
  return saida;
}

const inscricoesDe = async (db, email) =>
  (await db.query(
    "select trilha_slug, origem, ultima_origem, user_id, inscrito_em from public.trilha_inscricoes where lead_email = $1 order by trilha_slug",
    [email],
  )).rows;

async function semearLegado(db) {
  // Trilhas dinâmicas (como cadastradas pelo painel admin).
  const { rows: [curso] } = await db.query("select id from public.cursos order by nome limit 1");
  const trilhas = {};
  for (const [slug, nome, aulas] of [
    ["trilha-nova-de-marketing", "Mini Curso Estratégias de Marketing para o Mercado em Transformação", 3],
    ["gedat", "Trilha de Gestão Estratégica", 2],
    ["semana-ia-no-direito", "Semana IA no Direito", 2],
  ]) {
    const { rows: [t] } = await db.query(
      "insert into public.trilhas (nome, descricao, curso_id, status, slug) values ($1, '', $2, 'publicada', $3) returning id",
      [nome, curso.id, slug],
    );
    trilhas[slug] = [];
    for (let i = 1; i <= aulas; i += 1) {
      const { rows: [a] } = await db.query(
        "insert into public.aulas (trilha_id, titulo, vimeo_id, ordem) values ($1, $2, $3, $4) returning id",
        [t.id, `Aula ${i}`, `10000${i}`, i],
      );
      trilhas[slug].push(a.id);
    }
  }

  // Formulários antigos: Ana fez IFRS e depois Finanças (o legado sobrescreve).
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.ana, p_nome: "Ana Sintética", p_cargo: "Contadora" }));
  await comoAnon(db, tx => chamarCaptureLead(tx, {
    p_email: EMAILS.ana, p_nome: "Ana Sintética", p_cargo: "Controller", p_nome_trilha: "Trilha de Finanças",
  }));
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.bruno, p_nome: "Bruno Sintético", p_nome_trilha: "Trilha de Gestão Estratégica" }));
  await comoAnon(db, tx => chamarCaptureLead(tx, {
    p_email: EMAILS.carla, p_nome: "Carla Sintética",
    p_nome_trilha: "Mini Curso Estratégias de Marketing para o Mercado em Transformação",
  }));
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.davi, p_nome: "Davi Sintético", p_nome_trilha: "Trilha de Finanças" }));

  const ana = await criarUsuario(db, { email: EMAILS.ana, metadata: { name: "Ana Sintética", trilha: "ifrs" }, criadoEm: "2026-03-01T00:00:00Z" });
  const carla = await criarUsuario(db, { email: EMAILS.carla, metadata: { name: "Carla Sintética", trilhas: ["ifrs", "gestao"] }, criadoEm: "2026-05-01T00:00:00Z" });
  const davi = await criarUsuario(db, { email: EMAILS.davi, confirmado: false, metadata: { name: "Davi Sintético", trilha: "financas" } });

  // Progresso: Ana concluiu IFRS inteira (8 aulas) e 1 aula de Finanças.
  for (let i = 1; i <= 8; i += 1) {
    await db.query("insert into public.user_lesson_progress (user_id, lesson_id, completed_at) values ($1, $2, $3)",
      [ana.id, `lesson-${i}`, `2026-03-${String(i + 1).padStart(2, "0")} 10:00:00+00`]);
  }
  await db.query("insert into public.user_lesson_progress (user_id, lesson_id, completed_at) values ($1, 'financas-1', '2026-04-01 10:00:00+00')", [ana.id]);
  // Carla concluiu a trilha nova de marketing (dinâmica) e respondeu o NPS.
  for (const aulaId of trilhas["trilha-nova-de-marketing"]) {
    await db.query("insert into public.user_lesson_progress (user_id, lesson_id, completed_at) values ($1, $2, '2026-05-10 10:00:00+00')", [carla.id, aulaId]);
  }
  await db.query("insert into public.trilha_nps_respostas (trail_slug, lead_email, score, created_at) values ('trilha-nova-de-marketing', $1, 9, '2026-05-10')", [EMAILS.carla]);

  return { ana, carla, davi, trilhas };
}

let db;
let legado;
let antes;

before(async () => {
  db = await criarBancoLegado();
  legado = await semearLegado(db);
  antes = await contagens(db);
  await db.exec(MIGRATION);
  await db.exec(BACKFILL);
});

test("guarda de versão: aborta sem aplicar nada se a função de produção difere do repositório", async () => {
  const outro = await criarBancoLegado();
  await outro.exec(`create or replace function public.has_answered_trilha_nps(p_email text, p_trail_slug text)
    returns boolean language sql security definer set search_path = public as $$ select true $$;`);
  await assert.rejects(outro.exec(MIGRATION), /difere do repositório/);
  const { rows } = await outro.query("select to_regclass('public.trilha_inscricoes') as t");
  assert.equal(rows[0].t, null, "nenhuma tabela nova deve ter sido criada");
});

test("migration e backfill não alteram nenhum registro legado", async () => {
  const simulacao = await db.query("select * from public.hub_backfill_inscricoes(false)");
  assert.ok(simulacao.rows.length > 0);
  const { rows: [{ n }] } = await db.query("select count(*)::int as n from public.trilha_inscricoes");
  assert.equal(n, 0, "simulação não grava");

  await db.query("select * from public.hub_backfill_inscricoes(true)");
  assert.deepEqual(await contagens(db), antes);
});

test("backfill é idempotente: segunda execução não cria nada", async () => {
  const { rows: [{ n: n1 }] } = await db.query("select count(*)::int as n from public.trilha_inscricoes");
  const { rows } = await db.query("select * from public.hub_backfill_inscricoes(true)");
  const { rows: [{ n: n2 }] } = await db.query("select count(*)::int as n from public.trilha_inscricoes");
  assert.equal(n2, n1);
  assert.equal(rows.reduce((s, r) => s + Number(r.novas), 0), 0);
});

test("aluna antiga recupera as duas trilhas (inclusive a que o legado sobrescreveu) e o progresso", async () => {
  const { rows: minhas } = await comoUsuario(db, legado.ana, tx => tx.query("select * from public.hub_minhas_inscricoes()"));
  assert.deepEqual(minhas.map(r => r.trilha_slug).sort(), ["financas", "ifrs"]);
  assert.ok(minhas.every(r => r.origem === "reconstrucao"));
  const ifrs = minhas.find(r => r.trilha_slug === "ifrs");
  assert.equal(new Date(ifrs.inscrito_em).toISOString(), "2026-03-01T00:00:00.000Z", "data da conta, não a do backfill");

  const { rows: progresso } = await comoUsuario(db, legado.ana, tx => tx.query("select lesson_id from public.user_lesson_progress"));
  assert.equal(progresso.length, 9);
});

test("trigger grava histórico e tag com leads.id uuid (como em produção)", async () => {
  const { rows: [{ tipo }] } = await db.query(
    "select data_type as tipo from information_schema.columns where table_name = 'leads' and column_name = 'id'");
  assert.equal(tipo, "uuid");
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: "kai@example.test", p_nome_trilha: "Trilha de Finanças" }));
  const { rows } = await db.query("select lead_id from public.leads_historico where email = 'kai@example.test'");
  assert.equal(rows.length, 1, "histórico gravado (antes falhava em silêncio com lead_id bigint)");
  assert.match(rows[0].lead_id, /^[0-9a-f-]{36}$/);
  const [tag] = await inscricoesDe(db, "kai@example.test");
  assert.equal(tag.trilha_slug, "financas");
});

test("backfill usa inscricoes_ia_direito (tabela só de produção) quando existe", async () => {
  const outro = await criarBancoLegado();
  await outro.exec(`insert into public.inscricoes_ia_direito (nome, email, cidade, telefone, formacao_superior, area_formacao, empresa, cargo, pos_mba, created_at)
      values ('Jó', 'JO@example.test', null, '16999990000', 'sim', 'Direito', 'Empresa', 'Advogado', 'sim', '2026-08-01T00:00:00Z');
    insert into public.trilhas (nome, descricao, curso_id, status, slug)
      select 'Semana IA no Direito', '', id, 'publicada', 'semana-ia-no-direito' from public.cursos limit 1;`);
  await outro.exec(MIGRATION);
  await outro.exec(BACKFILL);
  await outro.query("select * from public.hub_backfill_inscricoes(true)");
  const [tag] = await inscricoesDe(outro, "jo@example.test");
  assert.equal(tag.trilha_slug, "semana-ia-no-direito");
  assert.equal(new Date(tag.inscrito_em).toISOString(), "2026-08-01T00:00:00.000Z");
});

test("aliases encontrados em produção resolvem para os slugs reais", async () => {
  const { rows } = await db.query(`select v, public.resolver_trilha_slug(v) as slug from unnest(array[
    'Trilha de Marketing Estratégico', 'marketing', 'Trilha Nova de Marketing', 'trilha-nova-de-marketing',
    'Semana IA no Direito', 'Trilha de Gestão Estratégica', 'Trilha Pocket Gestão Estratégica de TI']) v`);
  assert.deepEqual(rows.map(r => r.slug), [
    "trilha-de-marketing-estrategico", "trilha-de-marketing-estrategico", "trilha-nova-de-marketing", "trilha-nova-de-marketing",
    "semana-ia-no-direito", "gedat", "gestao-estrategica-ti"]);
});

test("lead antigo sem conta tem a tag reconstruída, sem user_id", async () => {
  const [inscricao] = await inscricoesDe(db, EMAILS.bruno);
  assert.equal(inscricao.trilha_slug, "gedat");
  assert.equal(inscricao.user_id, null);
});

test("formulário legado após a implantação: continua igual em leads e ganha uma tag por trilha", async () => {
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.eva, p_nome: "Eva Sintética", p_cargo: "Analista", p_nome_trilha: "Trilha de Gestão de Produção com IA" }));
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.eva, p_nome: "Eva Sintética", p_cargo: "Coordenadora", p_nome_trilha: "Trilha de Gestão de Projetos" }));
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.eva, p_nome: "Eva Sintética", p_cargo: "Coordenadora", p_nome_trilha: "Trilha de Gestão de Projetos" }));

  const { rows: [lead] } = await db.query("select nome_trilha, cargo from public.leads where email = $1", [EMAILS.eva]);
  assert.deepEqual(lead, { nome_trilha: "Trilha de Gestão de Projetos", cargo: "Coordenadora" }, "comportamento legado preservado");

  const inscricoes = await inscricoesDe(db, EMAILS.eva);
  assert.deepEqual(inscricoes.map(i => [i.trilha_slug, i.origem]), [["gestao", "formulario_legado"], ["gestao-projetos", "formulario_legado"]]);

  const { rows: historico } = await db.query("select cargo, trilha_slug, origem from public.leads_historico where email = $1 order by id", [EMAILS.eva]);
  assert.deepEqual(historico.map(h => h.cargo), ["Analista", "Coordenadora", "Coordenadora"], "valores originais preservados");
});

test("novo aluno pelo hub: cadastro único, várias trilhas, sem duplicar", async () => {
  await comoAnon(db, tx => chamarCaptureLead(tx, { p_email: EMAILS.fabio, p_nome: "Fábio Sintético", p_nome_trilha: "Trilha de Gestão Estratégica" }), HUB);
  const fabio = await criarUsuario(db, { email: EMAILS.fabio, metadata: { name: "Fábio Sintético" } });
  legado.fabio = fabio;

  // Segunda trilha (o que a Edge Function trilha-self-enroll faz) — duas vezes.
  for (let i = 0; i < 2; i += 1) {
    await comoServico(db, tx => tx.query(
      "select public.registrar_inscricao_trilha($1, 'trilha-nova-de-marketing', 'hub', $2, null, '{\"fonte\":\"trilha-self-enroll\"}'::jsonb)",
      [EMAILS.fabio, fabio.id],
    ));
  }

  const { rows } = await comoUsuario(db, fabio, tx => tx.query("select * from public.hub_minhas_inscricoes()"));
  assert.deepEqual(rows.map(r => [r.trilha_slug, r.origem]), [["gedat", "hub"], ["trilha-nova-de-marketing", "hub"]]);

  const { rows: [cadastro] } = await comoUsuario(db, fabio, tx => tx.query("select * from public.hub_meu_cadastro()"));
  assert.equal(cadastro.tem_cadastro, true);
});

test("navegador não escreve tags diretamente", async () => {
  await assert.rejects(
    comoUsuario(db, legado.fabio, tx => tx.query("select public.registrar_inscricao_trilha($1, 'ifrs', 'hub')", [EMAILS.fabio])),
    /permission denied/,
  );
  await assert.rejects(
    comoUsuario(db, legado.fabio, tx => tx.query("insert into public.trilha_inscricoes (lead_email, trilha_slug, origem, ultima_origem) values ($1, 'ifrs', 'hub', 'hub')", [EMAILS.fabio])),
    /permission denied/,
  );
});

test("cada aluno vê só os próprios dados", async () => {
  const { rows: tags } = await comoUsuario(db, legado.fabio, tx => tx.query("select distinct lead_email from public.trilha_inscricoes"));
  assert.deepEqual(tags.map(t => t.lead_email), [EMAILS.fabio]);

  const { rows: hist } = await comoUsuario(db, legado.fabio, tx => tx.query("select count(*)::int as n from public.leads_historico"));
  assert.equal(hist[0].n, 0, "histórico só para admin");

  await assert.rejects(comoAnon(db, tx => tx.query("select * from public.trilha_inscricoes")), /permission denied/);
  await assert.rejects(comoAnon(db, tx => tx.query("select * from public.certificados")), /permission denied/);
});

test("RPCs legadas deixam de expor dados de qualquer e-mail", async () => {
  const anonAntigo = await comoAnon(db, tx => tx.query("select * from public.get_lead_offer_context($1)", [EMAILS.bruno]));
  assert.equal(anonAntigo.rows.length, 0, "anon não lê lead antigo");

  const anonRecente = await comoAnon(db, tx => tx.query("select * from public.get_lead_offer_context($1)", [EMAILS.eva]));
  assert.equal(anonRecente.rows.length, 1, "fluxo do cadastrar-senha logo após o formulário continua funcionando");

  const proprio = await comoUsuario(db, legado.ana, tx => tx.query("select * from public.get_lead_offer_context($1)", [EMAILS.ana]));
  assert.equal(proprio.rows.length, 1, "player legado lê o próprio contexto");

  const alheio = await comoUsuario(db, legado.ana, tx => tx.query("select * from public.get_lead_offer_context($1)", [EMAILS.bruno]));
  assert.equal(alheio.rows.length, 0);

  await assert.rejects(
    comoAnon(db, tx => tx.query("select public.record_lead_offer_response($1, true)", [EMAILS.bruno])),
    /Acesso negado/,
  );
  await assert.rejects(
    comoAnon(db, tx => tx.query("select public.update_lead_activecampaign_sync($1, 'x', 'y', 'synced')", [EMAILS.bruno])),
    /permission denied/,
  );
  await comoServico(db, tx => tx.query("select public.update_lead_activecampaign_sync($1, '1', '75', 'synced')", [EMAILS.bruno]));
});

test("NPS: só o próprio aluno responde", async () => {
  await comoUsuario(db, legado.ana, tx => tx.query("select public.record_trilha_nps_resposta($1, 'ifrs', 10)", [EMAILS.ana]));
  await assert.rejects(
    comoUsuario(db, legado.ana, tx => tx.query("select public.record_trilha_nps_resposta($1, 'ifrs', 0)", [EMAILS.carla])),
    /Acesso negado/,
  );
  await assert.rejects(comoAnon(db, tx => tx.query("select public.record_trilha_nps_resposta($1, 'ifrs', 0)", [EMAILS.ana])), /permission denied/);
  const { rows: [r] } = await comoUsuario(db, legado.carla, tx => tx.query("select public.has_answered_trilha_nps($1, 'trilha-nova-de-marketing') as ok", [EMAILS.carla]));
  assert.equal(r.ok, true);
});

test("certificado: emissão conferida no servidor, uma trilha não interfere na outra", async () => {
  const { rows: [cert] } = await comoUsuario(db, legado.ana, tx => tx.query("select * from public.emitir_certificado('ifrs', 'player_legado')"));
  assert.match(cert.codigo, /^FDC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(cert.total_aulas, 8);
  assert.equal(cert.trilha_titulo, "Trilha Contabilidade em IFRS");
  assert.equal(cert.nome_impresso, "Ana Sintética");
  assert.equal(new Date(cert.concluido_em).toISOString(), "2026-03-09T10:00:00.000Z");

  await assert.rejects(
    comoUsuario(db, legado.ana, tx => tx.query("select * from public.emitir_certificado('financas')")),
    /não concluída/,
  );

  const { rows: [dinamico] } = await comoUsuario(db, legado.carla, tx => tx.query("select * from public.emitir_certificado('trilha-nova-de-marketing')"));
  assert.equal(dinamico.total_aulas, 3);
});

test("certificado: repetir a emissão devolve o mesmo código", async () => {
  const emitir = () => comoUsuario(db, legado.ana, tx => tx.query("select codigo from public.emitir_certificado('ifrs')"));
  const [a, b] = [(await emitir()).rows[0].codigo, (await emitir()).rows[0].codigo];
  assert.equal(a, b);
  const { rows: [{ n }] } = await db.query("select count(*)::int as n from public.certificados where trilha_slug = 'ifrs'");
  assert.equal(n, 1);
});

test("certificado: validação pública por código mostra só o que está impresso", async () => {
  const { rows: [{ codigo }] } = await db.query("select codigo from public.certificados where trilha_slug = 'ifrs'");
  const { rows } = await comoAnon(db, tx => tx.query("select * from public.validar_certificado($1)", [` ${codigo.toLowerCase()} `]));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["codigo", "concluido_em", "emitido_em", "nome_impresso", "total_aulas", "trilha_titulo"]);
  const invalido = await comoAnon(db, tx => tx.query("select * from public.validar_certificado('FDC-AAAA-AAAA-AAAA')"));
  assert.equal(invalido.rows.length, 0);
});

test("conta com e-mail não confirmado não recebe o histórico até confirmar", async () => {
  const antesConfirmar = await comoUsuario(db, legado.davi, tx => tx.query("select * from public.hub_minhas_inscricoes()"));
  assert.equal(antesConfirmar.rows.length, 0);
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [legado.davi.id]);
  const depois = await comoUsuario(db, legado.davi, tx => tx.query("select * from public.hub_minhas_inscricoes()"));
  assert.deepEqual(depois.rows.map(r => r.trilha_slug), ["financas"]);
});

test("painel do SDR (legado) continua executando", async () => {
  await db.query("insert into public.admin_users (email) values ('admin@example.test') on conflict do nothing");
  const admin = await criarUsuario(db, { email: "admin@example.test" });
  const { rows } = await comoUsuario(db, admin, tx => tx.query("select * from public.get_marketing_nova_sdr_all()"));
  assert.ok(Array.isArray(rows));
});

test("falha nas estruturas novas nunca derruba o formulário legado", async () => {
  const outro = await criarBancoLegado();
  await outro.exec(MIGRATION);
  await outro.exec("alter table public.trilhas_alias rename to trilhas_alias_quebrada");
  await comoAnon(outro, tx => chamarCaptureLead(tx, { p_email: "gina@example.test" }));
  const { rows: [{ n }] } = await outro.query("select count(*)::int as n from public.leads where email = 'gina@example.test'");
  assert.equal(n, 1);
});

test("rollback volta o legado e preserva os dados criados depois da implantação", async () => {
  const outro = await criarBancoLegado();
  const hashLegado = await hashesDasFuncoes(outro);
  await outro.exec(MIGRATION);
  await comoAnon(outro, tx => chamarCaptureLead(tx, { p_email: "hugo@example.test", p_nome_trilha: "Trilha de Finanças" }), HUB);
  await outro.exec(ROLLBACK);

  assert.deepEqual(await hashesDasFuncoes(outro), hashLegado, "funções legadas idênticas às do repositório");
  const { rows: trg } = await outro.query("select count(*)::int as n from pg_trigger where tgname = 'leads_registrar_historico_trg'");
  assert.equal(trg[0].n, 0);
  const { rows: tags } = await outro.query("select trilha_slug from public.trilha_inscricoes where lead_email = 'hugo@example.test'");
  assert.deepEqual(tags.map(t => t.trilha_slug), ["financas"], "dados novos mantidos");

  // Legado volta a aceitar formulários e a liberar o contexto para anon.
  await comoAnon(outro, tx => chamarCaptureLead(tx, { p_email: "iris@example.test" }));
  const ctx = await comoAnon(outro, tx => tx.query("select * from public.get_lead_offer_context('hugo@example.test')"));
  assert.equal(ctx.rows.length, 1);

  // Reimplantação continua possível.
  await outro.exec(MIGRATION);
});
