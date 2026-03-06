const { sql, getPool } = require('../db');
const path = require('path');
let puppeteer;
const fs = require('fs');
// Controlador de liquidaciones: altas manuales, cálculos proporcionales y PDF.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(n){ return Math.round(Number(n||0)*100)/100; }

// Convierte a Date sin hora.
function toDateOnly(value){
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return null;
  d.setHours(0,0,0,0);
  return d;
}

// Diferencia de dias incluyendo ambos extremos.
function diffDaysInclusive(start, end){
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  const s = start.getTime();
  const e = end.getTime();
  if (!isFinite(s) || !isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / MS_PER_DAY) + 1;
}

// POST /api/liquidaciones -> inserta liquidacion y evita duplicados.
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const fecha = body.fecha ? new Date(body.fecha) : new Date();
    const pago_vacaciones = round2(body.pago_vacaciones);
    const idEmpleado = Number(body.idEmpleado);
    const aguinaldo = round2(body.aguinaldo);
    const preaviso = round2(body.preaviso);
    const cesantia = round2(body.cesantia);
    const monto_total = round2(body.monto_total);
    const fecha_ingreso = body.fecha_ingreso ? new Date(body.fecha_ingreso) : null;

    if (!idEmpleado) { const e=new Error('Falta idEmpleado'); e.status=400; throw e; }

    const pool = await getPool();

    // No permitir liquidar 2 veces al mismo empleado
    const existQ = await pool.request()
      .input('idEmpleado', sql.Int, idEmpleado)
      .query(`SELECT TOP 1 idLiquidacion, fecha FROM dbo.Liquidaciones WHERE idEmpleado=@idEmpleado ORDER BY idLiquidacion DESC;`);
    if (existQ.recordset && existQ.recordset.length) {
      const e = new Error('Este empleado ya fue liquidado previamente.');
      e.status = 409;
      throw e;
    }
    const ps = pool.request()
      .input('fecha', sql.Date, fecha)
      .input('pago_vacaciones', sql.Decimal(12,2), pago_vacaciones)
      .input('idEmpleado', sql.Int, idEmpleado)
      .input('aguinaldo', sql.Decimal(12,2), aguinaldo)
      .input('preaviso', sql.Decimal(12,2), preaviso)
      .input('cesantia', sql.Decimal(12,2), cesantia)
      .input('monto_total', sql.Decimal(12,2), monto_total)
      .input('fecha_ingreso', sql.Date, fecha_ingreso);

    const r = await ps.query(`
      INSERT INTO dbo.Liquidaciones (
        fecha, pago_vacaciones, idEmpleado, aguinaldo, preaviso, cesantia, monto_total, fecha_ingreso
      ) VALUES (
        @fecha, @pago_vacaciones, @idEmpleado, @aguinaldo, @preaviso, @cesantia, @monto_total, @fecha_ingreso
      );
      SELECT SCOPE_IDENTITY() AS idLiquidacion;
    `);

    const id = Number(r.recordset?.[0]?.idLiquidacion || 0);
    res.status(201).json({ ok:true, id });
  } catch (e) { next(e); }
};

// GET /api/liquidaciones -> lista ultimas liquidaciones (filtra por empleado).
exports.list = async (req, res, next) => {
  try {
    const idEmpleado = req.query.idEmpleado ? Number(req.query.idEmpleado) : null;
    const pool = await getPool();
    const base = `
      SELECT TOP 100 L.*, (E.nombre+' '+E.apellido1+' '+ISNULL(E.apellido2,'')) AS nombre,
             P.nombre_puesto
      FROM dbo.Liquidaciones L
      JOIN dbo.Empleados E ON E.idEmpleado=L.idEmpleado
      JOIN dbo.Puestos P ON P.idPuesto=E.idPuesto
    `;
    let sqlText = base;
    const ps = pool.request();
    if (idEmpleado) { sqlText += ` WHERE L.idEmpleado=@idEmpleado`; ps.input('idEmpleado', sql.Int, idEmpleado); }
    sqlText += ` ORDER BY L.idLiquidacion DESC;`;
    const r = await ps.query(sqlText);
    res.json({ ok:true, data: r.recordset || [] });
  } catch (e) { next(e); }
};

