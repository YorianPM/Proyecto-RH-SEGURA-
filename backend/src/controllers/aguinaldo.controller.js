const { sql, getPool } = require('../db');
// Controlador de aguinaldo: calcula previos y genera registros oficiales.

// Redondea a dos decimales asegurando Number-safe.
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

// Normaliza cualquier fecha en formato ISO YYYY-MM-DD.
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
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Retorna el periodo legal de cálculo (dic-anio-1 a nov-anio).
function periodoPorAnio(anioParam) {
  const anio = Number(anioParam || new Date().getFullYear());
  const desde = `${anio - 1}-12-01`;
  const hasta = `${anio}-11-30`;
  return { anio, desde, hasta };
}

// Traduce numero de mes a llave de objeto en español.
const MES_NOMBRE = { 1: 'enero', 2: 'febrero', 3: 'marzo', 4: 'abril', 5: 'mayo', 6: 'junio', 7: 'julio', 8: 'agosto', 9: 'septiembre', 10: 'octubre', 11: 'noviembre', 12: 'diciembre' };
const MESES_LISTA = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function fetchAguinaldoEmpleado({ pool, anio, empleadoId }) {
  const ps = pool.request()
    .input('anio', sql.Int, anio)
    .input('idEmpleado', sql.Int, empleadoId);
  const { recordset } = await ps.query(`
    SELECT TOP 1 a.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
           pu.nombre_puesto
    FROM dbo.Aguinaldo a
    JOIN dbo.Empleados e ON e.idEmpleado=a.idEmpleado
    JOIN dbo.Puestos pu ON pu.idPuesto=e.idPuesto
    WHERE YEAR(a.fecha_generacion)=@anio AND a.idEmpleado=@idEmpleado
    ORDER BY a.fecha_generacion DESC, a.idAguinaldo DESC;
  `);
  return (recordset && recordset.length > 0) ? recordset[0] : null;
}

async function fetchAguinaldosPersistidos({ pool, anio }) {
  const ps = pool.request().input('anio', sql.Int, anio);
  const { recordset } = await ps.query(`
    SELECT a.*, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
           pu.nombre_puesto
    FROM dbo.Aguinaldo a
    JOIN dbo.Empleados e ON e.idEmpleado=a.idEmpleado
    JOIN dbo.Puestos pu ON pu.idPuesto=e.idPuesto
    WHERE YEAR(a.fecha_generacion)=@anio
    ORDER BY a.idAguinaldo ASC;
  `);
  return recordset || [];
}

function mapEmpleadoDetalle(row, anio) {
  if (!row) return null;
  const meses = {};
  for (const mes of MESES_LISTA) {
    meses[mes] = round2(row[mes] || 0);
  }
  const totalDev = round2(MESES_LISTA.reduce((acc, mes) => acc + Number(meses[mes] || 0), 0));
  const meta = periodoPorAnio(anio);
  return {
    detalle: {
      idAguinaldo: row.idAguinaldo,
      idEmpleado: row.idEmpleado,
      nombre: row.nombre,
      nombre_puesto: row.nombre_puesto,
      fecha_generacion: row.fecha_generacion,
      monto_total_pagado: round2(row.monto_total_pagado || 0),
      total_devengado: totalDev,
      meses,
    },
    meta,
  };
}
// Ejecuta la agregacion principal usando planillas del periodo.
async function calcularAguinaldos({ pool, desde, hasta, anio }) {
  const ps = pool.request()
    .input('desde', sql.Date, toISODate(desde))
    .input('hasta', sql.Date, toISODate(hasta));

  // Agrupar por empleado y mes calendario tomando salario_bruto (ingresos ordinarios + extraordinarios)
  const q = await ps.query(`
    SELECT p.idEmpleado,
           YEAR(p.fecha_fin) AS y,
           MONTH(p.fecha_fin) AS m,
           SUM(CAST(p.salario_bruto AS DECIMAL(12,2))) AS total_mes
    FROM dbo.Planillas p
    WHERE CAST(p.fecha_fin AS date) >= @desde AND CAST(p.fecha_fin AS date) <= @hasta
    GROUP BY p.idEmpleado, YEAR(p.fecha_fin), MONTH(p.fecha_fin)
  `);
  const rows = q.recordset || [];

  // Listado de empleados involucrados y nombres
  const empIds = Array.from(new Set(rows.map(r => Number(r.idEmpleado))));
  if (!empIds.length) return { data: [], meta: { desde, hasta, anio, total_empleados: 0 } };

  const empQ = await pool.request().query(`
    SELECT e.idEmpleado, (e.nombre+' '+e.apellido1+' '+ISNULL(e.apellido2,'')) AS nombre,
           p.nombre_puesto, p.salario_base
    FROM dbo.Empleados e
    JOIN dbo.Puestos p ON p.idPuesto=e.idPuesto
    WHERE e.idEmpleado IN (${empIds.map(id => Number(id)).join(',')})
  `);
  const empMap = new Map(empQ.recordset.map(e => [Number(e.idEmpleado), e]));

  const porEmp = new Map();
  for (const r of rows) {
    const id = Number(r.idEmpleado);
    if (!porEmp.has(id)) porEmp.set(id, []);
    porEmp.get(id).push({ y: Number(r.y), m: Number(r.m), total: Number(r.total_mes || 0) });
  }

  const data = [];
  for (const id of porEmp.keys()) {
    const info = empMap.get(id) || { nombre: `#${id}`, nombre_puesto: '', salario_base: 0 };
    const vals = porEmp.get(id);
    const meses = { enero: 0, febrero: 0, marzo: 0, abril: 0, mayo: 0, junio: 0, julio: 0, agosto: 0, septiembre: 0, octubre: 0, noviembre: 0, diciembre: 0 };
    let totalDev = 0;
    for (const v of vals) {
      // Mapeo: diciembre del año ANIO-1 va al campo 'diciembre'. Ene..Nov del año ANIO van a sus campos.
      if (v.y === (anio - 1) && v.m === 12) {
        meses.diciembre = round2(meses.diciembre + v.total);
        totalDev += Number(v.total || 0);
      } else if (v.y === anio && v.m >= 1 && v.m <= 11) {
        const key = MES_NOMBRE[v.m];
        if (key) {
          meses[key] = round2((meses[key] || 0) + v.total);
          totalDev += Number(v.total || 0);
        }
      }
    }
    const monto = round2(totalDev / 12);
    data.push({
      idEmpleado: id,
      nombre: info.nombre,
      puesto: info.nombre_puesto,
      salario_base: Number(info.salario_base || 0),
      ...meses,
      total_devengado: round2(totalDev),
      monto_aguinaldo: monto,
    });
  }

  // Ordenar por nombre
  data.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

  return { data, meta: { desde, hasta, anio, total_empleados: data.length } };
}

