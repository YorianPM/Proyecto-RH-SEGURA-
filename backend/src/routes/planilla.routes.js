const { Router } = require('express');
const ctrl = require('../controllers/planilla.controller');
const ctrlCR = require('../controllers/planilla.cr.controller');
const { verifyJWT, requirePerms } = require('../middlewares/auth');

const router = Router();

// Asegurar JWT en este módulo
router.use(verifyJWT);

// Vista previa de cálculo de planilla (existente)
router.get('/preview', requirePerms(['planilla_ver_RH']), ctrl.preview);
// Vista previa dinámica ingresos/deducciones (existente)
router.get('/preview-v2', requirePerms(['planilla_ver_RH']), ctrl.previewV2);

// Listado de planillas guardadas
router.get('/', requirePerms(['planilla_ver_RH']), ctrl.list);

// Ruta legacy de generar original (por compatibilidad)
router.post('/generar-legacy', requirePerms(['planilla_generar_RH']), ctrl.generar);

// Editar planilla (monto_bono, deduccion_prestamo)
router.put('/:id', requirePerms(['planilla_editar_RH']), ctrl.update);

// Cerrar planilla (marca de cierre si existe columna)
router.patch('/:id/cerrar', requirePerms(['planilla_cerrar_RH']), ctrl.cerrar);

// Nuevos endpoints Planilla (CR) basados en archivos (config/snapshot/lock)
router.post('/preview', requirePerms(['planilla_ver_RH']), ctrlCR.previewCR);
router.post('/generar', requirePerms(['planilla_generar_RH']), ctrlCR.generarCR);
router.get('/config/:anio', requirePerms(['planilla_ver_RH']), ctrlCR.getConfig);
router.put('/config/:anio', requirePerms(['planilla_generar_RH']), ctrlCR.putConfig);
router.get('/detalle', requirePerms(['planilla_ver_RH']), ctrlCR.detalle);
router.put('/override', requirePerms(['planilla_editar_RH']), ctrlCR.override);
router.post('/cerrar', requirePerms(['planilla_cerrar_RH']), ctrlCR.cerrarRango);
router.get('/pdf', requirePerms(['planilla_ver_RH']), ctrlCR.pdf);

// Descargar la coletilla (payslip) del propio empleado autenticado
// Parámetros por query: periodo, desde, hasta
router.get('/payslip', ctrlCR.payslipSelfV2 || ctrlCR.payslipSelf);

module.exports = router;
