const { sql, getPool } = require('../db');
// Controlador de asistencia: calcula marcas, res?menes y operaciones relacionadas.
const { esFeriadoCR } = require('../utils/feriadosCR');

const JORNADA_DIURNA_HORAS = 8; // estándar CR: 8h diarias, 48h semanales
const HORAS_META_SEMANAL = 48;
const HORAS_META_QUINCENAL = HORAS_META_SEMANAL * 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function isRhUser(user) {
  return user?.idRol === 3 || !!user?.perms?.asistencia_ver_RH;
}

function canMark(user) {
  return isRhUser(user) || !!user?.perms?.asistencia_marcar_EMPLEADO;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error('Fecha inv\u00e1lida'), { status: 400 });
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeTime(value) {
  const now = new Date();
  if (!value) {
    return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }
  if (value instanceof Date) {
    return value.toISOString().substring(11, 19);
  }
  const raw = String(value).trim();
  const isoMatch = raw.match(/(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];
  const match = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, h, m, s] = match;
    return `${pad2(parseInt(h, 10))}:${pad2(parseInt(m, 10))}:${pad2(parseInt(s ?? '0', 10))}`;
  }
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw Object.assign(new Error('Hora inv\u00e1lida'), { status: 400 });
  const hh = Math.min(Math.max(parseInt(parts[0], 10) || now.getHours(), 0), 23);
  const mm = Math.min(Math.max(parseInt(parts[1] ?? now.getMinutes(), 10) || 0, 0), 59);
  const ss = Math.min(Math.max(parseInt(parts[2] ?? now.getSeconds(), 10) || 0, 0), 59);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function combineDateTime(dateISO, timeStr) {
  return new Date(`${dateISO}T${timeStr}`);
}

function getQuincenaRange(fechaISO) {
  const base = new Date(fechaISO);
  if (Number.isNaN(base.getTime())) {
    throw Object.assign(new Error('Fecha inválida'), { status: 400 });
  }
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();
  const primera = day <= 15;
  const inicio = new Date(year, month, primera ? 1 : 16);
  const fin = primera ? new Date(year, month, 15) : new Date(year, month + 1, 0);
  return {
    numero: primera ? 1 : 2,
    label: primera ? 'Primera quincena' : 'Segunda quincena',
    desde: toISODate(inicio),
    hasta: toISODate(fin),
  };
}

