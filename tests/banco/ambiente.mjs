// Banco Postgres local (PGlite) com o schema legado do repositório + stub do
// Supabase. Usado pelos testes e pelo cálculo dos hashes da guarda de versão.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const aqui = dirname(fileURLToPath(import.meta.url));
const supabaseDir = join(aqui, "..", "..", "supabase");

export const lerSql = nome => readFileSync(join(supabaseDir, nome), "utf8");

// Ordem em que os arquivos legados dependem uns dos outros.
export const SQL_LEGADO = [
  "capture_lead.sql",
  "user_progress.sql",
  "admin_panel.sql",
  "trilhas_admin.sql",
  "aulas_video_provider.sql",
  "trilha_nps.sql",
  "sdr_marketing_nova.sql",
];

export const FUNCOES_GUARDADAS = [
  "public.get_lead_offer_context(text)",
  "public.record_lead_offer_response(text,boolean,boolean)",
  "public.record_trilha_nps_resposta(text,text,integer,text,text)",
  "public.has_answered_trilha_nps(text,text)",
];

// Por padrão o banco de teste reproduz produção: SQLs do repositório +
// ajustes_producao.sql (gerado do catálogo real; ex.: leads.id é uuid).
export async function criarBancoLegado({ comoProducao = true } = {}) {
  const db = await PGlite.create({ extensions: { citext, pgcrypto } });
  await db.exec(readFileSync(join(aqui, "supabase_stub.sql"), "utf8"));
  for (const arquivo of SQL_LEGADO) {
    try {
      await db.exec(lerSql(arquivo));
    } catch (error) {
      throw new Error(`Falha ao aplicar ${arquivo}: ${error.message}`);
    }
  }
  if (comoProducao) {
    try {
      await db.exec(readFileSync(join(aqui, "ajustes_producao.sql"), "utf8"));
    } catch (error) {
      throw new Error(`Falha ao aplicar ajustes_producao.sql: ${error.message}`);
    }
  }
  return db;
}

export async function hashesDasFuncoes(db) {
  const saida = {};
  for (const assinatura of FUNCOES_GUARDADAS) {
    const { rows } = await db.query(
      "select md5(btrim(replace(prosrc, E'\\r', ''))) as h from pg_proc where oid = to_regprocedure($1)",
      [assinatura],
    );
    saida[assinatura] = rows[0]?.h ?? null;
  }
  return saida;
}

// Executa fn dentro de uma transação com o papel e o JWT informados,
// como o PostgREST faz em cada requisição.
async function comPapel(db, papel, claims, headers, fn) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers ?? {})]);
    await tx.exec(`set local role ${papel}`);
    return fn(tx);
  });
}

export const comoAnon = (db, fn, headers) => comPapel(db, "anon", { role: "anon" }, headers, fn);
export const comoServico = (db, fn) => comPapel(db, "service_role", { role: "service_role" }, {}, fn);
export const comoUsuario = (db, usuario, fn, headers) =>
  comPapel(db, "authenticated", { role: "authenticated", sub: usuario.id, email: usuario.email }, headers, fn);

export async function criarUsuario(db, { email, confirmado = true, metadata = {}, criadoEm = null }) {
  const { rows } = await db.query(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data, created_at)
     values ($1, case when $2 then now() else null end, $3::jsonb, coalesce($4::timestamptz, now()))
     returning id, email`,
    [email, confirmado, JSON.stringify(metadata), criadoEm],
  );
  return rows[0];
}

// Mesma chamada que os formulários de captação fazem.
export function chamarCaptureLead(tx, dados) {
  const p = {
    p_nome: "Pessoa Sintética",
    p_email: "sintetico@example.test",
    p_cidade: null,
    p_telefone: "16999990000",
    p_possui_formacao_superior: true,
    p_area_formacao: "Administração",
    p_empresa: "Empresa Sintética",
    p_cargo: "Analista",
    p_pretende_pos: "sim_depois",
    p_nome_trilha: "Trilha CONTIFRS",
    ...dados,
  };
  return tx.query(
    `select * from public.capture_lead(
       p_nome => $1, p_email => $2, p_cidade => $3, p_telefone => $4,
       p_possui_formacao_superior => $5, p_area_formacao => $6, p_empresa => $7,
       p_cargo => $8, p_pretende_pos => $9, p_nome_trilha => $10)`,
    [p.p_nome, p.p_email, p.p_cidade, p.p_telefone, p.p_possui_formacao_superior,
     p.p_area_formacao, p.p_empresa, p.p_cargo, p.p_pretende_pos, p.p_nome_trilha],
  );
}
