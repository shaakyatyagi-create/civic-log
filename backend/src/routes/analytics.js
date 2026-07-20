const express = require('express');
const { requireSupabase } = require('../services/supabase');

const router = express.Router();

function rate(solved, total) {
  return total ? Math.round((solved / total) * 100) : 0;
}

function rating(successRate) {
  return successRate >= 80 ? 'Good' : successRate >= 50 ? 'Needs Improvement' : 'Poor';
}

router.get('/hotspots', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('reports').select('district');
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    const counts = {};
    (data || []).forEach((r) => { counts[r.district] = (counts[r.district] || 0) + 1; });

    const hotspots = Object.entries(counts)
      .map(([district, count]) => ({ district, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ hotspots });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('reports').select('state, district, category, status');
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    const reports = data || [];

    const matrixMap = {};
    reports.forEach((r) => {
      const key = `${r.state}|${r.district}|${r.category}`;
      if (!matrixMap[key]) matrixMap[key] = { state: r.state, district: r.district, category: r.category, total: 0, solved: 0 };
      matrixMap[key].total += 1;
      if (r.status === 'solved') matrixMap[key].solved += 1;
    });
    const matrix = Object.values(matrixMap).map((m) => ({
      ...m,
      pending: m.total - m.solved,
      successRate: rate(m.solved, m.total),
    }));

    const categories = [...new Set(reports.map((r) => r.category))];

    const hotspotsByCategory = {};
    categories.forEach((cat) => {
      const counts = {};
      reports.filter((r) => r.category === cat).forEach((r) => { counts[r.district] = (counts[r.district] || 0) + 1; });
      hotspotsByCategory[cat] = Object.entries(counts)
        .map(([district, count]) => ({ district, count }))
        .sort((a, b) => b.count - a.count);
    });

    const districtTotals = {};
    reports.forEach((r) => {
      if (!districtTotals[r.district]) districtTotals[r.district] = { district: r.district, state: r.state, totalCount: 0, categories: new Set() };
      districtTotals[r.district].totalCount += 1;
      districtTotals[r.district].categories.add(r.category);
    });
    const hotspotOverall = Object.values(districtTotals)
      .map((d) => ({ district: d.district, state: d.state, totalCount: d.totalCount, distinctCategories: d.categories.size }))
      .sort((a, b) => (b.distinctCategories - a.distinctCategories) || (b.totalCount - a.totalCount))
      .map((d, i) => ({ ...d, rank: i + 1 }));

    const leaderboardByCategory = {};
    categories.forEach((cat) => {
      const rows = matrix.filter((m) => m.category === cat)
        .sort((a, b) => b.successRate - a.successRate)
        .map((m, i) => ({ district: m.district, total: m.total, solved: m.solved, successRate: m.successRate, rank: i + 1, rating: rating(m.successRate) }));
      leaderboardByCategory[cat] = rows;
    });

    const districtAverages = {};
    matrix.forEach((m) => {
      if (!districtAverages[m.district]) districtAverages[m.district] = { district: m.district, rates: [], total: 0, solved: 0 };
      districtAverages[m.district].rates.push(m.successRate);
      districtAverages[m.district].total += m.total;
      districtAverages[m.district].solved += m.solved;
    });
    const leaderboardOverall = Object.values(districtAverages)
      .map((d) => ({
        district: d.district,
        total: d.total,
        solved: d.solved,
        avgSuccessRate: Math.round(d.rates.reduce((s, r) => s + r, 0) / d.rates.length),
      }))
      .sort((a, b) => b.avgSuccessRate - a.avgSuccessRate)
      .map((d, i) => ({ ...d, rank: i + 1, rating: rating(d.avgSuccessRate) }));

    res.json({ matrix, hotspotsByCategory, hotspotOverall, leaderboardByCategory, leaderboardOverall });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
