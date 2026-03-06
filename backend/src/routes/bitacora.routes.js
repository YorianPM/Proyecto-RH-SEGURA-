const { Router } = require('express');
const ctrl = require('../controllers/bitacora.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth'); // si ya lo tienes

const router = Router();
router.get('/', verifyJWT, requirePerms(['reportes_ver_RH'], 'ANY'), ctrl.getAll);
module.exports = router;
