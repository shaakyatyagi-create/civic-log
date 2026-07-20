const DUPLICATE_THRESHOLD = 0.6;

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function similarity(a, b) {
  const setA = tokenize(`${a.title} ${a.description}`);
  const setB = tokenize(`${b.title} ${b.description}`);
  return jaccard(setA, setB);
}

function isDuplicate(a, b) {
  return similarity(a, b) >= DUPLICATE_THRESHOLD;
}

module.exports = { similarity, isDuplicate, DUPLICATE_THRESHOLD };
