const OpenAI = require('openai');

const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const SEVERITIES = ['Critical', 'Important', 'Minor', 'Low priority'];

const ANALYSIS_SCHEMA = {
  name: 'civic_report_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ai_severity: { type: 'string', enum: SEVERITIES },
      ai_category_match: { type: 'boolean' },
      ai_flagged: { type: 'boolean', description: 'true if the photo evidence does not substantiate a Critical/Important claim and the severity was downgraded' },
      ai_confidence: { type: 'number', minimum: 0, maximum: 1 },
      ai_reasoning: { type: 'string' },
      email_subject: { type: 'string' },
      email_body: { type: 'string' },
      x_post: { type: 'string', description: 'Under 240 characters, no hashself-tags, ready to post as-is.' },
    },
    required: ['ai_severity', 'ai_category_match', 'ai_flagged', 'ai_confidence', 'ai_reasoning', 'email_subject', 'email_body', 'x_post'],
  },
  strict: true,
};

function dryRunAnalysis(report) {
  // Deterministic simulated analysis so the whole flow is testable before an
  // OPENAI_API_KEY is configured. Mirrors the citizen's own input back with a
  // clearly-labelled simulation notice.
  const level = SEVERITIES.includes(report.citizenSeverity) ? report.citizenSeverity : 'Minor';
  return {
    ai_severity: level,
    ai_category_match: true,
    ai_flagged: false,
    ai_confidence: 0.5,
    ai_reasoning: '[DRY RUN — no OPENAI_API_KEY configured] Simulated analysis: accepted the citizen-reported severity and category as-is.',
    email_draft: {
      subject: `[${level} Priority] Formal Grievance: ${report.title}`,
      body: buildFallbackEmailBody(report, level),
    },
    x_post_draft: buildFallbackXPost(report, level),
  };
}

function buildFallbackEmailBody(report, level) {
  return `To the Municipal Executive Officer / Commissioner,
Department of Health & Civic Administration, ${report.district}

Subject: Formal Grievance Regarding Unresolved Civic Concern (${level} Priority)

Respected Authority,

I, ${report.citizenName}, residing at ${report.area}, ${report.district}, wish to formally report the following civic issue:

${report.title}
${report.description}

Ward/Zone: ${report.ward}
Category: ${report.category}
${report.nearFacility ? 'Note: This location is near a hospital or school, increasing urgency.' : ''}

This matter requires your immediate attention and administrative action to ensure a swift resolution.

Yours Sincerely,
${report.citizenName}`;
}

function buildFallbackXPost(report, level) {
  const prefix = level === 'Critical' ? 'CRITICAL' : level === 'Important' ? 'IMPORTANT' : level === 'Minor' ? 'MINOR' : 'LOW PRIORITY';
  return `${prefix}: ${report.title} — ${report.category} issue reported in ${report.district}, ${report.area}. Awaiting civic action. #CivicLog`;
}

async function analyzeReport(report) {
  if (!client) {
    return dryRunAnalysis(report);
  }

  const userContent = [
    {
      type: 'text',
      text: `A citizen filed this civic grievance report. Scrutinize the attached photo carefully against the description and the claimed severity — this platform gets abused by people inflating minor issues to "Critical" or "Important" to jump the queue, so treat the photo as the source of truth over the citizen's own claim.

Citizen-reported details:
- Title: ${report.title}
- Category chosen by citizen: ${report.category}
- Severity chosen by citizen: ${report.citizenSeverity}
- Near a hospital/school: ${report.nearFacility ? 'Yes' : 'No'}
- District: ${report.district}, Ward: ${report.ward}, Area: ${report.area}
- Description: ${report.description}

Severity scale (choose exactly one): Critical (chemical leaks, contaminated water, severe overflow, immediate health hazard), Important (open sewage, poor cleanliness, unresolved and worsening), Minor (small drain overflow, garbage buildup), Low priority (seepage, cosmetic, low urgency).

Rules:
1. Assess ai_severity from what the photo actually shows, not from the citizen's claim.
2. If the citizen claimed Critical or Important but the photo shows a normal scene with no visible hazard, or the visible problem clearly doesn't rise to that level, downgrade ai_severity to Minor or Low priority as appropriate, set ai_flagged to true, and explain the discrepancy in ai_reasoning.
3. If the photo genuinely supports the claimed severity, set ai_flagged to false.
4. ai_category_match should reflect whether the chosen category (Road/Water/Garbage/Electricity/Other) matches what's actually depicted.

Write the email as a formal, respectful grievance letter addressed to the municipal authority of ${report.district}, signed by ${report.citizenName}, using the AI-assessed severity (not necessarily the citizen's original claim). Write the X post as a concise public civic-alert post (under 240 characters) that states the assessed severity, the issue, and the location — no hashtag spam, no @mentions.`,
    },
  ];

  if (report.imageUrl) {
    userContent.push({ type: 'image_url', image_url: { url: report.imageUrl } });
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a civic-issue triage assistant for a public grievance platform in India. You objectively assess severity from photographic evidence and citizen text, and you write clear, formal municipal correspondence. Always respond using the provided JSON schema.',
      },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
    temperature: 0.4,
  });

  const parsed = JSON.parse(completion.choices[0].message.content);

  return {
    ai_severity: parsed.ai_severity,
    ai_category_match: parsed.ai_category_match,
    ai_flagged: parsed.ai_flagged,
    ai_confidence: parsed.ai_confidence,
    ai_reasoning: parsed.ai_reasoning,
    email_draft: { subject: parsed.email_subject, body: parsed.email_body },
    x_post_draft: parsed.x_post,
  };
}

/**
 * Generates the short descriptive clause appended after a deterministic
 * ALERT prefix (the literal prefix text is decided by lib/escalation.js per
 * the platform's fixed severity-keyword rules, not by the model).
 */
async function generateEscalationClause(report) {
  if (!client) {
    return `${report.title} in ${report.district} (${report.area}) remains unresolved. [DRY RUN]`;
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You write terse, factual civic-alert social media clauses. One sentence, under 180 characters, no hashtags, no @mentions, no emoji.' },
      {
        role: 'user',
        content: `Write one sentence describing that this civic issue is STILL UNRESOLVED and needs urgent authority action: "${report.title}" (${report.category}) in ${report.district}, ${report.area}.`,
      },
    ],
    temperature: 0.5,
    max_tokens: 100,
  });

  return completion.choices[0].message.content.trim();
}

module.exports = { analyzeReport, generateEscalationClause, SEVERITIES };
