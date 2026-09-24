import {
  json,
  normText,
  requireRole,
} from '../../_lib/util.js';

import {
  loadStudents,
} from '../../_lib/sheets.js';

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

  const students =
    await loadStudents(env);

  const grade =
    normText(
      session.gradeLevel
    );

  const section =
    normText(
      session.section
    );

  const result =
    students
      .filter(
        (row) =>
          normText(row[3]) ===
            grade &&
          (
            !section ||
            normText(row[4]) ===
              section
          ) &&
          String(row[5] ?? '')
            .trim()
            .toUpperCase() !==
            'FALSE'
      )
      .map(
        (row) => ({
          id: row[0],
          name: row[2],
          gradeLevel: row[3],
          section: row[4],
        })
      );

  return json({
    teacher: {
      id: session.teacherId,
      name: session.name,
      gradeLevel: session.gradeLevel,
      section: session.section,
    },
    students: result,
  });
}