// POST /api/liquidaciones/aguinaldo-proporcional -> calcula aguinaldo proporcional a la fecha de salida.
exports.aguinaldoProporcionalEmpleado = async (req, res, next) => {
  try {
    const idEmpleado = Number(req.body?.idEmpleado);
    const fechaSalida = toDateOnly(req.body?.fecha_salida ? new Date(req.body.fecha_salida) : new Date());
    if (!idEmpleado) { const e=new Error('Falta idEmpleado'); e.status=400; throw e; }
    if (!fechaSalida) { const e=new Error('fecha_salida inválida'); e.status=400; throw e; }

    const anio = fechaSalida.getFullYear();
    const desde = toDateOnly(new Date(anio - 1, 11, 1)); // 1 Dic del año anterior
    const hasta = fechaSalida; // periodo legal solicitado: hasta la fecha de salida

    const pool = await getPool();

    const empQ = await pool.request()
      .input('id', sql.Int, idEmpleado)
      .query(`
        SELECT e.fecha_ingreso, p.salario_base
        FROM dbo.Empleados e
        JOIN dbo.Puestos p ON p.idPuesto=e.idPuesto
        WHERE e.idEmpleado=@id;
      `);
    if (!empQ.recordset?.length) {
      const e = new Error('Empleado no encontrado');
      e.status = 404;
      throw e;
    }
    const empleado = empQ.recordset[0];
    const fechaIngreso = toDateOnly(empleado.fecha_ingreso);
    const salarioMensual = Number(empleado.salario_base || 0);

    const inicioPeriodo = fechaIngreso && fechaIngreso > desde ? fechaIngreso : desde;
    const diasTrabajados = diffDaysInclusive(inicioPeriodo, hasta);
    const diasPeriodo = diffDaysInclusive(desde, hasta);

    const ps = pool.request()
      .input('id', sql.Int, idEmpleado)
      .input('desde', sql.Date, desde)
      .input('hasta', sql.Date, hasta);
    const q = await ps.query(`
      SELECT SUM(CAST(p.salario_bruto AS DECIMAL(14,2))) AS suma
      FROM dbo.Planillas p
      WHERE p.idEmpleado=@id AND CAST(p.fecha_fin AS date) >= @desde AND CAST(p.fecha_fin AS date) <= @hasta;
    `);

    let devengado = Number(q.recordset?.[0]?.suma || 0);
    let aguinaldo = 0;
    let metodo = 'planillas';

    if (devengado > 0) {
      aguinaldo = round2(devengado / 12);
    } else if (salarioMensual > 0 && diasTrabajados > 0) {
      metodo = 'estimado';
      // Ajuste equivalente a salario mensual * días trabajados / 365
      const estimado = salarioMensual * (diasTrabajados * 12 / 365);
      devengado = round2(estimado);
      aguinaldo = round2(devengado / 12);
    } else {
      devengado = 0;
      aguinaldo = 0;
      metodo = 'sin-datos';
    }

    res.json({
      ok:true,
      desde: desde?.toISOString().slice(0,10),
      hasta: hasta?.toISOString().slice(0,10),
      devengado,
      aguinaldo,
      dias_trabajados: diasTrabajados,
      dias_periodo: diasPeriodo,
      metodo,
    });
  } catch (e) { next(e); }
};

