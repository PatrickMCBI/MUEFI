import {
  json,
  requireAdmin,
  cleanText,
  validatePin
} from "./_lib.js";

import {
  loadStudents,
  appendStudent,
  updateStudent,
  findRowIndex,
  normalizeActive
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

    const rows =
      await loadStudents(env);

    const students =
      rows.map(row => ({
        id:
          String(
            row[0] || ""
          ).trim(),

        pin:
          row[1]
            ? "••••"
            : "",

        name:
          String(
            row[2] || ""
          ).trim(),

        schoolYear:
          String(
            row[3] || ""
          ).trim(),

        level:
          String(
            row[4] || ""
          ).trim(),

        section:
          String(
            row[5] || ""
          ).trim(),

        active:
          String(
            row[6] ?? ""
          )
            .trim()
            .toUpperCase() !==
          "FALSE"
      }));

    return json({
      ok: true,
      students
    });
  } catch (error) {
    console.error(
      "[ADMIN STUDENTS GET]",
      error
    );

    return json(
      {
        error:
          "Unable to load students."
      },
      500
    );
  }
}

export async function onRequestPost({
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

    const body =
      await request.json();

    const id =
      cleanText(
        body.id,
        50
      );

    const name =
      cleanText(
        body.name,
        150
      );

    const schoolYear =
      cleanText(
        body.schoolYear ||
          "2026-2027",
        20
      );

    const level =
      cleanText(
        body.level,
        30
      );

    const section =
      cleanText(
        body.section,
        50
      );

    const active =
      normalizeActive(
        body.active
      );

    const pin =
      String(
        body.pin ?? ""
      ).trim();

    if (!id) {
      return json(
        {
          error:
            "Student ID is required."
        },
        400
      );
    }

    if (!name) {
      return json(
        {
          error:
            "Student name is required."
        },
        400
      );
    }

    if (
      pin &&
      !validatePin(pin)
    ) {
      return json(
        {
          error:
            "PIN must contain 4 to 12 digits."
        },
        400
      );
    }

    const rows =
      await loadStudents(env);

    const index =
      findRowIndex(
        rows,
        id
      );

    /* Existing student */

    if (index !== -1) {
      const existing =
        rows[index];

      const finalPin =
        pin ||
        String(
          existing[1] || ""
        ).trim();

      const finalSchoolYear =
        schoolYear ||
        String(
          existing[3] || ""
        ).trim();

      await updateStudent(
        env,
        index + 2,
        {
          studentId: id,
          pin: finalPin,
          fullName: name,
          schoolYear:
            finalSchoolYear,
          gradeLevel: level,
          section,
          active
        }
      );

      return json({
        ok: true,
        action: "updated"
      });
    }

    /* New student */

    if (!pin) {
      return json(
        {
          error:
            "PIN is required when adding a new student."
        },
        400
      );
    }

    await appendStudent(
      env,
      {
        studentId: id,
        pin,
        fullName: name,
        schoolYear,
        gradeLevel: level,
        section,
        active
      }
    );

    return json({
      ok: true,
      action: "created"
    });
  } catch (error) {
    console.error(
      "[ADMIN STUDENTS POST]",
      error
    );

    return json(
      {
        error:
          error.message ||
          "Unable to save student."
      },
      500
    );
  }
}