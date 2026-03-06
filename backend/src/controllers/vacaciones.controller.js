const { sql, getPool } = require('../db');
const { sumarDiasPendientesSolicitudes } = require('../utils/vacaciones');
// Controlador de vacaciones: mantiene saldos y solicitudes ligadas.

// GET /api/vacaciones (?idEmpleado=) -> lista saldos aplicando permisos y recalcula pendientes.
exports.getAll = async (req, res, next) => {
  try {
    const { idEmpleado } = req.query;
    const pool = await getPool();
    const ps = pool.request();
    let where = '1=1';
    // Si NO es RH/aprobador ni superusuario, solo ver sus propios registros
    const canSeeAll = (req.user?.idRol === 3) || !!req.user?.perms?.vacaciones_aprobar_RH;
    const ownId = Number(req.user?.sub);
    const effId = !canSeeAll ? (ownId || null) : (idEmpleado ? Number(idEmpleado) : null);
    if (effId) { where += ' AND v.idEmpleado=@idEmpleado'; ps.input('idEmpleado', sql.Int, effId); }

    const { recordset } = await ps.query(`
      SELECT v.idVacaciones, v.dia_solicitado, v.dias_disponibles, v.dias_disfrutados,
             v.estado, v.idEmpleado,
             (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado, e.cedula,
             e.fecha_ingreso
      FROM dbo.Vacaciones v
      JOIN dbo.Empleados e ON e.idEmpleado=v.idEmpleado
      WHERE ${where}
      ORDER BY v.idVacaciones DESC;
    `);
    const vacIds = Array.from(new Set(recordset.map((r) => r.idVacaciones).filter((id) => id != null)));
    const diasPendientesPorVac = new Map();
    if (vacIds.length) {
      const pendReq = pool.request();
      const params = vacIds.map((id, idx) => {
        const key = `id${idx}`;
        pendReq.input(key, sql.Int, id);
        return `@${key}`;
      });
      const { recordset: pendientesRows } = await pendReq.query(`
        SELECT idVacaciones, fecha_inicio_vac, fecha_fin_vac
        FROM dbo.Solicitudes
        WHERE decision_administracion='Pendiente' AND idVacaciones IN (${params.join(',')});
      `);
      const grouped = new Map();
      for (const row of pendientesRows) {
        if (!grouped.has(row.idVacaciones)) grouped.set(row.idVacaciones, []);
        grouped.get(row.idVacaciones).push(row);
      }
      for (const [idVac, rows] of grouped.entries()) {
        diasPendientesPorVac.set(idVac, sumarDiasPendientesSolicitudes(rows));
      }
    }
    // Enriquecer con cómputos normativos: derecho_desde, ventana_hasta, dias_teoricos, dias_calc_disponibles
    const today = new Date();
    const updates = [];
    const data = recordset.map((r) => {
      try {
        const fi = new Date(r.fecha_ingreso);
        const weeks = Math.floor((today - fi) / (7*24*60*60*1000));
        const cycles = Math.max(0, Math.floor(weeks / 50));
        const derechoDesde = new Date(fi.getTime());
        derechoDesde.setDate(derechoDesde.getDate() + cycles*50*7);
        const ventanaHasta = new Date(derechoDesde.getTime());
        ventanaHasta.setDate(ventanaHasta.getDate() + 15*7);
        const diasTeoricos = cycles * 12;
        const diasPendientes = diasPendientesPorVac.get(r.idVacaciones) || 0;
        const diasCalcDisponibles = Math.max(0, diasTeoricos - Number(r.dias_disfrutados || 0) - diasPendientes);
        if (Number(r.dias_disponibles) !== diasCalcDisponibles) {
          updates.push(
            pool.request()
              .input('dias', sql.Int, diasCalcDisponibles)
              .input('id', sql.Int, r.idVacaciones)
              .query('UPDATE dbo.Vacaciones SET dias_disponibles=@dias WHERE idVacaciones=@id;')
          );
        }
        return {
          ...r,
          derecho_desde: derechoDesde.toISOString().slice(0,10),
          ventana_hasta: ventanaHasta.toISOString().slice(0,10),
          dias_teoricos: diasTeoricos,
          dias_calc_disponibles: diasCalcDisponibles,
          dias_pendientes: diasPendientes,
        };
      } catch (_) { return r; }
    });
    if (updates.length) await Promise.all(updates);
    res.json({ ok:true, data });
  } catch (err) { next(err); }
};

// GET /api/vacaciones/:id -> devuelve un saldo especifico verificando autorizacion.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { recordset } = await (await getPool()).request()
      .input('id', sql.Int, id)
      .query(`
        SELECT v.*, (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado, e.cedula
        FROM dbo.Vacaciones v
        JOIN dbo.Empleados e ON e.idEmpleado=v.idEmpleado
        WHERE v.idVacaciones=@id;
      `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    const row = recordset[0];
    const canSee = (req.user?.idRol === 3) || !!req.user?.perms?.vacaciones_aprobar_RH || Number(req.user?.sub) === Number(row.idEmpleado);
    if (!canSee) return res.status(403).json({ ok:false, message:'No autorizado' });
    res.json({ ok:true, data: row });
  } catch (err) { next(err); }
};

