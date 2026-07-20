const { google } = require('googleapis');

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_SENDER } = process.env;

const isConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN && GMAIL_SENDER);

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMime({ to, cc, subject, body, attachment }) {
  const headers = [
    `From: ${GMAIL_SENDER}`,
    `To: ${to}`,
    cc && cc.length ? `Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}` : null,
    `Subject: =?utf-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (!attachment) {
    headers.push('Content-Type: text/plain; charset=utf-8');
    return base64url(`${headers.join('\r\n')}\r\n\r\n${body}`);
  }

  const boundary = `civiclog_${Date.now().toString(36)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const textPart = [`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');

  const attachmentPart = [
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    attachment.buffer.toString('base64'),
  ].join('\r\n');

  return base64url(`${headers.join('\r\n')}\r\n\r\n${textPart}\r\n${attachmentPart}\r\n--${boundary}--`);
}

async function sendEmail({ to, cc, subject, body, attachment }) {
  if (!isConfigured) {
    console.log(`[gmail:dry-run] Would send to=${to} cc=${cc || '-'} subject="${subject}"${attachment ? ' with attachment' : ''}`);
    return { success: true, dryRun: true };
  }

  try {
    const gmail = getGmailClient();
    const raw = encodeMime({ to, cc, subject, body, attachment });
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { success: true, dryRun: false, messageId: res.data.id };
  } catch (err) {
    console.error('[gmail] send failed', err.message);
    return { success: false, dryRun: false, error: err.message };
  }
}

module.exports = { sendEmail, isConfigured };
