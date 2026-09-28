import { json } from '../_lib/util.js';
import {
  authHeader,
  sheetBase,
} from '../_lib/sheets.js';


// --------------------------------------------------
// Registrar request types
// --------------------------------------------------

const TYPES = {
  coe: 'Certificate of Enrollment',

  report_card:
    'Report Card / Form 138',

  good_moral:
    'Certificate of Good Moral Character',

  transcript:
    'Transcript of Records',

  transfer:
    'Certificate of Transfer',

  diploma:
    'Diploma / Graduation Document',

  correction:
    'Student Record Correction',

  other:
    'Other Registrar Concern',
};


// --------------------------------------------------
// Relationship
// --------------------------------------------------

const RELATIONSHIPS = [
  'parent',
  'student',
  'authorized',
  'other',
];


// --------------------------------------------------
// Maximum attachment
// --------------------------------------------------

const MAX_FILE =
  5 * 1024 * 1024;


// --------------------------------------------------
// Reference characters
// --------------------------------------------------

const ALPHA =
  'ABCDEFGHJKMNPQRSTUVWXYZ23456789';


// --------------------------------------------------
// Helpers
// --------------------------------------------------

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );


const clean = (
  value,
  max
) =>
  String(value ?? '')
    .replace(
      /[\r\n\t]+/g,
      ' '
    )
    .trim()
    .slice(0, max);


const bad = (
  error,
  status = 400
) =>
  json(
    { error },
    status
  );


const rnd = (n) =>
  Array.from(
    crypto.getRandomValues(
      new Uint8Array(n)
    ),
    (b) =>
      ALPHA[
        b % ALPHA.length
      ]
  ).join('');


// --------------------------------------------------
// Base64
// --------------------------------------------------

function b64(bytes) {

  let s = '';

  for (
    let i = 0;
    i < bytes.length;
    i += 0x8000
  ) {

    s +=
      String.fromCharCode.apply(
        null,
        bytes.subarray(
          i,
          i + 0x8000
        )
      );

  }

  return btoa(s);
}


// --------------------------------------------------
// Validate actual file signature
// --------------------------------------------------

function fileExt(bytes) {

  const at = (
    i,
    ...values
  ) =>
    values.every(
      (value, index) =>
        bytes[
          i + index
        ] === value
    );


  // PDF

  if(
    at(
      0,
      0x25,
      0x50,
      0x44,
      0x46
    )
  ){

    return 'pdf';

  }


  // JPG

  if(
    at(
      0,
      0xff,
      0xd8,
      0xff
    )
  ){

    return 'jpg';

  }


  // PNG

  if(
    at(
      0,
      0x89,
      0x50,
      0x4e,
      0x47
    )
  ){

    return 'png';

  }


  // WEBP

  if(
    at(
      0,
      0x52,
      0x49,
      0x46,
      0x46
    ) &&
    at(
      8,
      0x57,
      0x45,
      0x42,
      0x50
    )
  ){

    return 'webp';

  }


  return null;

}


// ==================================================
// POST /api/registrar
// ==================================================

