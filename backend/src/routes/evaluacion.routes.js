const { Router } = require('express');
const ctrl = require('../controllers/evaluacion.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const router = Router();

// Proteger todas
router.use(verifyJWT);

// Empleado autenticado: ver solo sus evaluaciones
router.get('/mias', ctrl.getMine);

// RH: ver/gestionar todas
router.get('/',    requirePerms(['asistencia_ver_RH']), ctrl.getAll);
router.get('/:id', requirePerms(['asistencia_ver_RH']), ctrl.getById);
router.post('/',   requirePerms(['asistencia_ver_RH']), ctrl.create);
router.put('/:id', requirePerms(['asistencia_ver_RH']), ctrl.update);
router.delete('/:id', requirePerms(['asistencia_ver_RH']), ctrl.remove);

module.exports = router;
