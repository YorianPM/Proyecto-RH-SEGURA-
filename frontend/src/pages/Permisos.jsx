import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';
import { todayStr } from '../utils/validation';
import BackToHome from '../components/BackToHome';
import { buildUnlockStatus, formatHumanDate, formatISODate } from '../utils/tenure';

const formatHoras = (value) => {
  if (!value && value !== 0) return '-';
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}:00`;
  }
  const str = String(value).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    const parts = str.split(':');
    while (parts.length < 3) parts.push('00');
    return parts.slice(0, 3).map((p, idx) => idx === 0 ? p.padStart(2, '0') : p.padStart(2, '0')).join(':');
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const hh = String(parsed.getUTCHours()).padStart(2, '0');
    const mm = String(parsed.getUTCMinutes()).padStart(2, '0');
    const ss = String(parsed.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return str;
};

const timeToSeconds = (value = '') => {
  const str = String(value).trim();
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) return 0;
  const [h = 0, m = 0, s = 0] = parts;
  return (h * 3600) + (m * 60) + s;
};

const PERMISOS_PROBATION_MONTHS = 3;

export default function Permisos() {
  const { hasPerm, user } = useAuth();
  const toast = useToast();
  const esRH = hasPerm('permisos_aprobar_RH');
  const userId = user?.idEmpleado;
  const probationInfo = useMemo(
    () => buildUnlockStatus(user?.fecha_ingreso, { months: PERMISOS_PROBATION_MONTHS }),
    [user?.fecha_ingreso]
  );
  const probationActive = !esRH && probationInfo.hasDate && !probationInfo.ready;
  const probationLabel = probationInfo.unlockDate ? formatHumanDate(probationInfo.unlockDate, { dateStyle: 'long' }) : null;
  const probationISO = probationInfo.unlockDate ? formatISODate(probationInfo.unlockDate) : '';
  const [empleados, setEmpleados] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({
    idEmpleado: esRH ? '' : (userId || ''), idTipo_Permiso: '', motivo: '',
    fecha_inicio: '', fecha_fin: '', cantidad_horas: '00:00:00',
    decision: 'Pendiente', derecho_pago: 'No'
  });

  const cargar = useCallback(async () => {
    try {
      const reqs = [];
      if (esRH) {
        reqs.push(api.get('/empleados'));
      } else if (userId) {
        reqs.push(api.get(`/empleados/${userId}`));
      } else {
        reqs.push(Promise.resolve({ data: { data: null } }));
      }
      reqs.push(api.get('/tipos-permiso'));
      reqs.push(api.get('/permisos'));
      const [e, t, p] = await Promise.all(reqs);
      const empleadosData = esRH
        ? (e?.data?.data || [])
        : (e?.data?.data ? [e.data.data] : []);
      setEmpleados(empleadosData);
      setTipos(t.data.data || []);
      setItems(p.data.data || []);
    } catch {
      setMsg('Error al cargar datos');
    }
  }, [esRH, userId]);

  useEffect(() => { cargar(); }, [cargar]);
  const onChange = e => setF(v => ({ ...v, [e.target.name]: e.target.value }));
  useEffect(() => {
    if (!esRH) {
      setF(v => ({ ...v, idEmpleado: userId || '' }));
    }
  }, [esRH, userId]);

  const crear = async (e) => {
    e.preventDefault(); setMsg('');
    // Validaciones de fechas
    const today = todayStr();
    if (!f.fecha_inicio || f.fecha_inicio < today) {
      setMsg('La fecha de inicio debe ser hoy o posterior');
      return;
    }
    if (!f.fecha_fin || f.fecha_fin < f.fecha_inicio) {
      setMsg('La fecha de fin no puede ser anterior al inicio');
      return;
    }
    if (timeToSeconds(f.cantidad_horas) <= 0) {
      const message = 'La cantidad de horas debe ser mayor a 0';
      setMsg(message);
      toast?.(message, { type: 'error', title: 'Permisos' });
      return;
    }
    try {
      // Build payload without decision/derecho_pago, HR will decide later
      const payload = {
        idEmpleado: esRH ? f.idEmpleado : user?.idEmpleado,
        idTipo_Permiso: f.idTipo_Permiso,
        motivo: f.motivo,
        fecha_inicio: f.fecha_inicio,
        fecha_fin: f.fecha_fin,
        cantidad_horas: f.cantidad_horas,
      };
      await api.post('/permisos', payload);
      const successBase = 'Permiso registrado';
      const successMsg = probationActive
        ? `${successBase}. Permiso solicitado en el período de prueba.`
        : successBase;
      setMsg(successMsg);
      toast?.(successMsg, { type: 'success', title: 'Permisos' });
      setF({
        idEmpleado: esRH ? '' : (userId || ''),
        idTipo_Permiso: '',
        motivo: '',
        fecha_inicio: '',
        fecha_fin: '',
        cantidad_horas: '00:00:00',
        decision: 'Pendiente',
        derecho_pago: 'No'
      });
      cargar();
    } catch (err) {
      const em = err?.response?.data?.message || 'Error al registrar';
      setMsg(em);
      toast?.(em, { type: 'error', title: 'Permisos' });
    }
  };

  const decidir = async (id, decision, derecho_pago = null) => {
    setMsg('');
    try {
      await api.patch(`/permisos/${id}/decidir`, { decision, ...(derecho_pago !== null ? { derecho_pago } : {}) });
      toast?.(`Permiso ${decision.toLowerCase()}`, {
        type: decision === 'Aprobado' ? 'success' : 'warning',
        title: 'Permisos'
      });
      cargar();
    } catch {
      setMsg('Error al decidir');
      toast?.('Error al decidir permiso', { type: 'error', title: 'Permisos' });
    }
  };

  const [pagoModal, setPagoModal] = useState({
    open: false,
    mode: null,
    permisoId: null,
    decision: null,
    derechoPago: 'No',
    saving: false,
  });

  const openPagoModal = ({ mode, permisoId, decision = null, derechoPago = 'No' }) => {
    setPagoModal({
      open: true,
      mode,
      permisoId,
      decision,
      derechoPago: derechoPago === 'Sí' ? 'Sí' : 'No',
      saving: false,
    });
  };

  const closePagoModal = () => {
    setPagoModal(prev => ({ ...prev, open: false, saving: false }));
  };

  const handlePagoModalConfirm = async () => {
    if (!pagoModal.permisoId) return;
    setPagoModal(prev => ({ ...prev, saving: true }));
    try {
      if (pagoModal.mode === 'decidir') {
        await decidir(pagoModal.permisoId, pagoModal.decision, pagoModal.derechoPago);
      } else if (pagoModal.mode === 'editar') {
        await api.put(`/permisos/${pagoModal.permisoId}`, { derecho_pago: pagoModal.derechoPago });
        toast?.('Derecho a pago actualizado', { type: 'success', title: 'Permisos' });
        cargar();
      }
      closePagoModal();
    } catch (err) {
      const em = err?.response?.data?.message || 'No se pudo completar la acción.';
      setMsg(em);
      toast?.(em, { type: 'error', title: 'Permisos' });
      setPagoModal(prev => ({ ...prev, saving: false }));
    }
  };

  const decidirConPago = (id, decision) => {
    openPagoModal({
      mode: 'decidir',
      permisoId: id,
      decision,
      derechoPago: decision === 'Aprobado' ? 'Sí' : 'No',
    });
  };

  const editarPago = (id, actual) => {
    openPagoModal({
      mode: 'editar',
      permisoId: id,
      derechoPago: actual || 'No',
    });
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Permisos</h3>
      </div>
      {msg && <div className="alert alert-dark">{msg}</div>}

      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h5 className="card-title">Nuevo permiso</h5>
          {!esRH && probationActive && (
            <div className="alert alert-warning py-2">
              Estás en período de prueba. Podrás solicitar permisos con normalidad a partir del {probationLabel || probationISO || 'fin del período de prueba'}.
              Por ahora, tus solicitudes se marcarán como realizadas durante el período de prueba.
            </div>
          )}
          <form onSubmit={crear} className="row g-3" autoComplete="off">
            <div className="col-md-4">
              {hasPerm('permisos_aprobar_RH') ? (
                <>
                  <label className="form-label">Empleado</label>
                  <select className="form-select" name="idEmpleado" value={f.idEmpleado} onChange={onChange} required>
                    <option value="">Seleccione...</option>
                    {empleados.map(e => (
                      <option key={e.idEmpleado} value={e.idEmpleado}>{e.cedula} - {e.nombre} {e.apellido1}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="form-label">Empleado</label>
                  <input
                    className="form-control"
                    value={
                      empleados[0]
                        ? `${empleados[0].nombre} ${empleados[0].apellido1 || ''}`.trim()
                        : (user?.usuario || '')
                    }
                    disabled
                  />
                </>
              )}
            </div>
            <div className="col-md-4">
              <label className="form-label">Tipo de permiso</label>
              <select className="form-select" name="idTipo_Permiso" value={f.idTipo_Permiso} onChange={onChange} required>
                <option value="">Seleccione...</option>
                {tipos.map(t => <option key={t.idTipo_Permiso} value={t.idTipo_Permiso}>{t.tipo}</option>)}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Horas</label>
              <input type="time" className="form-control" name="cantidad_horas" value={f.cantidad_horas} onChange={onChange} step="1" />
            </div>

            <div className="col-md-6">
              <label className="form-label">Inicio</label>
              <input type="date" className="form-control" name="fecha_inicio" value={f.fecha_inicio} onChange={onChange} min={todayStr()} required />
            </div>
            <div className="col-md-6">
              <label className="form-label">Fin</label>
              <input type="date" className="form-control" name="fecha_fin" value={f.fecha_fin} onChange={onChange} min={f.fecha_inicio || todayStr()} required />
            </div>

            <div className="col-md-12">
              <label className="form-label">Motivo</label>
              <textarea className="form-control" rows="2" name="motivo" value={f.motivo} onChange={onChange} required minLength={10} />
            </div>

            {/* HR decides later; no decision/pago fields on create */}

            <div className="col-md-6 d-flex align-items-end justify-content-end">
              <button className="btn btn-warning">Registrar</button>
            </div>
          </form>
        </div>
      </div>

      <h5 className="mb-2">Historial de permisos</h5>
      <div className="table-responsive">
        <table className="table table-dark table-striped align-middle">
          <thead>
            <tr>
              <th>ID</th><th>Empleado</th><th>Tipo</th><th>Inicio</th><th>Fin</th><th>Horas</th><th>Decisión</th><th>Pago</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => (
              <tr key={p.idPermiso}>
                <td>{p.idPermiso}</td>
                <td>{p.empleado} ({p.cedula})</td>
                <td>{p.tipo_permiso}</td>
                <td>{p.fecha_inicio?.slice(0, 10)}</td>
                <td>{p.fecha_fin?.slice(0, 10)}</td>
                <td>{formatHoras(p.cantidad_horas)}</td>
                <td>{p.decision}</td>
                <td>{p.derecho_pago}</td>
                <td className="d-flex gap-2">
                  {hasPerm('permisos_aprobar_RH') && (
                    (() => {
                      const isPend = String(p.decision || '').toLowerCase() === 'pendiente';
                      if (isPend) {
                        return (
                          <>
                            <button className="btn btn-success btn-sm" onClick={() => decidirConPago(p.idPermiso, 'Aprobado')}>Aprobar</button>
                            <button className="btn btn-danger btn-sm" onClick={() => decidirConPago(p.idPermiso, 'Rechazado')}>Rechazar</button>
                          </>
                        );
                      }
                      return (
                        <button className="btn btn-outline-warning btn-sm" title="Editar derecho de pago" onClick={() => editarPago(p.idPermiso, p.derecho_pago)}>
                          Editar pago
                        </button>
                      );
                    })()
                  )}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan="9" className="text-center text-secondary">No hay permisos</td></tr>}
          </tbody>
        </table>
      </div>
      {pagoModal.open && (
        <>
          <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    {pagoModal.mode === 'decidir' ? 'Registrar decisión' : 'Editar derecho a pago'}
                  </h5>
                  <button type="button" className="btn-close" onClick={closePagoModal} disabled={pagoModal.saving}></button>
                </div>
                <div className="modal-body">
                  <p className="mb-3">
                    Selecciona si este permiso tendrá derecho a pago. Este valor se registrará junto con la decisión.
                  </p>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="radio"
                      id="pago-si"
                      checked={pagoModal.derechoPago === 'Sí'}
                      onChange={() => setPagoModal(prev => ({ ...prev, derechoPago: 'Sí' }))}
                      disabled={pagoModal.saving}
                    />
                    <label className="form-check-label" htmlFor="pago-si">Sí</label>
                  </div>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="radio"
                      id="pago-no"
                      checked={pagoModal.derechoPago !== 'Sí'}
                      onChange={() => setPagoModal(prev => ({ ...prev, derechoPago: 'No' }))}
                      disabled={pagoModal.saving}
                    />
                    <label className="form-check-label" htmlFor="pago-no">No</label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={closePagoModal} disabled={pagoModal.saving}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handlePagoModalConfirm} disabled={pagoModal.saving}>
                    {pagoModal.saving ? 'Guardando…' : 'Confirmar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}
    </div>
  );
}