export async function onRequestPost({
  request,
  env,
}) {

  // ------------------------------------------------
  // Read FormData
  // ------------------------------------------------

  let f;

  try {

    f =
      await request.formData();

  }
  catch(error){

    console.error(
      'Registrar FormData error:',
      error
    );

    return bad(
      'Invalid form submission.'
    );

  }


  // ------------------------------------------------
  // Honeypot
  // ------------------------------------------------

  if(
    f.get('website')
  ){

    return json({
      ok:true,
      ref:'REG-000000-0000',
    });

  }


  // ------------------------------------------------
  // Environment validation
  // ------------------------------------------------

  if(!env.KV){

    console.error(
      'KV binding is missing.'
    );

    return bad(
      'The registrar request service is not configured correctly.',
      500
    );

  }


  if(!env.BREVO_API_KEY){

    console.error(
      'BREVO_API_KEY is missing.'
    );

    return bad(
      'The email service is not configured correctly.',
      500
    );

  }


  if(!env.MAIL_FROM){

    console.error(
      'MAIL_FROM is missing.'
    );

    return bad(
      'The email sender is not configured correctly.',
      500
    );

  }


  if(!env.ADMIN_EMAIL){

    console.error(
      'ADMIN_EMAIL is missing.'
    );

    return bad(
      'The registrar email is not configured correctly.',
      500
    );

  }


  // ------------------------------------------------
  // Rate limit
  // 5 successful requests / IP / hour
  // ------------------------------------------------

  const ip =
    request.headers.get(
      'cf-connecting-ip'
    ) ||
    'unknown';


  const rateKey =
    `registrar:${ip}`;


  const sent =
    Number(
      await env.KV.get(
        rateKey
      )
    ) || 0;


  if(
    sent >= 5
  ){

    return bad(
      'Too many requests. Please try again in an hour, or contact the registrar office.',
      429
    );

  }


  // ------------------------------------------------
  // Request type
  // ------------------------------------------------

  const type =
    String(
      f.get('type') ||
      ''
    );


  if(
    !TYPES[type]
  ){

    return bad(
      'Please choose a registrar request.'
    );

  }


  // ------------------------------------------------
  // Requester / student data
  // ------------------------------------------------

  const d = {

    requester:
      clean(
        f.get('requester'),
        80
      ),

    email:
      clean(
        f.get('email'),
        120
      ),

    phone:
      clean(
        f.get('phone'),
        30
      ),

    relationship:
      clean(
        f.get('relationship'),
        30
      ),

    student:
      clean(
        f.get('student'),
        80
      ),

    studentId:
      clean(
        f.get('studentId'),
        30
      ),

    level:
      clean(
        f.get('level'),
        40
      ),

    schoolYear:
      clean(
        f.get('schoolYear'),
        20
      ),

    purpose:
      String(
        f.get('purpose') ||
        ''
      )
        .trim()
        .slice(0, 1000),

    message:
      String(
        f.get('message') ||
        ''
      )
        .trim()
        .slice(0, 2000),

  };


  // ------------------------------------------------
  // Required fields
  // ------------------------------------------------

  if(
    !d.requester ||
    !d.email ||
    !d.relationship ||
    !d.student
  ){

    return bad(
      'Please fill in your name, email, relationship to the student, and student name.'
    );

  }


  // ------------------------------------------------
  // Email validation
  // ------------------------------------------------

  if(
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(
      d.email
    )
  ){

    return bad(
      'Please enter a valid email address so the registrar can reply.'
    );

  }


  // ------------------------------------------------
  // Relationship validation
  // ------------------------------------------------

  if(
    !RELATIONSHIPS.includes(
      d.relationship
    )
  ){

    return bad(
      'Please choose a valid relationship to the student.'
    );

  }


  // ------------------------------------------------
  // Generate reference
  // ------------------------------------------------

  const now =
    new Date(
      Date.now() +
      8 * 3600e3
    ).toISOString();


  const ref =
    `REG-${now.slice(2,4)}` +
    `${now.slice(5,7)}` +
    `${now.slice(8,10)}-` +
    rnd(4);


  // ------------------------------------------------
  // Optional attachment
  // ------------------------------------------------

  let attach = null;


  const file =
    f.get('attachment');


  if(
    file &&
    typeof file === 'object' &&
    file.size
  ){

    // File size

    if(
      file.size >
      MAX_FILE
    ){

      return bad(
        'The file is larger than 5 MB. Please upload a smaller file.'
      );

    }


    // Read file

    const bytes =
      new Uint8Array(
        await file.arrayBuffer()
      );


    // Verify actual signature

    const ext =
      fileExt(bytes);


    if(!ext){

      return bad(
        'Please upload a PDF, JPG, PNG, or WEBP file.'
      );

    }


    attach = {

      name:
        `${ref}-supporting.${ext}`,

      content:
        b64(bytes),

    };

  }


  // ------------------------------------------------
  // Email rows
  // ------------------------------------------------

  const rows = [

    [
      'Reference',
      ref,
    ],

    [
      'Request',
      TYPES[type],
    ],

    [
      'Requester',
      d.requester,
    ],

    [
      'Email',
      d.email,
    ],

    [
      'Phone',
      d.phone || '-',
    ],

    [
      'Relationship',
      d.relationship,
    ],

    [
      'Student',
      d.student,
    ],

    [
      'Student ID',
      d.studentId || '-',
    ],

    [
      'Grade and section',
      d.level || '-',
    ],

    [
      'School year',
      d.schoolYear || '-',
    ],

    [
      'Purpose',
      d.purpose || '-',
    ],

    [
      'Message',
      d.message || '-',
    ],

  ];


  // ------------------------------------------------
  // HTML email
  // ------------------------------------------------

  const html = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>
MUEFI Registrar Request
</title>

</head>


<body style="
  margin:0;
  padding:20px;
  background:#f5f5f5;
  font-family:Arial,Helvetica,sans-serif;
  color:#1f2933;
">


<div style="
  max-width:700px;
  margin:auto;
  background:#ffffff;
  padding:24px;
  border-radius:8px;
  border:1px solid #e5e7eb;
">


<h2 style="
  color:#9b1c1c;
  margin:0 0 8px 0;
">

MUEFI Registrar Request

</h2>


<p>

A new registrar request has been
submitted through the MUEFI website.

</p>


<div style="
  background:#fef3f2;
  border-left:4px solid #9b1c1c;
  padding:12px;
  margin:20px 0;
">

<strong>
Reference:
</strong>

${esc(ref)}

</div>


<p>

<strong>
Press Reply to answer the requester directly.
</strong>

${
  attach
    ? ' A supporting document is attached to this email.'
    : ''
}

</p>


<table
  cellpadding="8"
  cellspacing="0"
  style="
    border-collapse:collapse;
    width:100%;
    border:1px solid #ddd;
  "
>


${rows
  .map(
    ([key,value]) => `

<tr>

<td style="
  border:1px solid #ddd;
  background:#f7f7f7;
  width:35%;
  vertical-align:top;
">

<strong>

${esc(key)}

</strong>

</td>


<td style="
  border:1px solid #ddd;
  white-space:pre-wrap;
  vertical-align:top;
">

${esc(value)}

</td>

</tr>

`
  )
  .join('')}


</table>


<p style="
  margin-top:20px;
  color:#667085;
  font-size:13px;
">

This request was submitted through
the MUEFI website Registrar Request form.

</p>


</div>


</body>

</html>
`;


  // ------------------------------------------------
  // Plain text email
  // ------------------------------------------------

  const text =
    rows
      .map(
        ([key,value]) =>
          `${key}: ${value}`
      )
      .join('\n');


  // ------------------------------------------------
  // Recipients
  //
  // ADMIN_EMAIL may contain:
  //
  // registrar@muefi-edu.com
  //
  // OR:
  //
  // registrar@muefi-edu.com,
  // muhsofficial@gmail.com
  // ------------------------------------------------

  const recipients =
    String(
      env.ADMIN_EMAIL ||
      ''
    )
      .split(',')
      .map(
        (email) =>
          email.trim()
      )
      .filter(Boolean)
      .map(
        (email) => ({
          email,
          name:
            'MUEFI Registrar',
        })
      );


  if(
    !recipients.length
  ){

    return bad(
      'Registrar email is not configured.',
      500
    );

  }


  // ------------------------------------------------
  // Brevo payload
  // ------------------------------------------------

  const brevoPayload = {

    sender: {

      name:
        env.MAIL_FROM_NAME ||
        'MUEFI Registrar',

      email:
        env.MAIL_FROM,

    },


    to:
      recipients,


    // Reply directly to requester

    replyTo: {

      email:
        d.email,

      name:
        d.requester,

    },


    subject:
      `[Registrar] ${TYPES[type]} - ` +
      `${d.student} (${ref})`,


    htmlContent:
      html,


    textContent:
      text,


    tags: [

      'MUEFI',

      'registrar-request',

      type,

    ],

  };


  // ------------------------------------------------
  // Add attachment
  // ------------------------------------------------

  if(attach){

    brevoPayload.attachment = [
      attach,
    ];

  }


  // ------------------------------------------------
  // Send through Brevo
  // ------------------------------------------------

  let mail;


  try{

    mail =
      await fetch(
        'https://api.brevo.com/v3/smtp/email',
        {

          method:'POST',

          headers:{

            accept:
              'application/json',

            'api-key':
              env.BREVO_API_KEY,

            'content-type':
              'application/json',

          },

          body:
            JSON.stringify(
              brevoPayload
            ),

        }
      );

  }
  catch(error){

    console.error(
      'Brevo registrar request failed:',
      error
    );

    return bad(
      'We could not send your registrar request. Please try again later or contact the registrar office.',
      502
    );

  }


  // ------------------------------------------------
  // Brevo error
  // ------------------------------------------------

  if(
    !mail.ok
  ){

    const errorText =
      await mail
        .text()
        .catch(
          () => ''
        );


    console.error(
      'Brevo Registrar API error:',
      mail.status,
      errorText
    );


    return bad(
      'We could not send your registrar request. Please try again later or contact the registrar office.',
      502
    );

  }


  // ------------------------------------------------
  // Count successful request
  // ------------------------------------------------

  await env.KV.put(

    rateKey,

    String(
      sent + 1
    ),

    {
      expirationTtl:3600,
    }

  );


  // ------------------------------------------------
  // Google Sheets
  //
  // Registrar!A:N
  // ------------------------------------------------

  try{

    const a =
      await authHeader(
        env
      );


    const sheetResponse =
      await fetch(

        `${sheetBase(
          env
        )}/values/Registrar!A:N:append` +
        `?valueInputOption=RAW` +
        `&insertDataOption=INSERT_ROWS`,

        {

          method:'POST',

          headers:{

            ...a.headers,

            'content-type':
              'application/json',

          },

          body:
            JSON.stringify({

              values:[

                [

                  ref,

                  now
                    .slice(0,16)
                    .replace(
                      'T',
                      ' '
                    ),

                  TYPES[type],

                  d.requester,

                  d.email,

                  d.phone,

                  d.relationship,

                  d.student,

                  d.studentId,

                  d.level,

                  d.schoolYear,

                  d.purpose,

                  d.message,

                  'New',

                ],

              ],

            }),

        }

      );


    if(
      !sheetResponse.ok
    ){

      const sheetError =
        await sheetResponse
          .text()
          .catch(
            () => ''
          );


      console.error(
        'Google Sheets Registrar logging failed:',
        sheetResponse.status,
        sheetError
      );

    }

  }
  catch(error){

    // Email was already sent.
    // Do not make requester submit again.

    console.error(
      'Google Sheets Registrar logging exception:',
      error
    );

  }


  // ------------------------------------------------
  // Success
  // ------------------------------------------------

  return json({

    ok:true,

    ref,

  });

}