// Auditoría a archivo (no usa BD)
const { logger } = require('../logger');

function logAudit(req, res, next) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutating.includes(req.method)) return next();

  const started = Date.now();
  res.on('finish', () => {
    try {
      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - started,
        ip: req.ip,
        user: req.user?.sub || null
      };
      logger.info(entry);
    } catch (_) {}
  });

  next();
}

module.exports = { logAudit };
