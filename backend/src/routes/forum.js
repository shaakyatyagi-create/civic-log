const express = require('express');
const { requireSupabase } = require('../services/supabase');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('forum_posts').select('*').order('created_at', { ascending: false });
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    res.json({ posts: data });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { name, address, problem } = req.body || {};
    if (!name || !address || !problem) {
      return res.status(400).json({ error: 'name, address, and problem are required.' });
    }

    const { data, error } = await supabase.from('forum_posts').insert({ name, address, problem }).select('*').single();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.status(201).json({ post: data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/vote', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const direction = req.body && req.body.direction === 'down' ? 'down' : 'up';
    const { data: post, error: fetchErr } = await supabase.from('forum_posts').select('votes').eq('id', req.params.id).single();
    if (fetchErr || !post) return res.status(404).json({ error: 'Post not found' });

    const delta = direction === 'down' ? -1 : 1;
    const { data, error } = await supabase.from('forum_posts').update({ votes: (post.votes || 0) + delta }).eq('id', req.params.id).select('*').single();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.json({ post: data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/replies', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.from('forum_replies').select('*').eq('post_id', req.params.id).order('created_at', { ascending: true });
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    res.json({ replies: data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/replies', async (req, res, next) => {
  try {
    const supabase = requireSupabase();
    const { name, message } = req.body || {};
    if (!name || !message) {
      return res.status(400).json({ error: 'name and message are required.' });
    }

    const { data, error } = await supabase.from('forum_replies').insert({ post_id: req.params.id, name, message }).select('*').single();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    res.status(201).json({ reply: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