// POST /api/vacaciones -> crea manualmente un registro de vacaciones por empleado.
exports.create = async (req, res, next) => {
  try {
    const { dia_solicitado, dias_disponibles, dias_disfrutados, idEmpleado, estado=1 } = req.body || {};
    if (!dia_solicitado || idEmpleado == null || dias_disponibles == null || dias_disfrutados == null) {
      const e = new Error('Faltan campos: dia_solicitado, dias_disponibles, dias_disfrutados, idEmpleado'); e.status=400; throw e;
    }
    const { recordset } = await (await getPool()).request()
      .input('dia_solicitado', sql.Date, dia_solicitado)
      .input('dias_disponibles', sql.Int, dias_disponibles)
      .input('dias_disfrutados', sql.Int, dias_disfrutados)
      .input('idEmpleado', sql.Int, idEmpleado)
      .input('estado', sql.Bit, estado)
      .query(`
        INSERT INTO dbo.Vacaciones (dia_solicitado, dias_disponibles, dias_disfrutados, idEmpleado, estado)
        OUTPUT INSERTED.*
        VALUES (@dia_solicitado, @dias_disponibles, @dias_disfrutados, @idEmpleado, @estado);
      `);
    res.status(201).json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// PUT /api/vacaciones/:id -> actualiza campos dinamicamente.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const body = req.body || {};
    const ps = (await getPool()).request().input('id', sql.Int, id);

    const typeMap = {
      dia_solicitado:  sql.Date,
      dias_disponibles:sql.Int,
      dias_disfrutados:sql.Int,
      estado:          sql.Bit,
      idEmpleado:      sql.Int
    };

    const sets = [];
    for (const k of Object.keys(body)) {
      if (!(k in typeMap)) continue;
      sets.push(`${k}=@${k}`);
      ps.input(k, typeMap[k], body[k]);
    }
    if (!sets.length) { const e=new Error('No se envió ningún campo para actualizar'); e.status=400; throw e; }

    const { recordset } = await ps.query(`
      UPDATE dbo.Vacaciones SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idVacaciones=@id;
    `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/vacaciones/:id -> elimina el registro indicado.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const r = await (await getPool()).request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.Vacaciones WHERE idVacaciones=@id;');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ ok:false, message:'Registro no encontrado' });
    res.json({ ok:true, message:'Eliminado' });
  } catch (err) { next(err); }
};

/* ===================== Solicitudes de vacaciones ===================== */

// GET /api/solicitudes (?idVacaciones=) -> lista solicitudes asociadas al saldo.
exports.getSolicitudes = async (req, res, next) => {
  try {
    const { idVacaciones } = req.query;
    const ps = (await getPool()).request();
    let where = '1=1';
    if (idVacaciones) { where += ' AND s.idVacaciones=@idVacaciones'; ps.input('idVacaciones', sql.Int, +idVacaciones); }

    const { recordset } = await ps.query(`
      SELECT s.idSolicitud, s.fecha_inicio_vac, s.fecha_fin_vac, s.decision_administracion, s.pago,
             s.idVacaciones, v.idEmpleado, (e.nombre+' '+e.apellido1) AS empleado, e.cedula
      FROM dbo.Solicitudes s
      JOIN dbo.Vacaciones v ON v.idVacaciones=s.idVacaciones
      JOIN dbo.Empleados  e ON e.idEmpleado=v.idEmpleado
      WHERE ${where}
      ORDER BY s.idSolicitud DESC;
    `);
    res.json({ ok:true, data: recordset });
  } catch (err) { next(err); }
};

// POST /api/solicitudes -> crea solicitud simple ligada a un saldo.
exports.createSolicitud = async (req, res, next) => {
  try {
    const { fecha_inicio_vac, fecha_fin_vac, idVacaciones, decision_administracion='Pendiente', pago=0 } = req.body || {};
    if (!fecha_inicio_vac || !fecha_fin_vac || !idVacaciones) {
      const e = new Error('Faltan campos: fecha_inicio_vac, fecha_fin_vac, idVacaciones'); e.status=400; throw e;
    }
    const { recordset } = await (await getPool()).request()
      .input('fi', sql.Date, fecha_inicio_vac)
      .input('ff', sql.Date, fecha_fin_vac)
      .input('idV', sql.Int, idVacaciones)
      .input('dec', sql.VarChar(45), decision_administracion)
      .input('pago', sql.Decimal(10,2), pago)
      .query(`
        INSERT INTO dbo.Solicitudes (fecha_inicio_vac, fecha_fin_vac, idVacaciones, decision_administracion, pago)
        OUTPUT INSERTED.*
        VALUES (@fi, @ff, @idV, @dec, @pago);
      `);
    res.status(201).json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/solicitudes/:id/decidir -> registra la decision y pago opcional.
exports.decidirSolicitud = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { decision_administracion, pago } = req.body || {};
    if (!decision_administracion) { const e=new Error('Falta campo: decision_administracion'); e.status=400; throw e; }

    const ps = (await getPool()).request()
      .input('id', sql.Int, id)
      .input('dec', sql.VarChar(45), decision_administracion);

    let setPago = '';
    if (pago != null) { ps.input('pago', sql.Decimal(10,2), pago); setPago = ', pago=@pago'; }

    const { recordset } = await ps.query(`
      UPDATE dbo.Solicitudes
      SET decision_administracion=@dec${setPago}
      OUTPUT INSERTED.*
      WHERE idSolicitud=@id;
    `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Solicitud no encontrada' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};
