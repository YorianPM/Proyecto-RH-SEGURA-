const { Router } = require('express');
const ctrl = require('../controllers/asistencia.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');

const router = Router();

router.use(verifyJWT);

router.get('/resumen', ctrl.getResumen);
router.get('/', ctrl.list);
router.post(
  '/',
  requirePerms(['asistencia_marcar_EMPLEADO', 'asistencia_ver_RH'], 'ANY'),
  ctrl.create,
);

module.exports = router;

