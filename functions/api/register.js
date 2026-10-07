import {
  
  normalizeId,
  loadStudents,
  updateValues
} from "../_lib/admin.js";
import{
    json,
    validatePin
} from "./admin/_lib.js";
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const studentId =
      normalizeId(body.studentId);

    const fullName =
      String(body.fullName || "")
        .replace(/\s+/g, " ")
        .trim();

    const pin =
      String(body.pin || "").trim();

    const confirmPin =
      String(body.confirmPin || "").trim();

    /*
    |--------------------------------------------------------------------------
    | VALIDATION
    |--------------------------------------------------------------------------
    */

    if (
      !studentId ||
      !fullName ||
      !pin ||
      !confirmPin
    ) {
      return json(
        {
          error: "All fields are required."
        },
        400
      );
    }

    if (!validatePin(pin)) {
      return json(
        {
          error:
            "PIN must contain 4 to 12 digits."
        },
        400
      );
    }

    if (pin !== confirmPin) {
      return json(
        {
          error: "PINs do not match."
        },
        400
      );
    }

    /*
    |--------------------------------------------------------------------------
    | LOAD EXISTING STUDENTS
    |--------------------------------------------------------------------------
    */

    const students =
      await loadStudents(env);

    const wantedId =
      studentId.toLowerCase();

    const wantedName =
      fullName.toLowerCase();

    /*
    |--------------------------------------------------------------------------
    | FIND STUDENT
    |--------------------------------------------------------------------------
    */

    const index =
      students.findIndex((row) => {

        const rowStudentId =
          String(row[0] || "")
            .trim()
            .toLowerCase();

        const rowFullName =
          String(row[2] || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        return (
          rowStudentId === wantedId &&
          rowFullName === wantedName
        );
      });

    if (index === -1) {
      return json(
        {
          error:
            "Student ID and Full Name do not match the school's student records."
        },
        404
      );
    }

    /*
    |--------------------------------------------------------------------------
    | EXISTING STUDENT
    |--------------------------------------------------------------------------
    */

    const row =
      students[index];

    const existingPin =
      String(row[1] || "").trim();

    const active =
      String(row[6] ?? "TRUE")
        .trim()
        .toUpperCase();

    /*
    |--------------------------------------------------------------------------
    | CHECK ACTIVE
    |--------------------------------------------------------------------------
    */

    if (
      active === "FALSE" ||
      active === "INACTIVE"
    ) {
      return json(
        {
          error:
            "This student account is inactive. Please contact the school."
        },
        403
      );
    }

    /*
    |--------------------------------------------------------------------------
    | ALREADY REGISTERED
    |--------------------------------------------------------------------------
    */

    if (existingPin) {
      return json(
        {
          error:
            "This Student ID is already registered. Please log in to the Student Portal."
        },
        409
      );
    }

    /*
    |--------------------------------------------------------------------------
    | UPDATE ONLY THE PIN
    |--------------------------------------------------------------------------
    |
    | Students sheet:
    |
    | A = student_id
    | B = pin
    | C = full_name
    | D = school_year
    | E = grade_level
    | F = section
    | G = active
    |
    | We intentionally update ONLY column B.
    |
    */

    const sheetRow =
      index + 2;

    await updateValues(
      env,
      "Students",
      `B${sheetRow}`,
      [[pin]]
    );

    console.log(
      "[STUDENT REGISTER] PIN created:",
      studentId
    );

    return json(
      {
        ok: true,
        message:
          "Registration successful. You can now log in to the Student Portal.",
        student: {
          studentId:
            String(row[0] || "").trim(),

          fullName:
            String(row[2] || "").trim()
        }
      },
      200
    );

  } catch (error) {

    console.error(
      "[STUDENT REGISTER ERROR]",
      error
    );

    return json(
      {
        error:
          error?.message ||
          "Unable to process registration."
      },
      500
    );
  }
}