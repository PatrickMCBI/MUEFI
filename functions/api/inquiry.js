import { json } from '../_lib/util.js';
import { authHeader, sheetBase } from '../_lib/sheets.js';

const TYPES = {
  balance: 'Balance inquiry',
  payment: 'Tuition payment (proof of payment)',
  other: 'Other billing concern',
};

const METHODS = [
  'GCash',
  'Maya',
  'Bank transfer',
  'Over the counter',
  'Other',
];

const MAX_FILE = 5 * 1024 * 1024;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

const bad = (error, status = 400) =>
  json({ error }, status);

const rnd = (n) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(n)),
    (b) => ALPHA[b % ALPHA.length]
  ).join('');

function b64(bytes) {
  let s = '';

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + 0x8000)
    );
  }

  return btoa(s);
}

// Check the actual file signature.
function fileExt(b) {
  const at = (i, ...x) =>
    x.every((v, k) => b[i + k] === v);

  // PDF
  if (at(0, 0x25, 0x50, 0x44, 0x46)) {
    return 'pdf';
  }

  // JPG / JPEG
  if (at(0, 0xff, 0xd8, 0xff)) {
    return 'jpg';
  }

  // PNG
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) {
    return 'png';
  }

  // WEBP
  if (
    at(0, 0x52, 0x49, 0x46, 0x46) &&
    at(8, 0x57, 0x45, 0x42, 0x50)
  ) {
    return 'webp';
  }

  return null;
}

