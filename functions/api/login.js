import {
  json,
  normId,
  safeEqual,
  signSession,
  COOKIE,
} from '../_lib/util.js';

import {
  loadStudents,
} from '../_lib/sheets.js';

export async function onRequestPost({
  request,
  env,
}) {
  const body =
    await request.json().catch(
      () => ({})
    );

  const id = normId(
    body.studentId
  );

  const pin =
    String(body.pin ?? '').trim();

  if (!id || !pin) {
    return json(
      { error: 'invalid' },
      400
    );
  }

  const ip =
    request.headers.get(
      'cf-connecting-ip'
    ) || 'unknown';

  const keys = [
    `fail:id:${id}`,
    `fail:ip:${ip}`,
  ];

  const counts =
    (
      await Promise.all(
        keys.map((key) =>
          env.KV.get(key)
        )
      )
    ).map(Number);

  if (
    counts[0] >= 5 ||
    counts[1] >= 20
  ) {
    return json(
      { error: 'locked' },
      429
    );
  }

  const students =
    await loadStudents(env);

  const student =
    students.find(
      (row) =>
        normId(row[0]) === id &&
        String(row[5] ?? '')
          .trim()
          .toUpperCase() !==
          'FALSE'
    );

  if (
    !student ||
    !safeEqual(
      student[1],
      pin
    )
  ) {
    await Promise.all(
      keys.map(
        (key, index) =>
          env.KV.put(
            key,
            String(
              counts[index] + 1
            ),
            {
              expirationTtl: 900,
            }
          )
      )
    );

    return json(
      { error: 'invalid' },
      401
    );
  }

  await env.KV.delete(
    keys[0]
  );

  const token =
    await signSession(
      env.SESSION_SECRET,
      {
        role: 'parent',
        sid: id,
      }
    );

  return json(
    { ok: true },
    200,
    {
      'set-cookie':
        `session=${token}; ${COOKIE}; Max-Age=1800`,
    }
  );
}