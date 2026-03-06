const { Router } = require('express');
const ctrl = require('../controllers/permisos.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const router = Router();

// Requiere JWT para todas las rutas de este recurso
router.use(verifyJWT);
// Ver: empleado o RH
router.get('/', requirePerms(['permisos_ver_EMPLEADO','permisos_aprobar_RH'], 'ANY'), ctrl.getAll);
router.get('/:id', requirePerms(['permisos_ver_EMPLEADO','permisos_aprobar_RH'], 'ANY'), ctrl.getById);
// Crear/actualizar solicitud: empleado o RH
router.post('/', requirePerms(['permisos_ver_EMPLEADO','permisos_aprobar_RH'], 'ANY'), ctrl.create);
router.put('/:id', requirePerms(['permisos_ver_EMPLEADO','permisos_aprobar_RH'], 'ANY'), ctrl.update);
// Decidir y eliminar: solo RH
router.patch('/:id/decidir', requirePerms(['permisos_aprobar_RH']), ctrl.decidir);
router.delete('/:id', requirePerms(['permisos_aprobar_RH']), ctrl.remove);

module.exports = router;