export async function onRequestPost({ request, env }) {
  // --------------------------------------------------
  // Read form
  // --------------------------------------------------

  let f;

  try {
    f = await request.formData();
  } catch {
    return bad('Invalid form.');
  }

  // --------------------------------------------------
  // Honeypot anti-spam
  // --------------------------------------------------

  if (f.get('website')) {
    return json({
      ok: true,
      ref: 'INQ-000000-0000',
    });
  }

  // --------------------------------------------------
  // Environment validation
  // --------------------------------------------------

  if (!env.KV) {
    console.error('KV binding is missing.');
    return bad(
      'The inquiry service is not configured correctly.',
      500
    );
  }

  if (!env.BREVO_API_KEY) {
    console.error('BREVO_API_KEY is missing.');
    return bad(
      'The email service is not configured correctly.',
      500
    );
  }

  if (!env.MAIL_FROM) {
    console.error('MAIL_FROM is missing.');
    return bad(
      'The email sender is not configured correctly.',
      500
    );
  }

  if (!env.ADMIN_EMAIL) {
    console.error('ADMIN_EMAIL is missing.');
    return bad(
      'The accounting email is not configured correctly.',
      500
    );
  }

  // --------------------------------------------------
  // Rate limiting
  // Maximum 5 submissions per IP per hour
  // --------------------------------------------------

  const ip =
    request.headers.get('cf-connecting-ip') ||
    'unknown';

  const rateKey = `inq:${ip}`;

  const sent =
    Number(await env.KV.get(rateKey)) || 0;

  if (sent >= 5) {
    return bad(
      'Too many submissions. Please try again in an hour, or call the school office.',
      429
    );
  }

  // --------------------------------------------------
  // Inquiry type
  // --------------------------------------------------

  const type = String(
    f.get('type') || ''
  );

  if (!TYPES[type]) {
    return bad(
      'Please choose what you need.'
    );
  }

  // --------------------------------------------------
  // Parent / student information
  // --------------------------------------------------

  const d = {
    parent: clean(
      f.get('parent'),
      80
    ),

    student: clean(
      f.get('student'),
      80
    ),

    studentId: clean(
      f.get('studentId'),
      30
    ),

    level: clean(
      f.get('level'),
      40
    ),

    email: clean(
      f.get('email'),
      120
    ),

    phone: clean(
      f.get('phone'),
      30
    ),

    message: String(
      f.get('message') || ''
    )
      .trim()
      .slice(0, 2000),
  };

  // Required fields
  if (
    !d.parent ||
    !d.student ||
    !d.level
  ) {
    return bad(
      'Please fill in your name, the student name, and grade and section.'
    );
  }

  // Email validation
  if (
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(
      d.email
    )
  ) {
    return bad(
      'Please enter a valid email address so the school can reply.'
    );
  }

  // Other inquiry requires message
  if (
    type === 'other' &&
    !d.message
  ) {
    return bad(
      'Please describe your concern.'
    );
  }

  // --------------------------------------------------
  // Payment information
  // --------------------------------------------------

  let amount = '';
  let paidOn = '';
  let method = '';
  let payRef = '';
  let attach = null;

  // Philippine time
  const now = new Date(
    Date.now() + 8 * 3600e3
  ).toISOString();

  // Example:
  // INQ-260928-A7KD
  const ref =
    `INQ-${now.slice(2, 4)}` +
    `${now.slice(5, 7)}` +
    `${now.slice(8, 10)}-` +
    rnd(4);

  // --------------------------------------------------
  // Payment validation
  // --------------------------------------------------

  if (type === 'payment') {
    amount = String(
      f.get('amount') || ''
    ).replace(
      /[,\s₱]/g,
      ''
    );

    paidOn = clean(
      f.get('paidOn'),
      10
    );

    method = clean(
      f.get('method'),
      30
    );

    payRef = clean(
      f.get('payRef'),
      60
    );

    // Amount
    if (
      !/^\d{1,9}(\.\d{1,2})?$/.test(
        amount
      ) ||
      Number(amount) <= 0
    ) {
      return bad(
        'Please enter the amount you paid.'
      );
    }

    // Date
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        paidOn
      )
    ) {
      return bad(
        'Please enter the date you paid.'
      );
    }

    // Payment method
    if (
      !METHODS.includes(method)
    ) {
      return bad(
        'Please choose a payment method.'
      );
    }

    // Payment proof
    const file = f.get('proof');

    if (
      !file ||
      typeof file !== 'object' ||
      !file.size
    ) {
      return bad(
        'Please attach your proof of payment.'
      );
    }

    // 5 MB limit
    if (file.size > MAX_FILE) {
      return bad(
        'The file is larger than 5 MB. Please upload a smaller photo or PDF.'
      );
    }

    const bytes =
      new Uint8Array(
        await file.arrayBuffer()
      );

    // Verify actual file type
    const ext = fileExt(bytes);

    if (!ext) {
      return bad(
        'Please upload a PDF, JPG, PNG, or WEBP file.'
      );
    }

    attach = {
      name: `${ref}-proof.${ext}`,
      content: b64(bytes),
    };
  }

  // --------------------------------------------------
  // Format amount
  // --------------------------------------------------

  const peso = amount
    ? `PHP ${Number(amount).toLocaleString(
        'en-PH',
        {
          minimumFractionDigits: 2,
        }
      )}`
    : '';

  // --------------------------------------------------
  // Email rows
  // --------------------------------------------------

  const rows = [
    [
      'Reference',
      ref,
    ],

    [
      'Type',
      TYPES[type],
    ],

    [
      'Parent / guardian',
      d.parent,
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
      'Student',
      d.student,
    ],

    [
      'Student ID',
      d.studentId || '-',
    ],

    [
      'Grade and section',
      d.level,
    ],
  ];

  if (type === 'payment') {
    rows.push(
      [
        'Amount paid',
        peso,
      ],

      [
        'Date paid',
        paidOn,
      ],

      [
        'Payment method',
        method,
      ],

      [
        'Payment reference no.',
        payRef || '-',
      ]
    );
  }

  rows.push([
    'Message',
    d.message || '-',
  ]);

  // --------------------------------------------------
  // HTML email
  // --------------------------------------------------

  const html =
    `
    <div style="
      font-family:Arial,Helvetica,sans-serif;
      max-width:700px;
      margin:auto;
      color:#1f2933;
    ">

      <h2 style="
        color:#9b1c1c;
        margin-bottom:8px;
      ">
        MUEFI Accounting Inquiry
      </h2>

      <p>
        A new accounting inquiry has been submitted
        through the MUEFI website.
      </p>

      <p>
        <strong>Press Reply to answer the parent directly.</strong>
        ${
          attach
            ? ' Proof of payment is attached.'
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
            ([k, v]) => `
              <tr>
                <td style="
                  border:1px solid #ddd;
                  background:#f7f7f7;
                  width:35%;
                  vertical-align:top;
                ">
                  <strong>
                    ${esc(k)}
                  </strong>
                </td>

                <td style="
                  border:1px solid #ddd;
                  white-space:pre-wrap;
                  vertical-align:top;
                ">
                  ${esc(v)}
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
        Reference number:
        <strong>${esc(ref)}</strong>
      </p>

    </div>
    `;

  // --------------------------------------------------
  // Plain text email
  // --------------------------------------------------

  const text = rows
    .map(
      ([k, v]) =>
        `${k}: ${v}`
    )
    .join('\n');

  // --------------------------------------------------
  // Brevo recipients
  //
  // ADMIN_EMAIL can contain:
  //
  // accounting@muefi-edu.com
  //
  // or:
  //
  // accounting@muefi-edu.com,
  // admin@muefi-edu.com
  // --------------------------------------------------

  const recipients =
    String(
      env.ADMIN_EMAIL || ''
    )
      .split(',')
      .map(
        (s) => s.trim()
      )
      .filter(Boolean)
      .map(
        (email) => ({
          email,
          name: 'MUEFI Accounting',
        })
      );

  if (!recipients.length) {
    return bad(
      'School accounting email is not configured.',
      500
    );
  }

  // --------------------------------------------------
  // Brevo API payload
  // --------------------------------------------------

  const brevoPayload = {
    sender: {
      name:
        env.MAIL_FROM_NAME ||
        'MUEFI Accounting',

      email:
        env.MAIL_FROM,
    },

    to: recipients,

    // IMPORTANT:
    // When accounting clicks Reply,
    // Gmail will reply to the parent.
    replyTo: {
      email: d.email,
      name: d.parent,
    },

    subject:
      `[Accounting] ${TYPES[type]}, ` +
      `${d.student} (${ref})`,

    htmlContent: html,

    textContent: text,

    tags: [
      'MUEFI',
      'accounting-inquiry',
      type,
    ],
  };

  // Add payment proof
  if (attach) {
    brevoPayload.attachment = [
      attach,
    ];
  }

  // --------------------------------------------------
  // Send through Brevo
  // --------------------------------------------------

  let mail;

  try {
    mail = await fetch(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',

        headers: {
          accept:
            'application/json',

          'api-key':
            env.BREVO_API_KEY,

          'content-type':
            'application/json',
        },

        body: JSON.stringify(
          brevoPayload
        ),
      }
    );
  } catch (error) {
    console.error(
      'Brevo request failed:',
      error
    );

    return bad(
      'We could not send your inquiry. Please try again later or call the school office.',
      502
    );
  }

  // --------------------------------------------------
  // Brevo error
  // --------------------------------------------------

  if (!mail.ok) {
    const errorText =
      await mail
        .text()
        .catch(
          () => ''
        );

    console.error(
      'Brevo API error:',
      mail.status,
      errorText
    );

    return bad(
      'We could not send your inquiry. Please try again later or call the school office.',
      502
    );
  }

  // --------------------------------------------------
  // Rate limit
  // Only count successful submissions
  // --------------------------------------------------

  await env.KV.put(
    rateKey,
    String(sent + 1),
    {
      expirationTtl: 3600,
    }
  );

  // --------------------------------------------------
  // Google Sheets logging
  //
  // Inquiries!A:O
  // --------------------------------------------------

  try {
    const a =
      await authHeader(env);

    await fetch(
      `${sheetBase(
        env
      )}/values/Inquiries!A:O:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',

        headers: {
          ...a.headers,

          'content-type':
            'application/json',
        },

        body: JSON.stringify({
          values: [
            [
              ref,

              now
                .slice(0, 16)
                .replace(
                  'T',
                  ' '
                ),

              TYPES[type],

              d.parent,

              d.email,

              d.phone,

              d.student,

              d.studentId,

              d.level,

              amount,

              paidOn,

              method,

              payRef,

              d.message,

              'New',
            ],
          ],
        }),
      }
    );
  } catch (error) {
    // Do not make the parent submit again.
    // Email has already been sent successfully.
    console.error(
      'Google Sheets logging failed:',
      error
    );
  }

  // --------------------------------------------------
  // Success
  // --------------------------------------------------

  return json({
    ok: true,
    ref,
  });
}