const { sql, getPool } = require('../db');

// Controlador de permisos: maneja listados, CRUD y aprobaciones.
// GET /api/permisos (?idEmpleado=) -> aplica filtros y permisos segun el usuario autenticado.
exports.getAll = async (req, res, next) => {
  try {
    const { idEmpleado } = req.query;
    const ps = (await getPool()).request();
    let where = '1=1';
    const canSeeAll = (req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH;
    const ownId = Number(req.user?.sub);
    const effId = !canSeeAll ? (ownId || null) : (idEmpleado ? Number(idEmpleado) : null);
    if (effId) { where += ' AND p.idEmpleado=@idEmpleado'; ps.input('idEmpleado', sql.Int, effId); }

    const { recordset } = await ps.query(`
      SELECT p.idPermiso, p.motivo, p.fecha_inicio, p.fecha_fin, p.decision, p.derecho_pago,
             p.estado, p.cantidad_horas, p.idEmpleado, p.idTipo_Permiso,
             tp.tipo AS tipo_permiso,
             (e.nombre+' '+e.apellido1) AS empleado, e.cedula
      FROM dbo.Permisos p
      JOIN dbo.Empleados e ON e.idEmpleado=p.idEmpleado
      JOIN dbo.Tipo_Permiso tp ON tp.idTipo_Permiso=p.idTipo_Permiso
      WHERE ${where}
      ORDER BY p.idPermiso DESC;
    `);
    res.json({ ok:true, data: recordset });
  } catch (err) { next(err); }
};

// GET /api/permisos/:id -> valida visibilidad y devuelve detalle completo.
exports.getById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const { recordset } = await (await getPool()).request()
      .input('id', sql.Int, id)
      .query(`
        SELECT p.*, tp.tipo AS tipo_permiso,
               (e.nombre+' '+e.apellido1) AS empleado, e.cedula
        FROM dbo.Permisos p
        JOIN dbo.Empleados e ON e.idEmpleado=p.idEmpleado
        JOIN dbo.Tipo_Permiso tp ON tp.idTipo_Permiso=p.idTipo_Permiso
        WHERE p.idPermiso=@id;
      `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
    const row = recordset[0];
    const canSee = (req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH || Number(req.user?.sub) === Number(row.idEmpleado);
    if (!canSee) return res.status(403).json({ ok:false, message:'No autorizado' });
    res.json({ ok:true, data: row });
  } catch (err) { next(err); }
};

// POST /api/permisos -> crea una solicitud y fuerza defaults de decision/derecho_pago.
exports.create = async (req, res, next) => {
  try {
    const { motivo, fecha_inicio, fecha_fin, /* decision, derecho_pago, */ idEmpleado, estado=1, cantidad_horas, idTipo_Permiso } = req.body || {};
    
    // ✅ Validación de campos obligatorios
    // Verifica que todos los datos requeridos estén presentes antes de continuar
    if (!motivo || !fecha_inicio || !fecha_fin || !idEmpleado || !cantidad_horas || !idTipo_Permiso) {
      const e = new Error('Faltan campos obligatorios'); 
      e.status = 400; 
      throw e;
    }
    // ✅ Validación de permisos del usuario
    // Si el usuario no es de RRHH o administrador, solo puede crear permisos para sí mismo
    const isAdmin = (req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH;
    if (!isAdmin && Number(idEmpleado) !== Number(req.user?.sub)) {
      const e = new Error('No autorizado para crear para otro empleado'); 
      e.status = 403; 
      throw e;
    }
    const { recordset } = await (await getPool()).request()
      .input('motivo', sql.VarChar(sql.MAX), motivo)
      .input('fi', sql.Date, fecha_inicio)
      .input('ff', sql.Date, fecha_fin)
      .input('dec', sql.VarChar(45), 'Pendiente')
      .input('dp', sql.VarChar(45), 'No')
      .input('idEmpleado', sql.Int, idEmpleado)
      .input('estado', sql.Bit, estado)
      .input('horas', sql.Time, cantidad_horas)
      .input('idTipo', sql.Int, idTipo_Permiso)
      .query(`
        INSERT INTO dbo.Permisos
        (motivo, fecha_inicio, fecha_fin, decision, derecho_pago, idEmpleado, estado, cantidad_horas, idTipo_Permiso)
        OUTPUT INSERTED.*
        VALUES (@motivo, @fi, @ff, @dec, @dp, @idEmpleado, @estado, @horas, @idTipo);
      `);

    res.status(201).json({ ok:true, data: recordset[0] });
  } catch (err) { 
    next(err); 
  }
};


// PUT /api/permisos/:id -> permite edicion parcial con validaciones de propietario/RH.
exports.update = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    const body = req.body || {};
    const ps = (await getPool()).request().input('id', sql.Int, id);
    // Si no es RH, validamos que el permiso pertenezca al usuario
    if (!((req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH)) {
      const owner = await ps.query('SELECT idEmpleado FROM dbo.Permisos WHERE idPermiso=@id;');
      if (!owner.recordset.length || Number(owner.recordset[0].idEmpleado) !== Number(req.user?.sub)) {
        const e=new Error('No autorizado'); e.status=403; throw e;
      }
    }

    const typeMap = {
      motivo: sql.VarChar(sql.MAX),
      fecha_inicio: sql.Date,
      fecha_fin: sql.Date,
      // decision is not updatable via this route
      derecho_pago: sql.VarChar(45),
      idEmpleado: sql.Int,
      estado: sql.Bit,
      cantidad_horas: sql.Time,
      idTipo_Permiso: sql.Int
    };

    const sets = [];
    for (const k of Object.keys(body)) {
      if (!(k in typeMap)) continue;
      if (k === 'derecho_pago' && !((req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH)) {
        // only HR can edit derecho_pago
        continue;
      }
      sets.push(`${k}=@${k}`);
      ps.input(k, typeMap[k], body[k]);
    }
    if (!sets.length) { const e=new Error('No se envió ningún campo para actualizar'); e.status=400; throw e; }

    const { recordset } = await ps.query(`
      UPDATE dbo.Permisos SET ${sets.join(', ')}
      OUTPUT INSERTED.*
      WHERE idPermiso=@id;
    `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// PATCH /api/permisos/:id/decidir -> aprueba o rechaza si la decision sigue pendiente.
exports.decidir = async (req, res, next) => {
  try {
    // Se obtiene el ID del permiso desde la URL y los campos del cuerpo de la solicitud
    const id = parseInt(req.params.id,10);
    const { decision, derecho_pago } = req.body || {};
    // Validaciones: ambos campos son obligatorios
    if (!decision) { const e=new Error('Falta campo: decision'); e.status=400; throw e; }
    if (derecho_pago == null) { const e=new Error('Falta campo: derecho_pago'); e.status=400; throw e; }
    // Se obtiene una conexión al pool de la base de datos
    const pool = await getPool();
    // Se consulta el permiso actual para verificar su estado
    const curr = await pool.request().input('id', sql.Int, id).query('SELECT decision FROM dbo.Permisos WHERE idPermiso=@id;');
    // Si el permiso no existe, se devuelve error 404
    if (!curr.recordset.length) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
     // Se obtiene la decisión actual y se verifica si es "Pendiente"
    const decActual = String(curr.recordset[0].decision || '').toLowerCase();
    // Si el permiso ya fue decidido, no se puede volver a modificar
    if (decActual !== 'pendiente') { const e=new Error('La decision ya fue registrada y no se puede cambiar'); e.status=400; throw e; }

    const ps = pool.request()
      .input('id', sql.Int, id)
      .input('decision', sql.VarChar(45), decision)
      .input('dp', sql.VarChar(45), derecho_pago);

    const { recordset } = await ps.query(`
      UPDATE dbo.Permisos
      SET decision=@decision, derecho_pago=@dp
      OUTPUT INSERTED.*
      WHERE idPermiso=@id;
    `);
    if (!recordset.length) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
    res.json({ ok:true, data: recordset[0] });
  } catch (err) { next(err); }
};

// DELETE /api/permisos/:id -> elimina solo si no ha sido decidido y el usuario esta autorizado.
exports.remove = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id,10);
    // Si no es RH, solo puede eliminar si es suyo
    const ps = (await getPool()).request().input('id', sql.Int, id);
    if (!((req.user?.idRol === 3) || !!req.user?.perms?.permisos_aprobar_RH)) {
      const owner = await ps.query('SELECT idEmpleado FROM dbo.Permisos WHERE idPermiso=@id;');
      if (!owner.recordset.length || Number(owner.recordset[0].idEmpleado) !== Number(req.user?.sub)) {
        const e=new Error('No autorizado'); e.status=403; throw e;
      }
    }
    // do not allow deletion if already decided
    const c = await ps.query('SELECT decision FROM dbo.Permisos WHERE idPermiso=@id;');
    if (!c.recordset.length) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
    if (String(c.recordset[0].decision || '').toLowerCase() !== 'pendiente') {
      const e = new Error('No se puede eliminar un permiso ya decidido'); e.status=400; throw e;
    }
    const r = await ps.query('DELETE FROM dbo.Permisos WHERE idPermiso=@id;');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ ok:false, message:'Permiso no encontrado' });
    res.json({ ok:true, message:'Eliminado' });
  } catch (err) { next(err); }
};

/* ===== Tipos de permiso ===== */

// GET /api/tipos-permiso -> expone el catalogo de tipos para el frontend.
exports.getTipos = async (_req, res, next) => {
  try {
    const { recordset } = await (await getPool()).request().query(`
      SELECT idTipo_Permiso, tipo FROM dbo.Tipo_Permiso ORDER BY tipo;
    `);
    res.json({ ok:true, data: recordset });
  } catch (err) { next(err); }
};
