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


// ============================================================
// TEACHER GRADE LEVELS
// ============================================================

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


// ============================================================
// NORMALIZE GRADE LEVEL
// ============================================================

function normalizeGrade(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}


// ============================================================
// CHECK TEACHER ACCESS TO STUDENT
// ============================================================

function teacherCanAccessStudent(student, session) {
  if (!student) {
    return false;
  }

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

  const studentGrade =
    normalizeGrade(student[4]);

  const studentSection =
    normText(student[5]);

  const active =
    String(student[6] ?? '')
      .trim()
      .toUpperCase();

  /*
  |--------------------------------------------------------------------------
  | ACTIVE CHECK
  |--------------------------------------------------------------------------
  */

  if (
    active === 'FALSE' ||
    active === 'NO' ||
    active === '0'
  ) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | GRADE ACCESS
  |--------------------------------------------------------------------------
  |
  | Example:
  |
  | Teacher:
  | Grade 1,Grade 2,Grade 5,Grade 6
  |
  | Student:
  | Grade 1
  |
  | Result:
  | authorized
  |
  */

  const assignedGrades =
    getTeacherGradeLevels(session);

  const hasGradeAccess =
    assignedGrades.some(
      (grade) =>
        normalizeGrade(grade) ===
        studentGrade
    );

  if (!hasGradeAccess) {
    console.log(
      'TEACHER GRADE ACCESS DENIED:',
      {
        teacherId:
          session.teacherId,

        assignedGrades,

        studentGrade:
          student[4],
      }
    );

    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | SECTION ACCESS
  |--------------------------------------------------------------------------
  |
  | If teacher has a section assigned,
  | student must belong to that section.
  |
  */

  const teacherSection =
    normText(session.section);

  if (
    teacherSection &&
    studentSection.toLowerCase() !==
      teacherSection.toLowerCase()
  ) {
    console.log(
      'TEACHER SECTION ACCESS DENIED:',
      {
        teacherId:
          session.teacherId,

        teacherSection,

        studentSection,
      }
    );

    return false;
  }

  return true;
}


// ============================================================
// GET STUDENT
// ============================================================

async function getStudent(
  env,
  studentId
) {
  const students =
    await loadStudents(env);

  const student =
    students.find(
      (row) =>
        normId(row[0]) ===
        normId(studentId)
    );

  console.log(
    'GET STUDENT:',
    {
      requestedStudentId:
        studentId,

      found:
        !!student,

      student,
    }
  );

  return student;
}


// ============================================================
// GET GRADES
// ============================================================

export async function onRequestGet({
  request,
  env,
}) {
  /*
  |--------------------------------------------------------------------------
  | REQUIRE TEACHER
  |--------------------------------------------------------------------------
  */

  const session =
    await requireRole(
      request,
      env,
      'teacher'
    );

  if (!session) {
    return json(
      {
        error:
          'unauthorized',
      },
      401
    );
  }

  /*
  |--------------------------------------------------------------------------
  | REQUEST PARAMETERS
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | VALIDATION
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | FIND STUDENT
  |--------------------------------------------------------------------------
  */

  const student =
    await getStudent(
      env,
      studentId
    );

  if (!student) {
    return json(
      {
        error:
          'Student not found.',
      },
      404
    );
  }

  /*
  |--------------------------------------------------------------------------
  | VERIFY SCHOOL YEAR
  |--------------------------------------------------------------------------
  |
  | Students sheet:
  |
  | D = school_year
  |
  */

  const studentSchoolYear =
    normText(student[3]);

  if (
    studentSchoolYear &&
    studentSchoolYear !==
      schoolYear
  ) {
    return json(
      {
        error:
          'Student does not belong to the selected school year.',
      },
      403
    );
  }

  /*
  |--------------------------------------------------------------------------
  | VERIFY TEACHER ACCESS
  |--------------------------------------------------------------------------
  */

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
  |--------------------------------------------------------------------------
  | STUDENT'S ACTUAL GRADE
  |--------------------------------------------------------------------------
  |
  | Students sheet:
  |
  | E = grade_level
  |
  | IMPORTANT:
  | Never use session.gradeLevel here.
  |
  */

  const gradeLevel =
    normText(student[4]);

  if (!gradeLevel) {
    return json(
      {
        error:
          'Student grade level is missing.',
      },
      400
    );
  }

  /*
  |--------------------------------------------------------------------------
  | LOAD GRADE SHEET
  |--------------------------------------------------------------------------
  */

  const rows =
    await loadGradeSheet(
      env,
      gradeLevel
    );

  /*
  |--------------------------------------------------------------------------
  | FILTER STUDENT GRADES
  |--------------------------------------------------------------------------
  */

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
        studentId:
          row[0] ?? '',

        schoolYear:
          row[1] ?? '',

        quarter:
          row[2] ?? '',

        subject:
          row[3] ?? '',

        grade:
          row[4] ?? '',

        remarks:
          row[5] ?? '',

        teacherId:
          row[6] ?? '',
      }));

  console.log(
    'GET GRADES:',
    {
      teacherId:
        session.teacherId,

      studentId,

      schoolYear,

      gradeLevel,

      gradeCount:
        grades.length,
    }
  );

  /*
  |--------------------------------------------------------------------------
  | RESPONSE
  |--------------------------------------------------------------------------
  */

  return json({
    student: {
      id:
        student[0] ?? '',

      name:
        student[2] ?? '',

      schoolYear:
        student[3] ?? '',

      gradeLevel:
        student[4] ?? '',

      section:
        student[5] ?? '',
    },

    grades,
  });
}


