import {
  json,
  normId,
  normText,
  requireRole,
} from '../../_lib/util.js';

import {
  loadStudents,
  loadGradeSheet,
  findGradeRow,
  appendGrade,
  updateGradeRow,
  invalidateGradeCache,
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


function teacherCanAccessStudent(student, session) {
  if (!student) {
    return false;
  }

  /*
    Student sheet:

    A = student_id
    B = school_year
    C = name
    D = grade_level
    E = section
    F = active
  */

  const studentGrade =
    normText(student[3]);

  const studentSection =
    normText(student[4]);

  const active =
    String(student[5] ?? '')
      .trim()
      .toUpperCase();

  if (active === 'FALSE') {
    return false;
  }

  const assignedGrades =
    getTeacherGradeLevels(session);

  const hasGradeAccess =
    assignedGrades.some(
      (grade) =>
        normText(grade).toLowerCase() ===
        studentGrade.toLowerCase()
    );

  if (!hasGradeAccess) {
    return false;
  }

  const teacherSection =
    normText(session.section);

  if (
    teacherSection &&
    studentSection.toLowerCase() !==
      teacherSection.toLowerCase()
  ) {
    return false;
  }

  return true;
}


async function getStudent(
  env,
  studentId
) {
  const students =
    await loadStudents(env);

  return students.find(
    (row) =>
      normId(row[0]) ===
      normId(studentId)
  );
}


// ==============================
// GET GRADES
// ==============================

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
      { error: 'unauthorized' },
      401
    );
  }

  const url =
    new URL(request.url);

  const studentId =
    normId(
      url.searchParams.get(
        'studentId'
      )
    );

  const schoolYear =
    normText(
      url.searchParams.get(
        'schoolYear'
      )
    );

  if (!studentId) {
    return json(
      {
        error:
          'studentId required',
      },
      400
    );
  }

  if (!schoolYear) {
    return json(
      {
        error:
          'schoolYear required',
      },
      400
    );
  }

  const student =
    await getStudent(
      env,
      studentId
    );

  if (
    !teacherCanAccessStudent(
      student,
      session
    )
  ) {
    return json(
      {
        error:
          'You are not authorized to access this student.',
      },
      403
    );
  }

  /*
    IMPORTANT:

    Use the student's actual grade level,
    NOT session.gradeLevel.

    This allows:

    Teacher One
      Grade 1
      Grade 2
      Grade 5
      Grade 6
  */

  const gradeLevel =
    normText(student[3]);

  const rows =
    await loadGradeSheet(
      env,
      gradeLevel
    );

  const grades =
    rows
      .filter(
        (row) =>
          normId(row[0]) ===
            studentId &&
          normText(row[1]) ===
            schoolYear
      )
      .map((row) => ({
        studentId: row[0],
        schoolYear: row[1],
        quarter: row[2],
        subject: row[3],
        grade: row[4],
        remarks: row[5],
        teacherId: row[6],
      }));

  return json({
    student: {
      id: student[0],
      name: student[2],
      gradeLevel: student[3],
      section: student[4],
    },

    grades,
  });
}


// ==============================
// SAVE GRADE
// ==============================

export async function onRequestPost({
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
      { error: 'unauthorized' },
      401
    );
  }

  const body =
    await request.json()
      .catch(() => ({}));

  const studentId =
    normId(body.studentId);

  const schoolYear =
    normText(body.schoolYear);

  const quarter =
    normText(body.quarter);

  const subject =
    normText(body.subject);

  const remarks =
    String(
      body.remarks ?? ''
    ).trim();

  const gradeValue =
    Number(body.grade);

  if (!studentId) {
    return json(
      {
        error:
          'studentId required',
      },
      400
    );
  }

  if (!schoolYear) {
    return json(
      {
        error:
          'schoolYear required',
      },
      400
    );
  }

  if (!quarter) {
    return json(
      {
        error:
          'quarter required',
      },
      400
    );
  }

  if (!subject) {
    return json(
      {
        error:
          'subject required',
      },
      400
    );
  }

  if (
    !Number.isFinite(gradeValue) ||
    gradeValue < 0 ||
    gradeValue > 100
  ) {
    return json(
      {
        error:
          'Grade must be between 0 and 100.',
      },
      400
    );
  }

  const student =
    await getStudent(
      env,
      studentId
    );

  if (
    !teacherCanAccessStudent(
      student,
      session
    )
  ) {
    return json(
      {
        error:
          'You are not authorized to edit this student.',
      },
      403
    );
  }

  /*
    IMPORTANT:

    Determine the sheet from the student's
    actual grade level.

    Example:

    Grade 1 student -> Grade-1
    Grade 5 student -> Grade-5
    Grade 6 student -> Grade-6
  */

  const gradeLevel =
    normText(student[3]);

  const existing =
    await findGradeRow(
      env,
      gradeLevel,
      {
        studentId,
        schoolYear,
        quarter,
        subject,
      }
    );

  const values = [
    studentId,
    schoolYear,
    quarter,
    subject,
    gradeValue,
    remarks,
    normId(
      session.teacherId
    ),
  ];

  if (existing) {
    await updateGradeRow(
      env,
      gradeLevel,
      existing.rowNumber,
      values
    );
  } else {
    await appendGrade(
      env,
      gradeLevel,
      values
    );
  }

  await invalidateGradeCache(
    env,
    gradeLevel
  );

  return json({
    ok: true,

    message:
      'Grade saved successfully.',

    student: {
      id: student[0],
      name: student[2],
      gradeLevel: student[3],
      section: student[4],
    },

    grade: {
      quarter,
      subject,
      grade: gradeValue,
      remarks,
    },
  });
}