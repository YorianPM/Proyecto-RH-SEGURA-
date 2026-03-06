const { sql, getPool } = require('../db');
const { hashPassword } = require('../utils/hash');
// Controlador de empleados: CRUD, activación programada y contraseñas.

// Campos obligatorios al crear un empleado.
const CAMPOS = [
  'nombre','apellido1','apellido2','genero','fecha_ingreso','estado',
  'correo','contrasena','telefono','estado_civil','hijos','idPuesto',
  'idRol','conyuge_aplica','cedula'
];

// Fecha actual ISO ajustada a timezone local.
const currentDateISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// Limpia fechas de entrada manejando varios formatos comunes.
const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value.getTime());
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return str.slice(0, 10);
};

// Ajusta estado segun si la fecha de ingreso aun no ocurre.
const withEstadoVigente = (row, today) => {
  if (!row) return row;
  const fecha = normalizeDate(row.fecha_ingreso);
  const estadoProgramado = row.estado ? 1 : 0;
  const estadoVigente = fecha && fecha > today ? 0 : estadoProgramado;
  return {
    ...row,
    fecha_ingreso: fecha,
    estado: estadoVigente,
    estado_programado: estadoProgramado
  };
};

// GET - todos los empleados -> junta puesto/rol y recalcula estado vigente.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT e.*, p.nombre_puesto, p.salario_base, r.estado AS rol_activo
      FROM dbo.Empleados e
      JOIN dbo.Puestos p ON e.idPuesto = p.idPuesto
      JOIN dbo.Roles   r ON e.idRol = r.idRol
      ORDER BY e.idEmpleado DESC;
    `);
    const today = currentDateISO();
    const data = result.recordset.map(row => withEstadoVigente(row, today));
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// GET - empleado por ID -> devuelve el registro enriquecido con puesto/rol.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT e.*, p.nombre_puesto, p.salario_base, r.estado AS rol_activo
        FROM dbo.Empleados e
        JOIN dbo.Puestos p ON e.idPuesto = p.idPuesto
        JOIN dbo.Roles   r ON e.idRol = r.idRol
        WHERE e.idEmpleado=@id;
      `);
    if (!r.recordset.length)
      return res.status(404).json({ ok:false, message:'Empleado no encontrado' });
    const today = currentDateISO();
    res.json({ ok:true, data: withEstadoVigente(r.recordset[0], today) });
  } catch (err) { next(err); }
};

// POST - crear empleado (con contrase��a HASHEADA)
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    for (const c of CAMPOS) {
      if (body[c] === undefined) {
        const e = new Error(`Falta el campo: ${c}`);
        e.status = 400;
        throw e;
      }
    }

    const today = currentDateISO();
    const fechaIngreso = normalizeDate(body.fecha_ingreso);
    if (!fechaIngreso) {
      const e = new Error('La fecha de ingreso es requerida');
      e.status = 400;
      throw e;
    }
    if (fechaIngreso < today) {
      const e = new Error('La fecha de ingreso no puede ser anterior a hoy');
      e.status = 400;
      throw e;
    }
    body.fecha_ingreso = fechaIngreso;
    body.estado = fechaIngreso > today ? 0 : 1;

    const passwordHash = await hashPassword(body.contrasena);

    const pool = await getPool();

    const dupEmpleado = await pool.request()
      .input('correo', sql.VarChar(100), body.correo)
      .input('cedula', sql.VarChar(20), body.cedula)
      .query(`
        SELECT TOP 1 idEmpleado
        FROM dbo.Empleados
        WHERE correo=@correo OR cedula=@cedula;
      `);
    if (dupEmpleado.recordset.length) {
      const e = new Error('Ya existe un empleado con la misma cedula o correo');
      e.status = 409;
      throw e;
    }

    const q = pool.request()
      .input('nombre', sql.VarChar(20), body.nombre)
      .input('apellido1', sql.VarChar(15), body.apellido1)
      .input('apellido2', sql.VarChar(15), body.apellido2)
      .input('genero', sql.VarChar(15), body.genero)
      .input('fecha_ingreso', sql.Date, body.fecha_ingreso)
      .input('estado', sql.Bit, body.estado ?? 1)
      .input('correo', sql.VarChar(100), body.correo)
      .input('contrasena', sql.VarChar(128), passwordHash)
      .input('telefono', sql.VarChar(25), body.telefono)
      .input('estado_civil', sql.VarChar(45), body.estado_civil)
      .input('hijos', sql.Int, body.hijos ?? 0)
      .input('idPuesto', sql.Int, body.idPuesto)
      .input('idRol', sql.Int, body.idRol)
      .input('conyuge_aplica', sql.VarChar(45), body.conyuge_aplica)
      .input('cedula', sql.VarChar(20), body.cedula)
      .input('debe_cambiar_contrasena', sql.Bit, 1);

    const result = await q.query(`
      INSERT INTO dbo.Empleados
      (nombre, apellido1, apellido2, genero, fecha_ingreso, estado, correo, contrasena, telefono,
       estado_civil, hijos, idPuesto, idRol, conyuge_aplica, cedula, debe_cambiar_contrasena)
      OUTPUT INSERTED.*
      VALUES
      (@nombre, @apellido1, @apellido2, @genero, @fecha_ingreso, @estado, @correo, @contrasena, @telefono,
       @estado_civil, @hijos, @idPuesto, @idRol, @conyuge_aplica, @cedula, @debe_cambiar_contrasena);
    `);

    res.status(201).json({ ok:true, data: withEstadoVigente(result.recordset[0], today) });
  } catch (err) { next(err); }
};

