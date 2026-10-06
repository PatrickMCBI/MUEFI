import {
  json,
  requireAdmin,
  cleanText,
  validatePin,
  normalizeGradeLevels
} from "./_lib.js";

import {
  loadTeachers,
  appendTeacher,
  updateTeacher,
  normalizeActive,
  findRowIndex
} from "../../_lib/admin.js";

function publicTeacher(row) {
  const gradeLevels = normalizeGradeLevels(row[3]);

  return {
    teacherId: String(row[0] || ""),
    fullName: String(row[2] || ""),
    gradeLevels,
    section: String(row[4] || ""),
    active: String(row[5] || "").toUpperCase() !== "FALSE"
  };
}

function validateTeacherBody(body, isUpdate = false) {
  const teacherId = cleanText(body.teacherId, 50);
  const fullName = cleanText(body.fullName, 150);
  const section = cleanText(body.section, 50);
  const gradeLevels = normalizeGradeLevels(body.gradeLevels);
  const active = normalizeActive(body.active);
  const pin = String(body.pin || "").trim();

  if (!teacherId) return { error: "Teacher ID is required." };
  if (!fullName) return { error: "Full name is required." };

  if (!gradeLevels.length) {
    return { error: "Select at least one grade level." };
  }

  if (!section) {
    return { error: "Section is required." };
  }

  if (!isUpdate && !validatePin(pin)) {
    return { error: "PIN must contain 4-12 digits." };
  }

  if (isUpdate && pin && !validatePin(pin)) {
    return { error: "PIN must contain 4-12 digits." };
  }

  return {
    teacherId,
    fullName,
    gradeLevels: gradeLevels.join(","),
    section,
    active,
    pin
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const rows = await loadTeachers(env);

    return json({
      ok: true,
      teachers: rows
        .filter(row => row[0])
        .map(publicTeacher)
    });
  } catch (error) {
    console.error("[ADMIN TEACHERS GET]", error);
    return json({ error: "Unable to load teachers." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const body = await request.json();
    const data = validateTeacherBody(body, false);

    if (data.error) {
      return json({ error: data.error }, 400);
    }

    const rows = await loadTeachers(env);

    if (findRowIndex(rows, data.teacherId) !== -1) {
      return json({ error: "Teacher ID already exists." }, 409);
    }

    await appendTeacher(env, data);

    return json({
      ok: true,
      message: "Teacher added successfully."
    }, 201);
  } catch (error) {
    console.error("[ADMIN TEACHERS POST]", error);
    return json({ error: "Unable to add teacher." }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const body = await request.json();
    const data = validateTeacherBody(body, true);

    if (data.error) {
      return json({ error: data.error }, 400);
    }

    const rows = await loadTeachers(env);
    const index = findRowIndex(rows, data.teacherId);

    if (index === -1) {
      return json({ error: "Teacher not found." }, 404);
    }

    const existing = rows[index];
    const pin = data.pin || String(existing[1] || "").trim();

    if (!pin) {
      return json({ error: "Teacher PIN is missing." }, 400);
    }

    await updateTeacher(env, index + 2, {
      teacherId: data.teacherId,
      pin,
      fullName: data.fullName,
      gradeLevels: data.gradeLevels,
      section: data.section,
      active: data.active
    });

    return json({
      ok: true,
      message: "Teacher updated successfully."
    });
  } catch (error) {
    console.error("[ADMIN TEACHERS PUT]", error);
    return json({ error: "Unable to update teacher." }, 500);
  }
}
