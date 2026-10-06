import { json } from '../../_lib/util.js';

export const onRequestPost = () =>
  json({ ok: true }, 200, { 'set-cookie': 'asession=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0' });
