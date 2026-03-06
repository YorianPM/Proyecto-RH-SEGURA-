const { sql, getPool } = require('../db');
// Controlador de solicitudes de vacaciones: listado, validaciones y decisiones.
const {
  contarDiasHabilesFlexible,
  contarDiasHabilesStrict,
  sumarDiasPendientesSolicitudes,
} = require('../utils/vacaciones');

// GET /api/solicitudes?... -> lista solicitudes aplicando filtros y permisos del usuario.
exports.getAll = async (req, res, next) => {
  try {
    const { empleado, estado } = req.query;
    const pool = await getPool();
    let query = `
      SELECT s.*, v.idEmpleado,
             (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado,
             e.cedula
      FROM dbo.Solicitudes s
      JOIN dbo.Vacaciones v ON v.idVacaciones = s.idVacaciones
      JOIN dbo.Empleados  e ON e.idEmpleado  = v.idEmpleado
      WHERE 1=1
    `;
    const rqt = pool.request();
    const canSeeAll = (req.user?.idRol === 3) || !!req.user?.perms?.vacaciones_aprobar_RH;
    if (canSeeAll) {
      if (empleado) { query += ' AND v.idEmpleado=@emp'; rqt.input('emp', sql.Int, parseInt(empleado,10)); }
    } else {
      query += ' AND v.idEmpleado=@emp'; rqt.input('emp', sql.Int, Number(req.user?.sub));
    }
    if (estado)   { query += ' AND s.decision_administracion=@est'; rqt.input('est', sql.VarChar(45), estado); }
    query += ' ORDER BY s.idSolicitud DESC;';

    const r = await rqt.query(query);
    res.json({ ok:true, data:r.recordset });
  } catch (err) { next(err); }
};

