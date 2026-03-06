// Controlador de tipos de marca: administra catalogo de eventos de asistencia.
const { sql, getPool } = require('../db');

// GET /api/tipos-marca -> lista todos los tipos registrados.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT idTipo_de_Marca, tipo FROM dbo.Tipo_de_Marca ORDER BY idTipo_de_Marca DESC;
    `);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// POST /api/tipos-marca -> crea un nuevo tipo validando el nombre.
exports.create = async (req, res, next) => {
  try {
    const { tipo } = req.body || {};
    if (!tipo) { const e=new Error('Falta el campo: tipo'); e.status=400; throw e; }
    const pool = await getPool();
    const r = await pool.request().input('tipo', sql.VarChar(45), tipo).query(`
      INSERT INTO dbo.Tipo_de_Marca (tipo) OUTPUT INSERTED.* VALUES (@tipo);
    `);
    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/tipos-marca/:id -> elimina si no esta referenciado en asistencias.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const uso = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) usados FROM dbo.Control_de_Asistencia WHERE idTipo_de_Marca=@id;
    `);
    if (uso.recordset[0].usados>0) { const e=new Error('No se puede eliminar: está en uso por asistencias'); e.status=409; throw e; }
    const r = await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM dbo.Tipo_de_Marca WHERE idTipo_de_Marca=@id;`);
    if (r.rowsAffected[0]===0) return res.status(404).json({ ok:false, message:'Tipo de marca no encontrado' });
    res.json({ ok:true, message:'Tipo de marca eliminado' });
  } catch (err) { next(err); }
};
