const express = require('express');
const { requireSupabase } = require('../services/supabase');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    let query = supabase.from('ngos').select('*').order('district', { ascending: true });

    const { district, category } = req.query;
    if (district && district !== 'All') query = query.eq('district', district);
    if (category && category !== 'All') query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.json({ ngos: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
