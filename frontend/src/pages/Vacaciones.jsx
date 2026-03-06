import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';
import { todayStr } from '../utils/validation';
import { analyzeLaboralRange } from '../utils/feriadosCR';
import { buildUnlockStatus, formatHumanDate, formatISODate } from '../utils/tenure';
import BackToHome from '../components/BackToHome';

const VACACIONES_MIN_WEEKS = 50;

export default function Vacaciones() {
  const { hasPerm, user } = useAuth();
  const toast = useToast();
  const isRH = hasPerm('vacaciones_aprobar_RH');
  const [items, setItems] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [msg, setMsg] = useState('');
  const [formErrorActive, setFormErrorActive] = useState(false);

  const [fSol, setFSol] = useState({ idVacaciones:'', fecha_inicio_vac:'', fecha_fin_vac:'' });
  const [filterEmpleado, setFilterEmpleado] = useState(() => (
    isRH ? 'all' : String(user?.idEmpleado ?? '')
  ));
  const [vacPage, setVacPage] = useState(1);
  const [solPage, setSolPage] = useState(1);
  const PAGE_SIZE = 5;

  const cargar = useCallback(async () => {
    try {
      const reqs = [api.get('/vacaciones'), api.get('/solicitudes')];
      const [v, s] = await Promise.all(reqs);
      setItems(v.data.data || []);
      setSolicitudes(s.data.data || []);
      if (!isRH) {
        const first = (v.data.data || [])[0];
        if (first) setFSol(f=>({ ...f, idVacaciones: first.idVacaciones }));
      }
    } catch {
      setMsg('Error al cargar datos');
    }
  }, [isRH]);

  useEffect(()=>{ cargar(); },[cargar]);
  const onChangeSol = e => setFSol(f=>({...f,[e.target.name]: e.target.value}));
  useEffect(() => {
    if (!isRH && user?.idEmpleado) {
      setFilterEmpleado(String(user.idEmpleado));
    } else if (isRH) {
      setFilterEmpleado('all');
    }
  }, [isRH, user?.idEmpleado]);
  useEffect(() => { setVacPage(1); }, [filterEmpleado]);
  useEffect(() => { setSolPage(1); }, [solicitudes.length]);

  const vacSel = useMemo(() => {
    if (!items.length) return null;
    const selected = items.find(v => String(v.idVacaciones) === String(fSol.idVacaciones));
    return selected || items[0];
  }, [items, fSol.idVacaciones]);
  const diasPendientesVac = Number(vacSel?.dias_pendientes ?? 0);
  const saldoDisponible = Math.max(0, Number(vacSel?.dias_calc_disponibles ?? 0));
  const rangoLaboral = useMemo(() => {
    if (!fSol.fecha_inicio_vac || !fSol.fecha_fin_vac) return { count: 0, invalidEdges: [], note: null };
    return analyzeLaboralRange(fSol.fecha_inicio_vac, fSol.fecha_fin_vac);
  }, [fSol.fecha_inicio_vac, fSol.fecha_fin_vac]);
  const diasSeleccionados = rangoLaboral.count;
  const invalidEdges = rangoLaboral.invalidEdges || [];
  const primaryInvalidEdge = invalidEdges[0] || null;
  const noteLaboral = rangoLaboral.note;
  const excedeSaldo = Boolean(vacSel) && diasSeleccionados > saldoDisponible;
  const invalidEdgeToastRef = useRef(new Set());
  const noteToastRef = useRef(new Set());
  const vacUnlockInfo = useMemo(
    () => buildUnlockStatus(user?.fecha_ingreso, { weeks: VACACIONES_MIN_WEEKS }),
    [user?.fecha_ingreso]
  );
  const vacBlocked = !isRH && vacUnlockInfo.hasDate && !vacUnlockInfo.ready;
  const vacUnlockLabel = vacUnlockInfo.unlockDate ? formatHumanDate(vacUnlockInfo.unlockDate, { dateStyle: 'long' }) : null;
  const vacUnlockISO = vacUnlockInfo.unlockDate ? formatISODate(vacUnlockInfo.unlockDate) : '';
  const puedeEnviar = Boolean(vacSel) && diasSeleccionados > 0 && !excedeSaldo && !vacBlocked && invalidEdges.length === 0;

  useEffect(() => {
    if (
      formErrorActive &&
      vacSel &&
      diasSeleccionados &&
      !excedeSaldo &&
      diasSeleccionados <= saldoDisponible
    ) {
      setMsg('');
      setFormErrorActive(false);
    }
  }, [formErrorActive, vacSel, diasSeleccionados, excedeSaldo, saldoDisponible]);

  useEffect(() => {
    if (!invalidEdges.length) return;
    const baseMsg = 'No puede iniciar o finalizar vacaciones en un d\u00eda que no pertenece a su jornada laboral.';
    invalidEdges.forEach((edge) => {
      if (!edge || !edge.fecha || !edge.type) return;
      const key = `${edge.position || 'edge'}-${edge.type}-${edge.fecha}`;
      if (invalidEdgeToastRef.current.has(key)) return;
      invalidEdgeToastRef.current.add(key);
      const detail = edge.type === 'feriado'
        ? edge.nombre ? `${edge.fecha} es feriado (${edge.nombre})` : `${edge.fecha} es feriado`
        : `${edge.fecha} es domingo`;
      toast?.(`${baseMsg} (${detail}).`, { type: 'warning', title: 'Vacaciones' });
    });
  }, [invalidEdges, toast]);

  useEffect(() => {
    if (!noteLaboral || !noteLaboral.fecha) return;
    const key = `${noteLaboral.type || 'note'}-${noteLaboral.fecha}`;
    if (noteToastRef.current.has(key)) return;
    noteToastRef.current.add(key);
    if (noteLaboral.type === 'feriado') {
      const detail = noteLaboral.nombre ? `${noteLaboral.fecha} es feriado (${noteLaboral.nombre})` : `${noteLaboral.fecha} es feriado`;
      toast?.(`${detail} y no se descuenta del saldo.`, { type: 'info', title: 'Vacaciones' });
    }
  }, [noteLaboral, toast]);

  const crearSolicitud = async (e) => {
    e.preventDefault(); setMsg(''); setFormErrorActive(false);
    if (vacBlocked) {
      const unlockText = vacUnlockLabel || vacUnlockISO || 'la fecha indicada';
      const blockMessage = `Aún estás en el período de prueba. Podrás solicitar vacaciones a partir del ${unlockText}.`;
      setMsg(blockMessage);
      setFormErrorActive(true);
      toast(blockMessage, { type: 'info', title: 'Vacaciones' });
      return;
    }
    const today = todayStr();
    if (!vacSel) {
      setMsg('No existe un registro de vacaciones asignado para este empleado');
      setFormErrorActive(true);
      return;
    }
    if (!fSol.fecha_inicio_vac || fSol.fecha_inicio_vac < today) {
      setMsg('La fecha de inicio debe ser hoy o posterior');
      setFormErrorActive(true);
      return;
    }
    if (!fSol.fecha_fin_vac || fSol.fecha_fin_vac < fSol.fecha_inicio_vac) {
      setMsg('La fecha de fin no puede ser anterior al inicio');
      setFormErrorActive(true);
      return;
    }
    if (invalidEdges.length > 0) {
      const invalidMsg = 'No puede iniciar o finalizar vacaciones en un d\u00eda que no pertenece a su jornada laboral.';
      setMsg(invalidMsg);
      setFormErrorActive(true);
      toast?.(invalidMsg, { type: 'warning', title: 'Vacaciones' });
      return;
    }
    if (!diasSeleccionados) {
      setMsg('Debes seleccionar al menos un d\u00eda h\u00e1bil (lunes a s\u00e1bado). Los domingos y feriados no se descuentan.');
      setFormErrorActive(true);
      return;
    }
    if (excedeSaldo) {
      setMsg(`Solo cuentas con ${saldoDisponible} días hábiles disponibles para este ciclo`);
      setFormErrorActive(true);
      return;
    }
    try {
      await api.post('/solicitudes', fSol);
      setMsg('Solicitud creada');
      setFormErrorActive(false);
      toast('Solicitud creada', { type: 'success', title: 'Vacaciones' });
      setFSol({ idVacaciones:'', fecha_inicio_vac:'', fecha_fin_vac:'' });
      cargar();
    } catch (err) {
      const em = err?.response?.data?.error?.message || err?.response?.data?.message || 'Error creando solicitud';
      setMsg(em);
      setFormErrorActive(false);
      toast(em, { type: 'error', title: 'Vacaciones' });
    }
  };

  const [decidingId, setDecidingId] = useState(null);
  const decidir = async (id, decision) => {
    try {
      setDecidingId(id);
      await api.patch(`/solicitudes/${id}/decidir`, { decision_administracion: decision });
      toast(`Solicitud ${decision.toLowerCase()}`, { type: decision === 'Aprobado' ? 'success' : 'warning', title: 'Vacaciones' });
      cargar();
    } catch (err) {
      const em = err?.response?.data?.error?.message || err?.response?.data?.message || 'Error al decidir';
      setMsg(em);
      toast(em, { type: 'error', title: 'Vacaciones' });
    } finally { setDecidingId(null); }
  };

  const employeeOptions = useMemo(() => {
    const map = new Map();
    items.forEach(v => { if (!map.has(v.idEmpleado)) map.set(v.idEmpleado, v.empleado); });
    return Array.from(map.entries()).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  }, [items]);

  const sortedItems = useMemo(() => (
    [...items].sort((a,b)=>String(a.empleado).localeCompare(String(b.empleado)))
  ), [items]);

  const filteredItems = useMemo(() => {
    let list = sortedItems;
    if (isRH) {
      if (filterEmpleado !== 'all') list = list.filter(v => String(v.idEmpleado) === filterEmpleado);
    } else if (user?.idEmpleado) {
      list = list.filter(v => Number(v.idEmpleado) === Number(user.idEmpleado));
    }
    return list;
  }, [sortedItems, filterEmpleado, isRH, user?.idEmpleado]);

  const vacTotalPages = Math.max(1, Math.ceil(Math.max(filteredItems.length, 1) / PAGE_SIZE));
  const vacPageSafe = Math.min(vacPage, vacTotalPages);
  const vacPageItems = useMemo(() => {
    const start = (vacPageSafe - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, vacPageSafe]);

  const sortedSolicitudes = useMemo(() => (
    [...solicitudes].sort((a,b)=> new Date(b.fecha_inicio_vac || 0) - new Date(a.fecha_inicio_vac || 0))
  ), [solicitudes]);
  const solTotalPages = Math.max(1, Math.ceil(Math.max(sortedSolicitudes.length, 1) / PAGE_SIZE));
  const solPageSafe = Math.min(solPage, solTotalPages);
  const solPageItems = useMemo(() => {
    const start = (solPageSafe - 1) * PAGE_SIZE;
    return sortedSolicitudes.slice(start, start + PAGE_SIZE);
  }, [sortedSolicitudes, solPageSafe]);

  const Pagination = ({ page, total, onChange }) => {
    if (total <= 1) return null;
    return (
      <div className="d-flex justify-content-end align-items-center gap-2 mt-2">
        <small className="text-secondary">P-gina {page} de {total}</small>
        <div className="btn-group btn-group-sm">
          <button className="btn btn-outline-light" disabled={page === 1} onClick={() => onChange(page - 1)}>Anterior</button>
          <button className="btn btn-outline-light" disabled={page === total} onClick={() => onChange(page + 1)}>Siguiente</button>
        </div>
      </div>
    );
  };

  const renderDecisionBadge = (text) => {
    const d = String(text || '').toLowerCase();
    if (d.startsWith('pend')) return <span className="badge text-bg-warning">Pendiente</span>;
    if (d.startsWith('aprob')) return <span className="badge text-bg-success">Aprobado</span>;
    if (d.startsWith('deneg') || d.startsWith('rechaz')) return <span className="badge text-bg-danger">Rechazado</span>;
    return <span className="text-secondary">-</span>;
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Vacaciones</h3>
      </div>
      {msg && <div className="alert alert-dark">{msg}</div>}
      {!isRH && vacBlocked && (
        <div className="alert alert-warning">
          Estás en período de prueba. Podrás solicitar vacaciones después de cumplir 50 semanas de ingreso
          (a partir del {vacUnlockLabel || vacUnlockISO || 'fin del período de prueba'}).
        </div>
      )}

    

      {/* Tabla Vacaciones */}
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h5 className="mb-0">Registros</h5>
        {isRH && (
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 small text-secondary">Filtrar por empleado</label>
            <select className="form-select form-select-sm" style={{ minWidth: '220px' }} value={filterEmpleado} onChange={e => setFilterEmpleado(e.target.value)}>
              <option value="all">Todos</option>
              {employeeOptions.map(([id, nombre]) => (
                <option key={id} value={id}>{nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="table-responsive mb-4">
        <table className="table table-dark table-striped align-middle">
          <thead>
            <tr>
              <th>ID</th><th>Empleado</th><th>Cédula</th><th>Día solicitado</th><th>Disponibles</th><th>Pendientes</th><th>Disfrutados</th>
              <th>Derecho desde</th><th>Ventana hasta</th><th>Días teóricos</th>
            </tr>
          </thead>
          <tbody>
            {vacPageItems.map(v=> (
              <tr key={v.idVacaciones}>
                <td>{v.idVacaciones}</td>
                <td>{v.empleado}</td>
                <td>{v.cedula}</td>
                <td>{v.dia_solicitado?.slice(0,10)}</td>
                <td>{v.dias_calc_disponibles ?? '-'}</td>
                <td>{v.dias_pendientes ?? 0}</td>
                <td>{v.dias_disfrutados}</td>
                <td>{v.derecho_desde || '-'}</td>
                <td>{v.ventana_hasta || '-'}</td>
                <td>{v.dias_teoricos ?? '-'}</td>
              </tr>
            ))}
            {!filteredItems.length && <tr><td colSpan="10" className="text-center text-secondary">Sin registros</td></tr>}
          </tbody>
        </table>
        <Pagination page={vacPageSafe} total={vacTotalPages} onChange={setVacPage} />
      </div>

      {/* Formulario de solicitud (solo empleados) */}
      {!isRH && (
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body">
            <h5 className="card-title">Nueva solicitud de vacaciones</h5>
            {(() => {
              const vacActual = vacSel;
              if (!vacActual) {
                return <div className="alert alert-secondary mb-0">Aún no hay registro de vacaciones para este colaborador.</div>;
              }
              const today = todayStr();
              let winStart = vacActual?.derecho_desde || today;
              let winEnd   = vacActual?.ventana_hasta || undefined;
              let nextStart = null, nextEnd = null;
              if (vacActual?.derecho_desde) {
                const base = new Date(vacActual.derecho_desde);
                nextStart = new Date(base.getTime() + 50*7*24*60*60*1000);
                nextEnd   = new Date(nextStart.getTime() + 15*7*24*60*60*1000);
              }
              if (winEnd && today > winEnd) {
                if (nextStart && nextEnd) {
                  winStart = nextStart.toISOString().slice(0,10);
                  winEnd   = nextEnd.toISOString().slice(0,10);
                  const futureStart = new Date(nextStart.getTime() + 50*7*24*60*60*1000);
                  const futureEnd   = new Date(futureStart.getTime() + 15*7*24*60*60*1000);
                  nextStart = futureStart;
                  nextEnd = futureEnd;
                } else {
                  winStart = today; winEnd = undefined;
                }
              } else if (vacSel?.derecho_desde && today > vacSel.derecho_desde) {
                winStart = today;
              }
              const minStart = winStart;
              const maxStart = winEnd;
              const minEnd = fSol.fecha_inicio_vac || minStart;
              const maxEnd = maxStart;
              return (
                <>
                  {(() => {
                    const blocks = [];
                    if (vacBlocked) {
                      blocks.push({
                        id: 'probacion',
                        variant: 'warning',
                        content: (
                          <>
                            Estás en período de prueba. Podrás solicitar vacaciones a partir del {vacUnlockLabel || vacUnlockISO || 'cumplir 50 semanas de ingreso'}.
                          </>
                        ),
                      });
                    }
                    if (maxStart) {
                      blocks.push({
                        id: 'ventana',
                        variant: 'info',
                        content: (
                          <>
                            Ventana válida para este ciclo: {minStart} a {maxStart}
                            {nextStart && (
                              <span className="ms-2 text-secondary">
                                | Próxima ventana: {nextStart.toISOString().slice(0,10)} a {nextEnd.toISOString().slice(0,10)}
                              </span>
                            )}
                          </>
                        ),
                      });
                    }
                    const saldoVariant = excedeSaldo ? 'danger' : (diasSeleccionados ? 'success' : 'secondary');
                    blocks.push({
                      id: 'saldo',
                      variant: saldoVariant,
                      content: (
                        <>
                          <strong>Saldo:</strong> {saldoDisponible} días hábiles disponibles
                          {Boolean(diasPendientesVac) && <span className="ms-2">Pendientes: {diasPendientesVac}</span>}
                          {Boolean(diasSeleccionados) && <span className="ms-2">Seleccionados: {diasSeleccionados}</span>}
                        </>
                      ),
                    });
                    if (invalidEdges.length) {
                      invalidEdges.forEach((edge) => {
                        const label = edge.position === 'start' ? 'El inicio seleccionado' : 'El fin seleccionado';
                        const detail = edge.type === 'feriado'
                          ? `es feriado${edge.nombre ? ` (${edge.nombre})` : ''}`
                          : 'es domingo';
                        blocks.push({
                          id: `laboral-edge-${edge.position}`,
                          variant: 'danger',
                          content: `${label} (${edge.fecha}) ${detail} y no pertenece a la jornada laboral.`,
                        });
                      });
                    }
                    if (noteLaboral) {
                      const label = noteLaboral.nombre ? `es feriado (${noteLaboral.nombre})` : 'es feriado';
                      blocks.push({
                        id: 'laboral-note',
                        variant: 'info',
                        content: `La fecha ${noteLaboral.fecha} ${label} y no se descuenta del saldo.`,
                      });
                    }
                    if (excedeSaldo) {
                      blocks.push({
                        id: 'saldoInsuf',
                        variant: 'danger',
                        content: `No puedes solicitar más de ${saldoDisponible} días hábiles disponibles.`,
                      });
                    }
                    if (!blocks.length) return null;
                    return (
                      <div className="d-flex flex-column gap-2 mb-3">
                        {blocks.map(block => (
                          <div key={block.id} className={`alert alert-${block.variant} py-2 mb-0 border-0 shadow-sm small`}>
                            {block.content}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <form onSubmit={crearSolicitud} autoComplete="off">
                    <fieldset className="row g-3" disabled={vacBlocked}>
                      <div className="col-md-4">
                        <label className="form-label">Vacaciones (ID)</label>
                        <input className="form-control" value={vacActual ? `#${vacActual.idVacaciones}` : 'Sin registro de vacaciones'} disabled />
                      </div>
                      <div className="col-md-3">
                        <label className="form-label">Inicio</label>
                        <input type="date" className="form-control" name="fecha_inicio_vac" value={fSol.fecha_inicio_vac} onChange={onChangeSol} min={minStart} max={maxStart} required/>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label">Fin</label>
                        <input type="date" className="form-control" name="fecha_fin_vac" value={fSol.fecha_fin_vac} onChange={onChangeSol} min={minEnd} max={maxEnd} required/>
                      </div>
                      <div className="col-md-2 d-flex align-items-end">
                        <button className="btn btn-primary w-100" disabled={!puedeEnviar}>Crear solicitud</button>
                      </div>
                    </fieldset>
                  </form>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <h5 className="mb-2">Solicitudes</h5>
      <div className="table-responsive">
        <table className="table table-dark table-striped align-middle">
          <thead>
            <tr>
              <th>ID</th><th>Empleado</th><th>Cédula</th><th>Inicio</th><th>Fin</th><th>Decisión</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {solPageItems.map(s=> (
              <tr key={s.idSolicitud}>
                <td>{s.idSolicitud}</td>
                <td>{s.empleado}</td>
                <td>{s.cedula}</td>
                <td>{s.fecha_inicio_vac?.slice(0,10)}</td>
                <td>{s.fecha_fin_vac?.slice(0,10)}</td>
                <td>{renderDecisionBadge(s.decision_administracion)}</td>
                <td className="d-flex gap-2">
                  {hasPerm('vacaciones_aprobar_RH') && String(s.decision_administracion).toLowerCase()==='pendiente' ? (
                    <>
                      <button className="btn btn-success btn-sm" disabled={decidingId===s.idSolicitud} onClick={()=>decidir(s.idSolicitud,'Aprobado')}>Aprobar</button>
                      <button className="btn btn-danger btn-sm" disabled={decidingId===s.idSolicitud} onClick={()=>decidir(s.idSolicitud,'Rechazado')}>Rechazar</button>
                    </>
                  ) : (
                    <span className="text-secondary small">-</span>
                  )}
                </td>
              </tr>
            ))}
            {!sortedSolicitudes.length && <tr><td colSpan="7" className="text-center text-secondary">No hay solicitudes</td></tr>}
          </tbody>
        </table>
        <Pagination page={solPageSafe} total={solTotalPages} onChange={setSolPage} />
      </div>
    </div>
  );
}


