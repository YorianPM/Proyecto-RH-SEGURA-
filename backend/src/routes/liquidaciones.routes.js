const router = require('express').Router();
const ctrl = require('../controllers/liquidaciones.controller');

// Nota: El middleware JWT ya se aplica a /api en server.js

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/pdf', ctrl.pdf);
router.post('/aguinaldo-proporcional', ctrl.aguinaldoProporcionalEmpleado);

module.exports = router;
