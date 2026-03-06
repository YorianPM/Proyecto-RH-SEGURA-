const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { verifyJWT } = require('../middlewares/auth');
const router = Router();

router.post('/login', ctrl.login);
router.get('/me', verifyJWT, (req, res) => {
  res.json({ ok: true, user: req.user });
});
module.exports = router;
