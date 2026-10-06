import {
  json,
  requireAdmin
} from "./_lib.js";

export async function onRequestGet({
  request,
  env
}) {
  const session =
    await requireAdmin(
      request,
      env
    );

  if (!session) {
    return json(
      {
        authenticated: false
      },
      401
    );
  }

  return json({
    authenticated: true,
    admin: {
      id:
        session.adminId,
      name:
        session.name
    }
  });
}