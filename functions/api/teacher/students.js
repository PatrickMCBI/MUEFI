import {
  json,
  normText,
  requireRole,
} from '../../_lib/util.js';

import {
  loadStudents,
} from '../../_lib/sheets.js';

function getTeacherGradeLevels(session) {
  if (Array.isArray(session.gradeLevels)) {
    return session.gradeLevels
      .map((value) =>
        String(value).trim()
      )
      .filter(Boolean);
  }

  return String(
    session.gradeLevels ?? ''
  )
    .split(',')
    .map((value) =>
      value.trim()
    )
    .filter(Boolean);
}

function normalizeGrade(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function gradeMatches(a, b) {
  return (
    normalizeGrade(a) ===
    normalizeGrade(b)
  );
}

export async function onRequestGet({
  request,
  env,
}) {
  const session =
    await requireRole(
      request,
      env,
      'teacher'
    );

  if (!session) {
    return json(
      {
        error: 'unauthorized',
      },
      401
    );
  }

  const url =
    new URL(request.url);

  const requestedGrade =
    String(
      url.searchParams.get(
        'gradeLevel'
      ) ?? ''
    ).trim();

  const schoolYear =
    String(
      url.searchParams.get(
        'schoolYear'
      ) ?? ''
    ).trim();

  const assignedGrades =
    getTeacherGradeLevels(
      session
    );

  /*
  |--------------------------------------------------------------------------
  | SECURITY
  |--------------------------------------------------------------------------
  */

  if (requestedGrade) {
    const allowed =
      assignedGrades.some(
        (grade) =>
          gradeMatches(
            grade,
            requestedGrade
          )
      );

    if (!allowed) {
      return json(
        {
          error: 'forbidden',
          message:
            'You are not assigned to this grade level.',
        },
        403
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | LOAD STUDENTS
  |--------------------------------------------------------------------------
  */

  const students =
    await loadStudents(env);

  const teacherSection =
    String(
      session.section ?? ''
    ).trim();

  /*
  |--------------------------------------------------------------------------
  | FILTER
  |--------------------------------------------------------------------------
  */

  const result =
    students
      .filter((row) => {
        /*
        Students sheet:

        A = student_id
        B = pin
        C = full_name
        D = school_year
        E = grade_level
        F = section
        G = active
        */

        const studentId =
          String(
            row[0] ?? ''
          ).trim();

        const studentSchoolYear =
          String(
            row[3] ?? ''
          ).trim();

        const studentGrade =
          String(
            row[4] ?? ''
          ).trim();

        const studentSection =
          String(
            row[5] ?? ''
          ).trim();

        const active =
          String(
            row[6] ?? ''
          )
            .trim()
            .toUpperCase();

        // Empty row
        if (!studentId) {
          return false;
        }

        // Inactive
        if (active === 'FALSE') {
          return false;
        }

        /*
        |--------------------------------------------------------------------------
        | SCHOOL YEAR
        |--------------------------------------------------------------------------
        */

        if (
          schoolYear &&
          studentSchoolYear !==
            schoolYear
        ) {
          return false;
        }

        /*
        |--------------------------------------------------------------------------
        | GRADE
        |--------------------------------------------------------------------------
        */

        if (
          requestedGrade &&
          !gradeMatches(
            studentGrade,
            requestedGrade
          )
        ) {
          return false;
        }

        /*
        |--------------------------------------------------------------------------
        | Assigned grades
        |--------------------------------------------------------------------------
        */

        if (
          !requestedGrade &&
          !assignedGrades.some(
            (grade) =>
              gradeMatches(
                grade,
                studentGrade
              )
          )
        ) {
          return false;
        }

        /*
        |--------------------------------------------------------------------------
        | SECTION
        |--------------------------------------------------------------------------
        */

        if (
          teacherSection &&
          studentSection.toLowerCase() !==
            teacherSection.toLowerCase()
        ) {
          return false;
        }

        return true;
      })
      .map((row) => ({
        id: String(
          row[0] ?? ''
        ).trim(),

        name: String(
          row[2] ?? ''
        ).trim(),

        schoolYear: String(
          row[3] ?? ''
        ).trim(),

        gradeLevel: String(
          row[4] ?? ''
        ).trim(),

        section: String(
          row[5] ?? ''
        ).trim(),
      }));

  console.log(
    'LOAD STUDENTS RESULT:',
    {
      requestedGrade,
      schoolYear,
      assignedGrades,
      teacherSection,
      totalStudents:
        students.length,
      returnedStudents:
        result.length,
      students: result,
    }
  );

  return json({
    teacher: {
      id: session.teacherId,
      name: session.name,
      gradeLevels:
        assignedGrades,
      section:
        session.section,
    },

    selectedGrade:
      requestedGrade || null,

    schoolYear:
      schoolYear || null,

    students: result,
  });
}