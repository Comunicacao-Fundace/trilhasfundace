import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Convites de acesso gerados pelo script scripts/gerar-convites-trilha.mjs.
// O token tem o formato "<user_id>.<segredo>". Só o hash SHA-256 do segredo
// fica salvo em app_metadata (invite_token_hash + invite_expires_at), que o
// usuário não consegue alterar. Depois que a senha é definida o convite é
// apagado, então cada link funciona uma única vez.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  action?: "check" | "redeem";
  token?: string;
  password?: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function resolveInvite(rawToken: string) {
  const token = rawToken.trim();
  const separator = token.indexOf(".");
  const userId = separator > 0 ? token.slice(0, separator) : "";
  const secret = separator > 0 ? token.slice(separator + 1) : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId) || secret.length < 32) {
    return { error: json({ error: "Link inválido.", code: "invalid" }, 400) };
  }

  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  const user = data?.user;
  if (error || !user) {
    return { error: json({ error: "Link inválido.", code: "invalid" }, 400) };
  }

  const meta = user.app_metadata ?? {};
  const storedHash = String(meta.invite_token_hash ?? "");
  if (!storedHash || !safeEqual(storedHash, await sha256Hex(secret))) {
    return { error: json({ error: "Este link já foi usado ou não é mais válido.", code: "used" }, 400) };
  }

  const expiresAt = Date.parse(String(meta.invite_expires_at ?? ""));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return { error: json({ error: "Este link expirou.", code: "expired" }, 400) };
  }

  return { user };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ error: "Body inválido." }, 400);
  }

  const result = await resolveInvite(String(payload.token ?? ""));
  if ("error" in result) return result.error;
  const { user } = result;

  const trilha = String(user.app_metadata?.invite_trilha ?? user.user_metadata?.trilha ?? "");

  if (payload.action === "check") {
    return json({
      ok: true,
      email: user.email ?? "",
      nome: String(user.user_metadata?.name ?? ""),
      trilha,
      expiresAt: user.app_metadata?.invite_expires_at ?? null,
    });
  }

  if (payload.action !== "redeem") {
    return json({ error: "Ação inválida." }, 400);
  }

  const password = String(payload.password ?? "");
  if (password.length < 6) {
    return json({ error: "A senha deve ter ao menos 6 caracteres." }, 400);
  }

  // O GoTrue mescla app_metadata; chave com null é removida.
  const { error } = await adminClient.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    app_metadata: { invite_token_hash: null, invite_expires_at: null, invite_trilha: null },
  });

  if (error) {
    return json({ error: `Não foi possível salvar a senha: ${error.message}` }, 400);
  }

  return json({ ok: true, email: user.email ?? "", trilha });
});
