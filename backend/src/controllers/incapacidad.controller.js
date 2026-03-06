const { sql, getPool } = require('../db');
// Controlador de incapacidades: valida empleados, calcula subsidios y mantiene archivos.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// Reglas rapidas para estimar el subsidio segun concepto.
const SUBSIDIO_RULES = [
  {
    match: /accident|riesg|labor/i,
    calc: (daily, dias) => daily * dias * 0.6, // INS cubre 60% desde el dia 1
  },
  {
    match: /mater/i,
    calc: (daily, dias) => daily * dias * 0.5, // CCSS cubre 50% todo el periodo
  },
  {
    match: /enfer/i,
    calc: (daily, dias) => daily * Math.max(dias - 3, 0) * 0.6, // CCSS cubre 60% desde el dia 4
  },
];

// Parsea fechas a objeto Date (00:00).
const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

// Diferencia de dias incluyendo ambos extremos.
const diffDaysInclusive = (start, end) => {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / MS_PER_DAY) + 1;
};

// Recupera datos minimos del empleado.
async function getEmpleadoBasico(pool, idEmpleado) {
  const r = await pool.request()
    .input('id', sql.Int, idEmpleado)
    .query(`
      SELECT idEmpleado, fecha_ingreso, estado
      FROM dbo.Empleados
      WHERE idEmpleado=@id;
    `);
  return r.recordset[0] || null;
}

// Lanza error si el empleado no puede registrar una incapacidad.
async function assertEmpleadoActivoParaIncapacidad(pool, idEmpleado, fechaInicioRaw) {
  const id = Number(idEmpleado);
  if (!Number.isInteger(id) || id <= 0) {
    const e = new Error('Empleado no valido');
    e.status = 400;
    throw e;
  }
  const empleado = await getEmpleadoBasico(pool, id);
  if (!empleado) {
    const e = new Error('Empleado no encontrado');
    e.status = 404;
    throw e;
  }
  const fechaIngreso = normalizeDate(empleado.fecha_ingreso);
  if (!fechaIngreso) {
    const e = new Error('El empleado no tiene fecha de ingreso registrada');
    e.status = 400;
    throw e;
  }
  const hoy = normalizeDate(new Date());
  if (fechaIngreso > hoy) {
    const e = new Error('El empleado aun no inicia labores y no puede registrar incapacidades');
    e.status = 400;
    throw e;
  }
  if (!empleado.estado) {
    const e = new Error('El empleado no esta activo para registrar incapacidades');
    e.status = 400;
    throw e;
  }
  const fechaInicio = normalizeDate(fechaInicioRaw);
  if (!fechaInicio) {
    const e = new Error('La fecha de inicio de la incapacidad es invalida');
    e.status = 400;
    throw e;
  }
  if (fechaInicio < fechaIngreso) {
    const e = new Error('La incapacidad no puede iniciar antes de la fecha de ingreso del empleado');
    e.status = 400;
    throw e;
  }
}

// Obtiene salario mensual actual del empleado.
async function getEmpleadoSalario(pool, idEmpleado) {
  const r = await pool.request()
    .input('id', sql.Int, idEmpleado)
    .query(`
      SELECT p.salario_base
      FROM dbo.Empleados e
      JOIN dbo.Puestos p ON p.idPuesto = e.idPuesto
      WHERE e.idEmpleado=@id;
    `);
  if (!r.recordset.length) return null;
  return Number(r.recordset[0].salario_base || 0);
}

// Devuelve nombre del concepto de incapacidad.
async function getTipoConcepto(pool, idTipo) {
  const r = await pool.request()
    .input('id', sql.Int, idTipo)
    .query(`SELECT concepto FROM dbo.Tipo_Incapacidad WHERE idTipo_Incapacidad=@id;`);
  if (!r.recordset.length) return null;
  return String(r.recordset[0].concepto || '');
}

// Calcula el subsidio estimado aplicando la regla del concepto.
async function calcularSubsidio(pool, { idEmpleado, idTipo, fechaInicio, fechaFin }) {
  const inicio = normalizeDate(fechaInicio);
  const fin = normalizeDate(fechaFin);
  if (!inicio || !fin) return 0;

  const dias = diffDaysInclusive(inicio, fin);
  if (dias <= 0) return 0;

  const salarioMensual = await getEmpleadoSalario(pool, idEmpleado);
  if (!salarioMensual || salarioMensual <= 0) return 0;

  const concepto = await getTipoConcepto(pool, idTipo);
  if (!concepto) return 0;

  const conceptoLower = concepto.toLowerCase();
  const daily = salarioMensual / 30;

  const rule = SUBSIDIO_RULES.find(r => r.match.test(conceptoLower));
  if (!rule) return 0;

  const subsidio = rule.calc(daily, dias);
  return round2(Math.max(subsidio, 0));
}

