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
      .map((value) => String(value).trim())
      .filter(Boolean);
  }

  return String(session.gradeLevels ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeGrade(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function gradeMatches(a, b) {
  return normalizeGrade(a) === normalizeGrade(b);
}

export async function onRequestGet({ request, env }) {
  const session = await requireRole(
    request,
    env,
    'teacher'
  );

  if (!session) {
    return json(
      { error: 'unauthorized' },
      401
    );
  }

  const url = new URL(request.url);

  const requestedGrade =
    String(
      url.searchParams.get('gradeLevel') ?? ''
    ).trim();

  const schoolYear =
    String(
      url.searchParams.get('schoolYear') ?? ''
    ).trim();

  const assignedGrades =
    getTeacherGradeLevels(session);

  // ---------------------------------------------
  // SECURITY: verify teacher is assigned
  // to the selected grade.
  // ---------------------------------------------

  if (requestedGrade) {
    const allowed =
      assignedGrades.some((grade) =>
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

  // ---------------------------------------------
  // Load Students sheet
  //
  // Actual structure:
  // A = student_id
  // B = pin
  // C = full_name
  // D = grade_level
  // E = section
  // F = active
  // ---------------------------------------------

  const students =
    await loadStudents(env);

  const teacherSection =
    String(session.section ?? '').trim();

  const result =
    students
      .filter((row) => {
        const studentId =
          String(row[0] ?? '').trim();

        const studentGrade =
          String(row[3] ?? '').trim();

        const studentSection =
          String(row[4] ?? '').trim();

        const active =
          String(row[5] ?? '')
            .trim()
            .toUpperCase();

        // Ignore empty rows
        if (!studentId) {
          return false;
        }

        // Ignore inactive students
        if (active === 'FALSE') {
          return false;
        }

        // -----------------------------------------
        // Grade filter
        // -----------------------------------------

        if (
          requestedGrade &&
          !gradeMatches(
            studentGrade,
            requestedGrade
          )
        ) {
          return false;
        }

        // If no grade selected, only show
        // teacher's assigned grades.
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

        // -----------------------------------------
        // Section restriction
        // -----------------------------------------

        if (
          teacherSection &&
          studentSection.toLowerCase() !==
            teacherSection.toLowerCase()
        ) {
          return false;
        }

        // -----------------------------------------
        // IMPORTANT:
        // DO NOT filter school year here.
        //
        // Students sheet does not have school_year.
        // School year belongs to the Grade sheets.
        // -----------------------------------------

        return true;
      })
      .map((row) => ({
        id: String(row[0] ?? '').trim(),
        name: String(row[2] ?? '').trim(),
        gradeLevel:
          String(row[3] ?? '').trim(),
        section:
          String(row[4] ?? '').trim(),
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
      gradeLevels: assignedGrades,
      section: session.section,
    },

    selectedGrade:
      requestedGrade || null,

    schoolYear:
      schoolYear || null,

    students: result,
  });
}