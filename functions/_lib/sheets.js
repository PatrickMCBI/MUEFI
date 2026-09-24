import { b64uEncode } from './util.js';

const enc = new TextEncoder();

const b64json = (value) =>
  b64uEncode(
    enc.encode(JSON.stringify(value))
  );

async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = b64json({
    alg: 'RS256',
    typ: 'JWT',
  });

  const claim = b64json({
    iss: env.GOOGLE_CLIENT_EMAIL,

    // IMPORTANT:
    // Teacher needs write access.
    scope:
      'https://www.googleapis.com/auth/spreadsheets',

    aud: 'https://oauth2.googleapis.com/token',

    iat: now,
    exp: now + 3600,
  });

  const unsigned = `${header}.${claim}`;

  const pem = env.GOOGLE_PRIVATE_KEY
    .replace(/\\n/g, '\n')
    .replace(
      /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
      ''
    );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(
      atob(pem),
      (c) => c.charCodeAt(0)
    ),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature =
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      enc.encode(unsigned)
    );

  const jwt = `${unsigned}.${b64uEncode(signature)}`;

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type:
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Google authentication failed');
  }

  const data = await response.json();

  return data.access_token;
}

async function getToken(env) {
  let token = await env.KV.get('gtoken');

  if (token) {
    return token;
  }

  token = await googleToken(env);

  await env.KV.put(
    'gtoken',
    token,
    {
      expirationTtl: 3000,
    }
  );

  return token;
}

async function sheetsRequest(
  env,
  url,
  options = {}
) {
  const token = await getToken(env);

  let response = await fetch(
    url,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    }
  );

  // Token expired. Refresh once.
  if (response.status === 401) {
    await env.KV.delete('gtoken');

    const newToken = await googleToken(env);

    await env.KV.put(
      'gtoken',
      newToken,
      {
        expirationTtl: 3000,
      }
    );

    response = await fetch(
      url,
      {
        ...options,
        headers: {
          authorization: `Bearer ${newToken}`,
          ...(options.headers || {}),
        },
      }
    );
  }

  return response;
}

/*
|--------------------------------------------------------------------------
| READ STUDENTS
|--------------------------------------------------------------------------
*/

export async function loadStudents(env) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${env.SHEET_ID}/values/Students!A2:F`;

  const response =
    await sheetsRequest(env, url);

  if (!response.ok) {
    throw new Error(
      'Students sheet read failed'
    );
  }

  const data = await response.json();

  return data.values || [];
}

/*
|--------------------------------------------------------------------------
| READ TEACHERS
|--------------------------------------------------------------------------
*/

export async function loadTeachers(env) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${env.SHEET_ID}/values/Teachers!A2:F`;

  const response =
    await sheetsRequest(env, url);

  if (!response.ok) {
    throw new Error(
      'Teachers sheet read failed'
    );
  }

  const data = await response.json();

  return data.values || [];
}

/*
|--------------------------------------------------------------------------
| READ SPECIFIC GRADE SHEET
|--------------------------------------------------------------------------
*/

export async function loadGradeSheet(
  env,
  gradeLevel
) {
  const sheetName =
    getGradeSheetName(gradeLevel);

  if (!sheetName) {
    throw new Error(
      'Invalid grade level'
    );
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${env.SHEET_ID}/values/` +
    `${encodeURIComponent(sheetName)}!A2:G`;

  const response =
    await sheetsRequest(env, url);

  if (!response.ok) {
    throw new Error(
      `${sheetName} read failed`
    );
  }

  const data = await response.json();

  return data.values || [];
}

/*
|--------------------------------------------------------------------------
| WRITE / APPEND GRADE
|--------------------------------------------------------------------------
*/

export async function appendGrade(env, gradeLevel, values) {
  const sheetName = getGradeSheetName(gradeLevel);

  if (!sheetName) {
    throw new Error(`Invalid grade level: ${gradeLevel}`);
  }

  const range = `${sheetName}!A:G`;

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/` +
    `${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  console.log('APPEND GRADE:', {
    sheetName,
    range,
    values,
  });

  const response = await sheetsRequest(env, url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      values: [values],
    }),
  });

  const responseText = await response.text();

  console.log('GOOGLE APPEND STATUS:', response.status);
  console.log('GOOGLE APPEND RESPONSE:', responseText);

  if (!response.ok) {
    throw new Error(
      `Google Sheets append failed (${response.status}): ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { ok: true, raw: responseText };
  }
}

/*
|--------------------------------------------------------------------------
| UPDATE SPECIFIC ROW
|--------------------------------------------------------------------------
*/

export async function updateGradeRow(env, gradeLevel, rowNumber, values) {
  const sheetName = getGradeSheetName(gradeLevel);

  if (!sheetName) {
    throw new Error(`Invalid grade level: ${gradeLevel}`);
  }

  const range = `${sheetName}!A${rowNumber}:G${rowNumber}`;

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/` +
    `${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  console.log('UPDATE GRADE:', {
    sheetName,
    rowNumber,
    range,
    values,
  });

  const response = await sheetsRequest(env, url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values: [values],
    }),
  });

  const responseText = await response.text();

  console.log('GOOGLE UPDATE STATUS:', response.status);
  console.log('GOOGLE UPDATE RESPONSE:', responseText);

  if (!response.ok) {
    throw new Error(
      `Google Sheets update failed (${response.status}): ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { ok: true, raw: responseText };
  }
}

/*
|--------------------------------------------------------------------------
| FIND GRADE ROW
|--------------------------------------------------------------------------
*/

export async function findGradeRow(
  env,
  gradeLevel,
  {
    studentId,
    schoolYear,
    quarter,
    subject,
  }
) {
  const rows =
    await loadGradeSheet(
      env,
      gradeLevel
    );

  const index = rows.findIndex(
    (row) =>
      String(row[0] ?? '')
        .trim()
        .toUpperCase() ===
        String(studentId)
          .trim()
          .toUpperCase() &&

      String(row[1] ?? '').trim() ===
        String(schoolYear).trim() &&

      String(row[2] ?? '').trim() ===
        String(quarter).trim() &&

      String(row[3] ?? '').trim()
        .toLowerCase() ===
        String(subject).trim()
          .toLowerCase()
  );

  if (index === -1) {
    return null;
  }

  // API starts at row 2 because A2:G was loaded.
  return {
    rowNumber: index + 2,
    values: rows[index],
  };
}

/*
|--------------------------------------------------------------------------
| GRADE SHEET VALIDATION
|--------------------------------------------------------------------------
*/

export function getGradeSheetName(
  gradeLevel
) {
  const match =
    String(gradeLevel ?? '')
      .trim()
      .match(/^Grade[- ]?(10|[1-9])$/i);

  if (!match) {
    return null;
  }

  return `Grade-${match[1]}`;
}

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

export async function invalidateGradeCache(
  env
) {
  await env.KV.delete(
    'sheet-cache'
  );
}