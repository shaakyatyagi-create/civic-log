const gmail = require('../services/gmail');
const twitter = require('../services/twitter');
const openai = require('../services/openai');
const { fetchImageBuffer } = require('./media');

const NGO_COUNT_BY_SEVERITY = {
  Critical: 10,
  Important: 5,
  Minor: 2,
  'Low priority': 2,
};

const NGO_ESCALATION_THRESHOLD = 3;

function severityLevel(report) {
  return report.ai_severity || report.citizen_severity;
}

function alertPrefix(level, { firstPost = false } = {}) {
  const base = level === 'Critical' ? 'CRITICAL'
    : level === 'Important' ? 'IMPORTANT'
      : level === 'Minor' ? 'MINOR'
        : 'LOW PRIORITY';
  if (firstPost) return base;
  return `${base} ALERT!!!`;
}

function stripExistingPrefix(text) {
  return String(text || '').replace(/^(CRITICAL ALERT!!!|IMPORTANT ALERT!!!|MINOR ALERT|LOW PRIORITY ALERT|CRITICAL|IMPORTANT|MINOR|LOW PRIORITY)[:\s]*/i, '').trim();
}

async function logNotification(supabase, { reportId, channel, kind, recipient, payload, success, error }) {
  await supabase.from('notifications_log').insert({
    report_id: reportId,
    channel,
    kind,
    recipient: recipient || null,
    payload: payload || null,
    success,
    error: error || null,
  });
}

async function getDistrictContacts(supabase, district) {
  const { data } = await supabase.from('district_contacts').select('*').eq('district', district).maybeSingle();
  return data || {
    authority_email: 'rufusnocturnus@gmail.com',
    escalation_email: 'valeriusinfernusscandiacus@gmail.com',
    authority_handle: 'EnderFPV',
    escalation_handle: 'gzdlocal',
  };
}

async function getNgosForReport(supabase, report) {
  const level = severityLevel(report);
  const count = NGO_COUNT_BY_SEVERITY[level] || 2;
  const { data } = await supabase.from('ngos').select('*').eq('district', report.district).eq('category', report.category).limit(count);
  const ngos = data || [];
  const emails = [...new Set(ngos.map((n) => n.email).filter(Boolean))];
  const handles = [...new Set(ngos.map((n) => n.twitter_handle).filter(Boolean))];
  return { ngos, emails, handles, count };
}

async function loadReportImage(report) {
  if (!report.image_url) return null;
  const image = await fetchImageBuffer(report.image_url);
  if (!image) return null;
  return { buffer: image.buffer, contentType: image.contentType, filename: `report-${report.id}.jpg` };
}

async function sendInitialNotifications(supabase, report) {
  const contacts = await getDistrictContacts(supabase, report.district);
  const level = severityLevel(report);
  const prefix = alertPrefix(level, { firstPost: true });
  const image = await loadReportImage(report);

  const emailResult = await gmail.sendEmail({
    to: contacts.authority_email,
    subject: report.email_draft_subject || `[${level}] ${report.title}`,
    body: report.email_draft_body,
    attachment: image,
  });
  await logNotification(supabase, {
    reportId: report.id, channel: 'email', kind: 'initial', recipient: contacts.authority_email,
    payload: report.email_draft_body, success: emailResult.success, error: emailResult.error,
  });

  const xText = `${prefix}: ${stripExistingPrefix(report.x_post_draft) || report.title} @${contacts.authority_handle}`;
  const xResult = await twitter.postTweet(xText, image);
  await logNotification(supabase, {
    reportId: report.id, channel: 'x', kind: 'initial', recipient: `@${contacts.authority_handle}`,
    payload: xResult.text, success: xResult.success, error: xResult.error,
  });

  return { email: emailResult, x: xResult };
}

