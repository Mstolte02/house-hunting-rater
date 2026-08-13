const ALLOWED_ORIGINS = new Set([
  "https://mstolte02.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://mstolte02.github.io",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      ...extra,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePassword(password: string, salt: string) {
  const saltBytes = base64ToBytes(salt);
  const passwordBytes = encoder.encode(password);
  const combined = new Uint8Array(saltBytes.byteLength + passwordBytes.byteLength);
  combined.set(saltBytes);
  combined.set(passwordBytes, saltBytes.byteLength);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.byteLength] ?? 0) ^ (right[index % right.byteLength] ?? 0);
  }
  return difference === 0;
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function validSession(request: Request, env: Env) {
  const token = bearer(request);
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS valid FROM house_hunt_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1",
  ).bind(await sha256(token), Date.now()).first<{ valid: number }>();
  return row?.valid === 1;
}

async function login(request: Request, env: Env) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = await sha256(forwarded);
  const now = Date.now();
  const cutoff = now - 15 * 60_000;
  const attempts = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM house_hunt_login_attempts WHERE ip_hash = ? AND attempted_at >= ?",
  ).bind(ipHash, cutoff).first<{ total: number }>();
  if ((attempts?.total ?? 0) >= 10) {
    return json(request, { error: "Too many attempts. Try again in 15 minutes." }, 429, { "Retry-After": "900" });
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const config = await env.DB.prepare(
    "SELECT password_salt, password_hash, password_iterations FROM house_hunt_config WHERE id = 'editor'",
  ).first<{ password_salt: string; password_hash: string; password_iterations: number }>();
  if (!config) return json(request, { error: "Editor access has not been configured." }, 503);

  const candidate = await derivePassword(password, config.password_salt);
  const expected = base64ToBytes(config.password_hash);
  if (!constantTimeEqual(candidate, expected)) {
    await env.DB.prepare(
      "INSERT INTO house_hunt_login_attempts (ip_hash, attempted_at) VALUES (?, ?)",
    ).bind(ipHash, now).run();
    return json(request, { error: "Incorrect password." }, 401);
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM house_hunt_login_attempts WHERE ip_hash = ?").bind(ipHash),
    env.DB.prepare("DELETE FROM house_hunt_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "INSERT INTO house_hunt_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
    ).bind(await sha256(token), now + 12 * 60 * 60_000, now),
  ]);
  return json(request, { token, expiresIn: 43_200 });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const origin = request.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: "Origin not allowed." }, 403);

    const segment = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    try {
      if (request.method === "POST" && segment === "login") return await login(request, env);

      if (request.method === "GET" && segment === "session") {
        return await validSession(request, env)
          ? json(request, { valid: true })
          : json(request, { error: "Editor session expired." }, 401);
      }

      if (request.method === "GET" && segment === "state") {
        const row = await env.DB.prepare(
          "SELECT data, revision FROM house_hunt_state WHERE id = 'main'",
        ).first<{ data: string; revision: number }>();
        if (!row) return json(request, { error: "Shared data has not been initialized." }, 503);
        return json(request, { data: JSON.parse(row.data), revision: row.revision });
      }

      if (request.method === "PUT" && segment === "state") {
        if (!(await validSession(request, env))) {
          return json(request, { error: "Unlock editing before saving changes." }, 401);
        }
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 10_000_000) return json(request, { error: "The saved data is too large." }, 413);

        const body = await request.json() as { data?: unknown; revision?: unknown };
        if (!body?.data || typeof body.data !== "object" || Array.isArray(body.data) || !Number.isInteger(body.revision)) {
          return json(request, { error: "Invalid state payload." }, 400);
        }
        const serialized = JSON.stringify(body.data);
        if (serialized.length > 10_000_000) return json(request, { error: "The saved data is too large." }, 413);
        const revision = body.revision as number;
        const result = await env.DB.prepare(
          "UPDATE house_hunt_state SET data = ?, revision = ?, updated_at = ? WHERE id = 'main' AND revision = ?",
        ).bind(serialized, revision + 1, Date.now(), revision).run();
        if (result.meta.changes !== 1) {
          return json(request, { error: "Someone else saved newer changes. Reload before trying again." }, 409);
        }
        return json(request, { revision: revision + 1 });
      }

      return json(request, { error: "Not found." }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "house_hunt_api_error", message: error instanceof Error ? error.message : String(error) }));
      return json(request, { error: "The shared service could not complete that request." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