// POST /api/liquidaciones/pdf -> genera PDF del desglose usando puppeteer.
exports.pdf = async (req, res, next) => {
  try {
    const body = req.body || {};
    const desg = body.desglose || body; // admite directamente el objeto resultado
    const empleado = body.empleado || {};

    if (!desg || typeof desg !== 'object') { const e=new Error('Falta desglose'); e.status=400; throw e; }

    const safe = (n)=> (isFinite(Number(n))? Number(n): 0);
    const fmt = (n)=> (new Intl.NumberFormat('es-CR',{ style:'currency', currency:'CRC', maximumFractionDigits:2 }).format(safe(n)));

    const nombreEmp = String(empleado.nombre || '') + (empleado.apellido1? (' '+empleado.apellido1):'') + (empleado.apellido2? (' '+empleado.apellido2):'');
    const ahora = new Date();
    const ymd = ahora.toISOString().slice(0,10);

    const rows = [
      { label:'Vacaciones pendientes', value:`${desg.vacPend ?? 0} días → ${fmt(desg.pagoVac)}` },
      { label:'Aguinaldo proporcional', value: fmt(desg.aguinaldo) },
    ];
    if (desg.aplicaPreaviso && safe(desg.preaviso) > 0) rows.push({ label:`Preaviso (${safe(desg.preavisoDias)} días)`, value: fmt(desg.preaviso) });
    if (desg.aplicaCesantia && safe(desg.cesantia) > 0) rows.push({ label:`Cesantía (${Number(desg.cesantiaDias).toFixed(2)} días)`, value: fmt(desg.cesantia) });
    rows.push({ label:'Deducciones', value:`- ${fmt(desg.deducciones||0)}` });

    const totalStr = fmt(desg.total || 0);

    // Preparar HTML alternativo con logo y branding RH Segura
    const logoDataUri = (() => {
      try {
        const c = [
          path.join(process.cwd(),'frontend','public','logo-rhsegurasinfondo.png'),
          path.join(process.cwd(),'frontend','public','logo-rhsegura.png'),
        ];
        for (const p of c) {
          if (fs.existsSync(p)) { const b = fs.readFileSync(p); return `data:image/png;base64,${b.toString('base64')}`; }
        }
      } catch {}
      return null;
    })();

    const html2 = `<!doctype html>
    <html lang="es"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Liquidacion - Desglose</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111; margin:32px; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
        .brandline { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
        .logo { height:38px; }
        .company { font-weight:700; font-size:14px; }
        .title { font-size:20px; font-weight:700; }
        .sub { color:#555; font-size:12px; }
        .box { border:1px solid #ddd; border-radius:8px; padding:16px; }
        .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #e4e4e4; }
        .row:last-child { border-bottom:0; }
        .lbl { color:#333; }
        .val { font-variant-numeric: tabular-nums; }
        .total { display:flex; justify-content:space-between; padding:12px 0; margin-top:8px; border-top:2px solid #000; font-weight:700; font-size:16px; }
        .meta { margin:8px 0 16px 0; font-size:12px; color:#444; }
      </style>
    </head><body>
      <div class="header">
        <div>
          <div class="brandline">
            ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : ''}
            <div>
              <div class="company">RH Segura</div>
              <div class="sub">Alquileres Segura - RRHH</div>
            </div>
          </div>
          <div class="title">Desglose de liquidacion</div>
          <div class="sub">Fecha emision: ${ymd}</div>
        </div>
        <div class="sub" style="text-align:right">
          ${empleado?.idEmpleado ? ('Empleado #'+empleado.idEmpleado) : ''}<br/>
          ${nombreEmp || ''}
        </div>
      </div>
      <div class="meta"><strong>Documento emitido por RH Segura</strong></div>
      <div class="meta">
        ${desg.fechaIngreso ? ('Ingreso: '+desg.fechaIngreso) : ''}
        ${desg.fechaSalida ? (' | Salida: '+desg.fechaSalida) : ''}
      </div>
      <div class="box">
        ${rows.map(r=>`<div class="row"><div class="lbl">${r.label}</div><div class="val">${r.value}</div></div>`).join('')}
        <div class="total"><div>Total a pagar</div><div>${totalStr}</div></div>
      </div>
    </body></html>`;

    // HTML minimalista (solo desglose)
    const html = `<!doctype html>
    <html lang="es"><head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Liquidación – Desglose</title>
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111; margin:32px; }
        .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
        .title { font-size:20px; font-weight:700; }
        .sub { color:#555; font-size:12px; }
        .box { border:1px solid #ddd; border-radius:8px; padding:16px; }
        .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #e4e4e4; }
        .row:last-child { border-bottom:0; }
        .lbl { color:#333; }
        .val { font-variant-numeric: tabular-nums; }
        .total { display:flex; justify-content:space-between; padding:12px 0; margin-top:8px; border-top:2px solid #000; font-weight:700; font-size:16px; }
        .meta { margin:8px 0 16px 0; font-size:12px; color:#444; }
      </style>
    </head><body>
      <div class="header">
        <div>
          <div class="title">Desglose de liquidación</div>
          <div class="sub">Fecha emisión: ${ymd}</div>
        </div>
        <div class="sub" style="text-align:right">
          ${empleado?.idEmpleado ? ('Empleado #'+empleado.idEmpleado) : ''}<br/>
          ${nombreEmp || ''}
        </div>
      </div>
      <div class="meta">
        ${desg.fechaIngreso ? ('Ingreso: '+desg.fechaIngreso) : ''}
        ${desg.fechaSalida ? (' | Salida: '+desg.fechaSalida) : ''}
      </div>
      <div class="box">
        ${rows.map(r=>`<div class="row"><div class="lbl">${r.label}</div><div class="val">${r.value}</div></div>`).join('')}
        <div class="total"><div>Total a pagar</div><div>${totalStr}</div></div>
      </div>
    </body></html>`;

    if (!puppeteer) puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html2 || html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format:'A4', printBackground:true, margin: { top:'16mm', right:'14mm', bottom:'16mm', left:'14mm' } });
      await page.close();
      res.setHeader('Content-Type', 'application/pdf');
      const fileName = `Liquidacion_${empleado?.idEmpleado||'empleado'}_${ymd}.pdf`;
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(pdf);
    } finally {
      await browser.close();
    }
  } catch (e) { next(e); }
};
