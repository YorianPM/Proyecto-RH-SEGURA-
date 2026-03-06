// Controlador de puestos: gestiona CRUD de posiciones y salarios base.
const { sql, getPool } = require('../db');

// GET /api/puestos -> devuelve el catalogo completo de puestos con salarios.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT idPuesto, nombre_puesto, salario_base, tarifa_hora
      FROM dbo.Puestos
      ORDER BY idPuesto DESC;
    `);
    res.json({ ok: true, data: r.recordset });
  } catch (err) { next(err); }
};

// GET /api/puestos/:id -> muestra un puesto especifico.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT idPuesto, nombre_puesto, salario_base, tarifa_hora
        FROM dbo.Puestos
        WHERE idPuesto=@id;
      `);
    if (!r.recordset.length)
      return res.status(404).json({ ok:false, message:'Puesto no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// POST /api/puestos -> crea un nuevo puesto validando campos clave.
exports.create = async (req, res, next) => {
  try {
    const { nombre_puesto, salario_base } = req.body || {};
    if (!nombre_puesto || salario_base === undefined) {
      const e = new Error('Faltan campos requeridos: nombre_puesto, salario_base');
      e.status = 400; throw e;
    }
    const pool = await getPool();
    const r = await pool.request()
      .input('nombre_puesto', sql.VarChar(60), nombre_puesto)
      .input('salario_base', sql.Decimal(10,2), salario_base)
      .query(`
        INSERT INTO dbo.Puestos (nombre_puesto, salario_base)
        OUTPUT INSERTED.*
        VALUES (@nombre_puesto, @salario_base);
      `);
    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/puestos/:id -> actualiza parcialmente nombre o salario.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const sets = [];
    const pool = await getPool();
    const reqQ = pool.request().input('id', sql.Int, id);

    if (body.nombre_puesto !== undefined) {
      sets.push('nombre_puesto=@nombre_puesto');
      reqQ.input('nombre_puesto', sql.VarChar(60), body.nombre_puesto);
    }
    if (body.salario_base !== undefined) {
      sets.push('salario_base=@salario_base');
      reqQ.input('salario_base', sql.Decimal(10,2), body.salario_base);
    }
    if (!sets.length) {
      const e = new Error('No se envió ningún campo para actualizar');
      e.status = 400; throw e;
    }

    const r = await reqQ.query(`
      UPDATE dbo.Puestos
      SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idPuesto=@id;
    `);

    if (!r.recordset.length)
      return res.status(404).json({ ok:false, message:'Puesto no encontrado' });

    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/puestos/:id -> borra el registro si existe.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Puestos WHERE idPuesto=@id;`);
    if (r.rowsAffected[0] === 0)
      return res.status(404).json({ ok:false, message:'Puesto no encontrado' });
    res.json({ ok:true, message:'Puesto eliminado' });
  } catch (err) { next(err); }
};
