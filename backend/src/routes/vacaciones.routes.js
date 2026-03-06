const { Router } = require('express');
const ctrl = require('../controllers/vacaciones.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const router = Router();

// Requiere JWT para todas las rutas de este recurso
router.use(verifyJWT);
// Vacaciones (acumulados/registro)
// Lectura: empleado (propias) o RH (todas)
router.get('/', requirePerms(['vacaciones_ver_EMPLEADO','vacaciones_aprobar_RH'], 'ANY'), ctrl.getAll);
router.get('/:id', requirePerms(['vacaciones_ver_EMPLEADO','vacaciones_aprobar_RH'], 'ANY'), ctrl.getById);
// Crear acumulados: solo RH
router.post('/', requirePerms(['vacaciones_aprobar_RH']), ctrl.create);
// Actualizar/Eliminar: solo RH
router.put('/:id', requirePerms(['vacaciones_aprobar_RH']), ctrl.update);
router.delete('/:id', requirePerms(['vacaciones_aprobar_RH']), ctrl.remove);

module.exports = router;