// GET /api/solicitudes/:id -> valida visibilidad antes de devolver el detalle.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT s.*, v.idEmpleado,
             (e.nombre+' '+e.apellido1+' '+e.apellido2) AS empleado,
             e.cedula
      FROM dbo.Solicitudes s
      JOIN dbo.Vacaciones v ON v.idVacaciones = s.idVacaciones
      JOIN dbo.Empleados  e ON e.idEmpleado  = v.idEmpleado
      WHERE s.idSolicitud=@id;
    `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Solicitud no encontrada' });
    const row = r.recordset[0];
    const canSee = (req.user?.idRol === 3) || !!req.user?.perms?.vacaciones_aprobar_RH || Number(req.user?.sub) === Number(row.idEmpleado);
    if (!canSee) return res.status(403).json({ ok:false, message:'No autorizado' });
    res.json({ ok:true, data:row });
  } catch (err) { next(err); }
};

// POST /api/solicitudes  (creaciÃ³n en estado "Pendiente", pago=0)
exports.create = async (req, res, next) => {
  try {
    let { fecha_inicio_vac, fecha_fin_vac, idVacaciones } = req.body || {};
    if (!fecha_inicio_vac || !fecha_fin_vac) {
      const e = new Error('Faltan campos: fecha_inicio_vac, fecha_fin_vac');
      e.status = 400; throw e;
    }
    const pool = await getPool();
    const isAdmin = (req.user?.idRol === 3) || !!req.user?.perms?.vacaciones_aprobar_RH;
    if (!idVacaciones && !isAdmin) {
      const own = await pool.request().input('emp', sql.Int, Number(req.user?.sub)).query('SELECT TOP 1 idVacaciones FROM dbo.Vacaciones WHERE idEmpleado=@emp ORDER BY idVacaciones DESC;');
      if (!own.recordset.length) {
        // Autocrear registro de Vacaciones para el empleado si no existe
        const ins = await pool.request()
          .input('dia', sql.Date, fecha_inicio_vac)
          .input('disp', sql.Int, 0)
          .input('disf', sql.Int, 0)
          .input('emp', sql.Int, Number(req.user?.sub))
          .input('est', sql.Bit, 1)
          .query(`
            INSERT INTO dbo.Vacaciones (dia_solicitado, dias_disponibles, dias_disfrutados, idEmpleado, estado)
            OUTPUT INSERTED.idVacaciones
            VALUES (@dia, @disp, @disf, @emp, @est);
          `);
        idVacaciones = ins.recordset[0].idVacaciones;
      } else {
        idVacaciones = own.recordset[0].idVacaciones;
      }
    }
    if (!idVacaciones) { const e = new Error('Falta idVacaciones'); e.status = 400; throw e; }
    // Validar propiedad de la vacaciones si no es RH
    if (!isAdmin) {
      const own2 = await pool.request().input('idV', sql.Int, idVacaciones).query('SELECT idEmpleado FROM dbo.Vacaciones WHERE idVacaciones=@idV;');
      if (!own2.recordset.length || Number(own2.recordset[0].idEmpleado) !== Number(req.user?.sub)) {
        const e = new Error('No autorizado para crear solicitud de otro empleado'); e.status=403; throw e;
      }
    }
    // ValidaciÃ³n bÃ¡sica de rango
    const chk = await pool.request()
      .input('ini', sql.Date, fecha_inicio_vac)
      .input('fin', sql.Date, fecha_fin_vac)
      .query('SELECT CASE WHEN @fin < @ini THEN 1 ELSE 0 END AS invalido;');
    if (chk.recordset[0].invalido === 1) {
      const e = new Error('Rango de fechas invÃ¡lido: fin es anterior a inicio');
      e.status = 400; throw e;
    }

    // Normativa CR: validar derecho, ventana y dÃ­as disponibles (auto-acumula por ciclos)
    const info = await pool.request().input('idV', sql.Int, idVacaciones).query(`
      SELECT v.idVacaciones, v.dias_disponibles, v.dias_disfrutados, e.idEmpleado, e.fecha_ingreso, e.estado
      FROM dbo.Vacaciones v JOIN dbo.Empleados e ON e.idEmpleado = v.idEmpleado
      WHERE v.idVacaciones=@idV;
    `);
    if (!info.recordset.length) { const e = new Error('Vacaciones no encontradas'); e.status=404; throw e; }
    const rowV = info.recordset[0];
    const weeksQ = await pool.request().input('ing', sql.Date, rowV.fecha_ingreso).input('ini', sql.Date, fecha_inicio_vac)
      .query('SELECT DATEDIFF(WEEK,@ing,@ini) AS w;');
    const weeks = Number(weeksQ.recordset[0].w || 0);
    if (weeks < 50) { const e=new Error('AÃºn no cumple 50 semanas continuas para goce de vacaciones'); e.status=409; throw e; }
    const cycles = Math.floor(weeks / 50);
    const entQ = await pool.request().input('ing', sql.Date, rowV.fecha_ingreso).input('w', sql.Int, cycles*50)
      .query('SELECT CAST(DATEADD(WEEK,@w,@ing) AS date) AS d;');
    const derechoDesde = entQ.recordset[0].d;
    const maxQ = await pool.request().input('d', sql.Date, derechoDesde).query('SELECT CAST(DATEADD(WEEK,15,@d) AS date) AS m;');
    const limite = maxQ.recordset[0].m;
    if (new Date(fecha_inicio_vac) > new Date(limite)) {
      const e=new Error('Las vacaciones deben programarse dentro de las 15 semanas posteriores al derecho'); e.status=409; throw e;
    }
    const solicitados = contarDiasHabilesStrict(fecha_inicio_vac, fecha_fin_vac);
    const derechoTeorico = cycles * 12;
    const saldoCalculado = Math.max(0, derechoTeorico - Number(rowV.dias_disfrutados || 0));
    if (Number(rowV.dias_disponibles) !== saldoCalculado) {
      await pool.request()
        .input('idV', sql.Int, rowV.idVacaciones)
        .input('disp', sql.Int, saldoCalculado)
        .query('UPDATE dbo.Vacaciones SET dias_disponibles=@disp WHERE idVacaciones=@idV;');
    }

    const pendientes = await pool.request()
      .input('idV', sql.Int, idVacaciones)
      .query(`
        SELECT fecha_inicio_vac, fecha_fin_vac
        FROM dbo.Solicitudes
        WHERE idVacaciones=@idV AND decision_administracion='Pendiente';
      `);
    const diasPendientes = sumarDiasPendientesSolicitudes(pendientes.recordset);
    const saldoEfectivo = Math.max(0, saldoCalculado - diasPendientes);

    if (solicitados > saldoEfectivo) {
      const e = new Error(`No cuenta con días hábiles suficientes para esta solicitud (disponibles: ${saldoEfectivo}, pendientes: ${diasPendientes})`);
      e.status = 409;
      e.meta = { saldo: saldoEfectivo, diasPendientes };
      throw e;
    }

    const r = await pool.request()
      .input('ini', sql.Date, fecha_inicio_vac)
      .input('fin', sql.Date, fecha_fin_vac)
      .input('idVac', sql.Int, idVacaciones)
      .input('decision', sql.VarChar(45), 'Pendiente')
      .input('pago', sql.Decimal(10,2), 0)
      .query(`
        INSERT INTO dbo.Solicitudes (fecha_inicio_vac, fecha_fin_vac, idVacaciones, decision_administracion, pago)
        OUTPUT INSERTED.*
        VALUES (@ini, @fin, @idVac, @decision, @pago);
      `);

    res.status(201).json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/solicitudes/:id/aprobar -> calcula dias/pago y descuenta del saldo.
exports.aprobar = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();

    // Traemos solicitud + empleado + salario_base
    const s = await pool.request().input('id', sql.Int, id).query(`
      SELECT s.*, v.idEmpleado, p.salario_base, e.estado
      FROM dbo.Solicitudes s
      JOIN dbo.Vacaciones v ON v.idVacaciones = s.idVacaciones
      JOIN dbo.Empleados  e ON e.idEmpleado  = v.idEmpleado
      JOIN dbo.Puestos    p ON p.idPuesto    = e.idPuesto
      WHERE s.idSolicitud=@id;
    `);
    if (!s.recordset.length) return res.status(404).json({ ok:false, message:'Solicitud no encontrada' });

    const row   = s.recordset[0];
    let dias    = contarDiasHabilesFlexible(row.fecha_inicio_vac, row.fecha_fin_vac);
    if (dias <= 0) {
      dias = Math.max(
        1,
        Math.floor((new Date(row.fecha_fin_vac) - new Date(row.fecha_inicio_vac)) / 86400000) + 1
      );
    }
    const diario = Number(row.salario_base) / 30.0;
    const pago  = (Number(row.estado) === 0) ? Math.round(diario * dias * 100) / 100 : 0;

    // Actualizamos pago y decision
    const upd = await pool.request()
      .input('id', sql.Int, id)
      .input('pago', sql.Decimal(10,2), pago)
      .input('decision', sql.VarChar(45), 'Aprobado')
      .query(`
        UPDATE dbo.Solicitudes
        SET pago=@pago, decision_administracion=@decision
        OUTPUT INSERTED.*
        WHERE idSolicitud=@id;
      `);

    // Descuenta dÃ­as del balance (simple):
    await pool.request()
      .input('idVac', sql.Int, row.idVacaciones)
      .input('dias', sql.Int, dias)
      .query(`
        UPDATE dbo.Vacaciones
        SET dias_disponibles = CASE WHEN dias_disponibles>=@dias THEN dias_disponibles-@dias ELSE 0 END,
            dias_disfrutados = dias_disfrutados + @dias
        WHERE idVacaciones=@idVac;
      `);

    res.json({ ok:true, data: upd.recordset[0], dias_aprobados: dias, pago_calculado: pago });
  } catch (err) { next(err); }
};

// PATCH /api/solicitudes/:id/denegar -> marca la solicitud como denegada y limpia el pago.
exports.denegar = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('decision', sql.VarChar(45), 'Denegado')
      .query(`
        UPDATE dbo.Solicitudes
        SET decision_administracion=@decision, pago=0
        OUTPUT INSERTED.*
        WHERE idSolicitud=@id;
      `);
    if (!r.recordset.length) return res.status(404).json({ ok:false, message:'Solicitud no encontrada' });
    res.json({ ok:true, data:r.recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/solicitudes/:id/decidir -> enruta a aprobar o denegar segun el payload.
exports.decidir = async (req, res, next) => {
  try {
    const d = String(req.body?.decision_administracion || req.body?.decision || '').toLowerCase();
    if (d.startsWith('aprob')) return exports.aprobar(req, res, next);
    if (d.startsWith('rechaz') || d.startsWith('deneg')) return exports.denegar(req, res, next);
    const e = new Error('decision_administracion debe ser Aprobado o Rechazado');
    e.status = 400; throw e;
  } catch (err) { next(err); }
};

// DELETE /api/solicitudes/:id (sÃ³lo si estÃ¡ Pendiente)
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.Solicitudes
      WHERE idSolicitud=@id AND decision_administracion='Pendiente';
    `);
    if (r.rowsAffected[0] === 0) {
      const e = new Error('No se puede eliminar (no existe o no estÃ¡ Pendiente)');
      e.status = 409; throw e;
    }
    res.json({ ok:true, message:'Solicitud eliminada' });
  } catch (err) { next(err); }
};

