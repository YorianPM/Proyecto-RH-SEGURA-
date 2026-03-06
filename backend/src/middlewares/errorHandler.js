const { logger } = require('../logger');

function serializeError(err) {
  return {
    name: err.name,
    code: err.code,
    message: err.message,
    number: err.number,
    state: err.state,
    class: err.class,
    serverName: err.serverName,
    procName: err.procName,
    lineNumber: err.lineNumber,
    original: err.original || err.originalError || null,
  };
}

module.exports = (err, req, res, next) => {
  const payload = serializeError(err);
  try {
    logger.error({
      msg: 'API error',
      method: req.method,
      path: req.originalUrl,
      status: err.status || 500,
      error: payload,
      stack: err.stack,
    });
  } catch (_) {}
  console.error('API Error:', payload);
  const status = err.status || 500;
  res.status(status).json({ ok: false, status, error: payload });
};

