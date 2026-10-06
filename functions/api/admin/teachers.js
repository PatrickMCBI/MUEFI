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
      await loadTeachers(env);

    const teachers =
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

        gradeLevels:
          String(
            row[3] || ""
          ).trim(),

        section:
          String(
            row[4] || ""
          ).trim(),

        active:
          String(
            row[5] ?? ""
          )
            .trim()
            .toUpperCase() !==
          "FALSE"
      }));

    return json({
      ok: true,
      teachers
    });
  } catch (error) {
    console.error(
      "[ADMIN TEACHERS GET]",
      error
    );

    return json(
      {
        error:
          "Unable to load teachers."
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

    const section =
      cleanText(
        body.section,
        100
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
            "Teacher ID is required."
        },
        400
      );
    }

    if (!name) {
      return json(
        {
          error:
            "Teacher name is required."
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

    const gradeInput =
      body.gradeLevels ??
      body.classes ??
      "";

    const grades =
      normalizeGradeLevels(
        gradeInput
      );

    if (!grades.length) {
      return json(
        {
          error:
            "Enter at least one valid grade level, such as Grade 1 or Grade 3."
        },
        400
      );
    }

    const gradeLevels =
      grades.join(", ");

    const rows =
      await loadTeachers(env);

    const index =
      findRowIndex(
        rows,
        id
      );

    /* Existing teacher */

    if (index !== -1) {
      const existing =
        rows[index];

      const finalPin =
        pin ||
        String(
          existing[1] || ""
        ).trim();

      await updateTeacher(
        env,
        index + 2,
        {
          teacherId: id,
          pin: finalPin,
          fullName: name,
          gradeLevels,
          section,
          active
        }
      );

      return json({
        ok: true,
        action: "updated"
      });
    }

    /* New teacher */

    if (!pin) {
      return json(
        {
          error:
            "PIN is required when adding a new teacher."
        },
        400
      );
    }

    await appendTeacher(
      env,
      {
        teacherId: id,
        pin,
        fullName: name,
        gradeLevels,
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
      "[ADMIN TEACHERS POST]",
      error
    );

    return json(
      {
        error:
          error.message ||
          "Unable to save teacher."
      },
      500
    );
  }
}