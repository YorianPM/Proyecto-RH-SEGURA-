const { sql, getPool } = require('../db');
const { DEFAULTS, toPeriodoDesdeMensual, rentaPeriodo, ajustarSueldoPorIncapacidades, diasSolapados, buildTramosMensualesFromDb, PERIOD_FACTORS, diasHabilesEntre } = require('../utils/payroll');
const { configPath, readJSONSafe, writeJSON, isLocked, createLock, saveSnapshot, readSnapshot, appendAuditLine } = require('../services/planillaFiles');
// Controlador especifico para planillas CR (tasas locales, locks y PDFs).

// Redondeo a dos decimales.
function round2(n){ return Math.round(Number(n)*100)/100; }

// Tasas por defecto si no hay configuracion persistida.
const DEFAULT_TASAS = { ccss_obrero:0.1034, banco_popular_obrero:0.01, patronal_total:0.2633 };

// Busca tasas guardadas por año y rellena defaults.
function getTasasByYear(year){
  const p = configPath(String(year));
  const cfg = readJSONSafe(p, null);
  if (!cfg) return { ...DEFAULT_TASAS };
  const t = { ...DEFAULT_TASAS };
  if (typeof cfg.ccss_obrero === 'number') t.ccss_obrero = cfg.ccss_obrero;
  if (typeof cfg.banco_popular_obrero === 'number') t.banco_popular_obrero = cfg.banco_popular_obrero;
  if (typeof cfg.patronal_total === 'number') t.patronal_total = cfg.patronal_total;
  return t;
}

// Normaliza fechas a YYYY-MM-DD aceptando distintos formatos.
function toISODate(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return null;
}

// Devuelve factor de conversion segun periodo solicitado.
function ppm(periodo){
  const p = String(periodo||'mensual').toLowerCase();
  return PERIOD_FACTORS[p] || 1;
}

// Consulta los tramos de renta vigentes al corte.
async function cargarTramos(pool, hasta){
  const tramosQ = await pool.request()
    .input('h', sql.Date, hasta)
    .query(`
      SELECT idRenta_tramo, vigencia_desde, vigencia_hasta, monto_min, monto_max, tasa_pct
      FROM dbo.Renta_Tramo
      WHERE (vigencia_desde IS NULL OR vigencia_desde <= @h)
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= @h)
      ORDER BY monto_min ASC;
    `);
  const rows = tramosQ.recordset || [];
  const tramosMensuales = buildTramosMensualesFromDb(rows);
  return { rows, tramosMensuales };
}

// Determina el tramo correspondiente para guardar referencia.
function tramoDominanteId(baseMensual, tramosRows){
  let id = null;
  for (const r of (tramosRows||[])){
    const min = Number(r.monto_min||0);
    const max = (r.monto_max==null)? Infinity : Number(r.monto_max);
    if (baseMensual >= min && baseMensual < max){ id = r.idRenta_tramo; break; }
  }
  if (id==null && tramosRows && tramosRows.length) id = tramosRows[tramosRows.length-1].idRenta_tramo;
  return id||0;
}

// Arma nota rapida con incapacidades/vacaciones/permiso.
function buildObs({aj, vacDias, horasPerm}){
  const bits = [];
  if (aj?.resumen) bits.push(`Inc: ${aj.resumen}`);
  if (vacDias>0) bits.push(`Vac: ${vacDias}d`);
  if (horasPerm>0) bits.push(`Perm: ${Math.round(Number(horasPerm)*100)/100}h`);
  return bits.join(' | ');
}

