// Controlador de bitacora: permite filtrar eventos por rango de fechas y usuario.
const { sql, getPool } = require('../db');

// GET /api/bitacora?... -> aplica filtros opcionales y paginacion sobre la tabla.
exports.getAll = async (req, res, next) => {
  try {
    const { desde, hasta, usuario } = req.query;
    const page = parseInt(req.query.page || '1',10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '20',10), 100);
    const offset = (page-1)*pageSize;

    let where = 'WHERE 1=1';
    const pool = await getPool();
    const q = pool.request().input('offset', sql.Int, offset).input('limit', sql.Int, pageSize);

    if (desde) { where += ' AND b.fecha >= @desde'; q.input('desde', sql.Date, desde); }
    if (hasta) { where += ' AND b.fecha <= @hasta'; q.input('hasta', sql.Date, hasta); }
    if (usuario) { where += ' AND b.id_usuario = @usuario'; q.input('usuario', sql.Int, parseInt(usuario,10)); }

    const data = await q.query(`
      SELECT b.id_bitacora, b.id_usuario, b.accion, b.fecha
      FROM dbo.Bitacora b
      ${where}
      ORDER BY b.fecha DESC, b.id_bitacora DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `);

    const tot = await pool.request().query(`SELECT COUNT(*) total FROM dbo.Bitacora b ${where.replace(/@[\w]+/g,'NULL')};`);
    res.json({ ok:true, page, pageSize, total: tot.recordset[0].total, data: data.recordset });
  } catch (err) { next(err); }
};
