const enc = new TextEncoder();

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64u = (s) =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );

const hmacKey = (secret) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify']
  );

export const COOKIE =
  'HttpOnly; Secure; SameSite=Strict; Path=/api';

export const b64uEncode = b64u;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
  });

export const normId = (value) =>
  String(value ?? '').trim().toUpperCase();

export const normText = (value) =>
  String(value ?? '').trim();

export function safeEqual(a, b) {
  a = String(a ?? '');
  b = String(b ?? '');

  let diff = a.length ^ b.length;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |=
      (a.charCodeAt(i) || 0) ^
      (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}

export async function signSession(
  secret,
  payload,
  ttl = 1800
) {
  const body = b64u(
    enc.encode(
      JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + ttl,
      })
    )
  );

  const sig = b64u(
    await crypto.subtle.sign(
      'HMAC',
      await hmacKey(secret),
      enc.encode(body)
    )
  );

  return `${body}.${sig}`;
}

export async function readSession(request, secret) {
  const token =
    /(?:^|;\s*)session=([^;]+)/.exec(
      request.headers.get('cookie') || ''
    )?.[1];

  const [body, sig] = (token || '').split('.');

  if (!body || !sig) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      unb64u(sig),
      enc.encode(body)
    );

    if (!valid) return null;

    const data = JSON.parse(
      new TextDecoder().decode(unb64u(body))
    );

    if (data.exp <= Date.now() / 1000) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export async function requireRole(
  request,
  env,
  role
) {
  const session = await readSession(
    request,
    env.SESSION_SECRET
  );

  if (!session || session.role !== role) {
    return null;
  }

  return session;
}