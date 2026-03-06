const { Router } = require('express');
const ctrl = require('../controllers/roles.controller');
const router = Router();

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/toggle', ctrl.toggleEstado);
router.delete('/:id', ctrl.remove);

module.exports = router;