// ============================================================
// SAVE GRADE
// ============================================================

export async function onRequestPost({
  request,
  env,
}) {
  /*
  |--------------------------------------------------------------------------
  | REQUIRE TEACHER
  |--------------------------------------------------------------------------
  */

  const session =
    await requireRole(
      request,
      env,
      'teacher'
    );

  if (!session) {
    return json(
      {
        error:
          'unauthorized',
      },
      401
    );
  }

  /*
  |--------------------------------------------------------------------------
  | READ REQUEST BODY
  |--------------------------------------------------------------------------
  */

  const body =
    await request
      .json()
      .catch(() => ({}));

  const studentId =
    normId(
      body.studentId
    );

  const schoolYear =
    normText(
      body.schoolYear
    );

  const quarter =
    normText(
      body.quarter
    );

  const subject =
    normText(
      body.subject
    );

  const remarks =
    String(
      body.remarks ?? ''
    ).trim();

  const gradeValue =
    Number(
      body.grade
    );

  /*
  |--------------------------------------------------------------------------
  | VALIDATION
  |--------------------------------------------------------------------------
  */

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
    !Number.isFinite(
      gradeValue
    ) ||
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

  /*
  |--------------------------------------------------------------------------
  | FIND STUDENT
  |--------------------------------------------------------------------------
  */

  const student =
    await getStudent(
      env,
      studentId
    );

  if (!student) {
    return json(
      {
        error:
          'Student not found.',
      },
      404
    );
  }

  /*
  |--------------------------------------------------------------------------
  | VERIFY SCHOOL YEAR
  |--------------------------------------------------------------------------
  */

  const studentSchoolYear =
    normText(student[3]);

  if (
    studentSchoolYear &&
    studentSchoolYear !==
      schoolYear
  ) {
    return json(
      {
        error:
          'Student does not belong to the selected school year.',
      },
      403
    );
  }

  /*
  |--------------------------------------------------------------------------
  | VERIFY TEACHER ACCESS
  |--------------------------------------------------------------------------
  */

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
  |--------------------------------------------------------------------------
  | GET STUDENT GRADE LEVEL
  |--------------------------------------------------------------------------
  |
  | Students sheet:
  |
  | E = grade_level
  |
  | This is important because a teacher
  | may handle multiple grades.
  |
  */

  const gradeLevel =
    normText(
      student[4]
    );

  if (!gradeLevel) {
    return json(
      {
        error:
          'Student grade level is missing.',
      },
      400
    );
  }

  /*
  |--------------------------------------------------------------------------
  | FIND EXISTING GRADE
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | PREPARE GRADE ROW
  |--------------------------------------------------------------------------
  |
  | Grade sheet:
  |
  | A = student_id
  | B = school_year
  | C = quarter
  | D = subject
  | E = grade
  | F = remarks
  | G = teacher_id
  |
  */

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

  /*
  |--------------------------------------------------------------------------
  | UPDATE EXISTING GRADE
  |--------------------------------------------------------------------------
  */

  if (existing) {
    console.log(
      'UPDATING EXISTING GRADE:',
      {
        teacherId:
          session.teacherId,

        studentId,

        gradeLevel,

        rowNumber:
          existing.rowNumber,

        values,
      }
    );

    await updateGradeRow(
      env,
      gradeLevel,
      existing.rowNumber,
      values
    );
  }

  /*
  |--------------------------------------------------------------------------
  | APPEND NEW GRADE
  |--------------------------------------------------------------------------
  */

  else {
    console.log(
      'APPENDING NEW GRADE:',
      {
        teacherId:
          session.teacherId,

        studentId,

        gradeLevel,

        values,
      }
    );

    await appendGrade(
      env,
      gradeLevel,
      values
    );
  }

  /*
  |--------------------------------------------------------------------------
  | INVALIDATE CACHE
  |--------------------------------------------------------------------------
  */

  await invalidateGradeCache(
    env
  );

  /*
  |--------------------------------------------------------------------------
  | RESPONSE
  |--------------------------------------------------------------------------
  */

  return json({
    ok: true,

    message:
      'Grade saved successfully.',

    student: {
      id:
        student[0] ?? '',

      name:
        student[2] ?? '',

      schoolYear:
        student[3] ?? '',

      gradeLevel:
        student[4] ?? '',

      section:
        student[5] ?? '',
    },

    grade: {
      quarter,
      subject,
      grade:
        gradeValue,
      remarks,
    },
  });
}