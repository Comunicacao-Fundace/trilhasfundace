// Recalcula os hashes da guarda de versão de supabase/hub_cadastro_universal.sql.
// Rode sempre que alterar as funções legadas guardadas ou a versão nova delas:
//   npm run hashes
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { criarBancoLegado, hashesDasFuncoes, FUNCOES_GUARDADAS } from "./ambiente.mjs";

const arquivo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "hub_cadastro_universal.sql");

function gravarHashes(sql, porFuncao) {
  let saida = sql;
  for (const assinatura of FUNCOES_GUARDADAS) {
    const escapada = assinatura.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linha = new RegExp(`("${escapada}": )\\[[^\\]]*\\]`);
    if (!linha.test(saida)) throw new Error(`Linha da guarda não encontrada para ${assinatura}`);
    saida = saida.replace(linha, `$1${JSON.stringify(porFuncao[assinatura])}`);
  }
  return saida;
}

const original = readFileSync(arquivo, "utf8");

const legadoDb = await criarBancoLegado();
const legado = await hashesDasFuncoes(legadoDb);
if (Object.values(legado).some(h => !h)) throw new Error("Função legada não encontrada no banco de teste.");

// Primeira passada só com o hash legado, para a guarda deixar a migration rodar.
const provisorio = gravarHashes(original, Object.fromEntries(FUNCOES_GUARDADAS.map(f => [f, [legado[f]]])));
await legadoDb.exec(provisorio);
const novo = await hashesDasFuncoes(legadoDb);

const final = gravarHashes(original, Object.fromEntries(FUNCOES_GUARDADAS.map(f => [f, [legado[f], novo[f]]])));
writeFileSync(arquivo, final);
for (const f of FUNCOES_GUARDADAS) console.log(`${f}\n  legado ${legado[f]}\n  novo   ${novo[f]}`);
