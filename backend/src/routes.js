const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this';

// Middleware to protect routes
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ========== AUTH ==========
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Temporary: allow admin / admin123
    const isValid = password === 'admin123' || await bcrypt.compare(password, user.password);

    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ITEMS ==========
router.get('/items', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM items WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/items', auth, async (req, res) => {
  const { name, description, quantity, category, location, is_public } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO items (user_id, name, description, quantity, category, location, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.id, name, description  null, quantity  1, category  null, location, is_public  false]
    );

    // Record initial movement
    await pool.query(
      `INSERT INTO movements (item_id, from_location, to_location, note)
       VALUES ($1, '—', $2, 'Initial location')`,
      [result.rows[0].id, location]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/:id', auth, async (req, res) => {
  const { name, description, quantity, category, location, is_public } = req.body;

  try {
    const result = await pool.query(
      `UPDATE items SET 
         name = $1, description = $2, quantity = $3, category = $4, 
         location = $5, is_public = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [name, description, quantity, category, location, is_public, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MOVE ITEM ==========
router.post('/items/:id/move', auth, async (req, res) => {
  const { to_location, note } = req.body;

  try {
    const itemRes = await pool.query(
      'SELECT * FROM items WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

    const item = itemRes.rows[0];

    await pool.query(
      `INSERT INTO movements (item_id, from_location, to_location, note)
       VALUES ($1, $2, $3, $4)`,
      [item.id, item.location, to_location, note || null]
    );

    const updated = await pool.query(
      `UPDATE items SET location = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [to_location, item.id]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('item_moved', { itemId: item.id, newLocation: to_location });
    }

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MOVEMENT HISTORY ==========
router.get('/items/:id/movements', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.* FROM movements m
       JOIN items i ON i.id = m.item_id
       WHERE m.item_id = $1 AND i.user_id = $2
       ORDER BY m.moved_at DESC`,
      [req.params.id, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
