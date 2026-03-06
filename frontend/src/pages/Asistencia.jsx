import { useCallback, useEffect, useMemo, useState } from 'react';
import BackToHome from '../components/BackToHome';
import { fetchAsistenciaResumen, marcarAsistencia, solicitarHorasExtra } from '../api/asistencia';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';

function formatNombre(empleado) {
  if (!empleado) return '';
  const parts = [empleado.nombre, empleado.apellido1, empleado.apellido2].filter(Boolean);
  return parts.join(' ');
}

function formatFecha(fecha) {
  if (!fecha) return '-';
  return String(fecha).slice(0, 10);
}

function formatHora(hora) {
  if (!hora) return '-';
  const raw = hora instanceof Date ? hora.toISOString() : String(hora);
  const isoMatch = raw.match(/(\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];
  const hmMatch = raw.match(/(\d{2}:\d{2})(?::(\d{2}))?/);
  if (hmMatch) {
    const [, hm, ss] = hmMatch;
    return ss ? `${hm}:${ss}` : `${hm}:00`;
  }
  return raw.slice(-8);
}

function formatHoras(value) {
  return Number(value || 0).toFixed(2);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function renderDecisionBadge(decision) {
  const val = String(decision || '').toLowerCase();
  if (val.startsWith('aprob')) return <span className="badge text-bg-success">Aprobado</span>;
  if (val.startsWith('pend')) return <span className="badge text-bg-warning">Pendiente</span>;
  if (val.startsWith('deneg') || val.startsWith('rech')) return <span className="badge text-bg-danger">Denegado</span>;
  return <span className="badge text-bg-secondary">Sin estado</span>;
}

export default function Asistencia() {
  const toast = useToast();
  const { user, hasPerm } = useAuth();
  const esRH = Boolean(user?.idRol === 3 || hasPerm('asistencia_ver_RH'));
  const puedeMarcar = esRH || hasPerm('asistencia_marcar_EMPLEADO');

  const [loading, setLoading] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [solicitando, setSolicitando] = useState(false);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const [selectedEmpleado, setSelectedEmpleado] = useState('');
  const [selectedHorario, setSelectedHorario] = useState('');
  const [empleados, setEmpleados] = useState([]);
  const [horarios, setHorarios] = useState([]);
  const [datos, setDatos] = useState(null);

  const cargar = useCallback(async (empleadoIdParam = '') => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      const targetEmpleado = empleadoIdParam ? String(empleadoIdParam) : '';
      if (targetEmpleado) params.empleado = targetEmpleado;
      const resp = await fetchAsistenciaResumen(params);
      const info = resp?.data || {};
      setDatos(info);

      const combos = info.combos || {};
      const listadoEmpleados = combos.empleados && combos.empleados.length
        ? combos.empleados
        : (info.empleado ? [info.empleado] : []);
      setEmpleados(listadoEmpleados);

      const dataEmpleadoId = info.empleado ? String(info.empleado.idEmpleado) : '';
      setSelectedEmpleado((prev) => {
        if (targetEmpleado) return targetEmpleado;
        if (prev && listadoEmpleados.some((emp) => String(emp.idEmpleado) === String(prev))) return prev;
        return dataEmpleadoId;
      });

      const listadoHorarios = combos.horarios || [];
      setHorarios(listadoHorarios);
      setSelectedHorario((prev) => {
        if (prev && listadoHorarios.some((h) => String(h.idHorario) === String(prev))) return prev;
        return listadoHorarios[0] ? String(listadoHorarios[0].idHorario) : '';
      });
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'No se pudo cargar la asistencia';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const onChangeEmpleado = async (e) => {
    const value = e.target.value;
    setSelectedEmpleado(value);
    await cargar(value);
  };

  const onChangeHorario = (e) => {
    setSelectedHorario(e.target.value);
  };

  const resumen = datos?.resumen || {};
  const feriadoInfo = datos?.feriado || {};
  const esFeriado = Boolean(feriadoInfo?.esFeriado ?? resumen?.esFeriado);
  const feriadoNombre = feriadoInfo?.nombre || resumen?.feriadoNombre || '';
  const recientes = useMemo(() => datos?.recientes || [], [datos?.recientes]);
  const extrasHoy = useMemo(() => datos?.extrasHoy || [], [datos?.extrasHoy]);
  const puedeSolicitarExtra = Boolean(datos?.puedeSolicitarExtra);
  const quincena = datos?.quincena;
  const horasQuincenaLabel = quincena
    ? `${formatHoras(quincena.horasTrabajadas)} / ${formatHoras(quincena.horasEsperadas)} h`
    : null;

  const horasExtraRegistradas = useMemo(
    () => extrasHoy.reduce((acc, item) => acc + Number(item.horas_extras || 0), 0),
    [extrasHoy]
  );

  const filteredRecientes = useMemo(() => {
    if (!busqueda.trim()) return recientes;
    const q = busqueda.trim().toLowerCase();
    return recientes.filter((row) => {
      const values = [
        row.fecha,
        row.hora,
        row.empleado,
        row.cedula,
        row.marca,
        row.horario,
      ].map((v) => String(v || '').toLowerCase());
      return values.some((v) => v.includes(q));
    });
  }, [busqueda, recientes]);

  const puedeEntrada = puedeMarcar && resumen.puedeMarcarEntrada;
  const puedeSalida = puedeMarcar && resumen.puedeMarcarSalida;
  const haySolicitudes = extrasHoy.length > 0;
  const solicitudPendiente = extrasHoy.find(
    (item) => String(item.decision || '').toLowerCase() === 'pendiente'
  );

  const realizarMarca = async (tipo) => {
    if (!puedeMarcar) return;
    const empleadoId = selectedEmpleado || (datos?.empleado?.idEmpleado ? String(datos.empleado.idEmpleado) : '');
    const horarioId = selectedHorario;
    if (!empleadoId) {
      setError('Selecciona un empleado');
      return;
    }
    if (!horarioId) {
      setError('Selecciona un horario');
      return;
    }
    try {
      setMarcando(true);
      setError('');
      await marcarAsistencia({
        idEmpleado: Number(empleadoId),
        idHorario: Number(horarioId),
        marca: tipo,
      });
      toast(`${tipo} registrada`, { type: 'success', title: 'Asistencia' });
      await cargar(empleadoId);
    } catch (err) {
      let msg = err?.response?.data?.message || err?.message || `No se pudo registrar ${tipo.toLowerCase()}`;
      if (err?.response?.status === 409 && tipo === 'Salida') {
        msg = 'Debes completar las 8 horas de tu jornada antes de marcar la salida.';
      }
      setError(msg);
      toast(msg, { type: 'error', title: 'Asistencia' });
    } finally {
      setMarcando(false);
    }
  };

  const solicitarExtra = async () => {
    if (!puedeSolicitarExtra || !datos?.fecha) return;
    try {
      setSolicitando(true);
      setError('');
      const tipoExtra = esFeriado ? 'feriado' : 'ordinaria';
      await solicitarHorasExtra({
        fecha: datos.fecha,
        horas_extras: resumen.horasExtraCalculadas,
        tipo: tipoExtra,
      });
      toast('Solicitud de horas extra enviada', { type: 'success', title: 'Asistencia' });
      await cargar(selectedEmpleado);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'No se pudo solicitar horas extra';
      setError(msg);
      toast(msg, { type: 'error', title: 'Asistencia' });
    } finally {
      setSolicitando(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-4">
        <BackToHome />
        <h3 className="mb-0">Control de Asistencia</h3>
      </div>

      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => setError('')}>Cerrar</button>
        </div>
      )}

      {esFeriado && (
        <div className="alert alert-warning d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <strong>{feriadoNombre || 'Feriado oficial'}</strong>
            {datos?.fecha && (
              <span className="ms-2">({formatFecha(datos.fecha)})</span>
            )}
          </div>
          <small className="text-dark">
            Las horas trabajadas hoy se liquidarán automáticamente como feriado en planilla.
          </small>
        </div>
      )}

      <div className="card bg-dark border-0 shadow-sm mb-4">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label text-secondary">Empleado</label>
              {esRH ? (
                <select
                  className="form-select form-select-lg bg-dark text-white border-secondary"
                  value={selectedEmpleado}
                  onChange={onChangeEmpleado}
                  disabled={loading}
                >
                  {empleados.length === 0 ? <option value="">Sin empleados</option> : null}
                  {empleados.map((emp) => (
                    <option key={emp.idEmpleado} value={emp.idEmpleado}>
                      {emp.cedula ? `${emp.cedula} - ${formatNombre(emp)}` : formatNombre(emp)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="form-control form-control-lg bg-dark text-white border-secondary"
                  value={`${datos?.empleado?.cedula || ''} - ${formatNombre(datos?.empleado)}`}
                  readOnly
                />
              )}
            </div>
            <div className="col-md-4">
              <label className="form-label text-secondary">Horario</label>
              <select
                className="form-select form-select-lg bg-dark text-white border-secondary"
                value={selectedHorario}
                onChange={onChangeHorario}
                disabled={!puedeMarcar || horarios.length === 0 || loading}
              >
                {horarios.length === 0 ? <option value="">Sin horarios</option> : null}
                {horarios.map((h) => (
                  <option key={h.idHorario} value={h.idHorario}>{h.nombre}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3 d-flex align-items-end justify-content-end gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-success btn-lg px-4"
                disabled={!puedeEntrada || marcando || loading}
                onClick={() => realizarMarca('Entrada')}
              >
                {marcando && puedeEntrada ? 'Marcando...' : 'Entrada'}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-lg px-4"
                disabled={!puedeSalida || marcando || loading}
                onClick={() => realizarMarca('Salida')}
              >
                {marcando && puedeSalida ? 'Marcando...' : 'Salida'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <div className="card bg-dark border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="card-title text-secondary">Estado del día</h5>
              <p className="mb-1">Fecha: <strong>{datos?.fecha || '-'}</strong></p>
              <p className="mb-1">
                Entrada registrada: <strong>{resumen.tieneEntrada ? 'S\u00ed' : 'No'}</strong>
                {resumen.horaEntrada ? ` (${resumen.horaEntrada})` : ''}
              </p>
              <p className="mb-3">
                Salida registrada: <strong>{resumen.tieneSalida ? 'S\u00ed' : 'No'}</strong>
                {resumen.horaSalida ? ` (${resumen.horaSalida})` : ''}
              </p>
              <hr className="border-secondary" />
              <p className="mb-1">Horas trabajadas (netas): <strong>{formatHoras(resumen.horasNetas)} h</strong></p>
              <p className="mb-1">Horas ordinarias: <strong>{formatHoras(resumen.horasOrdinarias)} h</strong></p>
              <p className="mb-3">Horas extra calculadas: <strong>{formatHoras(resumen.horasExtraCalculadas)} h</strong></p>
              {!esRH && (
                <div className="d-flex flex-column gap-2">
                  {puedeSolicitarExtra ? (
                    <button
                      type="button"
                      className="btn btn-warning align-self-start"
                      onClick={solicitarExtra}
                      disabled={solicitando || loading}
                    >
                      {solicitando ? 'Enviando...' : 'Solicitar horas extra'}
                    </button>
                  ) : (
                    <small className="text-secondary">
                      {resumen.horasExtraCalculadas > 0
                        ? 'Horas extra calculadas registradas. Revisa tus solicitudes abajo.'
                        : 'Sin horas extra calculadas para hoy.'}
                    </small>
                  )}
                  {solicitudPendiente && (
                    <span className="badge text-bg-warning align-self-start">
                      Pendiente de RRHH ({formatHoras(solicitudPendiente.horas_extras)} h)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card bg-dark border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="card-title text-secondary">Resumen rapido</h5>
              <ul className="list-unstyled mb-0">
                <li className="mb-2">
                   Puedes marcar entrada: <strong>{puedeEntrada ? 'Disponible' : 'No disponible'}</strong>
                </li>
                <li className="mb-2">
                   Puedes marcar salida: <strong>{puedeSalida ? 'Disponible' : 'No disponible'}</strong>
                </li>
                <li className="mb-2">
                   Registros de hoy: <strong>{(resumen.marcasHoy || []).length}</strong>
                </li>
                <li className="mb-2">
                   Horarios disponibles: <strong>{horarios.length}</strong>
                </li>
                {horasQuincenaLabel && (
                  <li className="mb-2">
                    Horas quincenales:{' '}
                    <strong>
                      {horasQuincenaLabel} ({formatPercent(quincena?.cumplimiento)})
                    </strong>
                    <br />
                    <small className="text-secondary">
                      {formatFecha(quincena.desde)} al {formatFecha(quincena.hasta)}
                    </small>
                  </li>
                )}
                <li className="text-secondary small">
                   Horas extra solicitadas hoy: {formatHoras(horasExtraRegistradas)} h
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Solicitudes de horas extra</h5>
          <small className="text-secondary">
            {haySolicitudes ? 'Historial del d\u00eda' : 'Sin solicitudes para el d\u00eda seleccionado'}
          </small>
        </div>
        <div className="table-responsive shadow-sm">
          <table className="table table-dark table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Horas</th>
                <th>Estado</th>
                <th>Factor</th>
              </tr>
            </thead>
            <tbody>
              {haySolicitudes ? (
                extrasHoy.map((item) => (
                  <tr key={item.idHoras_Extras}>
                    <td>{formatFecha(item.fecha || datos?.fecha)}</td>
                    <td>{formatHoras(item.horas_extras)}</td>
                    <td>{renderDecisionBadge(item.decision)}</td>
                    <td>{item.factor ? Number(item.factor).toFixed(2) : '1.50'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center text-secondary py-3">
                    {resumen.horasExtraCalculadas > 0
                      ? 'A\u00fan no has solicitado estas horas extra.'
                      : 'Sin horas extra calculadas para mostrar.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="d-flex align-items-center justify-content-between mb-2">
        <h5 className="mb-0">Registros recientes</h5>
        <div className="d-flex align-items-center gap-2">
          <label htmlFor="buscar" className="text-secondary mb-0">Buscar</label>
          <input
            id="buscar"
            className="form-control bg-dark text-white border-secondary"
            placeholder="Filtrar por fecha, empleado o marca"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>
      <div className="table-responsive shadow-sm">
        <table className="table table-dark table-striped align-middle mb-0">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Empleado</th>
              <th>Cedula</th>
              <th>Marca</th>
              <th>Horario</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecientes.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-secondary py-4">
                  {loading ? 'Cargando registros...' : 'Sin registros para mostrar'}
                </td>
              </tr>
            ) : filteredRecientes.map((row) => (
              <tr key={row.idControlAsistencia}>
                <td>{formatFecha(row.fecha)}</td>
                <td>{formatHora(row.hora)}</td>
                <td>{row.empleado}</td>
                <td>{row.cedula}</td>
                <td>{row.marca}</td>
                <td>{row.horario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
