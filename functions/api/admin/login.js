import {
  json,
  getClientIp,
  findAdmin,
  createAdminSession,
  adminCookie,
  safeEqual,
  rateLimitLogin,
  recordLoginFailure,
  clearLoginFailures
} from "./_lib.js";

export async function onRequestPost({
  request,
  env
}) {
  try {
    const body =
      await request.json();

    const adminId =
      String(
        body.adminId || ""
      ).trim();

    const pin =
      String(
        body.pin || ""
      ).trim();

    if (!adminId || !pin) {
      return json(
        {
          error:
            "Admin ID and PIN are required."
        },
        400
      );
    }

    const ip =
      getClientIp(request);

    const ipLimit =
      await rateLimitLogin(
        env,
        `ip:${ip}`
      );

    const idLimit =
      await rateLimitLogin(
        env,
        `id:${adminId.toLowerCase()}`
      );

    if (
      !ipLimit.allowed ||
      !idLimit.allowed
    ) {
      return json(
        {
          error:
            "Too many failed login attempts. Please try again later."
        },
        429
      );
    }

    const admin =
      await findAdmin(
        env,
        adminId
      );

    if (
      !admin ||
      !admin.active ||
      !safeEqual(
        admin.pin,
        pin
      )
    ) {
      await recordLoginFailure(
        env,
        `ip:${ip}`
      );

      await recordLoginFailure(
        env,
        `id:${adminId.toLowerCase()}`
      );

      return json(
        {
          error:
            "Invalid admin ID or PIN."
        },
        401
      );
    }

    await clearLoginFailures(
      env,
      `ip:${ip}`
    );

    await clearLoginFailures(
      env,
      `id:${adminId.toLowerCase()}`
    );

    const token =
      await createAdminSession(
        env,
        {
          adminId:
            admin.adminId,
          name:
            admin.name
        }
      );

    return json(
      {
        ok: true,
        admin: {
          id:
            admin.adminId,
          name:
            admin.name
        }
      },
      200,
      {
        "Set-Cookie":
          adminCookie(token)
      }
    );
  } catch (error) {
    console.error(
      "[ADMIN LOGIN]",
      error
    );

    return json(
      {
        error:
          "Unable to process login."
      },
      500
    );
  }
}