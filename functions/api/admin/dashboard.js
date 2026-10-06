import {
  json,
  requireAdmin
} from "./_lib.js";

import {
  loadStudents,
  loadTeachers,
  isActive
} from "../../_lib/admin.js";

export async function onRequestGet({ request, env }) {
  try {
    const session = await requireAdmin(request, env);

    if (!session) {
      return json({ error: "Unauthorized." }, 401);
    }

    const [students, teachers] = await Promise.all([
      loadStudents(env),
      loadTeachers(env)
    ]);

    const activeStudents = students.filter(row => isActive(row[6]));
    const activeTeachers = teachers.filter(row => isActive(row[5]));

    const gradeBreakdown = {};

    for (let i = 1; i <= 10; i++) {
      gradeBreakdown[`Grade ${i}`] = 0;
    }

    for (const row of students) {
      const grade = String(row[4] || "").trim();

      if (Object.prototype.hasOwnProperty.call(gradeBreakdown, grade)) {
        gradeBreakdown[grade]++;
      }
    }

    return json({
      ok: true,
      admin: {
        id: session.adminId,
        name: session.name
      },
      stats: {
        totalStudents: students.length,
        activeStudents: activeStudents.length,
        inactiveStudents: students.length - activeStudents.length,
        totalTeachers: teachers.length,
        activeTeachers: activeTeachers.length,
        inactiveTeachers: teachers.length - activeTeachers.length
      },
      gradeBreakdown
    });
  } catch (error) {
    console.error("[ADMIN DASHBOARD]", error);
    return json({ error: "Unable to load dashboard." }, 500);
  }
}