function enumerateDays(desdeISO, hastaISO) {
  const start = new Date(desdeISO);
  const end = new Date(hastaISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const days = [];
  for (let ts = start.getTime(); ts <= end.getTime(); ts += MS_PER_DAY) {
    days.push(toISODate(new Date(ts)));
  }
  return days;
}

function isDiaLaborable(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getDay(); // 0 = domingo, 6 = sábado
  if (dow === 0 || dow === 6) return false;
  const feriado = esFeriadoCR(isoDate);
  return !feriado.esFeriado;
}

function getWeekStartISO(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const diff = d.getDay(); // domingo = 0
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

function isEntrada(nombre) {
  const t = String(nombre || '').trim().toLowerCase();
  return t.startsWith('ent');
}

function isSalida(nombre) {
  const t = String(nombre || '').trim().toLowerCase();
  return t.startsWith('sal');
}

async function getTipoById(req, id) {
  const r = await req
    .input('idTipo', sql.Int, id)
    .query(`
      SELECT TOP 1 idTipo_de_Marca AS id, tipo
      FROM dbo.Tipo_de_Marca
      WHERE idTipo_de_Marca = @idTipo;
    `);
  return r.recordset[0] || null;
}

async function getTipoByNombre(req, nombre) {
  const r = await req
    .input('tipoNombre', sql.VarChar(50), String(nombre || '').trim())
    .query(`
      SELECT TOP 1 idTipo_de_Marca AS id, tipo
      FROM dbo.Tipo_de_Marca
      WHERE LOWER(LTRIM(RTRIM(tipo))) = LOWER(LTRIM(RTRIM(@tipoNombre)));
    `);
  return r.recordset[0] || null;
}

async function getHorasExtrasColumns(pool) {
  const r = await pool.request().input('t', sql.VarChar(128), 'Horas_Extras').query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t;
  `);
  return new Set((r.recordset || []).map((row) => String(row.COLUMN_NAME || '').toLowerCase()));
}

async function fetchExtrasByDay(pool, empleadoId, fechaISO) {
  const res = await pool.request()
    .input('emp', sql.Int, empleadoId)
    .input('fec', sql.Date, fechaISO)
    .query(`
      SELECT he.*
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      WHERE c.idEmpleado = @emp AND c.fecha = @fec
      ORDER BY he.idHoras_Extras DESC;
    `);
  return res.recordset || [];
}

function calculateResumenDia(marcas, fechaISO) {
  const rows = Array.isArray(marcas) ? [...marcas] : [];
  if (rows.length < 1) return null;
  const entradaRow = rows.find((m) => isEntrada(m.marca || m.tipo)) || rows[0];
  const salidaRow = [...rows].reverse().find((m) => isSalida(m.marca || m.tipo)) || rows[rows.length - 1];
  if (!entradaRow || !salidaRow || entradaRow === salidaRow) return null;

  const hEntrada = normalizeTime(entradaRow.hora);
  const hSalida = normalizeTime(salidaRow.hora);
  const dtEnt = combineDateTime(fechaISO, hEntrada);
  const dtSal = combineDateTime(fechaISO, hSalida);
  const diffMs = dtSal.getTime() - dtEnt.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) return null;

  const horasBrutas = Math.round((diffMs / 3600000) * 100) / 100;
  const horasNetas = Math.max(0, Math.round((horasBrutas - 1) * 100) / 100);
  const horasOrdinarias = Math.min(horasNetas, 8);
  const horasExtra = Math.max(0, Math.round((horasNetas - 8) * 100) / 100);

  return {
    entrada: hEntrada,
    salida: hSalida,
    horasBrutas,
    horasNetas,
    horasOrdinarias,
    horasExtra,
  };
}

function buildQuincenaResumen(range, rows = [], extrasAprobadasPorDia = new Map()) {
  const dias = enumerateDays(range.desde, range.hasta);
  const rangeStartDate = new Date(range.desde);
  const rangeEndDate = new Date(range.hasta);
  const porDia = new Map();
  rows.forEach((row) => {
    const key = toISODate(row.fecha || row.fechaISO || row.fecha_registro);
    if (!porDia.has(key)) porDia.set(key, []);
    porDia.get(key).push(row);
  });

  const totals = {
    diasCalendario: dias.length,
    diasLaborables: 0,
    diasConRegistro: 0,
    diasAusentes: 0,
    diasFeriados: 0,
    horasBrutas: 0,
    horasNetas: 0,
    horasOrdinarias: 0,
    horasExtras: 0,
    horasAlmuerzo: 0,
  };
  const semanasMap = new Map();

  dias.forEach((diaIso) => {
    const feriado = esFeriadoCR(diaIso);
    if (feriado.esFeriado) totals.diasFeriados += 1;
    const laborable = isDiaLaborable(diaIso);
    if (laborable) totals.diasLaborables += 1;

    const registros = porDia.get(diaIso) || [];
    let resumenDia = null;
    if (registros.length > 0) {
      totals.diasConRegistro += 1;
      resumenDia = calculateResumenDia(registros, diaIso);
      if (resumenDia) {
        totals.horasBrutas += resumenDia.horasBrutas;
        totals.horasNetas += resumenDia.horasNetas;
        totals.horasOrdinarias += resumenDia.horasOrdinarias;
        const almuerzo = Math.max(0, Math.min(1, round2(resumenDia.horasBrutas - resumenDia.horasNetas)));
        totals.horasAlmuerzo += almuerzo;
      }
    } else if (laborable) {
      totals.diasAusentes += 1;
    }

    const horasExtraAprob = extrasAprobadasPorDia.get(diaIso) || 0;
    totals.horasExtras += horasExtraAprob;

    const weekKey = getWeekStartISO(diaIso);
    if (!semanasMap.has(weekKey)) {
      const startDate = new Date(weekKey);
      semanasMap.set(weekKey, {
        start: startDate,
        horasReales: 0,
        diasLaborables: 0,
      });
    }
    const semana = semanasMap.get(weekKey);
    semana.horasReales += resumenDia?.horasNetas || 0;
    if (laborable) semana.diasLaborables += 1;
  });

  const semanas = Array.from(semanasMap.values())
    .map((week) => {
      const desdeDate = new Date(Math.max(week.start.getTime(), rangeStartDate.getTime()));
      const hastaCandidate = new Date(week.start);
      hastaCandidate.setDate(hastaCandidate.getDate() + 6);
      const hastaDate = new Date(Math.min(hastaCandidate.getTime(), rangeEndDate.getTime()));
      const desde = toISODate(desdeDate);
      const hasta = toISODate(hastaDate);
      const meta = Math.min(HORAS_META_SEMANAL, week.diasLaborables * JORNADA_DIURNA_HORAS);
      return {
        desde,
        hasta,
        diasLaborables: week.diasLaborables,
        horasEsperadas: round2(meta),
        horasReales: round2(week.horasReales),
        diferencia: round2(week.horasReales - meta),
      };
    })
    .sort((a, b) => a.desde.localeCompare(b.desde))
    .map((week, index) => ({ numero: index + 1, ...week }));

  const horasEsperadas = HORAS_META_QUINCENAL;
  const horasTrabajadas = round2(totals.horasNetas);
  const horasFaltantes = Math.max(0, round2(horasEsperadas - horasTrabajadas));

  return {
    ...range,
    diasCalendario: totals.diasCalendario,
    diasLaborables: totals.diasLaborables,
    diasConRegistro: totals.diasConRegistro,
    diasAusentes: totals.diasAusentes,
    diasFeriados: totals.diasFeriados,
    horasEsperadas,
    horasTrabajadas,
    horasOrdinarias: round2(totals.horasOrdinarias),
    horasExtras: round2(totals.horasExtras),
    horasBrutas: round2(totals.horasBrutas),
    horasAlmuerzo: round2(totals.horasAlmuerzo),
    horasFaltantes: round2(horasFaltantes),
    horasAusencias: round2(totals.diasAusentes * JORNADA_DIURNA_HORAS),
    cumplimiento: horasEsperadas > 0 ? round2((horasTrabajadas / horasEsperadas) * 100) : 0,
    semanas,
  };
}

// GET /api/asistencia/resumen -> arma dashboard diario/quincenal para un empleado.
exports.getResumen = async (req, res, next) => {
  try {
    if (!req.user) {
      const e = new Error('No autenticado');
      e.status = 401;
      throw e;
    }
    const pool = await getPool();
    const rh = isRhUser(req.user);
    const userId = Number(req.user?.sub || req.user?.idEmpleado);

    let targetId = Number(req.query?.empleado ?? req.query?.idEmpleado ?? userId);
    if (!rh) {
      targetId = userId;
    }
    if (!targetId) {
      const e = new Error('No se pudo determinar el empleado');
      e.status = 400;
      throw e;
    }

    const empleadoQ = await pool.request()
      .input('id', sql.Int, targetId)
      .query(`
        SELECT TOP 1
          idEmpleado,
          cedula,
          nombre,
          apellido1,
          apellido2
        FROM dbo.Empleados
        WHERE idEmpleado = @id;
      `);
    if (!empleadoQ.recordset.length) {
      const e = new Error('Empleado no encontrado');
      e.status = 404;
      throw e;
    }
    const empleado = empleadoQ.recordset[0];

    const fechaISO = toISODate(req.query?.fecha ? new Date(req.query.fecha) : new Date());
    const feriadoInfo = esFeriadoCR(fechaISO);

    const recientesQ = await pool.request()
      .input('emp', sql.Int, targetId)
      .query(`
        SELECT TOP 25
          a.idControlAsistencia,
          a.fecha,
          a.hora,
          a.horas_ordinarias,
          tm.tipo AS marca,
          h.nombre AS horario,
          e.idEmpleado,
          e.cedula,
          (e.nombre + ' ' + e.apellido1 + COALESCE(' ' + e.apellido2, '')) AS empleado
        FROM dbo.Control_de_Asistencia a
        JOIN dbo.Tipo_de_Marca tm ON tm.idTipo_de_Marca = a.idTipo_de_Marca
        JOIN dbo.Horarios h       ON h.idHorario = a.idHorario
        JOIN dbo.Empleados e      ON e.idEmpleado = a.idEmpleado
        WHERE a.idEmpleado = @emp
        ORDER BY a.fecha DESC, a.hora DESC, a.idControlAsistencia DESC;
      `);

    const hoyQ = await pool.request()
      .input('emp', sql.Int, targetId)
      .input('fec', sql.Date, fechaISO)
      .query(`
        SELECT
          a.idControlAsistencia,
          a.fecha,
          a.hora,
          a.horas_ordinarias,
          tm.tipo AS marca,
          h.nombre AS horario
        FROM dbo.Control_de_Asistencia a
        JOIN dbo.Tipo_de_Marca tm ON tm.idTipo_de_Marca = a.idTipo_de_Marca
        JOIN dbo.Horarios h       ON h.idHorario = a.idHorario
        WHERE a.idEmpleado = @emp AND a.fecha = @fec
        ORDER BY a.hora ASC, a.idControlAsistencia ASC;
      `);

    const marcasHoy = hoyQ.recordset || [];
    const tieneEntrada = marcasHoy.some((row) => isEntrada(row.marca));
    const tieneSalida = marcasHoy.some((row) => isSalida(row.marca));

    const extrasHoy = await fetchExtrasByDay(pool, targetId, fechaISO);
    const calculo = calculateResumenDia(marcasHoy, fechaISO);

    const extrasPendientes = extrasHoy.filter((x) => String(x.decision || '').toLowerCase() === 'pendiente');
    const extrasAprobadas = extrasHoy.filter((x) => String(x.decision || '').toLowerCase() === 'aprobado');
    const puedeSolicitarExtra = !rh
      && calculo?.horasExtra > 0.009
      && extrasPendientes.length === 0
      && extrasAprobadas.length === 0;

    const combos = {};
    if (rh) {
      const empleadosQ = await pool.request().query(`
        SELECT idEmpleado, cedula, nombre, apellido1, apellido2
        FROM dbo.Empleados
        ORDER BY nombre, apellido1, apellido2;
      `);
      combos.empleados = empleadosQ.recordset;
    }
    const horariosQ = await pool.request().query(`
      SELECT idHorario, nombre
      FROM dbo.Horarios
      ORDER BY nombre;
    `);
    combos.horarios = horariosQ.recordset;

    const tiposQ = await pool.request().query(`
      SELECT idTipo_de_Marca AS id, tipo
      FROM dbo.Tipo_de_Marca
      ORDER BY tipo;
    `);
    combos.tipos = tiposQ.recordset;

    const quincenaRange = getQuincenaRange(fechaISO);
    const quincenaMarcasQ = await pool.request()
      .input('emp', sql.Int, targetId)
      .input('desde', sql.Date, quincenaRange.desde)
      .input('hasta', sql.Date, quincenaRange.hasta)
      .query(`
        SELECT
          a.idControlAsistencia,
          a.fecha,
          a.hora,
          a.horas_ordinarias,
          tm.tipo AS marca
        FROM dbo.Control_de_Asistencia a
        JOIN dbo.Tipo_de_Marca tm ON tm.idTipo_de_Marca = a.idTipo_de_Marca
        WHERE a.idEmpleado = @emp AND a.fecha BETWEEN @desde AND @hasta
        ORDER BY a.fecha ASC, a.hora ASC, a.idControlAsistencia ASC;
      `);

    const extrasAprobadasQ = await pool.request()
      .input('emp', sql.Int, targetId)
      .input('desde', sql.Date, quincenaRange.desde)
      .input('hasta', sql.Date, quincenaRange.hasta)
      .query(`
        SELECT he.horas_extras, c.fecha
        FROM dbo.Horas_Extras he
        JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
        WHERE c.idEmpleado = @emp
          AND c.fecha BETWEEN @desde AND @hasta
          AND LOWER(LTRIM(RTRIM(he.decision))) = 'aprobado';
      `);
    const extrasAprobadasPorDia = new Map();
    (extrasAprobadasQ.recordset || []).forEach((row) => {
      const key = toISODate(row.fecha);
      const val = extrasAprobadasPorDia.get(key) || 0;
      extrasAprobadasPorDia.set(key, val + Number(row.horas_extras || 0));
    });

    const quincena = buildQuincenaResumen(
      quincenaRange,
      quincenaMarcasQ.recordset || [],
      extrasAprobadasPorDia
    );

    res.json({
      ok: true,
      data: {
        fecha: fechaISO,
        empleado,
        resumen: {
          marcasHoy,
          tieneEntrada,
          tieneSalida,
          puedeMarcarEntrada: !tieneEntrada,
          puedeMarcarSalida: tieneEntrada && !tieneSalida,
          horasExtraCalculadas: calculo?.horasExtra || 0,
          horasNetas: calculo?.horasNetas || 0,
          horasOrdinarias: calculo?.horasOrdinarias || 0,
          horasBrutas: calculo?.horasBrutas || 0,
          horaEntrada: calculo?.entrada || null,
          horaSalida: calculo?.salida || null,
          esFeriado: feriadoInfo.esFeriado,
          feriadoNombre: feriadoInfo.nombre || null,
        },
        extrasHoy,
        calculo,
        puedeSolicitarExtra,
        recientes: recientesQ.recordset,
        combos,
        esRH: rh,
        feriado: feriadoInfo,
        quincena,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/asistencia -> lista marcas con filtros basicos.
exports.list = async (req, res, next) => {
  try {
    if (!req.user) {
      const e = new Error('No autenticado');
      e.status = 401;
      throw e;
    }
    const pool = await getPool();
    const rh = isRhUser(req.user);
    const userId = Number(req.user?.sub || req.user?.idEmpleado);

    let targetId = Number(req.query?.empleado ?? req.query?.idEmpleado ?? userId);
    if (!rh) {
      targetId = userId;
    }
    if (!targetId) {
      const e = new Error('No se pudo determinar el empleado');
      e.status = 400;
      throw e;
    }

    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 200);
    const desde = req.query?.desde ? toISODate(req.query.desde) : null;
    const hasta = req.query?.hasta ? toISODate(req.query.hasta) : null;

    let where = 'a.idEmpleado = @emp';
    const request = pool.request().input('emp', sql.Int, targetId);
    if (desde) { where += ' AND a.fecha >= @desde'; request.input('desde', sql.Date, desde); }
    if (hasta) { where += ' AND a.fecha <= @hasta'; request.input('hasta', sql.Date, hasta); }

    const q = await request.query(`
      SELECT TOP (${limit})
        a.idControlAsistencia,
        a.fecha,
        a.hora,
        a.horas_ordinarias,
        tm.tipo AS marca,
        h.nombre AS horario
      FROM dbo.Control_de_Asistencia a
      JOIN dbo.Tipo_de_Marca tm ON tm.idTipo_de_Marca = a.idTipo_de_Marca
      JOIN dbo.Horarios h       ON h.idHorario = a.idHorario
      WHERE ${where}
      ORDER BY a.fecha DESC, a.hora DESC, a.idControlAsistencia DESC;
    `);
    res.json({ ok: true, data: q.recordset });
  } catch (err) {
    next(err);
  }
};

// POST /api/asistencia -> registra una marca de entrada/salida aplicando validaciones.
exports.create = async (req, res, next) => {
  try {
    if (!req.user) {
      const e = new Error('No autenticado');
      e.status = 401;
      throw e;
    }
    if (!canMark(req.user)) {
      const e = new Error('Sin permisos para marcar asistencia');
      e.status = 403;
      throw e;
    }

    const body = req.body || {};
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const rh = isRhUser(req.user);
      const userId = Number(req.user?.sub || req.user?.idEmpleado);
      let idEmpleado = Number(body.idEmpleado ?? userId);
      if (!rh) {
        idEmpleado = userId;
      }
      if (!idEmpleado) {
        const e = new Error('idEmpleado es requerido');
        e.status = 400;
        throw e;
      }

      if (!body.idHorario) {
        const e = new Error('idHorario es requerido');
        e.status = 400;
        throw e;
      }

      const fechaISO = toISODate(body.fecha ? new Date(body.fecha) : new Date());
      const horaSql = normalizeTime(body.hora);

      const reqTipo = new sql.Request(tx);
      let tipoRow = null;
      if (body.idTipo_de_Marca) {
        tipoRow = await getTipoById(reqTipo, Number(body.idTipo_de_Marca));
      } else if (body.marca) {
        tipoRow = await getTipoByNombre(reqTipo, body.marca);
      }
      if (!tipoRow) {
        const e = new Error('Tipo de marca inv\u00e1lido');
        e.status = 400;
        throw e;
      }

      const dupReq = new sql.Request(tx)
        .input('emp', sql.Int, idEmpleado)
        .input('fec', sql.Date, fechaISO)
        .input('tipo', sql.Int, tipoRow.id)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.Control_de_Asistencia
          WHERE idEmpleado = @emp AND fecha = @fec AND idTipo_de_Marca = @tipo;
        `);
      const dupCount = Number((await dupReq).recordset[0]?.cnt || 0);
      if (dupCount > 0) {
        const mensaje = isEntrada(tipoRow.tipo)
          ? 'Ya se registr\u00f3 la entrada de este d\u00eda'
          : isSalida(tipoRow.tipo)
            ? 'Ya se registr\u00f3 la salida de este d\u00eda'
            : 'Ya existe una marca de este tipo para este d\u00eda';
        const e = new Error(mensaje);
        e.status = 409;
        throw e;
      }

      const esSalida = isSalida(tipoRow.tipo);
      const horasPagadas = esSalida
        ? Math.max(0, Number(body.horas_ordinarias ?? JORNADA_DIURNA_HORAS))
        : 0;

      const insertReq = new sql.Request(tx)
        .input('fecha', sql.Date, fechaISO)
        .input('horas', sql.Decimal(10, 2), horasPagadas)
        .input('hora', sql.Time, horaSql)
        .input('idEmpleado', sql.Int, idEmpleado)
        .input('idTipo', sql.Int, tipoRow.id)
        .input('idHorario', sql.Int, Number(body.idHorario));

      const insertRes = await insertReq.query(`
        INSERT INTO dbo.Control_de_Asistencia
          (fecha, horas_ordinarias, hora, idEmpleado, idTipo_de_Marca, idHorario)
        OUTPUT INSERTED.*
        VALUES (@fecha, @horas, @hora, @idEmpleado, @idTipo, @idHorario);
      `);

      const inserted = insertRes.recordset[0];
      inserted.horas_ordinarias = horasPagadas;

      let horasTrabajo = horasPagadas;
      let horasBrutasAjustadas = null;
      let horasExtraCalculada = 0;

      if (esSalida) {
        const tipoEntrada = await getTipoByNombre(new sql.Request(tx), 'Entrada');

        let entradaHora = null;
        if (tipoEntrada?.id) {
          const entQ = await new sql.Request(tx)
            .input('emp', sql.Int, idEmpleado)
            .input('fec', sql.Date, fechaISO)
            .input('tipoEnt', sql.Int, tipoEntrada.id)
            .query(`
              SELECT TOP 1 hora
              FROM dbo.Control_de_Asistencia
              WHERE idEmpleado = @emp AND fecha = @fec AND idTipo_de_Marca = @tipoEnt
              ORDER BY hora ASC, idControlAsistencia ASC;
            `);
          if (entQ.recordset.length) entradaHora = entQ.recordset[0].hora;
        }

        if (!entradaHora) {
          const e = new Error('No existe marca de entrada para calcular la salida');
          e.status = 409;
          throw e;
        }

        const dtEntrada = combineDateTime(fechaISO, normalizeTime(entradaHora));
        const dtSalida = combineDateTime(fechaISO, horaSql);
        let diffMs = dtSalida.getTime() - dtEntrada.getTime();
        if (Number.isNaN(diffMs) || diffMs <= 0) {
          diffMs = 0;
        }
        const horasBrutas = Math.round((diffMs / 3600000) * 100) / 100;
        const horasNetas = Math.max(0, Math.round((horasBrutas - 1) * 100) / 100); // descuenta 1 h de almuerzo

        if (!rh && horasNetas + 1e-6 < JORNADA_DIURNA_HORAS) {
          const faltan = Math.max(0, Math.round((JORNADA_DIURNA_HORAS - horasNetas) * 100) / 100);
          const e = new Error(`No puede registrar la salida antes de cumplir las ${JORNADA_DIURNA_HORAS} horas de la jornada. Faltan ${faltan} horas.`);
          e.status = 409;
          throw e;
        }

        horasBrutasAjustadas = horasBrutas;
        const horasExtra = Math.max(0, Math.round((horasNetas - 8) * 100) / 100);
        horasExtraCalculada = horasExtra;
        horasTrabajo = horasPagadas;
      }

      await tx.commit();
      res.status(201).json({
        ok: true,
        data: inserted,
        horas_trabajadas: horasTrabajo,
        horas_brutas: typeof horasBrutasAjustadas === 'number' ? horasBrutasAjustadas : undefined,
        horas_extras_calculadas: horasExtraCalculada,
      });
    } catch (errTx) {
      await tx.rollback();
      throw errTx;
    }
  } catch (err) {
    next(err);
  }
};
