const { Router } = require('express');
const ctrl = require('../controllers/solicitudes.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const router = Router();

// Requiere JWT en todo este recurso
router.use(verifyJWT);

// Ver/crear: empleado o RH
router.get('/', requirePerms(['vacaciones_ver_EMPLEADO','vacaciones_aprobar_RH'], 'ANY'), ctrl.getAll);
router.get('/:id', requirePerms(['vacaciones_ver_EMPLEADO','vacaciones_aprobar_RH'], 'ANY'), ctrl.getById);
router.post('/', requirePerms(['vacaciones_solicitar_EMPLEADO','vacaciones_aprobar_RH'], 'ANY'), ctrl.create);

// Decidir: solo RH
router.patch('/:id/aprobar', requirePerms(['vacaciones_aprobar_RH']), ctrl.aprobar);
router.patch('/:id/denegar', requirePerms(['vacaciones_aprobar_RH']), ctrl.denegar);
router.patch('/:id/decidir', requirePerms(['vacaciones_aprobar_RH']), ctrl.decidir);

router.delete('/:id', requirePerms(['vacaciones_aprobar_RH']), ctrl.remove);

module.exports = router;
