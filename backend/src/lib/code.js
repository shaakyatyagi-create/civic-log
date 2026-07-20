const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Verifies a citizen-submitted 6-digit code against a report row, with
 * brute-force protection: after MAX_ATTEMPTS wrong guesses the report locks
 * for LOCK_MINUTES. Persists the attempt/lock state back to Supabase.
 */
async function verifyAndConsumeCode(supabase, report, submittedCode) {
  const now = new Date();

  if (report.code_locked_until && new Date(report.code_locked_until) > now) {
    return { ok: false, locked: true, message: `Too many incorrect attempts. Try again after ${new Date(report.code_locked_until).toLocaleTimeString()}.` };
  }

  if (String(submittedCode).trim() === report.verification_code) {
    if (report.code_attempts !== 0 || report.code_locked_until) {
      await supabase.from('reports').update({ code_attempts: 0, code_locked_until: null }).eq('id', report.id);
    }
    return { ok: true };
  }

  const attempts = (report.code_attempts || 0) + 1;
  const update = { code_attempts: attempts };
  let locked = false;

  if (attempts >= MAX_ATTEMPTS) {
    update.code_attempts = 0;
    update.code_locked_until = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
    locked = true;
  }

  await supabase.from('reports').update(update).eq('id', report.id);

  return {
    ok: false,
    locked,
    message: locked
      ? `Too many incorrect attempts. This report is locked for ${LOCK_MINUTES} minutes.`
      : `Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
  };
}

module.exports = { generateCode, verifyAndConsumeCode, MAX_ATTEMPTS, LOCK_MINUTES };
