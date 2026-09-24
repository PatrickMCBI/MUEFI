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

function teacherCanAccessStudent(student, session) {
  if (!student) return false;

  const studentGrade = normText(student[3]);
  const studentSection = normText(student[4]);
  const active = normText(student[5]).toUpperCase();

  if (active === 'FALSE') return false;

  if (studentGrade.toLowerCase() !== normText(session.gradeLevel).toLowerCase()) {
    return false;
  }

  // If teacher has a section assigned, enforce it.
  if (
    normText(session.section) &&
    studentSection.toLowerCase() !== normText(session.section).toLowerCase()
  ) {
    return false;
  }

  return true;
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await requireRole(request, env, 'teacher');

    if (!session) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    const studentId = normId(url.searchParams.get('studentId'));
    const schoolYear = normText(url.searchParams.get('schoolYear'));

    console.log('GET grades:', {
      studentId,
      schoolYear,
    });

    if (!studentId) {
      return json({
        error: 'GET studentId required',
      }, 400);
    }

    if (!schoolYear) {
      return json({
        error: 'GET schoolYear required',
      }, 400);
    }

    const students = await loadStudents(env);

    const student = students.find(
      row => normId(row[0]) === studentId
    );

    if (!student) {
      return json({
        error: 'Student not found',
      }, 404);
    }

    if (!teacherCanAccessStudent(student, session)) {
      return json({
        error: 'You are not authorized to access this student',
      }, 403);
    }

    const gradeLevel = normText(session.gradeLevel);

    const rows = await loadGradeSheet(env, gradeLevel);

    const grades = rows
      .filter(row => {
        const rowStudentId = normId(row[0]);
        const rowSchoolYear = normText(row[1]);

        return (
          rowStudentId === studentId &&
          rowSchoolYear === schoolYear
        );
      })
      .map(row => ({
        studentId: normId(row[0]),
        schoolYear: normText(row[1]),
        quarter: normText(row[2]).toUpperCase(),
        subject: normText(row[3]),
        grade: normText(row[4]),
        remarks: normText(row[5]),
        teacherId: normId(row[6]),
      }));

    return json({
      ok: true,
      grades,
    });
  } catch (error) {
    console.error('GET /api/teacher/grades error:', error);

    return json({
      error: error?.message || 'Failed to load grades',
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const session = await requireRole(request, env, 'teacher');

    if (!session) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json();

    console.log('POST grades body:', body);

    const studentId = normId(body?.studentId);
    const schoolYear = normText(body?.schoolYear);
    const quarter = normText(body?.quarter).toUpperCase();
    const subject = normText(body?.subject);
    const grade = normText(body?.grade);
    const remarks = normText(body?.remarks);

    console.log('POST grades normalized:', {
      studentId,
      schoolYear,
      quarter,
      subject,
      grade,
      remarks,
    });

    if (!studentId) {
      return json({
        error: 'POST studentId required',
      }, 400);
    }

    if (!schoolYear) {
      return json({
        error: 'School year required',
      }, 400);
    }

    if (!quarter) {
      return json({
        error: 'Quarter required',
      }, 400);
    }

    if (!subject) {
      return json({
        error: 'Subject required',
      }, 400);
    }

    if (!grade) {
      return json({
        error: 'Grade required',
      }, 400);
    }

    const numericGrade = Number(grade);

    if (
      !Number.isFinite(numericGrade) ||
      numericGrade < 0 ||
      numericGrade > 100
    ) {
      return json({
        error: 'Grade must be a number between 0 and 100',
      }, 400);
    }

    const students = await loadStudents(env);

    const student = students.find(
      row => normId(row[0]) === studentId
    );

    if (!student) {
      return json({
        error: 'Student not found',
      }, 404);
    }

    if (!teacherCanAccessStudent(student, session)) {
      return json({
        error: 'You are not authorized to modify this student',
      }, 403);
    }

    // IMPORTANT:
    // Teacher's authenticated grade level determines the sheet.
    const gradeLevel = normText(session.gradeLevel);

    console.log('Saving grade to:', {
      gradeLevel,
      studentId,
      schoolYear,
      quarter,
      subject,
    });

    const existing = await findGradeRow(env, gradeLevel, {
      studentId,
      schoolYear,
      quarter,
      subject,
    });

    const values = [
      studentId,
      schoolYear,
      quarter,
      subject,
      numericGrade,
      remarks,
      normId(session.teacherId),
    ];

    if (existing) {
      await updateGradeRow(
        env,
        gradeLevel,
        existing.rowNumber,
        values
      );

      await invalidateGradeCache(env);

      return json({
        ok: true,
        action: 'updated',
        message: 'Grade updated successfully',
      });
    }

    await appendGrade(
      env,
      gradeLevel,
      values
    );

    await invalidateGradeCache(env);

    return json({
      ok: true,
      action: 'created',
      message: 'Grade saved successfully',
    });

  } catch (error) {
    console.error('POST /api/teacher/grades error:', error);

    return json({
      error: error?.message || 'Failed to save grade',
    }, 500);
  }
}