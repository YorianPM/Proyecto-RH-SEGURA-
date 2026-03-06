const { Router } = require('express');
const ctrl = require('../controllers/empleados.controller');
const { verifyJWT, requirePerms, requireSelfOrPerm } = require('../middlewares/auth');

const router = Router();

// Proteger todas las rutas de este recurso con JWT
router.use(verifyJWT);

// CRUD completo
router.get('/',     ctrl.getAll);
router.get('/:id',  ctrl.getById);
// Operaciones de escritura requieren permisos de gestión de usuarios
router.post('/',    requirePerms(['seguridad_gestion_usuarios_RH']), ctrl.create);
router.put('/:id',  requirePerms(['seguridad_gestion_usuarios_RH']), ctrl.update);
// Cambiar password: permitido al propio usuario o a RH con gestión de usuarios
router.patch('/:id/password', requireSelfOrPerm('seguridad_gestion_usuarios_RH'), ctrl.changePassword);
router.delete('/:id', requirePerms(['seguridad_gestion_usuarios_RH']), ctrl.remove);

module.exports = router;