// Core: arma filas de planilla con horas, incapacidades, vacaciones y permisos.
async function calcularPlanillaFilas({ pool, periodo, desde, hasta, horasMes, tasaHE, baseRentaSel, bonosMap }){
  const empQ = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
    SELECT e.idEmpleado, e.nombre, e.apellido1, e.apellido2,
           p.nombre_puesto, p.salario_base,
           COALESCE(e.hijos, 0) AS hijos
    FROM dbo.Empleados e
    JOIN dbo.Puestos p ON p.idPuesto = e.idPuesto
    WHERE e.estado = 1
      AND CAST(e.fecha_ingreso AS date) <= @desde
    ORDER BY e.idEmpleado ASC;
  `);
  const empleados = empQ.recordset || [];
  if (!empleados.length) return { filas: [], totales: {}, costo_total_empresa: 0, snapshot: { tasas: getTasasByYear(new Date(hasta).getFullYear()), tramos: [], params:{} } };

  // Horas extra ponderadas por factor (si la columna existe); si no, usar suma simple * tasaHE
  let horasPorEmp = new Map();
  try {
    const heQ = await pool.request()
      .input('desde', sql.Date, desde)
      .input('hasta', sql.Date, hasta)
      .input('tasa', sql.Decimal(10,2), Number(tasaHE))
      .query(`
        SELECT e.idEmpleado,
               SUM(CAST(he.horas_extras AS DECIMAL(10,2))) AS horas,
               SUM(CAST(he.horas_extras AS DECIMAL(10,2)) * CAST(COALESCE(NULLIF(he.factor,0), @tasa) AS DECIMAL(10,2))) AS ponderadas
        FROM dbo.Horas_Extras he
        JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
        JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
        WHERE he.decision = 'Aprobado'
          AND TRY_CONVERT(date, he.fecha, 103) >= @desde
          AND TRY_CONVERT(date, he.fecha, 103) <= @hasta
        GROUP BY e.idEmpleado;
      `);
    horasPorEmp = new Map(heQ.recordset.map(r => [r.idEmpleado, { horas: Number(r.horas||0), ponderadas: Number(r.ponderadas||0) }]));
  } catch {
    const heQ = await pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta).query(`
      SELECT e.idEmpleado, SUM(he.horas_extras) AS horas
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      JOIN dbo.Empleados e ON e.idEmpleado = c.idEmpleado
      WHERE he.decision = 'Aprobado'
        AND TRY_CONVERT(date, he.fecha, 103) >= @desde
        AND TRY_CONVERT(date, he.fecha, 103) <= @hasta
      GROUP BY e.idEmpleado;
    `);
    horasPorEmp = new Map(heQ.recordset.map(r => [r.idEmpleado, { horas: Number(r.horas||0), ponderadas: Number(r.horas||0) * Number(tasaHE) }]));
  }

  const incQ = await pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta).query(`
    SELECT i.idEmpleado, i.fecha_inicio, i.fecha_fin, i.estado, t.concepto
    FROM dbo.Incapacidad i
    JOIN dbo.Tipo_Incapacidad t ON t.idTipo_Incapacidad=i.idTipo_Incapacidad
    WHERE i.estado = 1 AND i.fecha_inicio <= @hasta AND i.fecha_fin >= @desde;
  `);
  const incByEmp = new Map();
  for (const r of incQ.recordset) { if (!incByEmp.has(r.idEmpleado)) incByEmp.set(r.idEmpleado, []); incByEmp.get(r.idEmpleado).push(r); }

  const vacQ = await pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta).query(`
    SELECT v.idEmpleado, s.fecha_inicio_vac, s.fecha_fin_vac, s.decision_administracion, s.pago
    FROM dbo.Solicitudes s
    JOIN dbo.Vacaciones v ON v.idVacaciones=s.idVacaciones
    WHERE s.decision_administracion='Aprobado'
      AND s.fecha_inicio_vac <= @hasta AND s.fecha_fin_vac >= @desde;
  `);
  const vacByEmp = new Map();
  for (const r of vacQ.recordset) { if (!vacByEmp.has(r.idEmpleado)) vacByEmp.set(r.idEmpleado, []); vacByEmp.get(r.idEmpleado).push(r); }

  const permQ = await pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta).query(`
    SELECT p.idEmpleado, p.fecha_inicio, p.fecha_fin, p.cantidad_horas
    FROM dbo.Permisos p
    WHERE p.decision='Aprobado'
      AND (p.derecho_pago IS NULL OR p.derecho_pago IN ('No','NO','no'))
      AND p.fecha_inicio <= @hasta AND p.fecha_fin >= @desde;
  `);
  const permByEmp = new Map();
  for (const r of permQ.recordset) { if (!permByEmp.has(r.idEmpleado)) permByEmp.set(r.idEmpleado, []); permByEmp.get(r.idEmpleado).push(r); }

  const horasTrabQ = await pool.request()
    .input('desde', sql.Date, desde)
    .input('hasta', sql.Date, hasta)
    .query(`
      SELECT c.idEmpleado, SUM(CAST(c.horas_ordinarias AS DECIMAL(10,2))) AS horas
      FROM dbo.Control_de_Asistencia c
      WHERE c.fecha BETWEEN @desde AND @hasta
        AND c.idTipo_de_Marca = 2
        AND c.horas_ordinarias IS NOT NULL
      GROUP BY c.idEmpleado;
    `);
  const horasTrabByEmp = new Map(horasTrabQ.recordset.map(r => [r.idEmpleado, Number(r.horas || 0)]));

  const { rows: tramosRows, tramosMensuales } = await cargarTramos(pool, hasta);
  const year = new Date(hasta).getFullYear();
  const tasas = getTasasByYear(year);

  const filas = [];
  let totalBruto=0, totalObrero=0, totalBancoPopular=0, totalRenta=0, totalNeto=0, totalPatronal=0;

  for (const e of empleados){
    const salarioMensual = Number(e.salario_base);
    const hijos = Number(e.hijos || 0);
    const heInfo = horasPorEmp.get(e.idEmpleado) || { horas:0, ponderadas:0 };
    const horasTrab = horasTrabByEmp.get(e.idEmpleado) || 0;
    const valorHora = salarioMensual / Number(horasMes || DEFAULTS.horasMes);
    const sueldoPeriodo = round2(valorHora * horasTrab);
    const he_monto = round2((salarioMensual / Number(horasMes || DEFAULTS.horasMes)) * Number(heInfo.ponderadas||0));
    const bono = round2(Number((bonosMap||new Map()).get(e.idEmpleado) || 0));

    const aj = ajustarSueldoPorIncapacidades({ sueldoPeriodo, salarioMensual, periodo, desde, hasta, incapacidades: incByEmp.get(e.idEmpleado) || [] });

    let vac_pago=0, vacDias=0;
    for (const v of (vacByEmp.get(e.idEmpleado)||[])){
      const d = diasSolapados(desde, hasta, v.fecha_inicio_vac, v.fecha_fin_vac);
      if (d>0){ vacDias += d; vac_pago += Number(v.pago||0); }
    }

    let horasPerm=0;
    for (const p of (permByEmp.get(e.idEmpleado)||[])){
      // Calcular horas de permiso sin goce. Si viene HH:mm, usar ese valor.
      // Si es un permiso por rango de fechas, estimar con días hábiles (Lun-Sáb) x 8h efectivas.
      const solIni = new Date(Math.max(new Date(desde), new Date(p.fecha_inicio)));
      const solFin = new Date(Math.min(new Date(hasta), new Date(p.fecha_fin)));
      if (solFin < solIni) continue;
      const time = String(p.cantidad_horas||'').trim();
      const m = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (m){
        const h = (parseInt(m[1],10)||0) + (parseInt(m[2],10)||0)/60 + (parseInt(m[3]||'0',10)||0)/3600;
        horasPerm += h;
      } else {
        const diasHab = diasHabilesEntre(solIni, solFin);
        const horasDiaEfectivas = 8; // CR: 8h diarias efectivas (almuerzo no remunerado)
        horasPerm += diasHab * horasDiaEfectivas;
      }
    }
    const salarioHora = salarioMensual / Number(horasMes || DEFAULTS.horasMes);
    const permisos_sin_goce = round2(horasPerm * salarioHora);

    const bruto = round2(Math.max(0, aj.sueldoAjustado - permisos_sin_goce) + he_monto + bono + vac_pago);
    const ccss_obrero = round2(bruto * Number(tasas.ccss_obrero));
    const banco_popular = round2(bruto * Number(tasas.banco_popular_obrero));
    const baseRenta = String(baseRentaSel||'Bruto').toLowerCase() === 'bruto' ? bruto : Math.max(0, bruto - ccss_obrero - banco_popular);
    const renta = rentaPeriodo(baseRenta, periodo, tramosMensuales);
    const neto = round2(bruto - ccss_obrero - banco_popular - renta);
    const patronal = round2(bruto * Number(tasas.patronal_total));

    totalBruto += bruto; totalObrero += ccss_obrero; totalBancoPopular += banco_popular; totalRenta += renta; totalNeto += neto; totalPatronal += patronal;

    filas.push({
      idEmpleado: e.idEmpleado,
      nombre: [e.nombre, e.apellido1, e.apellido2].filter(Boolean).join(' '),
      puesto: e.nombre_puesto,
      salario_mensual: salarioMensual,
      sueldo_periodo: round2(sueldoPeriodo),
      he_monto,
      bono,
      vac_pago: round2(vac_pago),
      permisos_sin_goce,
      bruto,
      ccss_obrero,
      banco_popular,
      renta,
      neto,
      patronal,
      obs: buildObs({ aj, vacDias, horasPerm }),
      _aux: { baseRenta, idRentaTramo: tramoDominanteId(baseRenta * ppm(periodo), tramosRows), incapResumen: aj.resumen, vacDias, hijos }
    });
  }

  const totales = {
    totalBruto: round2(totalBruto),
    totalObrero: round2(totalObrero),
    totalBancoPopular: round2(totalBancoPopular),
    totalRenta: round2(totalRenta),
    totalNeto: round2(totalNeto),
    totalPatronal: round2(totalPatronal),
  };
  const costo_total_empresa = round2(totalBruto + totalPatronal);
  const snapshot = { tasas, tramos: (await cargarTramos(pool, hasta)).rows, params: { periodo, fecha_inicio: desde, fecha_fin: hasta, horas_mes: horasMes, tasa_he: tasaHE, base_renta: baseRentaSel } };
  return { filas, totales, costo_total_empresa, snapshot };
}

// ===================== Endpoints =====================

// GET /api/planilla-cr/config/:anio -> lee archivo de tasas para el año dado.
exports.getConfig = async (req, res, next) => {
  try {
    const anio = String(req.params.anio);
    const p = configPath(anio);
    const j = readJSONSafe(p, null) || DEFAULT_TASAS;
    res.json(j);
  } catch (e) { next(e); }
};

// PUT /api/planilla-cr/config/:anio -> guarda las tasas enviadas.
exports.putConfig = async (req, res, next) => {
  try {
    const anio = String(req.params.anio);
    const body = req.body || {};
    const cfg = {
      ccss_obrero: Number(body.ccss_obrero ?? DEFAULT_TASAS.ccss_obrero),
      banco_popular_obrero: Number(body.banco_popular_obrero ?? DEFAULT_TASAS.banco_popular_obrero),
      patronal_total: Number(body.patronal_total ?? DEFAULT_TASAS.patronal_total),
    };
    writeJSON(configPath(anio), cfg);
    res.json({ ok:true });
  } catch (e) { next(e); }
};

// POST /api/planilla-cr/preview -> calcula resumen sin persistir.
exports.previewCR = async (req, res, next) => {
  try {
    const periodo = (req.body.periodo || 'Mensual');
    const desde = toISODate(req.body.fecha_inicio);
    const hasta = toISODate(req.body.fecha_fin);
    const horasMes = Number(req.body.horas_mes || DEFAULTS.horasMes);
    const tasaHE = Number(req.body.tasa_he || DEFAULTS.tasaHoraExtra);
    const baseRentaSel = (req.body.base_renta || 'Bruto');
    const bonos = Array.isArray(req.body.bonos) ? req.body.bonos : [];
    const bonosMap = new Map(bonos.map(b => [Number(b.idEmpleado), Number(b.monto || 0)]));
    if (!desde || !hasta) { const e=new Error('fecha_inicio y fecha_fin requeridos'); e.status=400; throw e; }

    const pool = await getPool();
    const { filas, totales, costo_total_empresa, snapshot } = await calcularPlanillaFilas({ pool, periodo: String(periodo).toLowerCase(), desde, hasta, horasMes, tasaHE, baseRentaSel: baseRentaSel.toLowerCase()==='bruto'?'bruto':'neto', bonosMap });
    res.json({ filas, totales, costo_total_empresa, snapshot });
  } catch (e) { next(e); }
};

// POST /api/planilla-cr/generar -> guarda/actualiza planilla oficial en BD + snapshot.
exports.generarCR = async (req, res, next) => {
  try {
    const periodo = (req.body.periodo || 'Mensual');
    const desde = toISODate(req.body.fecha_inicio);
    const hasta = toISODate(req.body.fecha_fin);
    const horasMes = Number(req.body.horas_mes || DEFAULTS.horasMes);
    const tasaHE = Number(req.body.tasa_he || DEFAULTS.tasaHoraExtra);
    const baseRentaSel = (req.body.base_renta || 'Bruto');
    const bonos = Array.isArray(req.body.bonos) ? req.body.bonos : [];
    const bonosMap = new Map(bonos.map(b => [Number(b.idEmpleado), Number(b.monto || 0)]));
    if (!desde || !hasta) { const e=new Error('fecha_inicio y fecha_fin requeridos'); e.status=400; throw e; }
    if (isLocked(periodo, desde, hasta)) { const e=new Error('Planilla cerrada'); e.status=409; throw e; }

    const pool = await getPool();
    const { filas, totales, costo_total_empresa, snapshot } = await calcularPlanillaFilas({ pool, periodo: String(periodo).toLowerCase(), desde, hasta, horasMes, tasaHE, baseRentaSel: baseRentaSel.toLowerCase()==='bruto'?'bruto':'neto', bonosMap });

    const cfQ = await pool.request().query(`SELECT TOP 1 idRenta_credito_tipo, valor, descripcion FROM dbo.Credito_Fiscal ORDER BY idRenta_credito_tipo ASC;`);
    const cf = cfQ.recordset?.[0] || { idRenta_credito_tipo: 1, valor: 0, descripcion: '' };
    const idRentaCredito = Number(cf.idRenta_credito_tipo || 1);
    const valorCredito = Number(cf.valor || 0);
    const descCredito  = String(cf.descripcion || '');

    for (const f of filas) {
      const hijos = Number(f._aux?.hijos || 0);
      const aplicaCreditoHijos = hijos > 0 && valorCredito > 0;
      const creditoValor = aplicaCreditoHijos ? round2(valorCredito) : 0;
      const creditoDescripcion = aplicaCreditoHijos ? descCredito : '';

      const ps = pool.request()
        .input('fecha_inicio', sql.Date, desde)
        .input('fecha_fin', sql.Date, hasta)
        .input('monto_horas_ordinarias', sql.Decimal(10,2), round2(f.sueldo_periodo))
        .input('monto_horas_extras', sql.Decimal(10,2), round2(f.he_monto))
        .input('monto_bono', sql.Decimal(10,2), round2(f.bono + f.vac_pago))
        .input('salario_bruto', sql.Decimal(10,2), round2(f.bruto))
        .input('deduccion_ccss', sql.Decimal(10,2), round2(f.ccss_obrero))
        .input('deduccion_bancopopular', sql.Decimal(10,2), round2(f.banco_popular))
        .input('deduccion_renta', sql.Decimal(10,2), round2(f.renta))
        .input('deduccion_prestamo', sql.Decimal(10,2), 0)
        .input('monto_pagado', sql.Decimal(10,2), round2(f.neto))
        .input('periodo', sql.VarChar(20), String(periodo).toLowerCase())
        .input('idEmpleado', sql.Int, f.idEmpleado)
        .input('incapacidades', sql.VarChar(200), f._aux?.incapResumen || '')
        .input('vacaciones', sql.VarChar(200), f._aux?.vacDias ? `${f._aux.vacDias}d` : '')
        .input('horas_extras_monto', sql.Decimal(10,2), round2(f.he_monto))
        .input('idRenta_tramo', sql.Int, Number(f._aux?.idRentaTramo || 0))
        .input('idRenta_credito_tipo', sql.Int, idRentaCredito)
        .input('valor_credito_fiscal', sql.Decimal(10,2), creditoValor)
        .input('renta_credito_vigencia', sql.VarChar(100), creditoDescripcion);

      const sqlMerge = `
        MERGE dbo.Planillas AS target
        USING (SELECT @idEmpleado AS idEmpleado, @periodo AS periodo, @fecha_inicio AS fecha_inicio, @fecha_fin AS fecha_fin) AS src
        ON (target.idEmpleado = src.idEmpleado AND target.periodo = src.periodo
            AND CAST(target.fecha_inicio AS date) = @fecha_inicio AND CAST(target.fecha_fin AS date) = @fecha_fin)
        WHEN MATCHED THEN
          UPDATE SET
            monto_horas_ordinarias=@monto_horas_ordinarias,
            monto_horas_extras=@monto_horas_extras,
            monto_bono=@monto_bono,
            salario_bruto=@salario_bruto,
            deduccion_ccss=@deduccion_ccss,
            deduccion_bancopopular=@deduccion_bancopopular,
            deduccion_renta=@deduccion_renta,
            deduccion_prestamo=@deduccion_prestamo,
            monto_pagado=@monto_pagado,
            incapacidades=@incapacidades,
            vacaciones=@vacaciones,
            horas_extras_monto=@horas_extras_monto,
            idRenta_tramo=@idRenta_tramo,
            idRenta_credito_tipo=@idRenta_credito_tipo,
            valor_credito_fiscal=@valor_credito_fiscal,
            renta_credito_vigencia=@renta_credito_vigencia
        WHEN NOT MATCHED THEN
          INSERT (
            fecha_inicio, fecha_fin,
            monto_horas_ordinarias, monto_horas_extras, monto_bono,
            salario_bruto,
            deduccion_ccss, deduccion_bancopopular, deduccion_renta, deduccion_prestamo,
            monto_pagado,
            periodo, idEmpleado,
            incapacidades, vacaciones,
            horas_extras_monto,
            idRenta_tramo, idRenta_credito_tipo, valor_credito_fiscal, renta_credito_vigencia)
          VALUES (
            @fecha_inicio, @fecha_fin,
            @monto_horas_ordinarias, @monto_horas_extras, @monto_bono,
            @salario_bruto,
            @deduccion_ccss, @deduccion_bancopopular, @deduccion_renta, @deduccion_prestamo,
            @monto_pagado,
            @periodo, @idEmpleado,
            @incapacidades, @vacaciones,
            @horas_extras_monto,
            @idRenta_tramo, @idRenta_credito_tipo, @valor_credito_fiscal, @renta_credito_vigencia);
      `;
      await ps.query(sqlMerge);
    }

    saveSnapshot(periodo, desde, hasta, { tasas: snapshot.tasas, tramos: snapshot.tramos, params: snapshot.params, totales, costo_total_empresa });
    res.json({ ok:true });
  } catch (e) { next(e); }
};

// GET /api/planilla-cr/detalle -> genera PDF consolidado del periodo.
exports.detalle = async (req, res, next) => {
  try {
    const periodo = (req.query.periodo || 'Mensual');
    const desde = toISODate(req.query.desde);
    const hasta = toISODate(req.query.hasta);
    const pool = await getPool();
    const ps = pool.request().input('periodo', sql.VarChar(20), String(periodo).toLowerCase());
    if (desde) ps.input('desde', sql.Date, desde);
    if (hasta) ps.input('hasta', sql.Date, hasta);
    const where = [];
    if (desde) where.push('CAST(p.fecha_inicio AS date)=@desde');
    if (hasta) where.push('CAST(p.fecha_fin AS date)=@hasta');
    where.push('p.periodo=@periodo');
    const whereSql = 'WHERE ' + where.join(' AND ');
    const { recordset } = await ps.query(`
      SELECT p.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
             pu.nombre_puesto, pu.salario_base
      FROM dbo.Planillas p
      JOIN dbo.Empleados e ON e.idEmpleado=p.idEmpleado
      JOIN dbo.Puestos pu ON pu.idPuesto=e.idPuesto
      ${whereSql}
      ORDER BY p.idPlanilla ASC;
    `);
    const snapshot = readSnapshot(periodo, desde, hasta) || null;
    const locked = isLocked(periodo, desde, hasta);
    res.json({ ok:true, data: recordset, snapshot, locked });
  } catch (e) { next(e); }
};

exports.override = async (req, res, next) => {
  try {
    const { periodo, fecha_inicio, fecha_fin, idPlanilla, campo, valor, motivo } = req.body || {};
    const desde = toISODate(fecha_inicio);
    const hasta = toISODate(fecha_fin);
    if (!idPlanilla || !campo) { const e=new Error('idPlanilla y campo requeridos'); e.status=400; throw e; }
    if (isLocked(periodo, desde, hasta)) { const e = new Error('Planilla cerrada'); e.status=409; throw e; }

    const pool = await getPool();
    const rowQ = await pool.request().input('id', sql.Int, Number(idPlanilla)).query(`
      SELECT * FROM dbo.Planillas WHERE idPlanilla=@id;
    `);
    if (!rowQ.recordset.length) { const e=new Error('Planilla no encontrada'); e.status=404; throw e; }
    const row = rowQ.recordset[0];

    const snapshot = readSnapshot(periodo, desde, hasta);
    const tasas = snapshot?.tasas || getTasasByYear(new Date(hasta||row.fecha_fin).getFullYear());

    const allowed = new Set(['monto_bono','monto_horas_extras','monto_horas_ordinarias','salario_bruto','deduccion_ccss','deduccion_bancopopular','deduccion_renta','deduccion_prestamo']);
    if (!allowed.has(String(campo))) { const e=new Error('Campo no permitido'); e.status=400; throw e; }

    const nuevo = Number(valor || 0);
    const anterior = Number(row[campo] != null ? row[campo] : (campo==='monto_horas_extras' ? row.horas_extras_monto : 0));

    let salario_bruto = Number(row.salario_bruto);
    if (campo === 'monto_bono' || campo === 'monto_horas_extras' || campo === 'monto_horas_ordinarias') {
      salario_bruto = salario_bruto - Number(row[campo] || 0) + nuevo;
    } else if (campo === 'salario_bruto') {
      salario_bruto = nuevo;
    }
    const deduccion_bancopopular = round2(salario_bruto * Number(tasas.banco_popular_obrero));
    const deduccion_ccss = round2(salario_bruto * Number(tasas.ccss_obrero));
    const baseTipo = snapshot?.params?.base_renta || 'Bruto';
    const baseRenta = String(baseTipo).toLowerCase() === 'bruto' ? salario_bruto : Math.max(0, salario_bruto - deduccion_ccss - deduccion_bancopopular);
    const { tramosMensuales } = await cargarTramos(pool, hasta || row.fecha_fin);
    const deduccion_renta = rentaPeriodo(baseRenta, String(row.periodo||'mensual'), tramosMensuales);
    const deduccion_prestamo = (campo==='deduccion_prestamo') ? nuevo : Number(row.deduccion_prestamo||0);
    const monto_pagado = round2(salario_bruto - deduccion_ccss - deduccion_bancopopular - deduccion_renta - deduccion_prestamo);

    const ps = pool.request()
      .input('id', sql.Int, Number(idPlanilla))
      .input('salario_bruto', sql.Decimal(10,2), round2(salario_bruto))
      .input('deduccion_ccss', sql.Decimal(10,2), deduccion_ccss)
      .input('deduccion_bancopopular', sql.Decimal(10,2), deduccion_bancopopular)
      .input('deduccion_renta', sql.Decimal(10,2), deduccion_renta)
      .input('deduccion_prestamo', sql.Decimal(10,2), round2(deduccion_prestamo))
      .input('monto_pagado', sql.Decimal(10,2), monto_pagado)
      .input('valor', sql.Decimal(10,2), round2(nuevo));
    const setCampo = (campo==='monto_horas_extras') ? `monto_horas_extras=@valor, horas_extras_monto=@valor` : `${campo}=@valor`;
    await ps.query(`
      UPDATE dbo.Planillas SET ${setCampo}, salario_bruto=@salario_bruto, deduccion_ccss=@deduccion_ccss,
        deduccion_bancopopular=@deduccion_bancopopular, deduccion_renta=@deduccion_renta,
        deduccion_prestamo=@deduccion_prestamo, monto_pagado=@monto_pagado
      WHERE idPlanilla=@id;
    `);

    appendAuditLine(periodo || row.periodo, toISODate(row.fecha_inicio), toISODate(row.fecha_fin), {
      timestamp: new Date().toISOString(),
      usuario: req.user?.usuario || req.user?.sub || null,
      idPlanilla: Number(idPlanilla), campo: String(campo), valor_anterior: Number(anterior), valor_nuevo: Number(nuevo), motivo: String(motivo||'')
    });

    res.json({ ok:true });
  } catch (e) { next(e); }
};

exports.cerrarRango = async (req, res, next) => {
  try {
    const { periodo, fecha_inicio, fecha_fin } = req.body || {};
    const desde = toISODate(fecha_inicio);
    const hasta = toISODate(fecha_fin);
    if (!desde || !hasta) { const e=new Error('fecha_inicio y fecha_fin requeridos'); e.status=400; throw e; }
    if (isLocked(periodo, desde, hasta)) return res.json({ ok:true, message:'Ya estaba cerrado' });
    createLock(periodo, desde, hasta, { by: req.user?.usuario || req.user?.sub || null });
    res.json({ ok:true });
  } catch (e) { next(e); }
};

exports.pdf = async (req, res, next) => {
  try {
    const periodo = (req.query.periodo || 'Mensual');
    const desde = toISODate(req.query.desde);
    const hasta = toISODate(req.query.hasta);
    const pool = await getPool();
    const ps = pool.request().input('periodo', sql.VarChar(20), String(periodo).toLowerCase()).input('desde', sql.Date, desde).input('hasta', sql.Date, hasta);
    const { recordset: rows } = await ps.query(`
      SELECT p.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
             pu.nombre_puesto
      FROM dbo.Planillas p
      JOIN dbo.Empleados e ON e.idEmpleado=p.idEmpleado
      JOIN dbo.Puestos pu ON pu.idPuesto=e.idPuesto
      WHERE p.periodo=@periodo AND CAST(p.fecha_inicio AS date)=@desde AND CAST(p.fecha_fin AS date)=@hasta
      ORDER BY p.idPlanilla ASC;
    `);
    const snap = readSnapshot(periodo, desde, hasta);
    const tasas = snap?.tasas || getTasasByYear(new Date(hasta).getFullYear());

    let tBruto=0,tCCSS=0,tBP=0,tRenta=0,tNeto=0,tPat=0,tPrest=0;
    for (const r of rows){
      tBruto += Number(r.salario_bruto||0);
      tCCSS += Number(r.deduccion_ccss||0);
      tBP += Number(r.deduccion_bancopopular||0);
      tRenta += Number(r.deduccion_renta||0);
      tPrest += Number(r.deduccion_prestamo||0);
      tNeto += Number(r.monto_pagado||0);
      tPat += Number(r.salario_bruto||0) * Number(tasas.patronal_total);
    }
    const costo = tBruto + tPat;

    const fmt = (n)=> Number(n||0).toLocaleString('es-CR',{ style:'currency', currency:'CRC' });
    const periodTitle = `${String(periodo).charAt(0).toUpperCase()+String(periodo).slice(1)} del ${new Date(desde).toLocaleDateString('es-CR')} al ${new Date(hasta).toLocaleDateString('es-CR')}`;

    const css = `
      <style>
      body{ font-family: Arial, sans-serif; font-size:11px; color:#111 }
      .brand{ font-size:18px; font-weight:bold; }
      .title{ font-size:12px; }
      .emp{ page-break-inside: avoid; margin: 8px 0 14px 0; }
      .emp-hdr{ display:grid; grid-template-columns: 1fr 100px 120px; align-items:center; gap:8px; font-weight:bold; }
      .subhdr{ font-size:10px; color:#444; margin-bottom:4px }
      table.detail{ width:100%; border-collapse:collapse; }
      table.detail th, table.detail td{ border:1px solid #888; padding:3px 4px; }
      table.detail thead th{ background:#f2f2f2; }
      .right{ text-align:right; }
      .subtotal td{ background:#fafafa; font-weight:bold; }
      .neto td{ background:#e8f5e9; font-weight:bold; }
      .totals{ margin-top:8px; border-top:2px solid #333; padding-top:6px; }
      </style>
    `;
    const empBlocks = rows.map((r,idx)=>{
      const he = Number(r.horas_extras_monto||r.monto_horas_extras||0);
      return `
      <div class="emp">
        <div class="emp-hdr">
          <div><span class="num">${idx+1}</span> ${r.nombre}</div>
          <div>Salario</div>
          <div class="right">${fmt(Number(r.salario_bruto||0))}</div>
        </div>
        <div class="subhdr">${r.nombre_puesto} &nbsp; Ref: ${r.idEmpleado}</div>
        <table class="detail"><thead><tr><th>Concepto</th><th>Asignaciones</th><th>Deducciones</th></tr></thead>
        <tbody>
          <tr><td>DÍAS TRABAJADOS / SUELDO PERÍODO</td><td class="right">${fmt(Number(r.monto_horas_ordinarias||0))}</td><td></td></tr>
          <tr><td>HORAS EXTRA</td><td class="right">${fmt(he)}</td><td></td></tr>
          <tr><td>BONOS / VACACIONES</td><td class="right">${fmt(Number(r.monto_bono||0))}</td><td></td></tr>
          <tr><td>RET. C.C.S.S. COLABORADOR</td><td></td><td class="right">${fmt(Number(r.deduccion_ccss||0))}</td></tr>
          <tr><td>RET. BANCO POPULAR</td><td></td><td class="right">${fmt(Number(r.deduccion_bancopopular||0))}</td></tr>
          <tr><td>IMPUESTO RENTA</td><td></td><td class="right">${fmt(Number(r.deduccion_renta||0))}</td></tr>
          <tr><td>OTROS (PRÉSTAMO)</td><td></td><td class="right">${fmt(Number(r.deduccion_prestamo||0))}</td></tr>
          <tr class="subtotal"><td>SUBTOTAL</td><td class="right">${fmt(Number(r.salario_bruto||0))}</td><td></td></tr>
          <tr class="neto"><td>TOTAL COLABORADOR NETO</td><td></td><td class="right">${fmt(Number(r.monto_pagado||0))}</td></tr>
        </tbody></table>
      </div>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <div class="brand">RH Segura</div>
      <div class="title">${periodTitle} — PRE-NÓMINA DETALLADA</div>
      ${empBlocks}
      <div class="totals">
        <table class="detail"><tbody>
          <tr><th>TOTAL BRUTO</th><td class="right">${fmt(tBruto)}</td></tr>
          <tr><th>TOTAL C.C.S.S. OBRERO</th><td class="right">${fmt(tCCSS)}</td></tr>
          <tr><th>TOTAL BANCO POPULAR</th><td class="right">${fmt(tBP)}</td></tr>
          <tr><th>TOTAL IMPUESTO RENTA</th><td class="right">${fmt(tRenta)}</td></tr>
          <tr><th>TOTAL PRÉSTAMO</th><td class="right">${fmt(tPrest)}</td></tr>
          <tr><th>TOTAL NETO</th><td class="right">${fmt(tNeto)}</td></tr>
          <tr><th>COSTO TOTAL EMPRESA (BRUTO + PATRONAL)</th><td class="right">${fmt(costo)}</td></tr>
        </tbody></table>
      </div>
    </body></html>`;

    let puppeteer = null; try { puppeteer = require('puppeteer'); } catch {}
    if (!puppeteer) return res.status(501).send('Generación de PDF no disponible (instale puppeteer)');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const now = new Date();
    const pdf = await page.pdf({
      format: 'A4', printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px; margin-left:8px; margin-right:8px; width:100%;"><span>RH Segura — ${periodTitle}</span></div>`,
      footerTemplate: `<div style=\"font-size:8px; margin-left:8px; margin-right:8px; width:100%; display:flex; justify-content:space-between;\"><span>${now.toLocaleString('es-CR')}</span><span>Página <span class=\"pageNumber\"></span>/<span class=\"totalPages\"></span></span></div>`,
      margin: { top: '20mm', bottom: '15mm', left: '8mm', right: '8mm' },
    });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=planilla_${periodo}_${desde}_${hasta}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

// GET /api/planilla-cr/payslip/self -> PDF para el empleado autenticado.
exports.payslipSelf = async (req, res, next) => {
  try {
    const periodo = (req.query.periodo || 'Quincenal');
    const desde = toISODate(req.query.desde);
    const hasta = toISODate(req.query.hasta);
    const idEmpleado = Number(req.user?.sub || 0);
    if (!idEmpleado) { const e = new Error('No autenticado'); e.status = 401; throw e; }
    if (!desde || !hasta) { const e = new Error('Parámetros de fecha inválidos'); e.status = 400; throw e; }

    const pool = await getPool();
    const ps = pool.request()
      .input('periodo', sql.VarChar(20), String(periodo).toLowerCase())
      .input('desde', sql.Date, desde)
      .input('hasta', sql.Date, hasta)
      .input('idEmpleado', sql.Int, idEmpleado);

    const q = await ps.query(`
      SELECT p.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
             pu.nombre_puesto, pu.salario_base
      FROM dbo.Planillas p
      JOIN dbo.Empleados e ON e.idEmpleado = p.idEmpleado
      JOIN dbo.Puestos pu ON pu.idPuesto = e.idPuesto
      WHERE CAST(p.fecha_inicio AS date) = @desde
        AND CAST(p.fecha_fin   AS date) = @hasta
        AND p.periodo = @periodo
        AND p.idEmpleado = @idEmpleado;
    `);

    if (!q.recordset || q.recordset.length === 0) {
      const e = new Error('No se encontró planilla para el período'); e.status = 404; throw e;
    }

    const r = q.recordset[0];
    const he = Number(r.horas_extras_monto || r.monto_horas_extras || 0);
    const periodTitle = `${String(periodo).charAt(0).toUpperCase()+String(periodo).slice(1)} del ${new Date(desde).toLocaleDateString('es-CR')} al ${new Date(hasta).toLocaleDateString('es-CR')}`;

    const fmt = (n) => (Number(n||0)).toLocaleString('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 });

    const css = `
      <style>
      body{ font-family: Arial, sans-serif; font-size:11px; color:#111; margin: 10mm }
      .brand{ font-size:18px; font-weight:bold; }
      .title{ font-size:12px; margin-bottom:6px; }
      .emp{ margin: 8px 0 14px 0; }
      .emp-hdr{ display:grid; grid-template-columns: 1fr 100px 120px; align-items:center; gap:8px; font-weight:bold; }
      .subhdr{ font-size:10px; color:#444; margin-bottom:4px }
      table.detail{ width:100%; border-collapse:collapse; }
      table.detail th, table.detail td{ border:1px solid #888; padding:4px 6px; }
      table.detail thead th{ background:#f2f2f2; }
      .right{ text-align:right; }
      .subtotal td{ background:#fafafa; font-weight:bold; }
      .neto td{ background:#e8f5e9; font-weight:bold; }
      </style>
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <div class="brand">RH Segura</div>
      <div class="title">${periodTitle} — Coletilla de Pago</div>
      <div class="emp">
        <div class="emp-hdr">
          <div>${r.nombre}</div>
          <div>Salario</div>
          <div class="right">${fmt(Number(r.salario_bruto||0))}</div>
        </div>
        <div class="subhdr">${r.nombre_puesto} &nbsp; Ref: ${r.idEmpleado}</div>
        <table class="detail"><thead><tr><th>Concepto</th><th>Asignaciones</th><th>Deducciones</th></tr></thead>
        <tbody>
          <tr><td>DÍAS TRABAJADOS / SUELDO PERÍODO</td><td class="right">${fmt(Number(r.monto_horas_ordinarias||0))}</td><td></td></tr>
          <tr><td>HORAS EXTRA</td><td class="right">${fmt(he)}</td><td></td></tr>
          <tr><td>BONOS / VACACIONES</td><td class="right">${fmt(Number(r.monto_bono||0))}</td><td></td></tr>
          <tr><td>RET. C.C.S.S. COLABORADOR</td><td></td><td class="right">${fmt(Number(r.deduccion_ccss||0))}</td></tr>
          <tr><td>RET. BANCO POPULAR</td><td></td><td class="right">${fmt(Number(r.deduccion_bancopopular||0))}</td></tr>
          <tr><td>IMPUESTO RENTA</td><td></td><td class="right">${fmt(Number(r.deduccion_renta||0))}</td></tr>
          <tr><td>OTROS (PRÉSTAMO)</td><td></td><td class="right">${fmt(Number(r.deduccion_prestamo||0))}</td></tr>
          <tr class="subtotal"><td>SUBTOTAL</td><td class="right">${fmt(Number(r.salario_bruto||0))}</td><td></td></tr>
          <tr class="neto"><td>TOTAL COLABORADOR NETO</td><td></td><td class="right">${fmt(Number(r.monto_pagado||0))}</td></tr>
        </tbody></table>
      </div>
    </body></html>`;

    let puppeteer = null; try { puppeteer = require('puppeteer'); } catch {}
    if (!puppeteer) return res.status(501).send('Generación de PDF no disponible (instale puppeteer)');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=coletilla_${periodo}_${desde}_${hasta}_${idEmpleado}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

// GET /api/planilla-cr/payslip/self-v2 -> version alternativa del comprobante.
exports.payslipSelfV2 = async (req, res, next) => {
  try {
    const periodo = (req.query.periodo || 'Quincenal');
    const desde = toISODate(req.query.desde);
    const hasta = toISODate(req.query.hasta);
    const idEmpleado = Number(req.user?.sub || 0);
    if (!idEmpleado) { const e = new Error('No autenticado'); e.status = 401; throw e; }
    if (!desde || !hasta) { const e = new Error('Parámetros de fecha inválidos'); e.status = 400; throw e; }

    const pool = await getPool();
    const ps = pool.request()
      .input('periodo', sql.VarChar(20), String(periodo).toLowerCase())
      .input('desde', sql.Date, desde)
      .input('hasta', sql.Date, hasta)
      .input('idEmpleado', sql.Int, idEmpleado);

    const q = await ps.query(`
      SELECT p.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
             pu.nombre_puesto, pu.salario_base
      FROM dbo.Planillas p
      JOIN dbo.Empleados e ON e.idEmpleado = p.idEmpleado
      JOIN dbo.Puestos pu ON pu.idPuesto = e.idPuesto
      WHERE CAST(p.fecha_inicio AS date) = @desde
        AND CAST(p.fecha_fin   AS date) = @hasta
        AND p.periodo = @periodo
        AND p.idEmpleado = @idEmpleado;
    `);

    if (!q.recordset || q.recordset.length === 0) { const e = new Error('No se encontró planilla para el período'); e.status = 404; throw e; }

    const r = q.recordset[0];
    const fmt = (n) => (Number(n||0)).toLocaleString('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 });
    const num = (n, d=2) => (Number(n||0)).toLocaleString('es-CR', { minimumFractionDigits:d, maximumFractionDigits:d });
    const heMonto = Number(r.horas_extras_monto || r.monto_horas_extras || 0);
    const snapshot = readSnapshot(periodo, desde, hasta) || null;
    const horasMes = Number(snapshot?.params?.horas_mes || 192);
    const tasaHE = Number(snapshot?.params?.tasa_he || 1.5);
    const valorHora = (Number(r.salario_base||0) / (horasMes || 1));
    const valorHoraOrd = valorHora;
    const valorHoraExt = valorHora * tasaHE;
    const valorHoraDob = valorHora * 2;
    const horasOrdinarias = valorHora > 0 ? (Number(r.monto_horas_ordinarias||0) / valorHora) : 0;
    const totalBruto = Number(r.salario_bruto||0);
    const totalDedu = Number(r.deduccion_ccss||0) + Number(r.deduccion_bancopopular||0) + Number(r.deduccion_renta||0) + Number(r.deduccion_prestamo||0);
    const neto = Number(r.monto_pagado||0);
    const compName = 'Alquileres Segura S.A.';
    const periodTitle = `Comprobante de pago de la planilla: Del ${new Date(desde).toLocaleDateString('es-CR')} al ${new Date(hasta).toLocaleDateString('es-CR')}`;

    const css = `
      <style>
        @page { margin: 12mm }
        body{ font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#111 }
        .sheet{ border:2px solid #3556a8; padding:8px }
        .hdr{ text-align:center; margin:4px 0 6px 0 }
        .hdr .company{ font-size:16px; font-weight:700; }
        .hdr .title{ font-size:12px; margin-top:2px }
        .emp-name{ border:1px solid #3556a8; padding:6px; color:#1756c5; font-weight:700; text-align:center; margin-bottom:6px }
        table.box{ width:100%; border-collapse:collapse; }
        table.box th, table.box td{ border:1px solid #999; padding:6px 8px; }
        table.box thead th{ background:#f1f3f8; font-weight:700 }
        .sec{ background:#111; color:#fff; text-align:center; letter-spacing:1px; font-weight:700 }
        .label{ width:60% }
        .amount{ width:20%; text-align:right }
        .saldo{ width:20%; text-align:right }
        .total-row td{ font-weight:700; background:#f7f7fb }
        .neto-bar{ margin-top:8px; border:1px solid #3556a8 }
        .neto-bar .lbl{ background:#dfe8ff; font-weight:700; padding:8px }
        .neto-bar .val{ text-align:right; font-weight:800; padding:8px }
        .comments{ margin-top:8px }
        .muted{ color:#666 }
      </style>
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>
      <div class="sheet">
        <div class="hdr">
          <div class="company">${compName}</div>
          <div class="title">${periodTitle}</div>
        </div>
        <div class="emp-name">${r.nombre}</div>

        <table class="box">
          <thead>
            <tr><th class="label">Descripción</th><th class="amount">Monto</th><th class="saldo">Saldo</th></tr>
          </thead>
          <tbody>
            <tr><td class="sec" colspan="3">V A L O R _ P O R _ H O R A</td></tr>
            <tr><td>VALOR HORA ORDINARIA:</td><td class="amount">${num(valorHoraOrd)}</td><td class="saldo"></td></tr>
            <tr><td>VALOR HORA EXTRAORDINARIA:</td><td class="amount">${num(valorHoraExt)}</td><td class="saldo"></td></tr>
            <tr><td>VALOR HORA DOBLE:</td><td class="amount">${num(valorHoraDob)}</td><td class="saldo"></td></tr>

            <tr><td class="sec" colspan="3">I N G R E S O S</td></tr>
            <tr><td>Horas Ordinarias Laboradas: ${num(horasOrdinarias, 2)}</td><td class="amount">${fmt(Number(r.monto_horas_ordinarias||0))}</td><td class="saldo"></td></tr>
            ${heMonto>0 ? `<tr><td>Horas Extra</td><td class="amount">${fmt(heMonto)}</td><td class="saldo"></td></tr>` : ''}
            ${(Number(r.monto_bono||0)>0)? `<tr><td>Bonos / Vacaciones</td><td class="amount">${fmt(Number(r.monto_bono||0))}</td><td class="saldo"></td></tr>`:''}
            <tr class="total-row"><td>TOTAL BRUTO</td><td class="amount">${fmt(totalBruto)}</td><td class="saldo"></td></tr>

            <tr><td class="sec" colspan="3">D E D U C C I O N E S</td></tr>
            <tr><td><strong>01 - Rebajos de ley</strong></td><td class="amount"></td><td class="saldo"></td></tr>
            <tr><td>CCSS</td><td class="amount">${fmt(Number(r.deduccion_ccss||0))}</td><td class="saldo"></td></tr>
            <tr><td>BANCO POPULAR</td><td class="amount">${fmt(Number(r.deduccion_bancopopular||0))}</td><td class="saldo"></td></tr>
            ${Number(r.deduccion_renta||0)>0 ? `<tr><td>IMPUESTO RENTA</td><td class="amount">${fmt(Number(r.deduccion_renta||0))}</td><td class="saldo"></td></tr>`:''}
            ${Number(r.deduccion_prestamo||0)>0 ? `<tr><td>OTROS (PRÉSTAMO)</td><td class="amount">${fmt(Number(r.deduccion_prestamo||0))}</td><td class="saldo"></td></tr>`:''}
            <tr class="total-row"><td>TOTAL DEDUCCIONES</td><td class="amount">${fmt(totalDedu)}</td><td class="saldo"></td></tr>
          </tbody>
        </table>

        <table class="neto-bar" style="width:100%; border-collapse:collapse;"><tr>
          <td class="lbl" style="width:70%">TOTAL NETO A PAGAR:</td>
          <td class="val" style="width:30%">${fmt(neto)}</td>
        </tr></table>

        <div class="comments">
          <div class="muted">Comentarios:</div>
          <div class="muted">${[r.incapacidades?`Incapacidades: ${r.incapacidades}`:null, r.vacaciones?`Vacaciones: ${r.vacaciones}`:null].filter(Boolean).join(' | ') || '—'}</div>
        </div>
      </div>
    </body></html>`;

    let puppeteer = null; try { puppeteer = require('puppeteer'); } catch {}
    if (!puppeteer) return res.status(501).send('Generación de PDF no disponible (instale puppeteer)');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=coletilla_${periodo}_${desde}_${hasta}_${idEmpleado}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};