// GET /api/aguinaldo/preview?anio=YYYY -> genera el calculo temporal para UI.
exports.preview = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio || new Date().getFullYear());
    const desde = toISODate(req.query.desde) || periodoPorAnio(anio).desde;
    const hasta = toISODate(req.query.hasta) || periodoPorAnio(anio).hasta;
    const pool = await getPool();
    const { data, meta } = await calcularAguinaldos({ pool, desde, hasta, anio });

    // Nota legal resumida para UI
    const nota = {
      ley: 'Ley 2412 Aguinaldo Empresa Privada (CR)',
      regla_general: 'Suma de salarios ordinarios y extraordinarios del 1 Dic año anterior al 30 Nov del año en curso, dividido entre 12.',
      deducciones: 'No se aplican cargas sociales ni impuesto de renta; solo pueden aplicarse rebajos por pensión alimentaria conforme a ley.'
    };

    res.json({ ok: true, data, meta, nota });
  } catch (e) { next(e); }
};

// POST /api/aguinaldo/generar { anio } -> persiste/actualiza registros oficiales por empleado.
exports.generar = async (req, res, next) => {
  const txItems = [];
  try {
    const anio = Number(req.body?.anio || new Date().getFullYear());
    const { desde, hasta } = periodoPorAnio(anio);
    const pool = await getPool();

    // Verificar si ya existe un aguinaldo generado para este año.
    const existsQ = await pool.request().input('anio', sql.Int, anio).query(`
      SELECT COUNT(1) AS total FROM dbo.Aguinaldo WHERE YEAR(fecha_generacion) = @anio;
    `);
    const total = Number(existsQ.recordset?.[0]?.total || 0);
    if (total > 0) {
      const err = new Error('El aguinaldo de este año ya fue generado.');
      err.status = 409;
      throw err;
    }

    const { data } = await calcularAguinaldos({ pool, desde, hasta, anio });

    const now = new Date();
    const fecha = now; // Date instance, sent as Date to SQL input

    for (const r of data) {
      const psSel = pool.request()
        .input('idEmpleado', sql.Int, Number(r.idEmpleado))
        .input('anio', sql.Int, anio);
      const sel = await psSel.query(`
        SELECT TOP 1 idAguinaldo FROM dbo.Aguinaldo
        WHERE idEmpleado=@idEmpleado AND YEAR(fecha_generacion)=@anio
        ORDER BY idAguinaldo DESC;
      `);
      const exists = sel.recordset && sel.recordset.length > 0;

      const ps = pool.request()
        .input('fecha_generacion', sql.DateTime, fecha)
        .input('monto_total_pagado', sql.Decimal(12, 2), round2(r.monto_aguinaldo))
        .input('idEmpleado', sql.Int, Number(r.idEmpleado))
        .input('enero', sql.Decimal(12, 2), round2(r.enero || 0))
        .input('febrero', sql.Decimal(12, 2), round2(r.febrero || 0))
        .input('marzo', sql.Decimal(12, 2), round2(r.marzo || 0))
        .input('abril', sql.Decimal(12, 2), round2(r.abril || 0))
        .input('mayo', sql.Decimal(12, 2), round2(r.mayo || 0))
        .input('junio', sql.Decimal(12, 2), round2(r.junio || 0))
        .input('julio', sql.Decimal(12, 2), round2(r.julio || 0))
        .input('agosto', sql.Decimal(12, 2), round2(r.agosto || 0))
        .input('septiembre', sql.Decimal(12, 2), round2(r.septiembre || 0))
        .input('octubre', sql.Decimal(12, 2), round2(r.octubre || 0))
        .input('noviembre', sql.Decimal(12, 2), round2(r.noviembre || 0))
        .input('diciembre', sql.Decimal(12, 2), round2(r.diciembre || 0));

      if (exists) {
        const id = Number(sel.recordset[0].idAguinaldo);
        await ps.input('id', sql.Int, id).query(`
          UPDATE dbo.Aguinaldo
          SET fecha_generacion=@fecha_generacion,
              monto_total_pagado=@monto_total_pagado,
              enero=@enero, febrero=@febrero, marzo=@marzo, abril=@abril, mayo=@mayo, junio=@junio,
              julio=@julio, agosto=@agosto, septiembre=@septiembre, octubre=@octubre, noviembre=@noviembre, diciembre=@diciembre
          WHERE idAguinaldo=@id;
        `);
        txItems.push({ action: 'update', idAguinaldo: id, idEmpleado: r.idEmpleado });
      } else {
        const ins = await ps.query(`
          INSERT INTO dbo.Aguinaldo (
            fecha_generacion, monto_total_pagado, idEmpleado,
            enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre
          ) VALUES (
            @fecha_generacion, @monto_total_pagado, @idEmpleado,
            @enero, @febrero, @marzo, @abril, @mayo, @junio, @julio, @agosto, @septiembre, @octubre, @noviembre, @diciembre
          );
          SELECT SCOPE_IDENTITY() AS idAguinaldo;
        `);
        const id = Number(ins.recordset?.[0]?.idAguinaldo || 0);
        txItems.push({ action: 'insert', idAguinaldo: id, idEmpleado: r.idEmpleado });
      }
    }

    res.json({ ok: true, count: data.length, ops: txItems });
  } catch (e) { next(e); }
};

