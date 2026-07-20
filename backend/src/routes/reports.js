const express = require('express');
const multer = require('multer');

const { requireSupabase } = require('../services/supabase');
const { uploadEvidenceImage } = require('../services/storage');
const openai = require('../services/openai');
const { generateCode, verifyAndConsumeCode } = require('../lib/code');
const { sendInitialNotifications, escalateUnsolved, requestNgoHelp } = require('../lib/escalation');
const { isDuplicate } = require('../lib/similarity');
const { fetchImageBuffer } = require('../lib/media');
const gmail = require('../services/gmail');
const twitter = require('../services/twitter');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function required(body, fields) {
  const missing = fields.filter((f) => !body[f] || String(body[f]).trim() === '');
  if (missing.length) {
    const err = new Error(`Missing required field(s): ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

// ---------- CREATE (analyze, don't send yet) ----------
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const body = req.body;
    required(body, ['citizenName', 'phone', 'state', 'district', 'ward', 'area', 'category', 'title', 'citizenSeverity', 'description']);

    const { data: candidates } = await supabase
      .from('reports')
      .select('id, title, description, ai_severity, citizen_severity, upvotes')
      .eq('district', body.district)
      .eq('category', body.category);

    const match = (candidates || []).find((c) => isDuplicate(
      { title: body.title, description: body.description },
      { title: c.title, description: c.description }
    ));

    if (match) {
      const level = match.ai_severity || match.citizen_severity;
      const boost = level === 'Critical' || level === 'Important' ? 2 : 1;
      const { data: boosted } = await supabase.from('reports')
        .update({ upvotes: (match.upvotes || 0) + boost })
        .eq('id', match.id).select('*').single();

      return res.status(200).json({
        duplicate: true,
        matchedReport: boosted,
        message: `This matches an existing report (#${match.id}) — we've added your confirmation to it instead of creating a duplicate.`,
      });
    }

    const imageUrl = req.file ? await uploadEvidenceImage(req.file) : null;

    const reportInput = {
      citizenName: body.citizenName,
      phone: body.phone,
      state: body.state,
      district: body.district,
      ward: body.ward,
      area: body.area,
      category: body.category,
      title: body.title,
      citizenSeverity: body.citizenSeverity,
      nearFacility: body.nearFacility === 'true' || body.nearFacility === true,
      description: body.description,
      imageUrl,
    };

    const analysis = await openai.analyzeReport(reportInput);
    const verificationCode = generateCode();

    const { data, error } = await supabase.from('reports').insert({
      citizen_name: reportInput.citizenName,
      phone: reportInput.phone,
      state: reportInput.state,
      district: reportInput.district,
      ward: reportInput.ward,
      area: reportInput.area,
      category: reportInput.category,
      title: reportInput.title,
      citizen_severity: reportInput.citizenSeverity,
      near_facility: reportInput.nearFacility,
      description: reportInput.description,
      image_url: imageUrl,
      verification_code: verificationCode,
      ai_severity: analysis.ai_severity,
      ai_category_match: analysis.ai_category_match,
      ai_flagged: analysis.ai_flagged,
      ai_confidence: analysis.ai_confidence,
      ai_reasoning: { text: analysis.ai_reasoning },
      email_draft_subject: analysis.email_draft.subject,
      email_draft_body: analysis.email_draft.body,
      x_post_draft: analysis.x_post_draft,
      status: 'unsolved',
    }).select('*').single();

    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.status(201).json({ report: data, code: verificationCode });
  } catch (err) {
    next(err);
  }
});

// ---------- SEND (dispatch the initial email + X post) ----------
router.post('/:id/send', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { id } = req.params;
    const { emailSubject, emailBody, xPost } = req.body || {};

    const { data: report, error: fetchErr } = await supabase.from('reports').select('*').eq('id', id).single();
    if (fetchErr || !report) return res.status(404).json({ error: 'Report not found' });
    if (report.sent) return res.status(409).json({ error: 'This report has already been sent.' });

    const updates = {};
    if (emailSubject) updates.email_draft_subject = emailSubject;
    if (emailBody) updates.email_draft_body = emailBody;
    if (xPost) updates.x_post_draft = xPost;

    let effectiveReport = report;
    if (Object.keys(updates).length) {
      const { data: updated } = await supabase.from('reports').update(updates).eq('id', id).select('*').single();
      effectiveReport = updated || { ...report, ...updates };
    }

    const result = await sendInitialNotifications(supabase, effectiveReport);

    const { data: finalReport } = await supabase.from('reports').update({ sent: true }).eq('id', id).select('*').single();

    res.json({ report: finalReport, notifications: result });
  } catch (err) {
    next(err);
  }
});

// ---------- LIST ----------
router.get('/', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    let query = supabase.from('reports').select('*').order('created_at', { ascending: false });

    const { state, district, category, status } = req.query;
    if (state && state !== 'All') query = query.eq('state', state);
    if (district && district !== 'All') query = query.eq('district', district);
    if (category && category !== 'All') query = query.eq('category', category);
    if (status && status !== 'All') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.json({ reports: data });
  } catch (err) {
    next(err);
  }
});

// ---------- DETAIL ----------
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: data });
  } catch (err) {
    next(err);
  }
});

