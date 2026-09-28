import {
  json,
  normText,
  requireRole,
} from '../../_lib/util.js';

import {
  loadStudents,
} from '../../_lib/sheets.js';


/*
|--------------------------------------------------------------------------
| GET TEACHER GRADE LEVELS
|--------------------------------------------------------------------------
*/

function getTeacherGradeLevels(session) {

  if (Array.isArray(session.gradeLevels)) {

    return session.gradeLevels
      .map((value) =>
        String(value ?? '').trim()
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


/*
|--------------------------------------------------------------------------
| NORMALIZE GRADE
|--------------------------------------------------------------------------
*/

function normalizeGrade(value) {

  return String(
    value ?? ''
  )
    .trim()
    .replace(
      /\s+/g,
      ' '
    )
    .toLowerCase();
}


/*
|--------------------------------------------------------------------------
| GRADE MATCH
|--------------------------------------------------------------------------
*/

function gradeMatches(
  a,
  b
) {

  return (
    normalizeGrade(a) ===
    normalizeGrade(b)
  );

}


/*
|--------------------------------------------------------------------------
| NORMALIZE SIMPLE TEXT
|--------------------------------------------------------------------------
*/

function normalizeValue(value) {

  return String(
    value ?? ''
  )
    .trim()
    .replace(
      /\s+/g,
      ' '
    );

}


/*
|--------------------------------------------------------------------------
| GET STUDENTS
|--------------------------------------------------------------------------
*/

export async function onRequestGet({
  request,
  env,
}) {

  /*
  |--------------------------------------------------------------------------
  | REQUIRE TEACHER LOGIN
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
    new URL(
      request.url
    );


  const requestedGrade =
    normalizeValue(
      url.searchParams.get(
        'gradeLevel'
      )
    );


  const requestedSchoolYear =
    normalizeValue(
      url.searchParams.get(
        'schoolYear'
      )
    );


  /*
  |--------------------------------------------------------------------------
  | TEACHER ASSIGNMENTS
  |--------------------------------------------------------------------------
  */

  const assignedGrades =
    getTeacherGradeLevels(
      session
    );


  const teacherSection =
    normalizeValue(
      session.section
    );


  console.log(
    'TEACHER STUDENT REQUEST:',
    {
      teacherId:
        session.teacherId,

      requestedGrade,

      requestedSchoolYear,

      assignedGrades,

      teacherSection,
    }
  );


  /*
  |--------------------------------------------------------------------------
  | SECURITY:
  | VERIFY REQUESTED GRADE
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

      console.warn(
        'TEACHER GRADE ACCESS DENIED:',
        {
          requestedGrade,
          assignedGrades,
        }
      );


      return json(
        {
          error:
            'forbidden',

          message:
            'You are not assigned to this grade level.',
        },
        403
      );

    }

  }


  /*
  |--------------------------------------------------------------------------
  | LOAD STUDENTS FROM GOOGLE SHEETS
  |--------------------------------------------------------------------------
  */

  let students;

  try {

    students =
      await loadStudents(
        env
      );

  } catch (error) {

    console.error(
      'LOAD STUDENTS FAILED:',
      error
    );


    return json(
      {
        error:
          'students_load_failed',

        message:
          error.message ||
          'Failed to load students.',
      },
      500
    );

  }


  console.log(
    'GOOGLE STUDENTS:',
    {
      rowCount:
        students.length,

      firstRow:
        students[0] || null,
    }
  );


  /*
  |--------------------------------------------------------------------------
  | FILTER STUDENTS
  |--------------------------------------------------------------------------
  */

  const result = [];


  for (
    const row of students
  ) {

    /*
    Students sheet:

    A = student_id       row[0]
    B = pin              row[1]
    C = full_name        row[2]
    D = school_year      row[3]
    E = grade_level      row[4]
    F = section           row[5]
    G = active            row[6]
    */


    const studentId =
      normalizeValue(
        row[0]
      );


    const studentName =
      normalizeValue(
        row[2]
      );


    const studentSchoolYear =
      normalizeValue(
        row[3]
      );


    const studentGrade =
      normalizeValue(
        row[4]
      );


    const studentSection =
      normalizeValue(
        row[5]
      );


    const active =
      normalizeValue(
        row[6]
      ).toUpperCase();


    /*
    |--------------------------------------------------------------------------
    | DEBUG INFORMATION
    |--------------------------------------------------------------------------
    */

    console.log(
      'CHECK STUDENT:',
      {
        studentId,
        studentName,
        studentSchoolYear,
        studentGrade,
        studentSection,
        active,
      }
    );


    /*
    |--------------------------------------------------------------------------
    | EMPTY ROW
    |--------------------------------------------------------------------------
    */

    if (!studentId) {

      console.log(
        'SKIP STUDENT: empty student ID'
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | ACTIVE
    |--------------------------------------------------------------------------
    |
    | Accept:
    |
    | TRUE
    | true
    | True
    | 1
    | YES
    |
    | Reject:
    |
    | FALSE
    | false
    |
    */

    if (
      active === 'FALSE' ||
      active === '0' ||
      active === 'NO' ||
      active === 'INACTIVE'
    ) {

      console.log(
        'SKIP STUDENT: inactive',
        studentId
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | SCHOOL YEAR
    |--------------------------------------------------------------------------
    */

    if (
      requestedSchoolYear &&
      studentSchoolYear !==
        requestedSchoolYear
    ) {

      console.log(
        'SKIP STUDENT: school year mismatch',
        {
          studentId,
          sheet:
            studentSchoolYear,
          requested:
            requestedSchoolYear,
        }
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | REQUESTED GRADE
    |--------------------------------------------------------------------------
    */

    if (
      requestedGrade &&
      !gradeMatches(
        studentGrade,
        requestedGrade
      )
    ) {

      console.log(
        'SKIP STUDENT: grade mismatch',
        {
          studentId,
          sheet:
            studentGrade,
          requested:
            requestedGrade,
        }
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | ASSIGNED GRADE
    |--------------------------------------------------------------------------
    |
    | This is an additional backend security
    | check.
    |
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

      console.log(
        'SKIP STUDENT: teacher not assigned',
        {
          studentId,
          studentGrade,
          assignedGrades,
        }
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | SECTION
    |--------------------------------------------------------------------------
    */

    if (
      teacherSection &&
      normalizeValue(
        studentSection
      ).toLowerCase() !==
        teacherSection.toLowerCase()
    ) {

      console.log(
        'SKIP STUDENT: section mismatch',
        {
          studentId,
          studentSection,
          teacherSection,
        }
      );

      continue;

    }


    /*
    |--------------------------------------------------------------------------
    | STUDENT PASSED ALL FILTERS
    |--------------------------------------------------------------------------
    */

    console.log(
      'STUDENT INCLUDED:',
      {
        studentId,
        studentName,
        studentSchoolYear,
        studentGrade,
        studentSection,
      }
    );


    result.push({

      id:
        studentId,

      name:
        studentName,

      schoolYear:
        studentSchoolYear,

      gradeLevel:
        studentGrade,

      section:
        studentSection,

    });

  }


  /*
  |--------------------------------------------------------------------------
  | FINAL LOG
  |--------------------------------------------------------------------------
  */

  console.log(
    'LOAD STUDENTS RESULT:',
    {
      requestedGrade,

      schoolYear:
        requestedSchoolYear,

      assignedGrades,

      teacherSection,

      totalStudents:
        students.length,

      returnedStudents:
        result.length,

      students:
        result,
    }
  );


  /*
  |--------------------------------------------------------------------------
  | RESPONSE
  |--------------------------------------------------------------------------
  */

  return json({

    teacher: {

      id:
        session.teacherId,

      name:
        session.name,

      gradeLevels:
        assignedGrades,

      section:
        session.section,

    },


    selectedGrade:
      requestedGrade ||
      null,


    schoolYear:
      requestedSchoolYear ||
      null,


    students:
      result,

  });

}