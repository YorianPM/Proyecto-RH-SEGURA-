// Controlador basico de tipos de incapacidad (CRUD minimal).
const { sql, getPool } = require('../db');

// GET /tipo-incapacidad -> devuelve todos los conceptos ordenados alfabeticamente.
exports.getAll = async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT idTipo_Incapacidad, concepto
      FROM dbo.Tipo_Incapacidad
      ORDER BY concepto;
    `);
    res.json({ ok: true, data: r.recordset });
  } catch (err) { next(err); }
};
