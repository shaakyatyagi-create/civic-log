const { requireSupabase } = require('./supabase');

const BUCKET = 'evidence';

/**
 * Uploads a report photo (multer memory-storage buffer) to the public
 * "evidence" bucket and returns its public URL.
 */
async function uploadEvidenceImage(file) {
  if (!file) return null;

  const supabase = requireSupabase();
  const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `reports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    const err = new Error(`Image upload failed: ${error.message}`);
    err.status = 500;
    throw err;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { uploadEvidenceImage };
