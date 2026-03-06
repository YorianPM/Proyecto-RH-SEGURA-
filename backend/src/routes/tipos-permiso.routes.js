const { Router } = require('express');
const ctrl = require('../controllers/permisos.controller');
const router = Router();

router.get('/', ctrl.getTipos);

module.exports = router;
