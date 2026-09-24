import {
  json,
  normId,
  requireRole,
} from '../_lib/util.js';

import {
  loadStudents,
  loadGradeSheet,
} from '../_lib/sheets.js';

export async function onRequestGet({
  request,
  env,
}) {
  const session =
    await requireRole(
      request,
      env,
      'parent'
    );

  if (!session) {
    return json(
      { error: 'unauthorized' },
      401
    );
  }

  const students =
    await loadStudents(env);

  const student =
    students.find(
      (row) =>
        normId(row[0]) ===
        session.sid
    );

  if (!student) {
    return json(
      { error: 'unauthorized' },
      401
    );
  }

  const gradeLevel =
    student[3];

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
          session.sid
      )
      .map(
        ([
          ,
          year,
          quarter,
          subject,
          grade,
          remarks,
        ]) => ({
          year,
          quarter,
          subject,
          grade,
          remarks:
            remarks || '',
        })
      );

  return json({
    student: {
      id: session.sid,
      name: student[2],
      level: student[3],
      section: student[4],
    },
    grades,
  });
}