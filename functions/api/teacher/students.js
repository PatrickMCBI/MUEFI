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
    return session.gradeLevels;
  }

  return String(session.gradeLevels ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function gradeMatches(assignedGrade, studentGrade) {
  return (
    normText(assignedGrade).toLowerCase() ===
    normText(studentGrade).toLowerCase()
  );
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
    url.searchParams.get('gradeLevel')?.trim() || '';

  const schoolYear =
    url.searchParams.get('schoolYear')?.trim() || '';

  const assignedGrades =
    getTeacherGradeLevels(session);

  /*
    If a grade was requested, make sure
    the teacher is actually assigned to it.
  */

  if (requestedGrade) {
    const allowed = assignedGrades.some(
      (grade) =>
        gradeMatches(grade, requestedGrade)
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

  const students = await loadStudents(env);

  const section = normText(session.section);

  let result = students
    .filter((row) => {
      // Student sheet:
      // A = student_id
      // B = school_year
      // C = name
      // D = grade_level
      // E = section
      // F = active

      const studentGrade =
        normText(row[3]);

      const studentSection =
        normText(row[4]);

      const active =
        String(row[5] ?? '')
          .trim()
          .toUpperCase();

      // Ignore inactive students
      if (active === 'FALSE') {
        return false;
      }

      // If a specific grade was selected,
      // only return that grade.
      if (
        requestedGrade &&
        !gradeMatches(
          requestedGrade,
          studentGrade
        )
      ) {
        return false;
      }

      // If no specific grade was selected,
      // only return assigned grades.
      if (
        !requestedGrade &&
        !assignedGrades.some((grade) =>
          gradeMatches(
            grade,
            studentGrade
          )
        )
      ) {
        return false;
      }

      // Teacher section restriction
      if (
        section &&
        studentSection !== section
      ) {
        return false;
      }

      /*
        If your Students sheet has school year
        in column B, filter it when supplied.
      */
      if (
        schoolYear &&
        String(row[1] ?? '').trim() &&
        String(row[1] ?? '').trim() !== schoolYear
      ) {
        return false;
      }

      return true;
    })
    .map((row) => ({
      id: row[0],
      name: row[2],
      gradeLevel: row[3],
      section: row[4],
    }));

  return json({
    teacher: {
      id: session.teacherId,
      name: session.name,
      gradeLevels: assignedGrades,
      section: session.section,
    },

    selectedGrade: requestedGrade || null,

    schoolYear: schoolYear || null,

    students: result,
  });
}