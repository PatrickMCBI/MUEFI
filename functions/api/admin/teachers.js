import { json, normId } from '../../_lib/util.js';
import { getAdmin } from '../../_lib/admin.js';
import { readRoster, writeRosterRow } from '../../_lib/admin.js';

const TAB = 'Teachers', LAST = 'E';
const toObj = (r) => ({ id: r[0] || '', pin: r[1] || '', name: r[2] || '', classes: r[3] || '', subjects: r[4] || '' });

export async function onRequestGet({ request, env }) {
  if (!(await getAdmin(request, env))) return json({ error: 'unauthorized' }, 401);
  const rows = await readRoster(env, TAB, LAST);
  return json({ teachers: rows.filter((r) => normId(r[0])).map(toObj) });
}

export async function onRequestPost({ request, env }) {
  if (!(await getAdmin(request, env))) return json({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const id = normId(b.id), name = String(b.name || '').trim();
  if (!id || !name) return json({ error: 'Please enter the teacher ID and name.' }, 400);

  const rows = await readRoster(env, TAB, LAST);
  const existing = rows.find((r) => normId(r[0]) === id);
  if (!existing && !String(b.pin || '').trim()) return json({ error: 'Please set a PIN for this new teacher.' }, 400);
  if (b.pin && !/^\d{4,8}$/.test(String(b.pin).trim())) return json({ error: 'PIN must be 4 to 8 digits.' }, 400);

  const values = [
    id,
    String(b.pin || '').trim() || existing?.[1] || '',
    name,
    String(b.classes || '').trim(),
    String(b.subjects || '').trim(),
  ];
  const result = await writeRosterRow(env, TAB, LAST, id, values, rows);
  await env.KV.delete('sheet-cache');
  return json({ ok: true, result });
}
