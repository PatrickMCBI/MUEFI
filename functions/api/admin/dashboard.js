import { json } from '../../_lib/util.js';
import { getAdmin } from '../../_lib/admin.js';
import { loadData, authHeader, sheetBase } from '../../_lib/sheets.js';

export async function onRequestGet({ request, env }) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const { students, teachers, tabs } = await loadData(env);
  let newInquiries = null;
  try {
    const res = await fetch(`${sheetBase(env)}/values/Inquiries!A:O`, await authHeader(env));
    if (res.ok) {
      const rows = (await res.json()).values || [];
      newInquiries = rows.slice(1).filter((r) => (r[14] || 'New') === 'New').length;
    }
  } catch {}

  return json({
    admin: admin.name,
    students: { total: students.length, active: students.filter((r) => String(r[5] ?? '').toUpperCase() !== 'FALSE').length },
    teachers: { total: teachers.length },
    classes: tabs.length,
    newInquiries,
  });
}
