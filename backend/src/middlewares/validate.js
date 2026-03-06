const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ ok:false, errors: errors.array().map(e => ({ field:e.param, msg:e.msg })) });
}

module.exports = { validate };
