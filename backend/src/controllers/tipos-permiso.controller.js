// Controlador del catalogo de tipos de permiso (CRUD basico).
const { sql, getPool } = require('../db');

// GET /api/tipos-permiso -> retorna todos los registros.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT * FROM dbo.Tipo_Permiso ORDER BY idTipo_Permiso DESC;`);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// GET /api/tipos-permiso/:id -> devuelve un tipo especifico.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.Tipo_Permiso WHERE idTipo_Permiso=@id;`);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Tipo de permiso no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// POST /api/tipos-permiso -> inserta un nuevo registro validando el nombre.
exports.create = async (req, res, next) => {
  try {
    const { tipo } = req.body || {};
    if (!tipo) { const e = new Error('Falta el campo: tipo'); e.status=400; throw e; }
    const pool = await getPool();
    const r = await pool.request().input('tipo', sql.VarChar(45), tipo).query(`
      INSERT INTO dbo.Tipo_Permiso (tipo)
      OUTPUT INSERTED.*
      VALUES (@tipo);
    `);
    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/tipos-permiso/:id -> actualiza el texto del tipo cuando se envia.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { tipo } = req.body || {};
    if (tipo === undefined) { const e = new Error('Nada que actualizar'); e.status=400; throw e; }
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).input('tipo', sql.VarChar(45), tipo).query(`
      UPDATE dbo.Tipo_Permiso SET tipo=@tipo
      OUTPUT INSERTED.*
      WHERE idTipo_Permiso=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Tipo de permiso no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/tipos-permiso/:id -> elimina si no se usa en Permisos.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    // Bloquear si está en uso
    const uso = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) usados FROM dbo.Permisos WHERE idTipo_Permiso=@id;
    `);
    if (uso.recordset[0].usados>0) { const e = new Error('No se puede eliminar: está en uso'); e.status=409; throw e; }

    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.Tipo_Permiso WHERE idTipo_Permiso=@id;
    `);
    if (r.rowsAffected[0]===0) return res.status(404).json({ ok:false, message:'Tipo de permiso no encontrado' });
    res.json({ ok:true, message:'Tipo de permiso eliminado' });
  } catch (err) { next(err); }
};
