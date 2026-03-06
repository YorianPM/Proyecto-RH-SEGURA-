const { Router } = require('express');
const ctrl = require('../controllers/incapacidad.controller');
const { uploadIncapacidad } = require('../middlewares/uploads');

const router = Router();

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', uploadIncapacidad.single('archivo'), ctrl.create);
router.put('/:id', uploadIncapacidad.single('archivo'), ctrl.update);
router.patch('/:id/estado', ctrl.updateEstado);
router.delete('/:id', ctrl.remove);

module.exports = router;
