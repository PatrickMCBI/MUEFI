import { json, normId, safeEqual, signSession } from '../../_lib/util.js';
import { loadData } from '../../_lib/sheets.js';

export async function onRequestPost({ request, env }) {
  const { adminId, pin } = await request.json().catch(() => ({}));
  const id = normId(adminId);
  if (!id || !pin) return json({ error: 'invalid' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const keys = [`afail:id:${id}`, `afail:ip:${ip}`];
  const counts = (await Promise.all(keys.map((k) => env.KV.get(k)))).map(Number);
  if (counts[0] >= 5 || counts[1] >= 20) return json({ error: 'locked' }, 429);

  const { admins = [] } = await loadData(env);
  const row = admins.find((r) => normId(r[0]) === id);
  if (!row || !safeEqual(row[1], String(pin).trim())) {
    await Promise.all(keys.map((k, i) => env.KV.put(k, String(counts[i] + 1), { expirationTtl: 900 })));
    return json({ error: 'invalid' }, 401);
  }
  await env.KV.delete(keys[0]);
  const token = await signSession(env.SESSION_SECRET, { aid: id }, 3600);
  return json({ ok: true, name: row[2] || id }, 200, {
    'set-cookie': `asession=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=3600`,
  });
}
