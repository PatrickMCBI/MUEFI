import {
  json,
  normId,
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
  const session = await requireRole(request, env, 'teacher');

  if (!session) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);

  const requestedGrade =
    String(url.searchParams.get('gradeLevel') ?? '').trim();

  const schoolYear =
    String(url.searchParams.get('schoolYear') ?? '').trim();

  const assignedGrades = getTeacherGradeLevels(session);

  // Teacher must be assigned to the requested grade.
  if (requestedGrade) {
    const allowed = assignedGrades.some((grade) =>
      gradeMatches(grade, requestedGrade)
    );

    if (!allowed) {
      return json(
        {
          error: 'forbidden',
          message: 'You are not assigned to this grade level.',
          requestedGrade,
          assignedGrades,
        },
        403
      );
    }
  }

  const students = await loadStudents(env);
console.log('STUDENTS FROM SHEET:', students);

console.log('FILTER DEBUG:', {
  requestedGrade,
  schoolYear,
  assignedGrades,
  teacherSection: session.section,
  students: students.map(row => ({
    id: row[0],
    schoolYear: row[1],
    name: row[2],
    grade: row[3],
    section: row[4],
    active: row[5],
  })),
});
  const teacherSection = String(session.section ?? '').trim();

  const result = students
    .filter((row) => {
      const studentId = String(row[0] ?? '').trim();
      const studentSchoolYear = String(row[1] ?? '').trim();
      const studentGrade = String(row[3] ?? '').trim();
      const studentSection = String(row[4] ?? '').trim();
      const active = String(row[5] ?? '').trim().toUpperCase();

      // Ignore empty rows.
      if (!studentId) {
        return false;
      }

      // Ignore inactive students.
      if (active === 'FALSE') {
        return false;
      }

      // Filter selected grade.
      if (
        requestedGrade &&
        !gradeMatches(studentGrade, requestedGrade)
      ) {
        return false;
      }

      // If no grade was explicitly selected,
      // only show grades assigned to this teacher.
      if (
        !requestedGrade &&
        !assignedGrades.some((grade) =>
          gradeMatches(grade, studentGrade)
        )
      ) {
        return false;
      }

      // Filter by teacher section.
      if (
        teacherSection &&
        studentSection.toLowerCase() !==
          teacherSection.toLowerCase()
      ) {
        return false;
      }

      // Only filter school year when the student actually has one.
      if (
        schoolYear &&
        studentSchoolYear &&
        studentSchoolYear !== schoolYear
      ) {
        return false;
      }

      return true;
    })
    .map((row) => ({
      id: String(row[0] ?? '').trim(),
      name: String(row[2] ?? '').trim(),
      gradeLevel: String(row[3] ?? '').trim(),
      section: String(row[4] ?? '').trim(),
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