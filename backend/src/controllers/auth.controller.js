const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../db');
const { comparePassword } = require('../utils/hash');
// Controlador de autenticacion: valida credenciales y emite JWT.

// Obtiene la fecha actual en ISO ajustando timezone local.
const currentDateISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// Normaliza strings/Date a YYYY-MM-DD.
const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value.getTime());
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0, 10);
};

// Firma un token JWT con los datos relevantes del usuario.
function signToken(user) {
  const payload = {
    sub: user.idEmpleado,        // id del empleado
    usuario: user.usuario,       // correo o cedula enviado
    idRol: user.idRol,
    perms: user.perms,
    mustChangePassword: !!user.mustChangePassword,
    fecha_ingreso: user.fecha_ingreso || null
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '1d' });
}

// POST /api/auth/login -> verifica credenciales y devuelve token+perfil.
exports.login = async (req, res, next) => {
  try {
    const { usuario, contrasena } = req.body || {};
    if (!usuario || !contrasena) {
      const e = new Error('usuario y contrasena son requeridos'); e.status = 400; throw e;
    }

    const pool = await getPool();
    // usuario puede ser correo o cǸdula
    const r = await pool.request()
      .input('usuario', sql.VarChar(100), usuario)
      .query(`
        SELECT 
          e.idEmpleado, e.correo, e.cedula, e.contrasena, e.idRol,
          e.estado AS estado_empleado,
          e.fecha_ingreso,
          e.debe_cambiar_contrasena,
          r.estado AS estado_rol,
          r.vacaciones_ver_EMPLEADO, r.vacaciones_solicitar_EMPLEADO, r.permisos_ver_EMPLEADO, r.asistencia_marcar_EMPLEADO,
          r.vacaciones_aprobar_RH, r.permisos_aprobar_RH, r.asistencia_ver_RH, r.planilla_ver_RH, r.planilla_generar_RH,
          r.horas_extras_ver_RH, r.horas_extras_registrar_RH, r.liquidaciones_ver_RH, r.liquidaciones_calcular_RH,
          r.aguinaldos_ver_RH, r.aguinaldos_calcular_RH, r.seguridad_gestion_usuarios_RH, r.seguridad_gestion_roles_RH,
          r.mantenimientos_RH, r.reportes_ver_RH
        FROM dbo.Empleados e
        JOIN dbo.Roles r ON r.idRol = e.idRol
        WHERE e.correo = @usuario OR e.cedula = @usuario;
      `);

    if (!r.recordset.length) return res.status(401).json({ ok:false, message:'Credenciales invǭlidas' });

    const row = r.recordset[0];

    // Soportar hash (bcrypt) y, si estǭs en dev con texto plano, tambiǸn igualar directo
    const okHash = await comparePassword(contrasena, row.contrasena).catch(() => false);
    const okPlain = contrasena === row.contrasena;
    if (!okHash && !okPlain) return res.status(401).json({ ok:false, message:'Credenciales invǭlidas' });

    if (!row.estado_rol) return res.status(403).json({ ok:false, message:'Rol deshabilitado' });
    if (!row.estado_empleado) return res.status(403).json({ ok:false, message:'Empleado inactivo' });

    const ingreso = normalizeDate(row.fecha_ingreso);
    const today = currentDateISO();
    if (ingreso && ingreso > today) {
      return res.status(403).json({ ok:false, message:'El empleado aun no inicia labores' });
    }

    const perms = {
      vacaciones_ver_EMPLEADO: row.vacaciones_ver_EMPLEADO,
      vacaciones_solicitar_EMPLEADO: row.vacaciones_solicitar_EMPLEADO,
      permisos_ver_EMPLEADO: row.permisos_ver_EMPLEADO,
      asistencia_marcar_EMPLEADO: row.asistencia_marcar_EMPLEADO,
      vacaciones_aprobar_RH: row.vacaciones_aprobar_RH,
      permisos_aprobar_RH: row.permisos_aprobar_RH,
      asistencia_ver_RH: row.asistencia_ver_RH,
      planilla_ver_RH: row.planilla_ver_RH,
      planilla_generar_RH: row.planilla_generar_RH,
      horas_extras_ver_RH: row.horas_extras_ver_RH,
      horas_extras_registrar_RH: row.horas_extras_registrar_RH,
      liquidaciones_ver_RH: row.liquidaciones_ver_RH,
      liquidaciones_calcular_RH: row.liquidaciones_calcular_RH,
      aguinaldos_ver_RH: row.aguinaldos_ver_RH,
      aguinaldos_calcular_RH: row.aguinaldos_calcular_RH,
      seguridad_gestion_usuarios_RH: row.seguridad_gestion_usuarios_RH,
      seguridad_gestion_roles_RH: row.seguridad_gestion_roles_RH,
      mantenimientos_RH: row.mantenimientos_RH,
      reportes_ver_RH: row.reportes_ver_RH
    };

    const mustChangePassword = !!row.debe_cambiar_contrasena;

    const token = signToken({
      idEmpleado: row.idEmpleado,
      usuario,
      idRol: row.idRol,
      perms,
      mustChangePassword,
      fecha_ingreso: ingreso
    });

    res.json({
      ok: true,
      token,
      user: {
        idEmpleado: row.idEmpleado,
        usuario,        // lo que us�� para loguear (correo/cedula)
        correo: row.correo,
        cedula: row.cedula,
        idRol: row.idRol,
        perms,
        mustChangePassword,
        fecha_ingreso: ingreso
      }
    });
  } catch (err) { next(err); }
};

