import {
  json,
  requireAdmin
} from "./_lib.js";

import {
  loadStudents,
  loadTeachers,
  isActive
} from "../../_lib/admin.js";

export async function onRequestGet({
  request,
  env
}) {
  try {
    const session =
      await requireAdmin(
        request,
        env
      );

    if (!session) {
      return json(
        {
          error:
            "Unauthorized."
        },
        401
      );
    }

    const [
      students,
      teachers
    ] = await Promise.all([
      loadStudents(env),
      loadTeachers(env)
    ]);

    const activeStudents =
      students.filter(row =>
        isActive(row[6])
      );

    const activeTeachers =
      teachers.filter(row =>
        isActive(row[5])
      );

    const gradeBreakdown = {};

    for (
      let i = 1;
      i <= 10;
      i++
    ) {
      gradeBreakdown[
        `Grade ${i}`
      ] = 0;
    }

    for (const row of students) {
      const grade =
        String(
          row[4] || ""
        ).trim();

      if (
        Object.prototype.hasOwnProperty.call(
          gradeBreakdown,
          grade
        )
      ) {
        gradeBreakdown[
          grade
        ]++;
      }
    }

    const classes =
      new Set();

    for (const row of teachers) {
      const levels =
        String(
          row[3] || ""
        )
          .split(",")
          .map(x =>
            x.trim()
          )
          .filter(Boolean);

      levels.forEach(
        level =>
          classes.add(level)
      );
    }

    return json({
      ok: true,

      admin: {
        id:
          session.adminId,
        name:
          session.name
      },

      students: {
        total:
          students.length,
        active:
          activeStudents.length,
        inactive:
          students.length -
          activeStudents.length
      },

      teachers: {
        total:
          teachers.length,
        active:
          activeTeachers.length,
        inactive:
          teachers.length -
          activeTeachers.length
      },

      classes:
        classes.size,

      newInquiries: null,

      gradeBreakdown
    });
  } catch (error) {
    console.error(
      "[ADMIN DASHBOARD]",
      error
    );

    return json(
      {
        error:
          "Unable to load dashboard."
      },
      500
    );
  }
}