const { sql, getPool } = require('../db');
// Controlador de notificaciones: arma feed resumen para el empleado autenticado.

// Normaliza fechas hacia ISO string.
function toISODateString(value){
  if (!value) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Representacion humana en es-CR.
function toHumanDate(value){
  const iso = toISODateString(value);
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-CR');
}

// Toma el primer valor valido (fallback = hoy).
function pickDate(...values){
  for (const v of values){
    const iso = toISODateString(v);
    if (iso) return iso;
  }
  return new Date().toISOString();
}

// Retorna rango amigable para mensajes.
function formatRangeHuman(start, end){
  const a = toHumanDate(start);
  const b = toHumanDate(end);
  if (a && b) {
    if (a === b) return a;
    return `${a} al ${b}`;
  }
  return a || b || 'Sin fechas registradas';
}

// Inserta evento normalizado en el listado final.
function pushEvent(target, evt){
  if (!evt || !evt.id) return;
  target.push({
    id: String(evt.id),
    type: evt.type,
    status: evt.status || '',
    title: evt.title || '',
    message: evt.message || '',
    date: evt.date ? toISODateString(evt.date) : new Date().toISOString(),
    link: evt.link || null,
  });
}

// GET /api/notificaciones -> reúne eventos relevantes (vacaciones, permisos, HE, etc.).
exports.list = async (req, res, next) => {
  try {
    const idEmpleado = Number(req.user?.sub || req.user?.idEmpleado || 0);
    if (!idEmpleado) { const e = new Error('No autenticado'); e.status = 401; throw e; }
    const totalLimit = Math.max(5, Math.min(50, Number(req.query?.limit) || 20));
    const perTypeLimit = Math.min(20, Math.max(5, totalLimit));
    const pool = await getPool();
    const events = [];

    // Vacaciones (solicitudes resueltas)
    const vacReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const vacQ = await vacReq.query(`
      SELECT TOP (@lim)
        s.idSolicitud,
        s.decision_administracion,
        s.fecha_inicio_vac,
        s.fecha_fin_vac
      FROM dbo.Solicitudes s
      JOIN dbo.Vacaciones v ON v.idVacaciones = s.idVacaciones
      WHERE v.idEmpleado=@emp
        AND LOWER(LTRIM(RTRIM(s.decision_administracion))) <> 'pendiente'
      ORDER BY s.idSolicitud DESC;
    `);
    for (const row of vacQ.recordset || []) {
      const decision = String(row.decision_administracion || '').trim();
      const approved = decision.toLowerCase().startsWith('aprob');
      pushEvent(events, {
        id: `vacaciones:${row.idSolicitud}`,
        type: 'vacaciones',
        status: decision || 'Resuelto',
        title: approved ? 'Vacaciones aprobadas' : 'Vacaciones resueltas',
        message: `Solicitud #${row.idSolicitud} (${formatRangeHuman(row.fecha_inicio_vac, row.fecha_fin_vac)})`,
        date: pickDate(row.fecha_fin_vac, row.fecha_inicio_vac),
        link: '/vacaciones',
      });
    }

    // Permisos (resueltos)
    const perReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const perQ = await perReq.query(`
      SELECT TOP (@lim)
        p.idPermiso,
        p.decision,
        p.fecha_inicio,
        p.fecha_fin,
        tp.tipo AS tipo_permiso
      FROM dbo.Permisos p
      JOIN dbo.Tipo_Permiso tp ON tp.idTipo_Permiso = p.idTipo_Permiso
      WHERE p.idEmpleado=@emp
        AND LOWER(LTRIM(RTRIM(p.decision))) <> 'pendiente'
      ORDER BY p.idPermiso DESC;
    `);
    for (const row of perQ.recordset || []) {
      const decision = String(row.decision || '').trim();
      const approved = decision.toLowerCase().startsWith('aprob');
      pushEvent(events, {
        id: `permiso:${row.idPermiso}`,
        type: 'permisos',
        status: decision || 'Resuelto',
        title: approved ? 'Permiso aprobado' : 'Permiso resuelto',
        message: `${row.tipo_permiso || 'Permiso'} (${formatRangeHuman(row.fecha_inicio, row.fecha_fin)})`,
        date: pickDate(row.fecha_fin, row.fecha_inicio),
        link: '/permisos',
      });
    }

    // Horas extra (decididas)
    const heReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const heQ = await heReq.query(`
      SELECT TOP (@lim)
        he.idHoras_Extras,
        he.decision,
        COALESCE(TRY_CONVERT(datetime, he.fecha, 103), TRY_CONVERT(datetime, he.fecha, 23), TRY_CONVERT(datetime, he.fecha)) AS he_fecha,
        c.fecha AS asistencia_fecha
      FROM dbo.Horas_Extras he
      JOIN dbo.Control_de_Asistencia c ON c.idControlAsistencia = he.idControlAsistencia
      WHERE c.idEmpleado=@emp
        AND he.decision IN ('Aprobado','Denegado')
      ORDER BY he.idHoras_Extras DESC;
    `);
    for (const row of heQ.recordset || []) {
      const decision = String(row.decision || '').trim();
      const date = pickDate(row.he_fecha, row.asistencia_fecha);
      pushEvent(events, {
        id: `horas:${row.idHoras_Extras}`,
        type: 'horas_extras',
        status: decision || 'Resuelto',
        title: decision === 'Aprobado' ? 'Horas extra aprobadas' : 'Horas extra resueltas',
        message: `Solicitud del ${formatRangeHuman(row.asistencia_fecha, row.asistencia_fecha)}`,
        date,
        link: '/horas-extras',
      });
    }

    // Incapacidades (estado 1 o 2)
    const incReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const incQ = await incReq.query(`
      SELECT TOP (@lim)
        i.idIncapacidad,
        i.estado,
        i.fecha_inicio,
        i.fecha_fin,
        t.concepto
      FROM dbo.Incapacidad i
      JOIN dbo.Tipo_Incapacidad t ON t.idTipo_Incapacidad=i.idTipo_Incapacidad
      WHERE i.idEmpleado=@emp AND i.estado IN (1,2)
      ORDER BY i.idIncapacidad DESC;
    `);
    for (const row of incQ.recordset || []) {
      const estado = Number(row.estado);
      const status = estado === 1 ? 'Aprobada' : (estado === 2 ? 'Desaprobada' : 'Actualizada');
      pushEvent(events, {
        id: `incapacidad:${row.idIncapacidad}`,
        type: 'incapacidades',
        status,
        title: `Incapacidad ${status.toLowerCase()}`,
        message: `${row.concepto || ''} (${formatRangeHuman(row.fecha_inicio, row.fecha_fin)})`,
        date: pickDate(row.fecha_fin, row.fecha_inicio),
        link: '/incapacidades',
      });
    }

    // Planilla (coletilla disponible)
    const planReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const planQ = await planReq.query(`
      SELECT TOP (@lim)
        p.idPlanilla,
        p.periodo,
        p.fecha_inicio,
        p.fecha_fin,
        p.monto_pagado
      FROM dbo.Planillas p
      WHERE p.idEmpleado=@emp
      ORDER BY p.idPlanilla DESC;
    `);
    for (const row of planQ.recordset || []) {
      pushEvent(events, {
        id: `planilla:${row.idPlanilla}`,
        type: 'planilla',
        status: 'Disponible',
        title: 'Coletilla de pago lista',
        message: `${String(row.periodo || '').charAt(0).toUpperCase() + String(row.periodo || '').slice(1)} (${formatRangeHuman(row.fecha_inicio, row.fecha_fin)})`,
        date: pickDate(row.fecha_fin, row.fecha_inicio),
        link: '/mi-coletilla',
      });
    }

    // Aguinaldo disponible
    const aguReq = pool.request()
      .input('emp', sql.Int, idEmpleado)
      .input('lim', sql.Int, perTypeLimit);
    const aguQ = await aguReq.query(`
      SELECT TOP (@lim)
        a.idAguinaldo,
        a.fecha_generacion,
        YEAR(a.fecha_generacion) AS anio
      FROM dbo.Aguinaldo a
      WHERE a.idEmpleado=@emp
      ORDER BY a.fecha_generacion DESC, a.idAguinaldo DESC;
    `);
    for (const row of aguQ.recordset || []) {
      pushEvent(events, {
        id: `aguinaldo:${row.idAguinaldo}`,
        type: 'aguinaldo',
        status: 'Disponible',
        title: 'Aguinaldo disponible',
        message: `Año ${row.anio || new Date(row.fecha_generacion || Date.now()).getFullYear()}`,
        date: pickDate(row.fecha_generacion),
        link: '/aguinaldo',
      });
    }

    events.sort((a, b) => {
      const da = new Date(a.date || 0).getTime();
      const db = new Date(b.date || 0).getTime();
      if (db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id));
    });

    res.json({ ok: true, data: events.slice(0, totalLimit) });
  } catch (err) {
    next(err);
  }
};
