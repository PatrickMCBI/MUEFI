import { json } from '../_lib/util.js';

export async function onRequestPost() {
  return json(
    { ok: true },
    200,
    {
      'set-cookie':
        'session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0',
    }
  );
}