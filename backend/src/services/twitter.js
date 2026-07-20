const { TwitterApi } = require('twitter-api-v2');

const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;

const isConfigured = Boolean(X_API_KEY && X_API_SECRET && X_ACCESS_TOKEN && X_ACCESS_TOKEN_SECRET);

let client = null;
if (isConfigured) {
  client = new TwitterApi({
    appKey: X_API_KEY,
    appSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  });
}

async function postTweet(text, image) {
  const trimmed = text.length > 280 ? `${text.slice(0, 277)}...` : text;

  if (!isConfigured) {
    console.log(`[x:dry-run] Would post: ${trimmed}${image ? ' with image' : ''}`);
    return { success: true, dryRun: true, text: trimmed };
  }

  try {
    let mediaIds;
    if (image && image.buffer) {
      const mediaId = await client.v1.uploadMedia(image.buffer, { mimeType: image.contentType });
      mediaIds = [mediaId];
    }

    const res = await client.v2.tweet(mediaIds ? { text: trimmed, media: { media_ids: mediaIds } } : trimmed);
    return { success: true, dryRun: false, id: res.data.id, text: trimmed };
  } catch (err) {
    console.error('[x] post failed', err.message);
    return { success: false, dryRun: false, error: err.message, text: trimmed };
  }
}

module.exports = { postTweet, isConfigured };
