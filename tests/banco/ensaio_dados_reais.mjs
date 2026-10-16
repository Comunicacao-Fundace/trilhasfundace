// Ensaio geral em memória com o backup real: restaura, aplica a migration,
// roda o backfill e confere que nada legado muda. Só imprime agregados.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { criarBancoLegado, lerSql } from "./ambiente.mjs";

const pasta = process.argv[2];
const db = await criarBancoLegado();
await db.exec("set session_replication_role = replica;");
const usuarios = JSON.parse(readFileSync(join(pasta, "auth.users.json"), "utf8"));
await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
  select (u->>'id')::uuid, u->>'email', (u->>'email_confirmed_at')::timestamptz, coalesce(u->'raw_user_meta_data','{}'::jsonb), (u->>'created_at')::timestamptz
  from jsonb_array_elements($1::jsonb) u`, [JSON.stringify(usuarios)]);
for (const t of ["cursos", "trilhas", "aulas", "leads", "user_lesson_progress", "trilha_nps_respostas", "sdr_pipeline_stages", "sdr_contact_triggers", "inscricoes_ia_direito"]) {
  await db.query(`delete from public.${t}`);
  await db.query(`insert into public.${t} overriding system value select * from jsonb_populate_recordset(null::public.${t}, $1::jsonb)`,
    [readFileSync(join(pasta, `public.${t}.json`), "utf8")]);
}
await db.exec("set session_replication_role = origin;");

const assinatura = async () => (await db.query(`select
  (select md5(string_agg(l::text, '|' order by l.email)) from public.leads l) leads,
  (select md5(string_agg(p::text, '|' order by p.user_id, p.lesson_id)) from public.user_lesson_progress p) progresso,
  (select md5(string_agg(n::text, '|' order by n.id)) from public.trilha_nps_respostas n) nps,
  (select md5(string_agg(u::text, '|' order by u.id)) from auth.users u) usuarios`)).rows[0];
const antes = await assinatura();

const t0 = Date.now();
await db.exec(lerSql("hub_cadastro_universal.sql"));
await db.exec(lerSql("hub_backfill_inscricoes.sql"));
console.log(`migration aplicada (guarda de versão aceitou) em ${Date.now() - t0} ms`);

const t1 = Date.now();
const { rows } = await db.query("select * from public.hub_backfill_inscricoes(false)");
console.log(`simulação do backfill em ${Date.now() - t1} ms\n`);
console.log("trilha_slug".padEnd(34), "reconhecido", "candidatos", "com_conta", "data_aprox");
let total = 0;
for (const r of rows) {
  total += Number(r.candidatos);
  console.log(String(r.trilha_slug).padEnd(34), String(r.slug_reconhecido).padEnd(11), String(r.candidatos).padEnd(10), String(r.com_conta_confirmada).padEnd(9), r.data_aproximada);
}
const { rows: [{ n: gravadas }] } = await db.query("select count(*)::int n from public.trilha_inscricoes");
console.log(`\ntotal de pares pessoa+trilha: ${total}; gravados pela simulação: ${gravadas}`);

const t2 = Date.now();
await db.query("select * from public.hub_backfill_inscricoes(true)");
const { rows: [r2] } = await db.query(`select count(*)::int tags, count(distinct lead_email)::int pessoas, count(user_id)::int com_conta,
  (select count(*)::int from (select lead_email from public.trilha_inscricoes group by 1 having count(*) > 1) x) multitrilha
  from public.trilha_inscricoes`);
console.log(`aplicado em ${Date.now() - t2} ms: ${r2.tags} tags, ${r2.pessoas} pessoas, ${r2.com_conta} com conta, ${r2.multitrilha} pessoas em mais de uma trilha`);
const { rows: [{ n: semTag }] } = await db.query("select count(*)::int n from public.leads l where not exists (select 1 from public.trilha_inscricoes i where i.lead_email = l.email)");
console.log(`leads sem nenhuma tag: ${semTag}`);
const { rows: [{ novas }] } = await db.query("select coalesce(sum(novas),0)::int novas from public.hub_backfill_inscricoes(true)");
console.log(`segunda execução criou: ${novas}`);

const depois = await assinatura();
const iguais = Object.keys(antes).every(k => antes[k] === depois[k]);
console.log(`\ndados legados idênticos antes/depois (leads, progresso, NPS, usuários): ${iguais ? "SIM" : "NÃO"}`);
process.exit(iguais ? 0 : 1);
