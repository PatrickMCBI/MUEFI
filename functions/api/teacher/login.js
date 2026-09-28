import {
  json,
  normId,
  safeEqual,
  signSession,
  COOKIE,
} from '../../_lib/util.js';

import {
  loadTeachers,
} from '../../_lib/sheets.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));

  const teacherId = normId(body.teacherId);
  const pin = String(body.pin ?? '').trim();

  if (!teacherId || !pin) {
    return json({ error: 'invalid' }, 400);
  }

  // Rate limiting
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';

  const key = `teacher-fail:${teacherId}:${ip}`;

  const attempts =
    Number(await env.KV.get(key)) || 0;

  if (attempts >= 10) {
    return json(
      {
        error: 'locked',
        message: 'Too many failed attempts. Please try again later.',
      },
      429
    );
  }

  const teachers = await loadTeachers(env);

  /*
    Teachers sheet:

    A = teacher_id
    B = pin
    C = full_name
    D = grade_level
    E = section
    F = active
  */

  const teacher = teachers.find((row) => {
    const id = normId(row[0]);

    const active =
      String(row[5] ?? '')
        .trim()
        .toUpperCase();

    return (
      id === teacherId &&
      active !== 'FALSE'
    );
  });

  if (!teacher) {
    await env.KV.put(
      key,
      String(attempts + 1),
      {
        expirationTtl: 900,
      }
    );

    return json({ error: 'invalid' }, 401);
  }

  // PIN is column B
  if (!safeEqual(String(teacher[1] ?? '').trim(), pin)) {
    await env.KV.put(
      key,
      String(attempts + 1),
      {
        expirationTtl: 900,
      }
    );

    return json({ error: 'invalid' }, 401);
  }

  await env.KV.delete(key);

  /*
    Grade levels are stored like:

    Grade 1,Grade 2,Grade 5,Grade 6
  */

  const gradeLevels = String(teacher[3] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (gradeLevels.length === 0) {
    return json(
      {
        error: 'no_grade_assignment',
        message: 'This teacher has no assigned grade level.',
      },
      403
    );
  }

  const section = String(teacher[4] ?? '').trim();

  const sessionData = {
    role: 'teacher',

    teacherId,

    name: String(teacher[2] ?? '').trim(),

    gradeLevels,

    section,
  };

  const token = await signSession(
    env.SESSION_SECRET,
    sessionData
  );

  return json(
    {
      ok: true,

      teacher: {
        id: teacherId,

        name: sessionData.name,

        gradeLevels,

        section,
      },
    },
    200,
    {
      'set-cookie':
        `session=${token}; ${COOKIE}; Max-Age=1800`,
    }
  );
}