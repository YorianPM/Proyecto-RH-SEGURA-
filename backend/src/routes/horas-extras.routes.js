const { Router } = require('express');
const ctrl = require('../controllers/horas-extras.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const router = Router();

// Proteger todas las rutas
router.use(verifyJWT);

// Ver listado/detalle: RH
router.get('/resumen', requirePerms(['horas_extras_ver_RH']), ctrl.getResumen);
router.get('/', requirePerms(['horas_extras_ver_RH']), ctrl.getAll);
// Mis horas extra: cualquier autenticado
router.get('/mias', ctrl.getMine);
router.get('/:id', requirePerms(['horas_extras_ver_RH']), ctrl.getById);

// Registrar/calcular (si lo usan): RH
router.post('/calcular', requirePerms(['horas_extras_registrar_RH']), ctrl.calcularCrear);
// Empleado solicita horas extra (autogestion)
router.post('/solicitar', ctrl.solicitar);
router.patch('/:id', requirePerms(['horas_extras_registrar_RH']), ctrl.update);

// Aprobar/Denegar: RH
router.patch('/:id/aprobar', requirePerms(['horas_extras_registrar_RH']), ctrl.aprobar);
router.patch('/:id/denegar', requirePerms(['horas_extras_registrar_RH']), ctrl.denegar);

// Eliminar: RH
router.delete('/:id', requirePerms(['horas_extras_registrar_RH']), ctrl.remove);

module.exports = router;
