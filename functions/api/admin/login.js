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

export async function onRequestPost({ request, env }) {
  try {
    console.log("[ADMIN LOGIN] Starting");

    const body = await request.json();

    const adminId = String(body.adminId || "").trim();
    const pin = String(body.pin || "").trim();

    console.log("[ADMIN LOGIN] Admin ID:", adminId);
    console.log("[ADMIN LOGIN] PIN supplied:", pin ? "YES" : "NO");

    if (!adminId || !pin) {
      return json({
        error: "Admin ID and PIN are required."
      }, 400);
    }

    // Check configuration without exposing secrets
    console.log(
      "[ADMIN LOGIN] GOOGLE_SHEET_ID:",
      env.GOOGLE_SHEET_ID || env.GOOGLE_SPREADSHEET_ID
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "[ADMIN LOGIN] GOOGLE_SERVICE_ACCOUNT_EMAIL:",
      env.GOOGLE_SERVICE_ACCOUNT_EMAIL || env.GOOGLE_CLIENT_EMAIL
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "[ADMIN LOGIN] GOOGLE_PRIVATE_KEY:",
      env.GOOGLE_PRIVATE_KEY || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
        ? "CONFIGURED"
        : "MISSING"
    );

    console.log(
      "[ADMIN LOGIN] SESSION_SECRET:",
      env.SESSION_SECRET ? "CONFIGURED" : "MISSING"
    );

    const ip = getClientIp(request);

    const ipLimit = await rateLimitLogin(
      env,
      `ip:${ip}`
    );

    const idLimit = await rateLimitLogin(
      env,
      `id:${adminId.toLowerCase()}`
    );

    if (!ipLimit.allowed || !idLimit.allowed) {
      return json({
        error:
          "Too many failed login attempts. Please try again later."
      }, 429);
    }

    console.log("[ADMIN LOGIN] Reading Admins sheet...");

    const admin = await findAdmin(env, adminId);

    console.log(
      "[ADMIN LOGIN] Admin found:",
      !!admin
    );

    if (!admin) {
      await recordLoginFailure(
        env,
        `ip:${ip}`
      );

      await recordLoginFailure(
        env,
        `id:${adminId.toLowerCase()}`
      );

      return json({
        error: "Invalid admin ID or PIN."
      }, 401);
    }

    console.log(
      "[ADMIN LOGIN] Admin active:",
      admin.active
    );

    const pinValid = safeEqual(
      admin.pin,
      pin
    );

    console.log(
      "[ADMIN LOGIN] PIN valid:",
      pinValid
    );

    if (!admin.active || !pinValid) {
      await recordLoginFailure(
        env,
        `ip:${ip}`
      );

      await recordLoginFailure(
        env,
        `id:${adminId.toLowerCase()}`
      );

      return json({
        error: "Invalid admin ID or PIN."
      }, 401);
    }

    await clearLoginFailures(
      env,
      `ip:${ip}`
    );

    await clearLoginFailures(
      env,
      `id:${adminId.toLowerCase()}`
    );

    console.log(
      "[ADMIN LOGIN] Creating session..."
    );

    const token = await createAdminSession(env, {
      adminId: admin.adminId,
      name: admin.name
    });

    console.log(
      "[ADMIN LOGIN] Session created"
    );

    return json(
      {
        ok: true,
        admin: {
          id: admin.adminId,
          name: admin.name
        }
      },
      200,
      {
        "Set-Cookie": adminCookie(token)
      }
    );

  } catch (error) {
    console.error(
      "[ADMIN LOGIN ERROR]",
      error
    );

    return json(
      {
        error: `Login server error: ${
          error?.message || String(error)
        }`
      },
      500
    );
  }
}