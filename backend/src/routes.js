// Record movement
    await pool.query(
      `INSERT INTO movements (item_id, from_location, to_location, note)
       VALUES ($1, $2, $3, $4)`,
      [item.id, item.location, to_location, note || null]
    );

    // Update item location
    const updated = await pool.query(
      `UPDATE items SET location = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [to_location, item.id]
    );

    // Emit real-time update (optional)
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
