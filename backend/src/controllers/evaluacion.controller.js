const { sql, getPool } = require('../db');
// Controlador de evaluaciones de desempeño: CRUD y consultas personales.

// Campos requeridos para crear una evaluacion.
const CAMPOS = ['idEmpleado','fecha','puntuacion','observaciones'];

// GET - todas -> permite filtrar por empleado o rango de fechas.
exports.getAll = async (req, res, next) => {
  try {
    const { idEmpleado, desde, hasta } = req.query;
    let where = '1=1';
    const ps = (await getPool()).request();

    if (idEmpleado) { where += ' AND ev.idEmpleado=@idEmpleado'; ps.input('idEmpleado', sql.Int, +idEmpleado); }
    if (desde)      { where += ' AND ev.fecha>=@desde';           ps.input('desde', sql.Date, desde); }
    if (hasta)      { where += ' AND ev.fecha<=@hasta';           ps.input('hasta', sql.Date, hasta); }

    const { recordset } = await ps.query(`
      SELECT ev.idEvaluacion, ev.idEmpleado, ev.fecha, ev.puntuacion, ev.observaciones,
             (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado, e.cedula
      FROM dbo.Evaluacion_Desempeno ev
      JOIN dbo.Empleados e ON e.idEmpleado=ev.idEmpleado
      WHERE ${where}
      ORDER BY ev.fecha DESC, ev.idEvaluacion DESC;
    `);
    res.json({ ok:true, data: recordset });
  } catch (err) { next(err); }
};

// GET - mis evaluaciones -> usa el id del token para limitar.
exports.getMine = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const myId = Number(req.user?.sub || req.user?.idEmpleado);
    if (!myId) { const e=new Error('No se pudo determinar el empleado de la sesión'); e.status=401; throw e; }
    let where = 'ev.idEmpleado=@idEmpleado';
    const ps = (await getPool()).request().input('idEmpleado', sql.Int, myId);
    if (desde) { where += ' AND ev.fecha>=@desde'; ps.input('desde', sql.Date, desde); }
    if (hasta) { where += ' AND ev.fecha<=@hasta'; ps.input('hasta', sql.Date, hasta); }
    const { recordset } = await ps.query(`
      SELECT ev.idEvaluacion, ev.idEmpleado, ev.fecha, ev.puntuacion, ev.observaciones,
             (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado, e.cedula
      FROM dbo.Evaluacion_Desempeno ev
      JOIN dbo.Empleados e ON e.idEmpleado=ev.idEmpleado
      WHERE ${where}
      ORDER BY ev.fecha DESC, ev.idEvaluacion DESC;
    `);
    res.json({ ok:true, data: recordset });
  } catch (err) { next(err); }
};

// GET - por ID -> trae detalle individual.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { recordset } = await (await getPool()).request()
      .input('id', sql.Int, id)
      .query(`
        SELECT ev.idEvaluacion, ev.idEmpleado, ev.fecha, ev.puntuacion, ev.observaciones,
               (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado, e.cedula
        FROM dbo.Evaluacion_Desempeno ev
        JOIN dbo.Empleados e ON e.idEmpleado=ev.idEmpleado
        WHERE ev.idEvaluacion=@id;
      `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Evaluación no encontrada' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// POST - crear -> inserta nueva evaluacion validando campos obligatorios.
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    for (const c of CAMPOS) {
      if (body[c] === undefined && c !== 'observaciones') {
        const e = new Error(`Falta el campo: ${c}`); e.status = 400; throw e;
      }
    }

    const ps = (await getPool()).request()
      .input('idEmpleado',   sql.Int,          body.idEmpleado)
      .input('fecha',        sql.Date,         body.fecha)
      .input('puntuacion',   sql.Decimal(4,2), body.puntuacion)
      .input('observaciones',sql.VarChar(500), body.observaciones ?? null);

    const { recordset } = await ps.query(`
      INSERT INTO dbo.Evaluacion_Desempeno (idEmpleado, fecha, puntuacion, observaciones)
      OUTPUT INSERTED.*
      VALUES (@idEmpleado, @fecha, @puntuacion, @observaciones);
    `);
    res.status(201).json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// PUT - actualizar -> modifica campos permitidos dinamicamente.
exports.update = async (req, res, next) => {
  try {
    const id   = parseInt(req.params.id,10);
    const body = req.body || {};
    const ps   = (await getPool()).request().input('id', sql.Int, id);

    const typeMap = {
      idEmpleado:   sql.Int,
      fecha:        sql.Date,
      puntuacion:   sql.Decimal(4,2),
      observaciones:sql.VarChar(500),
    };

    const sets = [];
    for (const k of Object.keys(body)) {
      if (!(k in typeMap)) continue;
      sets.push(`${k}=@${k}`);
      ps.input(k, typeMap[k], body[k]);
    }
    if (!sets.length) { const e=new Error('No se envió ningún campo para actualizar'); e.status=400; throw e; }

    const { recordset } = await ps.query(`
      UPDATE dbo.Evaluacion_Desempeno SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idEvaluacion=@id;
    `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Evaluación no encontrada' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// DELETE - eliminar -> remueve definitivamente la evaluacion.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const r = await (await getPool()).request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Evaluacion_Desempeno WHERE idEvaluacion=@id;`);
    if (r.rowsAffected[0] === 0) return res.status(404).json({ ok:false, message:'Evaluación no encontrada' });
    res.json({ ok:true, message:'Evaluación eliminada' });
  } catch (err) { next(err); }
};
