import { readSession, normId } from './util.js';
import { loadData, authHeader, sheetBase, quoteTab } from './sheets.js';

// Returns the signed-in super admin, or null.
export async function getAdmin(request, env) {
  const s = await readSession(request, env.SESSION_SECRET, 'asession');
  if (!s?.aid) return null;
  const { admins } = await loadData(env);
  const row = (admins || []).find((r) => normId(r[0]) === s.aid);
  return row ? { id: s.aid, name: row[2] || s.aid } : null;
}

// Fresh (uncached) read of a roster tab (Students or Teachers): row 1 is a label header, row 2+ is data.
export async function readRoster(env, tab, lastCol) {
  const res = await fetch(`${sheetBase(env)}/values/${quoteTab(tab)}!A2:${lastCol}`, await authHeader(env));
  if (!res.ok) throw new Error('Sheet read failed');
  return (await res.json()).values || [];
}

// Adds a new row, or overwrites the existing row for that id. Returns 'created' or 'updated'.
export async function writeRosterRow(env, tab, lastCol, id, values, rows) {
  const idx = (rows ?? (await readRoster(env, tab, lastCol))).findIndex((r) => normId(r[0]) === normId(id));
  const a = await authHeader(env), base = sheetBase(env), hdr = { ...a.headers, 'content-type': 'application/json' };
  if (idx === -1) {
    const res = await fetch(`${base}/values/${quoteTab(tab)}!A:${lastCol}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers: hdr, body: JSON.stringify({ values: [values] }),
    });
    if (!res.ok) throw new Error('Sheet write failed');
    return 'created';
  }
  const row = idx + 2;
  const res = await fetch(`${base}/values/${quoteTab(tab)}!A${row}:${lastCol}${row}?valueInputOption=RAW`, {
    method: 'PUT', headers: hdr, body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) throw new Error('Sheet write failed');
  return 'updated';
}