// GET /api/incapacidades -> lista todas o filtra por empleado.
exports.getAll = async (req, res, next) => {
  try {
    const { empleado } = req.query;
    const pool = await getPool();
    const q = pool.request();
    let where = 'WHERE 1=1';
    if (empleado) { where += ' AND i.idEmpleado=@emp'; q.input('emp', sql.Int, parseInt(empleado,10)); }

    const r = await q.query(`
      SELECT i.*, e.nombre, e.apellido1, e.apellido2, t.concepto
      FROM dbo.Incapacidad i
      JOIN dbo.Empleados e ON e.idEmpleado=i.idEmpleado
      JOIN dbo.Tipo_Incapacidad t ON t.idTipo_Incapacidad=i.idTipo_Incapacidad
      ${where}
      ORDER BY i.idIncapacidad DESC;
    `);
    res.json({ ok:true, data: r.recordset });
  } catch (err) { next(err); }
};

// GET /api/incapacidades/:id -> muestra el registro y concepto asociado.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT i.*, e.nombre, e.apellido1, e.apellido2, t.concepto
      FROM dbo.Incapacidad i
      JOIN dbo.Empleados e ON e.idEmpleado=i.idEmpleado
      JOIN dbo.Tipo_Incapacidad t ON t.idTipo_Incapacidad=i.idTipo_Incapacidad
      WHERE i.idIncapacidad=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Incapacidad no encontrada' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// POST /api/incapacidades -> crea una incapacidad validando boleta y subsidio.
