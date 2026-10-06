import { loadAdmins, isActive } from "../../_lib/admin.js";

export const ADMIN_COOKIE = "muefi_admin_session";
const SESSION_TTL = 60 * 60 * 4;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function base64urlEncode(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  for (let i = 0; i < arr.length; i += 0x8000) {
    binary += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function hmacKey(secret) {
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload, secret) {
  const encoded = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );

  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded)
  );

  return `${encoded}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function verifyPayload(token, secret) {
  try {
    const [encoded, signature] = String(token || "").split(".");

    if (!encoded || !signature) return null;

    const key = await hmacKey(secret);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signature),
      new TextEncoder().encode(encoded)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encoded))
    );

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function createAdminSession(env, admin) {
  const now = Math.floor(Date.now() / 1000);

  return signPayload(
    {
      role: "super_admin",
      adminId: admin.adminId,
      name: admin.name,
      iat: now,
      exp: now + SESSION_TTL
    },
    env.SESSION_SECRET
  );
}

export async function getAdminSession(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`)
  );

  if (!match) return null;

  return verifyPayload(match[1], env.SESSION_SECRET);
}

export async function requireAdmin(request, env) {
  const session = await getAdminSession(request, env);

  if (!session || session.role !== "super_admin") {
    return null;
  }

  return session;
}

export function adminCookie(token) {
  return [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL}`
  ].join("; ");
}

export function clearAdminCookie() {
  return [
    `${ADMIN_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

export function safeEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");

  if (left.length !== right.length) return false;

  let result = 0;

  for (let i = 0; i < left.length; i++) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return result === 0;
}

export async function findAdmin(env, adminId) {
  const rows = await loadAdmins(env);
  const wanted = String(adminId || "").trim().toLowerCase();

  const index = rows.findIndex(
    row => String(row[0] || "").trim().toLowerCase() === wanted
  );

  if (index === -1) return null;

  return {
    row: rows[index],
    index,
    sheetRow: index + 2,
    adminId: String(rows[index][0] || "").trim(),
    pin: String(rows[index][1] || "").trim(),
    name: String(rows[index][2] || "").trim(),
    active: isActive(rows[index][3])
  };
}

export async function rateLimitLogin(env, key) {
  if (!env?.KV) return { allowed: true, remaining: 5 };

  const storageKey = `admin_login_fail:${key}`;
  const current = Number((await env.KV.get(storageKey)) || 0);

  if (current >= 5) {
    return { allowed: false, remaining: 0 };
  }

  return {
    allowed: true,
    remaining: Math.max(0, 5 - current)
  };
}

export async function recordLoginFailure(env, key) {
  if (!env?.KV) return;

  const storageKey = `admin_login_fail:${key}`;
  const current = Number((await env.KV.get(storageKey)) || 0);

  await env.KV.put(storageKey, String(current + 1), {
    expirationTtl: 900
  });
}

export async function clearLoginFailures(env, key) {
  if (env?.KV) {
    await env.KV.delete(`admin_login_fail:${key}`);
  }
}

export function cleanText(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

export function validatePin(value) {
  const pin = String(value ?? "").trim();
  return /^\d{4,12}$/.test(pin);
}

export function normalizeGradeLevels(value) {
  let values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",");

  const grades = values
    .map(v => String(v).trim().match(/^Grade\s*(10|[1-9])$/i))
    .filter(Boolean)
    .map(m => `Grade ${m[1]}`);

  return [...new Set(grades)].sort((a, b) => {
    const na = Number(a.replace("Grade ", ""));
    const nb = Number(b.replace("Grade ", ""));
    return na - nb;
  });
}

export function validateSchoolYear(value) {
  return /^\d{4}-\d{4}$/.test(String(value || "").trim());
}
