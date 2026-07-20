async function fetchImageBuffer(url) {
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  } catch (err) {
    console.error('[media] fetchImageBuffer failed', err.message);
    return null;
  }
}

module.exports = { fetchImageBuffer };
