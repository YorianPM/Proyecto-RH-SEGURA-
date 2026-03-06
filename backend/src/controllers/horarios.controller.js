// Controlador de horarios: CRUD basico del catalogo de jornadas.
const { sql, getPool } = require('../db');

// GET /api/horarios -> lista todo el catalogo.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT * FROM dbo.Horarios ORDER BY idHorario DESC;`);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// POST /api/horarios -> crea un horario nuevo validando el nombre.
exports.create = async (req, res, next) => {
  try {
    const { nombre } = req.body || {};
    if (!nombre) { const e = new Error('Falta el campo: nombre'); e.status=400; throw e; }
    const pool = await getPool();
    const r = await pool.request().input('nombre', sql.VarChar(60), nombre).query(`
      INSERT INTO dbo.Horarios (nombre) OUTPUT INSERTED.* VALUES (@nombre);
    `);
    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/horarios/:id -> renombra un horario existente.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { nombre } = req.body || {};
    if (nombre === undefined) { const e=new Error('Nada que actualizar'); e.status=400; throw e; }
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).input('nombre', sql.VarChar(60), nombre).query(`
      UPDATE dbo.Horarios SET nombre=@nombre
      OUTPUT INSERTED.* WHERE idHorario=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Horario no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/horarios/:id -> elimina si no hay asistencias ligadas.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const uso = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) usados FROM dbo.Control_de_Asistencia WHERE idHorario=@id;
    `);
    if (uso.recordset[0].usados>0) { const e=new Error('No se puede eliminar: está en uso por asistencias'); e.status=409; throw e; }
    const r = await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Horarios WHERE idHorario=@id;`);
    if (r.rowsAffected[0]===0) return res.status(404).json({ ok:false, message:'Horario no encontrado' });
    res.json({ ok:true, message:'Horario eliminado' });
  } catch (err) { next(err); }
};
