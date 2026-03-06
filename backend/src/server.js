require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const errorHandler = require('./middlewares/errorHandler');
const { getPool } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* ========= helper: cargar módulos/rutas sin romper si no existen ========= */
function safeRequire(p) {
  try {
    return require(p);
  } catch (e) {
    console.warn(`⚠️  Ruta/Módulo no cargado: ${p} -> ${e.message}`);
    return null;
  }
}

/* ============================ Auditoría (si existe) ============================ */
/* Ponemos el logger ANTES de las rutas para que registre todo */
const auditMw = safeRequire('./middlewares/audit');
if (auditMw?.logAudit) app.use(auditMw.logAudit);

/* ============================== Rutas básicas (tu esquema) ============================== */
const empleadosRoutes    = safeRequire('./routes/empleados.routes');      // CRUD completo
if (empleadosRoutes) app.use('/api/empleados', empleadosRoutes);

const puestosRoutes      = safeRequire('./routes/puestos.routes');        // mantenimientos opcionales
if (puestosRoutes) app.use('/api/puestos', puestosRoutes);

const rolesRoutes        = safeRequire('./routes/roles.routes');          // mantenimientos opcionales
if (rolesRoutes) app.use('/api/roles', rolesRoutes);

const vacacionesRoutes   = safeRequire('./routes/vacaciones.routes');
if (vacacionesRoutes) app.use('/api/vacaciones', vacacionesRoutes);

const solicitudesRoutes  = safeRequire('./routes/solicitudes.routes');
if (solicitudesRoutes) app.use('/api/solicitudes', solicitudesRoutes);

const permisosRoutes     = safeRequire('./routes/permisos.routes');
if (permisosRoutes) app.use('/api/permisos', permisosRoutes);

const tiposPermisoRoutes = safeRequire('./routes/tipos-permiso.routes');
if (tiposPermisoRoutes) app.use('/api/tipos-permiso', tiposPermisoRoutes);

/* ============================ Rutas adicionales (opcionales) ============================ */
const tiposMarcaRoutes   = safeRequire('./routes/tipos-marca.routes');
if (tiposMarcaRoutes) app.use('/api/tipos-marca', tiposMarcaRoutes);

const horariosRoutes     = safeRequire('./routes/horarios.routes');
if (horariosRoutes) app.use('/api/horarios', horariosRoutes);

const asistenciaRoutes   = safeRequire('./routes/asistencia.routes');
if (asistenciaRoutes) app.use('/api/asistencia', asistenciaRoutes);

const horasExtrasRoutes  = safeRequire('./routes/horas-extras.routes');
if (horasExtrasRoutes) app.use('/api/horas-extras', horasExtrasRoutes);

const incapacidadRoutes  = safeRequire('./routes/incapacidad.routes');
if (incapacidadRoutes) app.use('/api/incapacidades', incapacidadRoutes);

const tipoIncapRoutes = safeRequire('./routes/tipo_incapacidades.routes');
if (tipoIncapRoutes) app.use('/api/tipo_incapacidades', tipoIncapRoutes);

// Planilla (cálculo)
const planillaRoutes = safeRequire('./routes/planilla.routes');
if (planillaRoutes) app.use('/api/planilla', planillaRoutes);

// Aguinaldo (CR)
const aguinaldoRoutes = safeRequire('./routes/aguinaldo.routes');
if (aguinaldoRoutes) app.use('/api/aguinaldo', aguinaldoRoutes);

// Liquidaciones (CR)
const liquidacionesRoutes = safeRequire('./routes/liquidaciones.routes');
if (liquidacionesRoutes) app.use('/api/liquidaciones', liquidacionesRoutes);

const notificacionesRoutes = safeRequire('./routes/notificaciones.routes');
if (notificacionesRoutes) app.use('/api/notificaciones', notificacionesRoutes);

/* ============================ Evaluación de desempeño (NUEVO) ============================ */
const evaluacionRoutes   = safeRequire('./routes/evaluacion.routes');     // ✔ NUEVO
if (evaluacionRoutes) app.use('/api/evaluacion', evaluacionRoutes);

/* ============================ Auth (login por Empleados) ============================ */
const authRoutes         = safeRequire('./routes/auth.routes');
if (authRoutes) app.use('/api/auth', authRoutes);

// A partir de aquí, todo /api requiere JWT
const { verifyJWT } = safeRequire('./middlewares/auth') || {};
if (verifyJWT) app.use('/api', verifyJWT);

/* ============================ Estáticos (uploads) ============================ */
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

/* ============================ Swagger (opcional) ============================ */
const swaggerModule = safeRequire('./swagger');
if (swaggerModule?.mountSwagger) {
  swaggerModule.mountSwagger(app); // expone /docs
}

/* ============================ Auditoría a archivo (visor) ============================ */
const auditRoutes = safeRequire('./routes/audit.routes');
if (auditRoutes) app.use('/api/audit', auditRoutes); // lector de logs

/* ================================== Healthchecks ================================== */
app.get('/', (_req, res) => res.send('API RRHH lista 🚀'));

app.get('/debug/db', async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT SUSER_SNAME() AS windows_user,
             @@SERVERNAME  AS server_name,
             DB_NAME()     AS db_name,
             @@VERSION     AS version
    `);
    res.json({ ok: true, data: r.recordset[0] });
  } catch (e) { next(e); }
});


app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ API escuchando en http://localhost:${PORT}`);
});

