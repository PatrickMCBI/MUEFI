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

export async function onRequestPost({
  request,
  env,
}) {
  const body =
    await request.json().catch(
      () => ({})
    );

  const teacherId =
    normId(
      body.teacherId
    );

  const pin =
    String(
      body.pin ?? ''
    ).trim();

  if (!teacherId || !pin) {
    return json(
      { error: 'invalid' },
      400
    );
  }

  const ip =
    request.headers.get(
      'cf-connecting-ip'
    ) || 'unknown';

  const key =
    `teacher-fail:${teacherId}:${ip}`;

  const attempts =
    Number(
      await env.KV.get(key)
    ) || 0;

  if (attempts >= 10) {
    return json(
      { error: 'locked' },
      429
    );
  }

  const teachers =
    await loadTeachers(env);

  const teacher =
    teachers.find(
      (row) =>
        normId(row[0]) ===
          teacherId &&
        String(row[4] ?? '')
          .trim()
          .toUpperCase() !==
          'FALSE'
    );

  if (
    !teacher ||
    !safeEqual(
      teacher[1],
      pin
    )
  ) {
    await env.KV.put(
      key,
      String(attempts + 1),
      {
        expirationTtl: 900,
      }
    );

    return json(
      { error: 'invalid' },
      401
    );
  }

  await env.KV.delete(key);

  /*
   * Teachers sheet:
   *
   * A teacher_id
   * B pin
   * C full_name
   * D grade_level
   * E section
   * F active
   */

  const token =
    await signSession(
      env.SESSION_SECRET,
      {
        role: 'teacher',
        teacherId,
        name: teacher[2],
        gradeLevel: teacher[3],
        section: teacher[4],
      }
    );

  return json(
    {
      ok: true,
      teacher: {
        id: teacherId,
        name: teacher[2],
        gradeLevel: teacher[3],
        section: teacher[4],
      },
    },
    200,
    {
      'set-cookie':
        `session=${token}; ${COOKIE}; Max-Age=1800`,
    }
  );
}