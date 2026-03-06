// Controlador de roles: gestiona CRUD de permisos del sistema.
const { sql, getPool } = require('../db');

// Catálogo de campos/flags que se pueden actualizar para cada rol.
// Campos permitidos según tu tabla dbo.Roles
const FIELDS = [
  'estado',
  'vacaciones_ver_EMPLEADO',
  'vacaciones_solicitar_EMPLEADO',
  'permisos_ver_EMPLEADO',
  'asistencia_marcar_EMPLEADO',
  'vacaciones_aprobar_RH',
  'permisos_aprobar_RH',
  'asistencia_ver_RH',
  'planilla_ver_RH',
  'planilla_generar_RH',
  'horas_extras_ver_RH',
  'horas_extras_registrar_RH',
  'liquidaciones_ver_RH',
  'liquidaciones_calcular_RH',
  'aguinaldos_ver_RH',
  'aguinaldos_calcular_RH',
  'seguridad_gestion_usuarios_RH',
  'seguridad_gestion_roles_RH',
  'mantenimientos_RH',
  'reportes_ver_RH'
];

// GET /api/roles -> lista todos los roles.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT * FROM dbo.Roles ORDER BY idRol DESC;
    `);
    res.json({ ok: true, data: r.recordset });
  } catch (err) { next(err); }
};

// GET /api/roles/:id -> obtiene detalle por identificador.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.Roles WHERE idRol=@id;`);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Rol no encontrado' });
    res.json({ ok:true, data: r.recordset[0] });
  } catch (err) { next(err); }
};

// POST /api/roles -> crea un rol y establece los bits enviados (resto por defecto).
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const pool = await getPool();
    const reqQ = pool.request();

    // preparar inputs con defaults
    for (const f of FIELDS) {
      const val = (f === 'estado')
        ? (body[f] !== undefined ? body[f] : 1)
        : (body[f] !== undefined ? body[f] : 0);
      reqQ.input(f, sql.Bit, val ? 1 : 0);
    }

    const cols = FIELDS.join(', ');
    const vals = FIELDS.map(f => '@' + f).join(', ');

    const r = await reqQ.query(`
      INSERT INTO dbo.Roles (${cols})
      OUTPUT INSERTED.*
      VALUES (${vals});
    `);

    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/roles/:id -> actualiza dinamicamente solo las propiedades enviadas.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const setParts = [];
    const pool = await getPool();
    const reqQ = pool.request().input('id', sql.Int, id);

    for (const f of FIELDS) {
      if (body[f] !== undefined) {
        setParts.push(`${f}=@${f}`);
        reqQ.input(f, sql.Bit, body[f] ? 1 : 0);
      }
    }

    if (!setParts.length) {
      const e = new Error('No se envió ningún campo para actualizar');
      e.status = 400; throw e;
    }

    const r = await reqQ.query(`
      UPDATE dbo.Roles SET ${setParts.join(', ')}
      OUTPUT INSERTED.*
      WHERE idRol=@id;
    `);

    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Rol no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/roles/:id/toggle -> alterna el estado activo/inactivo.
exports.toggleEstado = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.Roles
      SET estado = CASE WHEN estado=1 THEN 0 ELSE 1 END
      OUTPUT INSERTED.*
      WHERE idRol=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Rol no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/roles/:id -> borra el rol si no tiene empleados asociados.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();

    // ¿está en uso?
    const uso = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) AS usados FROM dbo.Empleados WHERE idRol=@id;
    `);
    if (uso.recordset[0].usados > 0) {
      const e = new Error('No se puede eliminar: el rol está asignado a uno o más empleados');
      e.status = 409; throw e;
    }

    const del = await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Roles WHERE idRol=@id;`);
    if (del.rowsAffected[0] === 0)
      return res.status(404).json({ ok:false, message:'Rol no encontrado' });

    res.json({ ok:true, message:'Rol eliminado' });
  } catch (err) { next(err); }
};
