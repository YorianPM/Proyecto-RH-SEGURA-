const { Router } = require('express');
const ctrl = require('../controllers/audit.controller');

const router = Router();
// Si quieres protegerlo con token, agrega verifyJWT aquí
router.get('/', ctrl.tail);

module.exports = router;