// GET /api/aguinaldo?anio=YYYY -> lista lo generado en un año.
exports.list = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio || new Date().getFullYear());
    const pool = await getPool();
    const data = await fetchAguinaldosPersistidos({ pool, anio });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// GET /api/aguinaldo/mio?anio=YYYY -> devuelve el registro calculado del empleado autenticado.
exports.mine = async (req, res, next) => {
  try {
    const empleadoId = Number(req.user?.sub || 0);
    if (!empleadoId) {
      const e = new Error('Empleado no asociado al usuario autenticado'); e.status = 400; throw e;
    }
    const anio = Number(req.query.anio || new Date().getFullYear());
    const pool = await getPool();
    const row = await fetchAguinaldoEmpleado({ pool, anio, empleadoId });
    if (!row) {
      return res.status(404).json({ ok: false, message: 'Aún no hay un aguinaldo generado para este año.' });
    }
    const mapped = mapEmpleadoDetalle(row, anio);
    res.json({ ok: true, data: mapped.detalle, meta: mapped.meta });
  } catch (e) { next(e); }
};

function aguinaldoPdfTemplate({ detalle, meta, nota }) {
  const fmt = (n) => Number(n || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const monthHeader = MESES_LISTA.map((m) => `<th>${cap(m)}</th>`).join('');
  const monthCells = MESES_LISTA.map((m) => `<td class="right">${fmt(detalle.meses?.[m] || 0)}</td>`).join('');
  const css = `
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 12mm; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; margin-top: 0; color: #444; }
      .summary { margin: 10px 0; display: flex; flex-wrap: wrap; gap: 12px; }
      .summary .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; min-width: 200px; }
      .summary .label { text-transform: uppercase; font-size: 10px; color: #666; margin-bottom: 4px; }
      .summary .value { font-size: 16px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #bbb; padding: 6px 8px; font-size: 11px; }
      th { background: #f6f6f6; text-align: center; }
      .right { text-align: right; }
      .note { font-size: 10px; color: #555; margin-top: 12px; }
    </style>
  `;
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        ${css}
      </head>
      <body>
        <h1>RH Segura</h1>
        <h2>Aguinaldo ${meta?.anio || ''} - ${detalle.nombre}</h2>
        <div>Periodo legal: ${meta?.desde || '-'} al ${meta?.hasta || '-'}</div>
        <div class="summary">
          <div class="card">
            <div class="label">Monto a recibir</div>
            <div class="value">${fmt(detalle.monto_total_pagado)}</div>
          </div>
          <div class="card">
            <div class="label">Total devengado</div>
            <div class="value">${fmt(detalle.total_devengado)}</div>
          </div>
          <div class="card">
            <div class="label">Generado</div>
            <div class="value">${detalle.fecha_generacion ? new Date(detalle.fecha_generacion).toLocaleDateString('es-CR') : '-'}</div>
          </div>
          <div class="card">
            <div class="label">Puesto</div>
            <div class="value" style="font-size:13px;">${detalle.nombre_puesto || '-'}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>${monthHeader}<th>Total devengado</th><th>Aguinaldo</th></tr>
          </thead>
          <tbody>
            <tr>${monthCells}<td class="right">${fmt(detalle.total_devengado)}</td><td class="right">${fmt(detalle.monto_total_pagado)}</td></tr>
          </tbody>
        </table>
        <div class="note">
          ${nota || 'El aguinaldo corresponde al promedio de salarios ordinarios y extraordinarios devengados entre el 1° de diciembre del año anterior y el 30 de noviembre del año vigente, sin deducciones adicionales.'}
        </div>
      </body>
    </html>
  `;
  return html;
}

function aguinaldoAdminPdfTemplate({ registros, meta }) {
  const fmt = (n) => Number(n || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const headerMonths = MESES_LISTA.map((m) => `<th>${cap(m)}</th>`).join('');
  const rowsHtml = registros.map((r) => {
    const monthCells = MESES_LISTA.map((m) => `<td class="right">${fmt(r[m] || 0)}</td>`).join('');
    return `
      <tr>
        <td>${r.nombre}</td>
        <td>${r.nombre_puesto || '-'}</td>
        ${monthCells}
        <td class="right">${fmt(r.monto_total_pagado)}</td>
        <td>${r.fecha_generacion ? new Date(r.fecha_generacion).toLocaleDateString('es-CR') : '-'}</td>
      </tr>
    `;
  }).join('');
  const css = `
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 12mm; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; margin: 0 0 8px 0; color: #444; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 5px 6px; font-size: 10px; }
      th { background: #f5f5f5; }
      .right { text-align: right; white-space: nowrap; }
    </style>
  `;
  return `
    <!doctype html>
    <html>
      <head><meta charset="utf-8" />${css}</head>
      <body>
        <h1>RH Segura</h1>
        <h2>Aguinaldos generados ${meta?.anio || ''}</h2>
        <div>Periodo legal: ${meta?.desde || '-'} al ${meta?.hasta || '-'}</div>
        <table>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Puesto</th>
              ${headerMonths}
              <th>Aguinaldo pagado</th>
              <th>Generado</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

// GET /api/aguinaldo/mio/pdf?anio=YYYY -> descarga PDF personal del aguinaldo.
exports.minePdf = async (req, res, next) => {
  try {
    const empleadoId = Number(req.user?.sub || 0);
    if (!empleadoId) {
      const e = new Error('Empleado no asociado al usuario autenticado'); e.status = 400; throw e;
    }
    const anio = Number(req.query.anio || new Date().getFullYear());
    const pool = await getPool();
    const row = await fetchAguinaldoEmpleado({ pool, anio, empleadoId });
    if (!row) {
      const e = new Error('Aún no hay un aguinaldo generado para este año.'); e.status = 404; throw e;
    }

    const mapped = mapEmpleadoDetalle(row, anio);
    const html = aguinaldoPdfTemplate({ detalle: { ...mapped.detalle, nombre_puesto: row.nombre_puesto }, meta: mapped.meta });

    let puppeteer = null;
    try { puppeteer = require('puppeteer'); } catch {}
    if (!puppeteer) {
      const e = new Error('Generación de PDF no disponible (instale puppeteer)'); e.status = 501; throw e;
    }
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=aguinaldo_${anio}_${empleadoId}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

// GET /api/aguinaldo/pdf?anio=YYYY -> PDF consolidado para RH.
exports.listPdf = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio || new Date().getFullYear());
    const pool = await getPool();
    const registros = await fetchAguinaldosPersistidos({ pool, anio });
    if (!registros.length) {
      const e = new Error('No hay aguinaldos generados para este año.'); e.status = 404; throw e;
    }
    const html = aguinaldoAdminPdfTemplate({ registros, meta: periodoPorAnio(anio) });
    let puppeteer = null;
    try { puppeteer = require('puppeteer'); } catch {}
    if (!puppeteer) { const e = new Error('Generación de PDF no disponible (instale puppeteer)'); e.status = 501; throw e; }
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=aguinaldo_${anio}_persistidos.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