// PUT - actualizar empleado (si viene contrasena, se HASH�%A)
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const pool = await getPool();
    const today = currentDateISO();

    const sets = [];
    const reqQ = pool.request().input('id', sql.Int, id);

    if (Object.prototype.hasOwnProperty.call(body, 'correo') || Object.prototype.hasOwnProperty.call(body, 'cedula')) {
      const dupReq = pool.request()
        .input('id', sql.Int, id)
        .input('correo', sql.VarChar(100), body.correo ?? null)
        .input('cedula', sql.VarChar(20), body.cedula ?? null);
      const dupEmpleado = await dupReq.query(`
        SELECT TOP 1 idEmpleado
        FROM dbo.Empleados
        WHERE idEmpleado<>@id
          AND (
            (@correo IS NOT NULL AND correo=@correo)
            OR (@cedula IS NOT NULL AND cedula=@cedula)
          );
      `);
      if (dupEmpleado.recordset.length) {
        const e = new Error('Ya existe un empleado con la misma cedula o correo');
        e.status = 409;
        throw e;
      }
    }

    let passwordUpdated = false;
    if (Object.prototype.hasOwnProperty.call(body, 'contrasena')) {
      body.contrasena = await hashPassword(String(body.contrasena));
      passwordUpdated = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fecha_ingreso')) {
      const fecha = normalizeDate(body.fecha_ingreso);
      if (!fecha) {
        const e = new Error('La fecha de ingreso es requerida');
        e.status = 400;
        throw e;
      }
      body.fecha_ingreso = fecha;
      if (fecha > today) {
        body.estado = 0;
      } else if (body.estado === undefined) {
        body.estado = 1;
      }
    }

    const typeMap = {
      nombre: sql.VarChar(20),
      apellido1: sql.VarChar(15),
      apellido2: sql.VarChar(15),
      genero: sql.VarChar(15),
      fecha_ingreso: sql.Date,
      estado: sql.Bit,
      correo: sql.VarChar(100),
      contrasena: sql.VarChar(128),
      telefono: sql.VarChar(25),
      estado_civil: sql.VarChar(45),
      hijos: sql.Int,
      idPuesto: sql.Int,
      idRol: sql.Int,
      conyuge_aplica: sql.VarChar(45),
      cedula: sql.VarChar(20)
    };

    for (const k of Object.keys(body)) {
      if (!(k in typeMap)) continue;
      sets.push(`${k}=@${k}`);
      reqQ.input(k, typeMap[k], body[k]);
    }

    if (passwordUpdated) {
      sets.push('debe_cambiar_contrasena=@flagCambio');
      reqQ.input('flagCambio', sql.Bit, 1);
    }

    if (!sets.length) {
      const e = new Error('No se envi�� ningǧn campo para actualizar');
      e.status = 400;
      throw e;
    }

    const result = await reqQ.query(`
      UPDATE dbo.Empleados SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idEmpleado=@id;
    `);

    if (!result.recordset.length)
      return res.status(404).json({ ok:false, message:'Empleado no encontrado' });

    res.json({ ok:true, data: withEstadoVigente(result.recordset[0], today) });
  } catch (err) { next(err); }
};

// PATCH - cambiar SOLO la contrase��a (hash)
exports.changePassword = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { nueva } = req.body || {};
    if (!nueva) { const e=new Error('Falta el campo: nueva'); e.status=400; throw e; }

    const hash = await hashPassword(String(nueva));
    const solicitante = Number(req.user?.sub);
    const selfChange = Number.isInteger(solicitante) && solicitante === id;

    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('hash', sql.VarChar(128), hash)
      .input('flagCambio', sql.Bit, selfChange ? 0 : 1)
      .query(`
        UPDATE dbo.Empleados SET contrasena=@hash, debe_cambiar_contrasena=@flagCambio
        OUTPUT INSERTED.*
        WHERE idEmpleado=@id;
      `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Empleado no encontrado' });
    res.json({ ok:true, message:'Contrase��a actualizada' });
  } catch (err) { next(err); }
};

// DELETE - eliminar empleado -> borra definitivamente el registro.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Empleados WHERE idEmpleado=@id;`);
    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ ok:false, message:'Empleado no encontrado' });
    res.json({ ok:true, message:'Empleado eliminado' });
  } catch (err) { next(err); }
};
