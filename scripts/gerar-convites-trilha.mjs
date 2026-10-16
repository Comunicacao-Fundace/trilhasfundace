#!/usr/bin/env node
// Matricula uma lista de alunos numa trilha e gera, para cada um, um link
// pessoal de uso único para criar a senha (página definir-senha.html,
// validada pela Edge Function trilha-invite).
//
// Uso:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/gerar-convites-trilha.mjs \
//     --trilha gedat --entrada alunos.csv --saida links.csv [--horas 72] [--dry-run]
//
// A entrada é um CSV com cabeçalho contendo pelo menos as colunas "email" e
// "nome". Quem já tem conta mantém as trilhas atuais e ganha a nova; quem não
// tem é criado já com e-mail confirmado.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hasptpxcyavfdzxtwpws.supabase.co";
const SITE_URL = (process.env.SITE_URL || "https://trilhasfundace.vercel.app").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function parseArgs(argv) {
  const args = { horas: 72, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--")) args[arg.slice(2)] = argv[++i];
  }
  args.horas = Number(args.horas);
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === ";") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(cell => cell.trim()));
  const keys = header.map(h => h.replace(/^﻿/, "").trim().toLowerCase());
  return body.map(cells => Object.fromEntries(keys.map((key, idx) => [key, (cells[idx] ?? "").trim()])));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function adminFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.msg || body.message || body.error_description || `HTTP ${response.status}`);
  }
  return body;
}

async function listAllUsers() {
  const byEmail = new Map();
  for (let page = 1; ; page++) {
    const { users = [] } = await adminFetch(`/users?page=${page}&per_page=1000`);
    users.forEach(user => byEmail.set(String(user.email || "").toLowerCase(), user));
    if (users.length < 1000) break;
  }
  return byEmail;
}

function mergedTrilhas(userMetadata, trilha) {
  const current = Array.isArray(userMetadata?.trilhas) && userMetadata.trilhas.length
    ? userMetadata.trilhas
    : userMetadata?.trilha ? [userMetadata.trilha] : [];
  return [...new Set([...current, trilha])];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!SERVICE_ROLE_KEY) throw new Error("Defina a variável SUPABASE_SERVICE_ROLE_KEY.");
  if (!args.trilha || !args.entrada || !args.saida) {
    throw new Error("Uso: --trilha <slug> --entrada <alunos.csv> --saida <links.csv> [--horas 72] [--dry-run]");
  }
  if (!(args.horas > 0)) throw new Error("--horas deve ser um número positivo.");

  const trilha = args.trilha.trim().toLowerCase();
  const alunos = parseCsv(readFileSync(args.entrada, "utf8"))
    .map(row => ({ nome: row.nome || "", email: (row.email || "").toLowerCase() }))
    .filter(row => row.email);

  const existing = await listAllUsers();
  const expiresAt = new Date(Date.now() + args.horas * 3600 * 1000).toISOString();
  const output = [["nome", "email", "situacao", "link", "expira_em"]];
  let falhas = 0;

  for (const aluno of alunos) {
    const user = existing.get(aluno.email);
    const secret = randomBytes(32).toString("base64url");
    const appMetadata = {
      invite_token_hash: createHash("sha256").update(secret).digest("hex"),
      invite_expires_at: expiresAt,
      invite_trilha: trilha,
    };

    try {
      let userId;
      let situacao;
      if (user) {
        const userMetadata = {
          ...(user.user_metadata || {}),
          name: user.user_metadata?.name || aluno.nome,
          trilha: user.user_metadata?.trilha || trilha,
          trilhas: mergedTrilhas(user.user_metadata, trilha),
        };
        situacao = user.user_metadata?.trilhas?.includes(trilha) || user.user_metadata?.trilha === trilha
          ? "ja_matriculado"
          : "conta_existente_matriculado";
        if (!args.dryRun) {
          await adminFetch(`/users/${user.id}`, {
            method: "PUT",
            body: JSON.stringify({ user_metadata: userMetadata, app_metadata: appMetadata }),
          });
        }
        userId = user.id;
      } else {
        situacao = "conta_criada";
        if (!args.dryRun) {
          const created = await adminFetch("/users", {
            method: "POST",
            body: JSON.stringify({
              email: aluno.email,
              email_confirm: true,
              user_metadata: { name: aluno.nome, trilha, trilhas: [trilha] },
              app_metadata: appMetadata,
            }),
          });
          userId = created.id;
        }
      }

      const link = args.dryRun ? "(dry-run)" : `${SITE_URL}/definir-senha?token=${userId}.${secret}`;
      output.push([aluno.nome, aluno.email, situacao, link, expiresAt]);
      console.log(`ok    ${aluno.email} (${situacao})`);
    } catch (error) {
      falhas++;
      output.push([aluno.nome, aluno.email, `erro: ${error.message}`, "", ""]);
      console.error(`ERRO  ${aluno.email}: ${error.message}`);
    }
  }

  writeFileSync(args.saida, "﻿" + output.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
  console.log(`\n${alunos.length - falhas}/${alunos.length} processados. Links em ${args.saida} (expiram em ${expiresAt}).`);
  if (falhas) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
