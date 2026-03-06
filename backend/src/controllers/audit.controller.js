// Controlador de auditoria: expone utilidades para leer logs del server.
const fs = require('fs');
const path = require('path');
const { logsDir } = require('../logger');

const LOG_FILE = path.join(logsDir, 'combined.log');

// GET /api/audit?limit=100 -> regresa las ultimas N lineas parseadas del log combinado.
exports.tail = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
    if (!fs.existsSync(LOG_FILE)) return res.json({ ok: true, count: 0, data: [] });

    // Lee últimas N líneas (forma simple)
    const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!content) return res.json({ ok: true, count: 0, data: [] });

    const lines = content.split('\n').filter(Boolean);
    const last = lines.slice(-limit);
    const data = [];
    for (const line of last) {
      try { data.push(JSON.parse(line)); } catch {}
    }
    res.json({ ok: true, count: data.length, data });
  } catch (err) { next(err); }
};
