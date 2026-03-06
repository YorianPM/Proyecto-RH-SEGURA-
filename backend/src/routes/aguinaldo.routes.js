const { Router } = require('express');
const { verifyJWT, requirePerms } = require('../middlewares/auth');
const ctrl = require('../controllers/aguinaldo.controller');

const router = Router();

router.use(verifyJWT);

// Usamos los mismos permisos de planilla para evitar romper roles existentes
router.get('/mio', ctrl.mine);
router.get('/mio/pdf', ctrl.minePdf);
router.get('/preview', requirePerms(['planilla_ver_RH']), ctrl.preview);
router.post('/generar', requirePerms(['planilla_generar_RH']), ctrl.generar);
router.get('/', requirePerms(['planilla_ver_RH']), ctrl.list);
router.get('/pdf', requirePerms(['planilla_ver_RH']), ctrl.listPdf);

module.exports = router;