async function escalateUnsolved(supabase, report) {
  const contacts = await getDistrictContacts(supabase, report.district);
  const level = severityLevel(report);
  const prefix = alertPrefix(level, { firstPost: false });
  const shouldTagNgos = report.unsolved_count >= NGO_ESCALATION_THRESHOLD;
  const image = await loadReportImage(report);

  let ngoData = { ngos: [], emails: [], handles: [], count: 0 };
  if (shouldTagNgos) {
    ngoData = await getNgosForReport(supabase, report);
  }

  const clause = await openai.generateEscalationClause(report);
  const emailSubject = `${prefix} Unresolved Civic Issue #${report.id}: ${report.title}`;
  const emailBody = `This civic issue has been re-confirmed as UNRESOLVED (report #${report.id}, marked unsolved ${report.unsolved_count} time(s)).

${clause}

District: ${report.district}
Ward/Zone: ${report.ward}
Location: ${report.area}
Category: ${report.category}
Severity: ${level}
Original description: ${report.description}

Immediate escalated action is requested.${shouldTagNgos ? `\n\nLocal NGOs have been notified for community pressure/support: ${ngoData.ngos.map((n) => n.name).join(', ') || 'none configured for this district/category'}.` : ''}`;

  const emailResult = await gmail.sendEmail({
    to: contacts.escalation_email,
    cc: shouldTagNgos ? ngoData.emails : undefined,
    subject: emailSubject,
    body: emailBody,
    attachment: image,
  });
  await logNotification(supabase, {
    reportId: report.id, channel: 'email', kind: 'escalation', recipient: contacts.escalation_email,
    payload: emailBody, success: emailResult.success, error: emailResult.error,
  });

  const alertText = `${prefix} ${report.title} (${report.category}) in ${report.district}, ${report.area} — ${clause} @${contacts.escalation_handle}`;
  const xResult = await twitter.postTweet(alertText, image);
  await logNotification(supabase, {
    reportId: report.id, channel: 'x', kind: 'escalation', recipient: `@${contacts.escalation_handle}`,
    payload: xResult.text, success: xResult.success, error: xResult.error,
  });

  let ngoXResult = null;
  if (shouldTagNgos && ngoData.handles.length) {
    const mentions = ngoData.handles.map((h) => `@${h}`).join(' ');
    const ngoText = `${prefix} Report #${report.id} in ${report.district} still unresolved after ${report.unsolved_count} checks. Requesting community support: ${mentions}`;
    ngoXResult = await twitter.postTweet(ngoText, image);
    await logNotification(supabase, {
      reportId: report.id, channel: 'x', kind: 'ngo', recipient: mentions,
      payload: ngoXResult.text, success: ngoXResult.success, error: ngoXResult.error,
    });
  }

  return { email: emailResult, x: xResult, ngoX: ngoXResult, ngoTagged: shouldTagNgos, ngoCount: ngoData.count };
}

async function requestNgoHelp(supabase, report) {
  const ngoData = await getNgosForReport(supabase, report);
  const level = severityLevel(report);
  const prefix = alertPrefix(level, { firstPost: false });
  const image = await loadReportImage(report);

  const emailBody = `A citizen has manually requested NGO support for this unresolved civic issue (report #${report.id}).

Title: ${report.title}
District: ${report.district}
Category: ${report.category}
Severity: ${level}
Location: ${report.area} (${report.ward})
Description: ${report.description}

NGOs notified: ${ngoData.ngos.map((n) => n.name).join(', ') || 'none configured for this district/category'}.`;

  const emailResult = await gmail.sendEmail({
    to: 'shaakyatyagi@gmail.com',
    cc: ngoData.emails,
    subject: `${prefix} NGO Support Requested — Report #${report.id}: ${report.title}`,
    body: emailBody,
    attachment: image,
  });
  await logNotification(supabase, {
    reportId: report.id, channel: 'email', kind: 'ngo', recipient: 'shaakyatyagi@gmail.com',
    payload: emailBody, success: emailResult.success, error: emailResult.error,
  });

  const mentions = ['shakyatyagi', ...ngoData.handles].map((h) => `@${h}`).join(' ');
  const xText = `${prefix} Report #${report.id} in ${report.district} (${report.category}) needs NGO support after no government response: ${mentions}`;
  const xResult = await twitter.postTweet(xText, image);
  await logNotification(supabase, {
    reportId: report.id, channel: 'x', kind: 'ngo', recipient: mentions,
    payload: xResult.text, success: xResult.success, error: xResult.error,
  });

  return { email: emailResult, x: xResult, ngoCount: ngoData.count };
}

module.exports = {
  sendInitialNotifications,
  escalateUnsolved,
  requestNgoHelp,
  getNgosForReport,
  alertPrefix,
  severityLevel,
  NGO_COUNT_BY_SEVERITY,
  NGO_ESCALATION_THRESHOLD,
};
