import {
  json,
  requireAdmin,
  cleanText,
  validatePin,
  validateSchoolYear
} from "./_lib.js";

import {
  loadStudents,
  appendStudent,
  updateStudent,
  normalizeGradeLevel,
  normalizeActive,
  normalizeId,
  findRowIndex
} from "../../_lib/admin.js";

function publicStudent(row) {
  return {
    studentId: String(row[0] || ""),
    fullName: String(row[2] || ""),
    schoolYear: String(row[3] || ""),
    gradeLevel: String(row[4] || ""),
    section: String(row[5] || ""),
    active: String(row[6] || "").toUpperCase() !== "FALSE"
  };
}

function validateStudentBody(body, isUpdate = false) {
  const studentId = cleanText(body.studentId, 50);
  const fullName = cleanText(body.fullName, 150);
  const schoolYear = cleanText(body.schoolYear, 20);
  const gradeLevel = normalizeGradeLevel(body.gradeLevel);
  const section = cleanText(body.section, 50);
  const active = normalizeActive(body.active);

  if (!studentId) return { error: "Student ID is required." };
  if (!fullName) return { error: "Full name is required." };

  if (!validateSchoolYear(schoolYear)) {
    return { error: "School year must use YYYY-YYYY format." };
  }

  if (!gradeLevel) {
    return { error: "Grade level must be Grade 1 through Grade 10." };
  }

  if (!section) {
    return { error: "Section is required." };
  }

  const pin = String(body.pin || "").trim();

  if (!isUpdate && !validatePin(pin)) {
    return { error: "PIN must contain 4-12 digits." };
  }

  if (isUpdate && pin && !validatePin(pin)) {
    return { error: "PIN must contain 4-12 digits." };
  }

  return {
    studentId,
    fullName,
    schoolYear,
    gradeLevel,
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

    const rows = await loadStudents(env);

    return json({
      ok: true,
      students: rows
        .filter(row => row[0])
        .map(publicStudent)
    });
  } catch (error) {
    console.error("[ADMIN STUDENTS GET]", error);
    return json({ error: "Unable to load students." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const body = await request.json();
    const data = validateStudentBody(body, false);

    if (data.error) {
      return json({ error: data.error }, 400);
    }

    const rows = await loadStudents(env);

    if (findRowIndex(rows, data.studentId) !== -1) {
      return json({ error: "Student ID already exists." }, 409);
    }

    await appendStudent(env, data);

    return json({
      ok: true,
      message: "Student added successfully.",
      student: {
        studentId: data.studentId,
        fullName: data.fullName,
        schoolYear: data.schoolYear,
        gradeLevel: data.gradeLevel,
        section: data.section,
        active: data.active === "TRUE"
      }
    }, 201);
  } catch (error) {
    console.error("[ADMIN STUDENTS POST]", error);
    return json({ error: "Unable to add student." }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const body = await request.json();
    const data = validateStudentBody(body, true);

    if (data.error) {
      return json({ error: data.error }, 400);
    }

    const rows = await loadStudents(env);
    const index = findRowIndex(rows, data.studentId);

    if (index === -1) {
      return json({ error: "Student not found." }, 404);
    }

    const existing = rows[index];
    const pin = data.pin || String(existing[1] || "").trim();

    if (!pin) {
      return json({ error: "Student PIN is missing." }, 400);
    }

    await updateStudent(env, index + 2, {
      studentId: data.studentId,
      pin,
      fullName: data.fullName,
      schoolYear: data.schoolYear,
      gradeLevel: data.gradeLevel,
      section: data.section,
      active: data.active
    });

    return json({
      ok: true,
      message: "Student updated successfully.",
      student: {
        studentId: data.studentId,
        fullName: data.fullName,
        schoolYear: data.schoolYear,
        gradeLevel: data.gradeLevel,
        section: data.section,
        active: data.active === "TRUE"
      }
    });
  } catch (error) {
    console.error("[ADMIN STUDENTS PUT]", error);
    return json({ error: "Unable to update student." }, 500);
  }
}
