// Teste de restauração do backup lógico num Postgres em memória (descartado
// ao final). Uso: node banco/restaurar_backup.mjs <pasta-do-backup>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { criarBancoLegado } from "./ambiente.mjs";

const pasta = process.argv[2];
const manifesto = JSON.parse(readFileSync(join(pasta, "MANIFESTO.json"), "utf8"));
const db = await criarBancoLegado();
await db.exec("set session_replication_role = replica;"); // sem triggers durante a carga

// Tabelas com o schema reproduzido localmente (legado + ajustes de produção).
const alvo = ["leads", "user_lesson_progress", "trilha_nps_respostas", "cursos", "trilhas", "aulas", "comments",
  "lesson_views", "admin_users", "sdr_pipeline_stages", "sdr_contact_triggers", "sdr_followup_templates",
  "sdr_followup_tasks", "sdr_email_link_clicks", "sdr_approach_templates", "sdr_loss_reason_templates",
  "inscricoes", "inscricoes_ia_direito", "inscricoes_vendas"];

// auth.users primeiro (FKs de progresso/comentários/visualizações).
const usuarios = JSON.parse(readFileSync(join(pasta, "auth.users.json"), "utf8"));
await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
  select (u->>'id')::uuid, u->>'email', (u->>'email_confirmed_at')::timestamptz, coalesce(u->'raw_user_meta_data', '{}'::jsonb), (u->>'created_at')::timestamptz
  from jsonb_array_elements($1::jsonb) u`, [JSON.stringify(usuarios)]);
const { rows: [{ n: nu }] } = await db.query("select count(*)::int n from auth.users");
console.log(`auth.users: ${nu}/${manifesto.auth_users.linhas}`);

let ok = nu === manifesto.auth_users.linhas;
for (const t of ["cursos", "trilhas", ...alvo.filter(x => !["cursos", "trilhas"].includes(x))]) {
  const linhas = JSON.parse(readFileSync(join(pasta, `public.${t}.json`), "utf8"));
  await db.query(`delete from public.${t}`);
  await db.query(`insert into public.${t} overriding system value
    select * from jsonb_populate_recordset(null::public.${t}, $1::jsonb)`, [JSON.stringify(linhas)]);
  const { rows: [{ n }] } = await db.query(`select count(*)::int n from public.${t}`);
  const esperado = manifesto.tabelas[t].linhas;
  if (n !== esperado) ok = false;
  console.log(`${t}: ${n}/${esperado}${n !== esperado ? "  <-- DIVERGE" : ""}`);
}
console.log(ok ? "\nRESTAURAÇÃO OK: todas as contagens conferem." : "\nRESTAURAÇÃO COM DIVERGÊNCIA");
process.exit(ok ? 0 : 1);
