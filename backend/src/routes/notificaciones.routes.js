const { Router } = require('express');
const { verifyJWT } = require('../middlewares/auth');
const ctrl = require('../controllers/notificaciones.controller');

const router = Router();

router.use(verifyJWT);

router.get('/', ctrl.list);

module.exports = router;