// ---------- UPVOTE / CONFIRM ----------
router.post('/:id/upvote', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data: report, error: fetchErr } = await supabase.from('reports').select('upvotes').eq('id', req.params.id).single();
    if (fetchErr || !report) return res.status(404).json({ error: 'Report not found' });

    const { data, error } = await supabase.from('reports').update({ upvotes: (report.upvotes || 0) + 1 }).eq('id', req.params.id).select('*').single();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.json({ report: data });
  } catch (err) {
    next(err);
  }
});

// ---------- STATUS TOGGLE (code-gated) ----------
router.post('/:id/status', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { code, newStatus, reason } = req.body || {};

    if (!code || !['solved', 'unsolved'].includes(newStatus)) {
      return res.status(400).json({ error: 'code and a valid newStatus (solved|unsolved) are required.' });
    }

    const { data: report, error: fetchErr } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (fetchErr || !report) return res.status(404).json({ error: 'Report not found' });

    const verification = await verifyAndConsumeCode(supabase, report, code);
    if (!verification.ok) {
      return res.status(403).json({ error: verification.message, locked: !!verification.locked });
    }

    if (newStatus === 'solved') {
      const { data: updated, error } = await supabase.from('reports')
        .update({ status: 'solved', resolved_at: new Date().toISOString() })
        .eq('id', req.params.id).select('*').single();
      if (error) throw Object.assign(new Error(error.message), { status: 500 });
      return res.json({ report: updated, escalation: null });
    }

    // newStatus === 'unsolved'
    const { data: updated, error } = await supabase.from('reports')
      .update({ status: 'unsolved', unsolved_count: (report.unsolved_count || 0) + 1, resolved_at: null })
      .eq('id', req.params.id).select('*').single();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    if (reason) {
      await supabase.from('notifications_log').insert({
        report_id: updated.id, channel: 'email', kind: 'escalation', recipient: null,
        payload: `Citizen reopen reason: ${reason}`, success: true,
      });
    }

    const escalationResult = await escalateUnsolved(supabase, updated);

    res.json({ report: updated, escalation: escalationResult });
  } catch (err) {
    next(err);
  }
});

// ---------- MANUAL NGO HELP REQUEST (one-shot per report) ----------
router.post('/:id/ngo-help', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data: report, error: fetchErr } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (fetchErr || !report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'unsolved') return res.status(400).json({ error: 'NGO help can only be requested for unsolved reports.' });
    if (report.ngo_manual_requested) return res.status(409).json({ error: 'NGO help has already been requested for this report.' });

    const result = await requestNgoHelp(supabase, report);

    const { data: updated } = await supabase.from('reports').update({ ngo_manual_requested: true }).eq('id', req.params.id).select('*').single();

    res.json({ report: updated, notifications: result });
  } catch (err) {
    next(err);
  }
});

// ---------- NGO APPLICATION (assign a specific NGO, review draft, then send) ----------
router.post('/:id/ngo-application', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { ngoId } = req.body || {};
    if (!ngoId) return res.status(400).json({ error: 'ngoId is required.' });

    const { data: report, error: reportErr } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (reportErr || !report) return res.status(404).json({ error: 'Report not found' });

    const { data: ngo, error: ngoErr } = await supabase.from('ngos').select('*').eq('id', ngoId).single();
    if (ngoErr || !ngo) return res.status(404).json({ error: 'NGO not found' });

    const draft = await openai.generateNgoApplication(report, ngo);

    res.json({ report, ngo, draft });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/ngo-application/send', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { ngoId, subject, body, xPost } = req.body || {};
    if (!ngoId || !subject || !body || !xPost) {
      return res.status(400).json({ error: 'ngoId, subject, body, and xPost are required.' });
    }

    const { data: report, error: reportErr } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (reportErr || !report) return res.status(404).json({ error: 'Report not found' });

    const { data: ngo, error: ngoErr } = await supabase.from('ngos').select('*').eq('id', ngoId).single();
    if (ngoErr || !ngo) return res.status(404).json({ error: 'NGO not found' });

    const image = report.image_url ? await fetchImageBuffer(report.image_url) : null;
    const attachment = image ? { ...image, filename: `report-${report.id}.jpg` } : null;

    const emailResult = await gmail.sendEmail({
      to: 'shaakyatyagi@gmail.com',
      cc: ngo.email || undefined,
      subject,
      body,
      attachment,
    });

    const handles = [...new Set(['shakyatyagi', ngo.twitter_handle].filter(Boolean))];
    const xText = `${xPost} ${handles.map((h) => `@${h}`).join(' ')}`;
    const xResult = await twitter.postTweet(xText, attachment);

    await supabase.from('notifications_log').insert([
      { report_id: report.id, channel: 'email', kind: 'ngo', recipient: 'shaakyatyagi@gmail.com', payload: body, success: emailResult.success, error: emailResult.error },
      { report_id: report.id, channel: 'x', kind: 'ngo', recipient: handles.map((h) => `@${h}`).join(' '), payload: xResult.text, success: xResult.success, error: xResult.error },
    ]);

    res.json({ notifications: { email: emailResult, x: xResult } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