exports.create = async (req, res, next) => {
  try {
    const b = req.body || {};
    const pathFile = req.file?.filename ? `incapacidades/${req.file.filename}` : null;

    const need = ['fecha_inicio','fecha_fin','numero_boleta','idTipo_Incapacidad','idEmpleado'];
    for (const k of need) if (b[k] === undefined) { const e=new Error(`Falta ${k}`); e.status=400; throw e; }

    const pool = await getPool();
    const numeroBoleta = String(b.numero_boleta || '').trim();
    if (!numeroBoleta) {
      const e = new Error('El número de boleta es obligatorio');
      e.status = 400;
      throw e;
    }

    const dup = await pool.request()
      .input('boleta', sql.VarChar(45), numeroBoleta)
      .query('SELECT TOP 1 idIncapacidad FROM dbo.Incapacidad WHERE numero_boleta=@boleta;');
    if (dup.recordset.length) {
      const e = new Error('Ya existe una incapacidad con el mismo número de boleta');
      e.status = 409;
      throw e;
    }

    await assertEmpleadoActivoParaIncapacidad(pool, Number(b.idEmpleado), b.fecha_inicio);

    const subsidio = await calcularSubsidio(pool, {
      idEmpleado: Number(b.idEmpleado),
      idTipo: Number(b.idTipo_Incapacidad),
      fechaInicio: b.fecha_inicio,
      fechaFin: b.fecha_fin
    });

    const observaciones = b.observaciones ? String(b.observaciones).trim() : null;

    const r = await pool.request()
      .input('fecha_inicio', sql.Date, b.fecha_inicio)
      .input('fecha_fin', sql.Date, b.fecha_fin)
      .input('monto_subsidio', sql.Decimal(10,2), subsidio)
      .input('estado', sql.TinyInt, Number(b.estado ?? 0))
      .input('numero_boleta', sql.VarChar(45), numeroBoleta)
      .input('idTipo_Incapacidad', sql.Int, b.idTipo_Incapacidad)
      .input('idEmpleado', sql.Int, b.idEmpleado)
      .input('escaneo_boleta', sql.VarChar(255), pathFile)
      .input('observaciones', sql.VarChar(500), observaciones)
      .query(`
        INSERT INTO dbo.Incapacidad
        (fecha_inicio, fecha_fin, monto_subsidio, estado, numero_boleta, idTipo_Incapacidad, idEmpleado, escaneo_boleta, observaciones)
        OUTPUT INSERTED.*
        VALUES (@fecha_inicio, @fecha_fin, @monto_subsidio, @estado, @numero_boleta, @idTipo_Incapacidad, @idEmpleado, @escaneo_boleta, @observaciones);
      `);
    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/incapacidades/:id -> actualiza campos y recalcula subsidio (permite nuevo archivo).
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const b = req.body || {};
    const pool = await getPool();
    const currentRes = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.Incapacidad WHERE idIncapacidad=@id;`);
    if (!currentRes.recordset.length) return res.status(404).json({ ok:false, message:'Incapacidad no encontrada' });

    const current = currentRes.recordset[0];
    const merged = {
      ...current,
      ...b,
      idEmpleado: Number(b.idEmpleado ?? current.idEmpleado),
      idTipo_Incapacidad: Number(b.idTipo_Incapacidad ?? current.idTipo_Incapacidad),
      fecha_inicio: b.fecha_inicio ?? current.fecha_inicio,
      fecha_fin: b.fecha_fin ?? current.fecha_fin,
      observaciones: b.observaciones ?? current.observaciones
    };
    const numeroBoleta = String(b.numero_boleta ?? current.numero_boleta ?? '').trim();
    if (numeroBoleta) {
      const dup = await pool.request()
        .input('boleta', sql.VarChar(45), numeroBoleta)
        .input('id', sql.Int, id)
        .query('SELECT TOP 1 idIncapacidad FROM dbo.Incapacidad WHERE numero_boleta=@boleta AND idIncapacidad<>@id;');
      if (dup.recordset.length) {
        const e = new Error('Ya existe una incapacidad con el mismo número de boleta');
        e.status = 409;
        throw e;
      }
    }

    await assertEmpleadoActivoParaIncapacidad(pool, merged.idEmpleado, merged.fecha_inicio);

    const subsidio = await calcularSubsidio(pool, {
      idEmpleado: merged.idEmpleado,
      idTipo: merged.idTipo_Incapacidad,
      fechaInicio: merged.fecha_inicio,
      fechaFin: merged.fecha_fin
    });

    const q = pool.request().input('id', sql.Int, id);
    const sets = [];
    const map = {
      fecha_inicio: sql.Date,
      fecha_fin: sql.Date,
      estado: sql.TinyInt,
      numero_boleta: sql.VarChar(45),
      idTipo_Incapacidad: sql.Int,
      idEmpleado: sql.Int,
      observaciones: sql.VarChar(500)
    };
    for (const k of Object.keys(map)) {
      if (b[k] !== undefined) {
        let value;
        if (k === 'numero_boleta') value = numeroBoleta;
        else if (k === 'observaciones') value = String(b[k] ?? '').trim() || null;
        else value = b[k];
        sets.push(`${k}=@${k}`);
        q.input(k, map[k], value);
      }
    }
    if (req.file?.filename) {
      sets.push('escaneo_boleta=@file');
      q.input('file', sql.VarChar(255), `incapacidades/${req.file.filename}`);
    }
    sets.push('monto_subsidio=@monto_subsidio');
    q.input('monto_subsidio', sql.Decimal(10,2), subsidio);
    if (!sets.length) { const e=new Error('Nada que actualizar'); e.status=400; throw e; }

    const r = await q.query(`
      UPDATE dbo.Incapacidad SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idIncapacidad=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Incapacidad no encontrada' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/incapacidades/:id/estado -> cambia estado y observaciones segun revisi?n.
exports.updateEstado = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { estado } = req.body || {};
    const observacionesRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'observaciones')
      ? String(req.body.observaciones ?? '').trim()
      : undefined;
    if (Number.isNaN(id)) {
      const e = new Error('ID invalido');
      e.status = 400;
      throw e;
    }
    if (![0, 1, 2].includes(Number(estado))) {
      const e = new Error('Estado invalido');
      e.status = 400;
      throw e;
    }
    if (Number(estado) === 2 && !observacionesRaw) {
      const e = new Error('Debe indicar observaciones al desaprobar la incapacidad');
      e.status = 400;
      throw e;
    }
    const pool = await getPool();
    const reqUpd = pool.request()
      .input('id', sql.Int, id)
      .input('estado', sql.TinyInt, Number(estado));
    let setObs = '';
    if (observacionesRaw !== undefined) {
      reqUpd.input('observaciones', sql.VarChar(500), observacionesRaw || null);
      setObs = ', observaciones=@observaciones';
    }
    const r = await reqUpd.query(`
        UPDATE dbo.Incapacidad
        SET estado=@estado${setObs}
        OUTPUT INSERTED.*
        WHERE idIncapacidad=@id;
      `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Incapacidad no encontrada' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/incapacidades/:id -> elimina definitivamente el registro.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.Incapacidad WHERE idIncapacidad=@id;
    `);
    if (r.rowsAffected[0]===0) return res.status(404).json({ ok:false, message:'Incapacidad no encontrada' });
    res.json({ ok:true, message:'Incapacidad eliminada' });
  } catch (err) { next(err); }
};

