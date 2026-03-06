const { sql, getPool } = require('../db');
const { esFeriadoCR } = require('../utils/feriadosCR');
// Controlador de horas extra: solicitudes, aprobaciones y calculos por tipo.

// GET /api/horas-extras?... -> listado filtrable por empleado, fecha y estado.
exports.getAll = async (req, res, next) => {
  try {
    const { empleado, desde, hasta, decision } = req.query;
    const pool = await getPool();
    const heDateExpr = "COALESCE(TRY_CONVERT(date, he.fecha, 103), TRY_CONVERT(date, he.fecha, 23), TRY_CONVERT(date, he.fecha))";
    let q = `
      SELECT he.*, e.idEmpleado, e.nombre, e.apellido1, e.apellido2, c.fecha AS fecha_asistencia,
             ${heDateExpr} AS he_fecha_conv
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
      WHERE 1=1
    `;
    const rqt = pool.request();
    if (empleado) { q+=' AND e.idEmpleado=@emp'; rqt.input('emp', sql.Int, parseInt(empleado,10)); }
    if (desde)    { q+=` AND (${heDateExpr} >= @desde)`; rqt.input('desde', sql.Date, desde); }
    if (hasta)    { q+=` AND (${heDateExpr} <= @hasta)`; rqt.input('hasta', sql.Date, hasta); }
    if (decision) { q+=' AND he.decision=@dec'; rqt.input('dec', sql.VarChar(45), decision); }
    q += ` ORDER BY ${heDateExpr} DESC, he.idHoras_Extras DESC;`;
    const r = await rqt.query(q);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// GET /api/horas-extras/mias -> devuelve solo las solicitudes del usuario autenticado.
// Devuelve horas extra solo del empleado autenticado
exports.getMine = async (req, res, next) => {
  try {
    const myId = Number(req.user?.sub || req.user?.idEmpleado);
    if (!myId) { const e = new Error('No se pudo determinar el empleado de la sesiÃ³n'); e.status = 401; throw e; }

    const { desde, hasta, decision } = req.query;
    const pool = await getPool();
    const heDateExpr = "COALESCE(TRY_CONVERT(date, he.fecha, 103), TRY_CONVERT(date, he.fecha, 23), TRY_CONVERT(date, he.fecha))";
    let q = `
      SELECT he.*, e.idEmpleado, e.nombre, e.apellido1, e.apellido2, c.fecha AS fecha_asistencia,
             ${heDateExpr} AS he_fecha_conv
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
      WHERE e.idEmpleado=@emp
    `;
    const rqt = pool.request().input('emp', sql.Int, myId);
    if (desde) { q += ` AND (${heDateExpr} >= @desde)`; rqt.input('desde', sql.Date, desde); }
    if (hasta) { q += ` AND (${heDateExpr} <= @hasta)`; rqt.input('hasta', sql.Date, hasta); }
    if (decision) { q += ' AND he.decision=@dec'; rqt.input('dec', sql.VarChar(45), decision); }
    q += ' ORDER BY he.fecha DESC, he.idHoras_Extras DESC;';
    const r = await rqt.query(q);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// GET /api/horas-extras/:id -> obtiene detalle y datos del empleado.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT he.*, e.idEmpleado, e.nombre, e.apellido1, e.apellido2, c.fecha AS fecha_asistencia
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
      WHERE he.idHoras_Extras=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Registro de horas extra no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// GET /api/horas-extras/resumen -> totales por decision y pendientes para RH.
// Devuelve totales por decision y listado de pendientes para RH
exports.getResumen = async (req, res, next) => {
  try {
    const pool = await getPool();
    const resumenQ = await pool.request().query(`
      SELECT
        COALESCE(decision, 'Pendiente') AS decision,
        COUNT(1) AS cantidad,
        SUM(COALESCE(horas_extras, 0)) AS total_horas
      FROM dbo.Horas_Extras
      GROUP BY COALESCE(decision, 'Pendiente');
    `);

    const pendientesQ = await pool.request().query(`
      SELECT
        he.*,
        e.idEmpleado,
        e.nombre,
        e.apellido1,
        e.apellido2,
        e.cedula,
        c.fecha         AS fecha_asistencia,
        c.hora          AS hora_marca,
        tm.tipo         AS tipo_marca
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      JOIN dbo.Empleados e            ON e.idEmpleado = c.idEmpleado
      JOIN dbo.Tipo_de_Marca tm       ON tm.idTipo_de_Marca = c.idTipo_de_Marca
      WHERE COALESCE(he.decision, 'Pendiente') = 'Pendiente'
      ORDER BY c.fecha DESC, c.hora DESC, he.idHoras_Extras DESC;
    `);

    res.json({
      ok: true,
      data: {
        resumen: resumenQ.recordset,
        pendientes: pendientesQ.recordset,
      },
    });
  } catch (err) { next(err); }
};

// Utilidad: obtener columnas disponibles de una tabla
async function getColumns(pool, table){
  const r = await pool.request().input('t', sql.VarChar(128), String(table)).query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=@t;
  `);
  const set = new Set((r.recordset||[]).map(x => String(x.COLUMN_NAME||'').toLowerCase()));
  return set;
}

function mapTipoFactor(tipo, factor){
  const t = String(tipo||'').toLowerCase();
  if (t==='feriado') return { tipo:'feriado', factor: 2 };
  if (t==='nocturna' || t==='nocturno') return { tipo:'nocturna', factor: 1.5 };
  if (t==='personalizada') return { tipo:'personalizada', factor: Number(factor)||0 };
  // default ordinaria
  return { tipo:'ordinaria', factor: 1.5 };
}

function toISODateSafe(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return raw;
}

// POST /api/horas-extras/calcular -> calcula monto estimado y crea registro ligado a una marca.
// body: { idControlAsistencia, horas_extras, fecha?=hoy, tasa?=1.5, horas_mes?=192, tipo?, factor? }
exports.calcularCrear = async (req, res, next) => {
  try {
    const { idControlAsistencia, horas_extras, fecha, tasa=1.5, horas_mes=192, tipo, factor } = req.body || {};
    if (!idControlAsistencia || horas_extras===undefined) {
      const e = new Error('Faltan campos: idControlAsistencia, horas_extras'); e.status=400; throw e;
    }
    const pool = await getPool();

    // Traer salario_base del empleado involucrado
    const q = await pool.request().input('idc', sql.Int, idControlAsistencia).query(`
      SELECT p.salario_base
      FROM dbo.Control_de_Asistencia c
      JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
      JOIN dbo.Puestos p   ON p.idPuesto   = e.idPuesto
      WHERE c.idControlAsistencia=@idc;
    `);
    if (!q.recordset.length) { const e=new Error('Control de asistencia no existe'); e.status=404; throw e; }

    const salario_base = Number(q.recordset[0].salario_base);
    const salario_hora = salario_base / Number(horas_mes);
    const sel = mapTipoFactor(tipoDetectado, factor);
    const fx = Number(sel.factor || tasa);
    const monto = Math.round(Number(horas_extras) * salario_hora * Number(fx) * 100) / 100;

    const fechaIns = toISODateSafe(fecha) || new Date().toISOString().slice(0,10);
    const feriadoInfo = esFeriadoCR(fechaIns);
    const tipoDetectado = feriadoInfo.esFeriado ? 'feriado' : tipo;

    const cols = await getColumns(pool, 'Horas_Extras');
    const hasTipo = cols.has('tipo');
    const hasFactor = cols.has('factor');

    const reqQ = pool.request()
      .input('horas_extras', sql.Decimal(10,2), horas_extras)
      .input('estado', sql.Bit, 1)
      .input('decision', sql.VarChar(45), 'Pendiente')
      .input('idControlAsistencia', sql.Int, idControlAsistencia)
      .input('fecha', sql.Date, fechaIns);
    let insertCols = 'horas_extras, estado, decision, idControlAsistencia, fecha';
    let insertVals = '@horas_extras, @estado, @decision, @idControlAsistencia, @fecha';
    if (hasTipo) { insertCols += ', tipo'; insertVals += ', @tipo'; reqQ.input('tipo', sql.VarChar(20), sel.tipo); }
    if (hasFactor) { insertCols += ', factor'; insertVals += ', @factor'; reqQ.input('factor', sql.Decimal(10,2), Number(sel.factor||0)); }

    const ins = await reqQ.query(`
      INSERT INTO dbo.Horas_Extras (${insertCols})
      OUTPUT INSERTED.*
      VALUES (${insertVals});
    `);

    // Agrega campo calculado "monto" en respuesta (tu tabla no lo guarda)
    const data = ins.recordset[0];
    data.monto_calculado = monto;
    data.tasa_usada = Number(fx);
    data.salario_hora = Math.round(salario_hora*100)/100;
    data.esFeriado = feriadoInfo.esFeriado;
    data.feriadoNombre = feriadoInfo.nombre || null;

    res.status(201).json({ ok:true, data });
  } catch (err) { next(err); }
};

// PATCH /api/horas-extras/:id -> edita tipo/factor/horas mientras este Pendiente./aprobar -> marca como aprobado y permite adjuntar monto final.
exports.aprobar = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { monto } = req.body || {};
    const pool = await getPool();
    // Solo cambia decision/estado; monto final lo puedes enviar calculado desde frontend
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('decision', sql.VarChar(45), 'Aprobado')
      .query(`
        UPDATE dbo.Horas_Extras
        SET decision=@decision
        OUTPUT INSERTED.*
        WHERE idHoras_Extras=@id;
      `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    const data = r.recordset[0];
    if (monto !== undefined) data.monto_aprobado = Number(monto);
    res.json({ ok:true, data });
  } catch (err) { next(err); }
};

// PATCH /api/horas-extras/:id -> edita tipo/factor/horas mientras este Pendiente./denegar -> rechaza la solicitud.
exports.denegar = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).input('decision', sql.VarChar(45), 'Denegado').query(`
      UPDATE dbo.Horas_Extras SET decision=@decision
      OUTPUT INSERTED.* WHERE idHoras_Extras=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/horas-extras/:id -> elimina registros que siguen pendientes.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.Horas_Extras WHERE idHoras_Extras=@id AND decision='Pendiente';
    `);
    if (r.rowsAffected[0]===0) { const e=new Error('No se puede eliminar (no existe o no estÃ¡ Pendiente)'); e.status=409; throw e; }
    res.json({ ok:true, message:'Horas extra eliminadas' });
  } catch (err) { next(err); }
};

// POST /api/horas-extras/solicitar -> empleado genera su propia solicitud calculada.
// Empleado solicita horas extra de un dÃ­a. Si no envÃ­a horas_extras, se calcula con regla: (Salida - Entrada - 60min) - 8h
exports.solicitar = async (req, res, next) => {
  try {
    const myId = Number(req.user?.sub || req.user?.idEmpleado);
    if (!myId) { const e=new Error('No autenticado'); e.status=401; throw e; }
    const { fecha, horas_extras, tipo, factor } = req.body || {};
    if (!fecha) { const e=new Error('Falta fecha'); e.status=400; throw e; }
    const fechaN = toISODateSafe(fecha);
    const feriadoInfo = esFeriadoCR(fechaN);
    const tipoDetectado = feriadoInfo.esFeriado ? 'feriado' : tipo;


    const pool = await getPool();

    // Todas las marcas del dÃ­a ordenadas
    const marcasQ = await pool.request()
      .input('emp', sql.Int, myId)
      .input('fec', sql.Date, fechaN)
      .query(`
        SELECT idControlAsistencia, hora, idTipo_de_Marca
        FROM dbo.Control_de_Asistencia
        WHERE idEmpleado=@emp AND fecha=@fec
        ORDER BY hora ASC, idControlAsistencia ASC;
      `);
    const marcas = marcasQ.recordset || [];
    if (marcas.length < 2) { const e=new Error('No se puede calcular horas extra sin Entrada y Salida'); e.status=409; throw e; }

    // Tipos de marca, si existen
    async function getTipoId(nombre){
      try {
        const r = await pool.request().input('t', sql.VarChar(45), nombre)
          .query('SELECT TOP 1 idTipo_de_Marca FROM dbo.Tipo_de_Marca WHERE LOWER(LTRIM(RTRIM(tipo)))=LOWER(LTRIM(RTRIM(@t)));');
        return r.recordset[0]?.idTipo_de_Marca;
      } catch { return null; }
    }
    const entId = await getTipoId('Entrada');
    const salId = await getTipoId('Salida');

    const entradaRow = marcas.find(m => entId && m.idTipo_de_Marca === entId) || marcas[0];
    let salidaRow = [...marcas].reverse().find(m => salId && m.idTipo_de_Marca === salId && m.idControlAsistencia !== entradaRow.idControlAsistencia) || marcas[marcas.length - 1];
    if (salidaRow.idControlAsistencia === entradaRow.idControlAsistencia && marcas.length > 1) {
      salidaRow = marcas[marcas.length - 1];
    }
    if (salidaRow.idControlAsistencia === entradaRow.idControlAsistencia) {
      const e = new Error('No se encontraron marcas vÃ¡lidas de Entrada/Salida en el dÃ­a'); e.status = 409; throw e;
    }

    function toDate(fechaStr, horaStr){
      const d = new Date(fechaStr);
      const [hh,mm,ss] = String(horaStr).split(':').map(x=>parseInt(x,10)||0);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, ss||0, 0);
    }
    let dtEnt = toDate(fechaN, entradaRow.hora);
    let dtSal = toDate(fechaN, salidaRow.hora);
    // Si por algÃºn motivo la salida no es posterior a la entrada, usar min/max del dÃ­a
    if (!(dtSal instanceof Date) || !(dtEnt instanceof Date) || isNaN(dtSal) || isNaN(dtEnt) || dtSal <= dtEnt){
      const daySpan = await pool.request().input('emp', sql.Int, myId).input('fec', sql.Date, fechaN)
        .query('SELECT MIN(hora) AS hmin, MAX(hora) AS hmax FROM dbo.Control_de_Asistencia WHERE idEmpleado=@emp AND fecha=@fec;');
      const r = daySpan.recordset[0] || {};
      if (r.hmin && r.hmax){ dtEnt = toDate(fechaN, r.hmin); dtSal = toDate(fechaN, r.hmax); }
    }
    const diffMin = Math.max(0, Math.round((dtSal - dtEnt)/60000));
    const horasEfectivas = Math.max(0, Math.round(((diffMin - 60) / 60) * 100) / 100); // -1h almuerzo
    const extraCalc = Math.max(0, Math.round((horasEfectivas - 8) * 100) / 100);
    let extra = extraCalc;
    if (horas_extras !== undefined && horas_extras !== null && horas_extras !== '') {
      const reqExtra = Number(horas_extras);
      if (!isFinite(reqExtra) || reqExtra <= 0) { const e=new Error('Horas extra invÃ¡lidas'); e.status=400; throw e; }
      if (extraCalc > 0 && reqExtra - extraCalc > 0.01) { const e=new Error('No puedes solicitar más horas de las calculadas según tus marcas'); e.status=400; throw e; }
      extra = reqExtra;
    }

    // Si no hay horas extra, rechazar solicitud
    if (extra <= 0) { const e=new Error('No hay horas extra para ese dÃ­a'); e.status=400; throw e; }

    // Si ya existe HE Pendiente para esa asistencia, actualizar; si no, insertar
    const exist = await pool.request().input('idc', sql.Int, salidaRow.idControlAsistencia).query(`
      SELECT TOP 1 * FROM dbo.Horas_Extras WHERE idControlAsistencia=@idc ORDER BY idHoras_Extras DESC;
    `);

    const cols = await getColumns(pool, 'Horas_Extras');
    const hasTipo = cols.has('tipo');
    const hasFactor = cols.has('factor');
    const hasFecha = cols.has('fecha');
    const hasDecision = cols.has('decision');
    const hasEstado = cols.has('estado');
    const map = mapTipoFactor(tipoDetectado, factor);

    if (exist.recordset.length) {
      const row = exist.recordset[0];
      const reqQ = pool.request()
        .input('id', sql.Int, row.idHoras_Extras)
        .input('horas_extras', sql.Decimal(10,2), extra);
      let sqlSet = 'horas_extras=@horas_extras';
      if (hasTipo) { reqQ.input('tipo', sql.VarChar(20), map.tipo); sqlSet += ', tipo=@tipo'; }
      if (hasFactor) { reqQ.input('factor', sql.Decimal(10,2), Number(map.factor||0)); sqlSet += ', factor=@factor'; }
      if (hasFecha) { reqQ.input('fecha', sql.Date, fecha); sqlSet += ', fecha=@fecha'; }
      if (hasDecision) { sqlSet += ", decision='Pendiente'"; }
      const upd = await reqQ.query(`
        UPDATE dbo.Horas_Extras SET ${sqlSet}
        OUTPUT INSERTED.*
        WHERE idHoras_Extras=@id;
      `);
      const payload = upd.recordset[0];
      payload.esFeriado = feriadoInfo.esFeriado;
      payload.feriadoNombre = feriadoInfo.nombre || null;
      return res.json({ ok:true, data: payload, updated: true });
    }

    const reqQ = pool.request()
      .input('horas_extras', sql.Decimal(10,2), extra)
      .input('idControlAsistencia', sql.Int, salidaRow.idControlAsistencia);
    let insertCols = 'horas_extras, idControlAsistencia';
    let insertVals = '@horas_extras, @idControlAsistencia';
    if (hasEstado) { insertCols += ', estado'; insertVals += ', @estado'; reqQ.input('estado', sql.Bit, 1); }
    if (hasDecision) { insertCols += ', decision'; insertVals += ', @decision'; reqQ.input('decision', sql.VarChar(45), 'Pendiente'); }
    if (hasFecha) { insertCols += ', fecha'; insertVals += ', @fecha'; reqQ.input('fecha', sql.Date, fecha); }
    if (hasTipo) { insertCols += ', tipo'; insertVals += ', @tipo'; reqQ.input('tipo', sql.VarChar(20), map.tipo); }
    if (hasFactor) { insertCols += ', factor'; insertVals += ', @factor'; reqQ.input('factor', sql.Decimal(10,2), Number(map.factor||0)); }
    const ins = await reqQ.query(`
      INSERT INTO dbo.Horas_Extras (${insertCols})
      OUTPUT INSERTED.*
      VALUES (${insertVals});
    `);
    const payload = ins.recordset[0];
    payload.esFeriado = feriadoInfo.esFeriado;
    payload.feriadoNombre = feriadoInfo.nombre || null;
    res.status(201).json({ ok:true, data: payload, created: true });
  } catch (err) { next(err); }
};
// PATCH /api/horas-extras/:id -> edita tipo/factor/horas mientras este Pendiente.
// Permite cambiar tipo/factor (y opcional horas_extras) cuando el registro estÃ¡ Pendiente
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const body = req.body || {};
    const pool = await getPool();

    // Verificar estado
    const r0 = await pool.request().input('id', sql.Int, id).query(`
      SELECT decision FROM dbo.Horas_Extras WHERE idHoras_Extras=@id;
    `);
    if (!r0.recordset.length) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    const dec = String(r0.recordset[0].decision||'');
    if (dec !== 'Pendiente') { const e=new Error('Solo se puede editar cuando estÃ¡ Pendiente'); e.status=409; throw e; }

    const cols = await getColumns(pool, 'Horas_Extras');
    const hasTipo = cols.has('tipo');
    const hasFactor = cols.has('factor');

    const sets = [];
    const reqQ = pool.request().input('id', sql.Int, id);

    if (Object.prototype.hasOwnProperty.call(body,'horas_extras')){
      sets.push('horas_extras=@horas_extras');
      reqQ.input('horas_extras', sql.Decimal(10,2), Number(body.horas_extras||0));
    }

    if (hasTipo && body.tipo){
      const m = mapTipoFactor(body.tipo, body.factor);
      sets.push('tipo=@tipo');
      reqQ.input('tipo', sql.VarChar(20), m.tipo);
      if (hasFactor){
        sets.push('factor=@factor');
        reqQ.input('factor', sql.Decimal(10,2), Number(m.factor||0));
      }
    } else if (hasFactor && Object.prototype.hasOwnProperty.call(body,'factor')){
      sets.push('factor=@factor');
      reqQ.input('factor', sql.Decimal(10,2), Number(body.factor||0));
    }

    if (!sets.length) { const e=new Error('No hay campos para actualizar'); e.status=400; throw e; }

    const r = await reqQ.query(`
      UPDATE dbo.Horas_Extras SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idHoras_Extras=@id;
    `);
    res.json({ ok:true, data: r.recordset[0] });
  } catch (err) { next(err); }
};

