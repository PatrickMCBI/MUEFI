/*
 * MUEFI Google Sheets helper
 *
 * Same spreadsheet is used by:
 *   Admins
 *   Students
 *   Teachers
 *   Grade-1 ... Grade-10
 *
 * Required environment variables:
 *   GOOGLE_SHEET_ID (or GOOGLE_SPREADSHEET_ID)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL (or GOOGLE_CLIENT_EMAIL)
 *   GOOGLE_PRIVATE_KEY (or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
 *
 * Optional KV binding:
 *   KV
 */

const SCOPES = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function envValue(env, ...names) {
  for (const name of names) {
    if (env?.[name]) return env[name];
  }
  return "";
}

function getSpreadsheetId(env) {
  const id = envValue(env, "GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID");
  if (!id) throw new Error("Google Spreadsheet ID is not configured.");
  return id;
}

function getClientEmail(env) {
  const email = envValue(
    env,
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_CLIENT_EMAIL"
  );
  if (!email) throw new Error("Google service-account email is not configured.");
  return email;
}

function getPrivateKey(env) {
  let key = envValue(
    env,
    "GOOGLE_PRIVATE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  );
  if (!key) throw new Error("Google service-account private key is not configured.");

  key = key.replace(/\\n/g, "\n");

  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Google private key format is invalid.");
  }

  return key;
}

function base64url(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunk = 0x8000;

  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getAccessToken(env) {
  const kv = env?.KV;

  if (kv) {
    const cached = await kv.get("google_sheets_access_token", "json");
    if (cached?.token && cached?.expiresAt > Date.now() + 30000) {
      return cached.token;
    }
  }

  const clientEmail = getClientEmail(env);
  const privateKey = getPrivateKey(env);

  const now = Math.floor(Date.now() / 1000);

  const header = base64url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  );

  const claim = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope: SCOPES,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
      })
    )
  );

  const unsigned = `${header}.${claim}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google OAuth failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("Google OAuth returned no access token.");
  }

  if (kv) {
    await kv.put(
      "google_sheets_access_token",
      JSON.stringify({
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 3600) - 120) * 1000
      }),
      { expirationTtl: Math.max(60, (data.expires_in || 3600) - 120) }
    );
  }

  return data.access_token;
}

async function sheetsRequest(env, path, options = {}) {
  const token = await getAccessToken(env);

  const response = await fetch(`${SHEETS_API}/${getSpreadsheetId(env)}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Sheets request failed (${response.status}): ${body.slice(0, 1000)}`
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

function sheetRange(sheet, range) {
  return `${encodeURIComponent(sheet)}!${range}`;
}

export async function getValues(env, sheet, range = "A:Z") {
  const data = await sheetsRequest(
    env,
    `/values/${sheetRange(sheet, range)}?majorDimension=ROWS`
  );

  return data.values || [];
}

export async function appendValues(env, sheet, values) {
  const range = sheetRange(sheet, "A:Z");

  return sheetsRequest(
    env,
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values
      })
    }
  );
}

export async function updateValues(env, sheet, range, values) {
  const encodedRange = sheetRange(sheet, range);

  return sheetsRequest(
    env,
    `/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values
      })
    }
  );
}

export async function loadAdmins(env) {
  const rows = await getValues(env, "Admins", "A:D");
  return rows.slice(1);
}

export async function loadStudents(env) {
  const rows = await getValues(env, "Students", "A:G");
  return rows.slice(1);
}

export async function loadTeachers(env) {
  const rows = await getValues(env, "Teachers", "A:F");
  return rows.slice(1);
}

export async function loadGrades(env, gradeLevel) {
  const sheet = getGradeSheetName(gradeLevel);
  const rows = await getValues(env, sheet, "A:G");
  return rows.slice(1);
}

export function getGradeSheetName(gradeLevel) {
  const match = String(gradeLevel || "").trim().match(/^Grade\s*(10|[1-9])$/i);

  if (!match) {
    throw new Error("Invalid grade level.");
  }

  return `Grade-${match[1]}`;
}

export function normalizeGradeLevel(value) {
  const match = String(value || "").trim().match(/^Grade\s*(10|[1-9])$/i);
  return match ? `Grade ${match[1]}` : "";
}

export function isActive(value) {
  return String(value ?? "").trim().toUpperCase() !== "FALSE";
}

export function normalizeActive(value) {
  return value === false ||
    String(value ?? "").trim().toLowerCase() === "false"
    ? "FALSE"
    : "TRUE";
}

export function normalizeId(value) {
  return String(value || "").trim();
}

export function findRowIndex(rows, id) {
  const wanted = normalizeId(id).toLowerCase();
  return rows.findIndex(
    row => normalizeId(row[0]).toLowerCase() === wanted
  );
}

/*
 * Existing teacher/grade APIs can use these helpers.
 */
export async function appendGrade(env, gradeLevel, values) {
  return appendValues(env, getGradeSheetName(gradeLevel), [values]);
}

export async function updateGradeRow(env, gradeLevel, rowNumber, values) {
  return updateValues(
    env,
    getGradeSheetName(gradeLevel),
    `A${rowNumber}:G${rowNumber}`,
    [values]
  );
}

export async function findGradeRow(env, gradeLevel, studentId, schoolYear, quarter, subject) {
  const rows = await loadGrades(env, gradeLevel);

  const index = rows.findIndex(row =>
    normalizeId(row[0]).toLowerCase() === normalizeId(studentId).toLowerCase() &&
    String(row[1] || "").trim() === String(schoolYear || "").trim() &&
    String(row[2] || "").trim() === String(quarter || "").trim() &&
    String(row[3] || "").trim().toLowerCase() === String(subject || "").trim().toLowerCase()
  );

  return index === -1 ? null : { index, row: rows[index], sheetRow: index + 2 };
}

/*
 * Admin helpers
 */
export async function appendAdmin(env, admin) {
  return appendValues(env, "Admins", [[
    admin.adminId,
    admin.pin,
    admin.fullName,
    admin.active
  ]]);
}

export async function updateAdmin(env, rowNumber, admin) {
  return updateValues(env, "Admins", `A${rowNumber}:D${rowNumber}`, [[
    admin.adminId,
    admin.pin,
    admin.fullName,
    admin.active
  ]]);
}

export async function appendStudent(env, student) {
  return appendValues(env, "Students", [[
    student.studentId,
    student.pin,
    student.fullName,
    student.schoolYear,
    student.gradeLevel,
    student.section,
    student.active
  ]]);
}

export async function updateStudent(env, rowNumber, student) {
  return updateValues(env, "Students", `A${rowNumber}:G${rowNumber}`, [[
    student.studentId,
    student.pin,
    student.fullName,
    student.schoolYear,
    student.gradeLevel,
    student.section,
    student.active
  ]]);
}

export async function appendTeacher(env, teacher) {
  return appendValues(env, "Teachers", [[
    teacher.teacherId,
    teacher.pin,
    teacher.fullName,
    teacher.gradeLevels,
    teacher.section,
    teacher.active
  ]]);
}

export async function updateTeacher(env, rowNumber, teacher) {
  return updateValues(env, "Teachers", `A${rowNumber}:F${rowNumber}`, [[
    teacher.teacherId,
    teacher.pin,
    teacher.fullName,
    teacher.gradeLevels,
    teacher.section,
    teacher.active
  ]]);
}
