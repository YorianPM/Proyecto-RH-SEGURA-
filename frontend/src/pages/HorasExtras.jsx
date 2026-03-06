import { useCallback, useEffect, useMemo, useState } from 'react';
import BackToHome from '../components/BackToHome';
import {
  aprobarHorasExtra,
  denegarHorasExtra,
  fetchHorasExtras,
} from '../api/horasExtras';
import { api } from '../api';
import { useToast } from '../context/toastStore';

function getEmpleadoId(row) {
  return (
    row?.idEmpleado ??
    row?.IDEMPLEADO ??
    row?.id_empleado ??
    row?.idempleado ??
    row?.IdEmpleado ??
    null
  );
}

function formatNombre(row) {
  if (!row) return '-';
  if (row.empleado) return row.empleado;
  if (row.EMPLEADO) return row.EMPLEADO;
  const nombre =
    row.nombre ??
    row.NOMBRE ??
    row.nombre_empleado ??
    row.NOMBRE_EMPLEADO ??
    '';
  const apellido1 =
    row.apellido1 ?? row.APELLIDO1 ?? row.apellido_uno ?? '';
  const apellido2 =
    row.apellido2 ?? row.APELLIDO2 ?? row.apellido_dos ?? '';
  const parts = [nombre, apellido1, apellido2].filter(Boolean);
  return parts.length ? parts.join(' ') : '-';
}

function formatFecha(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function formatHora(value) {
  if (!value) return '-';
  const raw = value instanceof Date ? value.toISOString() : String(value);
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

function normalizeDecision(value) {
  const val = String(value || '').toLowerCase();
  if (val.startsWith('aprob')) return 'Aprobado';
  if (val.startsWith('deneg') || val.startsWith('rech')) return 'Denegado';
  if (val.startsWith('pend') || !val) return 'Pendiente';
  return value;
}

function normalizeHorasRow(row) {
  const rawId =
    row.idHoras_Extras ??
    row.idhoras_extras ??
    row.idHorasExtras ??
    row.id ??
    null;
  const idNumero = Number(rawId);
  const fechaAsistencia =
    row.fecha_asistencia ?? row.fechaAsistencia ?? row.fecha ?? null;
  const fechaRegistro = row.fecha ?? row.fechaRegistro ?? null;
  const horas = Number(row.horas_extras ?? row.horas ?? 0);
  return {
    id: rawId != null ? String(rawId) : `${row.idEmpleado}-${fechaAsistencia || ''}`,
    idNumero: Number.isFinite(idNumero) ? idNumero : null,
    idEmpleado: getEmpleadoId(row),
    empleado: formatNombre(row),
    cedula: row.cedula ?? row.CEDULA ?? row.cedula_empleado ?? '-',
    fecha: formatFecha(fechaAsistencia),
    fechaRegistro: formatFecha(fechaRegistro),
    hora: formatHora(row.hora_marca ?? row.hora ?? null),
    horas,
    decision: normalizeDecision(row.decision),
    factor: row.factor ?? row.FACTOR ?? null,
  };
}

function toBadge(decision) {
  const val = String(decision || '').toLowerCase();
  if (val.startsWith('aprob')) return 'success';
  if (val.startsWith('deneg') || val.startsWith('rech')) return 'danger';
  if (val.startsWith('pend')) return 'warning';
  return 'secondary';
}

export default function HorasExtras() {
  const toast = useToast();

  const [empleados, setEmpleados] = useState([]);
  const [selectedEmpleado, setSelectedEmpleado] = useState('');
  const [buscarEmpleado, setBuscarEmpleado] = useState('');

  const [pendientes, setPendientes] = useState([]);
  const [historial, setHistorial] = useState([]);

  const [buscarPendiente, setBuscarPendiente] = useState('');
  const [buscarHistorial, setBuscarHistorial] = useState('');
  const [filtroDecision, setFiltroDecision] = useState('Todos');

  const [loadingPendientes, setLoadingPendientes] = useState(false);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [loadingEmpleados, setLoadingEmpleados] = useState(false);
  const [accionandoId, setAccionandoId] = useState('');
  const [error, setError] = useState('');

  const cargarEmpleados = useCallback(async () => {
    try {
      setLoadingEmpleados(true);
      const resp = await api
        .get('/empleados', { params: { limit: 400 } })
        .catch(() => ({ data: { data: [] } }));
      const lista = Array.isArray(resp?.data?.data) ? resp.data.data : [];
      const ordenados = [...lista].sort((a, b) =>
        formatNombre(a).toLowerCase().localeCompare(formatNombre(b).toLowerCase(), 'es')
      );
      setEmpleados(ordenados);
      setSelectedEmpleado((prev) => prev);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'No se pudieron cargar los empleados';
      setError(msg);
      setEmpleados([]);
    } finally {
      setLoadingEmpleados(false);
    }
  }, []);

  const cargarPendientes = useCallback(
    async (empleadoId) => {
      try {
        setLoadingPendientes(true);
        const params = { decision: 'Pendiente' };
        if (empleadoId) params.empleado = empleadoId;
        const resp = await fetchHorasExtras(params);
        const lista = Array.isArray(resp?.data)
          ? resp.data.map(normalizeHorasRow)
          : [];
        setPendientes(lista);
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar las solicitudes pendientes';
        setError(msg);
        setPendientes([]);
      } finally {
        setLoadingPendientes(false);
      }
    },
    []
  );

  const cargarHistorial = useCallback(
    async (empleadoId) => {
      try {
        setLoadingHistorial(true);
        const params = {};
        if (empleadoId) params.empleado = empleadoId;
        const resp = await fetchHorasExtras(params);
        const lista = Array.isArray(resp?.data)
          ? resp.data.map(normalizeHorasRow)
          : [];
        setHistorial(lista);
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar el historial';
        setError(msg);
        setHistorial([]);
      } finally {
        setLoadingHistorial(false);
      }
    },
    []
  );

  useEffect(() => {
    cargarEmpleados();
  }, [cargarEmpleados]);

  useEffect(() => {
    cargarPendientes(selectedEmpleado);
    cargarHistorial(selectedEmpleado);
  }, [cargarPendientes, cargarHistorial, selectedEmpleado]);

  const empleadosFiltrados = useMemo(() => {
    const q = buscarEmpleado.trim().toLowerCase();
    if (!q) return empleados;
    return empleados.filter((emp) => {
      const texto = [
        emp.cedula ?? '',
        formatNombre(emp),
        String(getEmpleadoId(emp) ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      return texto.includes(q);
    });
  }, [empleados, buscarEmpleado]);

  const empleadosLista = useMemo(() => {
    const vistos = new Set();
    const lista = [];
    const pushUnique = (emp) => {
      const id = getEmpleadoId(emp);
      const key = id != null ? String(id) : formatNombre(emp);
      if (vistos.has(key)) return;
      vistos.add(key);
      lista.push(emp);
    };
    empleadosFiltrados.forEach(pushUnique);
    if (selectedEmpleado) {
      const actual = empleados.find(
        (emp) => String(getEmpleadoId(emp)) === String(selectedEmpleado)
      );
      if (actual) pushUnique(actual);
    }
    return lista;
  }, [empleadosFiltrados, empleados, selectedEmpleado]);

  const empleadoActual = useMemo(() => {
    if (!selectedEmpleado) return null;
    return (
      empleados.find(
        (emp) => String(getEmpleadoId(emp)) === String(selectedEmpleado)
      ) || null
    );
  }, [empleados, selectedEmpleado]);

  const resumenEmpleado = useMemo(() => {
    const base = {
      Pendiente: { registros: 0, horas: 0 },
      Aprobado: { registros: 0, horas: 0 },
      Denegado: { registros: 0, horas: 0 },
    };
    historial.forEach((row) => {
      const key = normalizeDecision(row.decision);
      if (!base[key]) {
        base[key] = { registros: 0, horas: 0 };
      }
      base[key].registros += 1;
      base[key].horas += Number(row.horas || 0);
    });
    return base;
  }, [historial]);

  const pendienteFiltrado = useMemo(() => {
    const q = buscarPendiente.trim().toLowerCase();
    if (!q) return pendientes;
    return pendientes.filter((row) => {
      const valores = [
        row.empleado,
        row.cedula,
        row.fecha,
        row.hora,
        row.horas,
      ].map((v) => String(v || '').toLowerCase());
      return valores.some((v) => v.includes(q));
    });
  }, [pendientes, buscarPendiente]);

  const historialFiltrado = useMemo(() => {
    const q = buscarHistorial.trim().toLowerCase();
    return historial.filter((row) => {
      if (filtroDecision !== 'Todos' && row.decision !== filtroDecision) {
        return false;
      }
      if (!q) return true;
      const valores = [
        row.empleado,
        row.cedula,
        row.fecha,
        row.fechaRegistro,
        row.decision,
        row.horas,
      ].map((v) => String(v || '').toLowerCase());
      return valores.some((v) => v.includes(q));
    });
  }, [historial, buscarHistorial, filtroDecision]);

  const totalPendientesHoras = useMemo(
    () =>
      pendienteFiltrado.reduce((acc, row) => acc + Number(row.horas || 0), 0),
    [pendienteFiltrado]
  );

  const totalHistorialHoras = useMemo(
    () =>
      historialFiltrado.reduce((acc, row) => acc + Number(row.horas || 0), 0),
    [historialFiltrado]
  );

  const onAccion = async (row, tipo) => {
    const numericId = row.id != null ? Number(row.id) : null;
    const targetId = row.idNumero ?? numericId ?? row.id;
    if (targetId == null || Number.isNaN(targetId)) {
      toast('No se pudo identificar el registro', {
        type: 'error',
        title: 'Horas extra',
      });
      return;
    }
    try {
      setAccionandoId(String(row.id));
      setError('');
      if (tipo === 'aprobar') {
        await aprobarHorasExtra(targetId);
        toast('Horas extra aprobadas', {
          type: 'success',
          title: 'Horas extra',
        });
      } else {
        await denegarHorasExtra(targetId);
        toast('Horas extra denegadas', {
          type: 'warning',
          title: 'Horas extra',
        });
      }
      await Promise.all([
        cargarPendientes(selectedEmpleado),
        cargarHistorial(selectedEmpleado),
      ]);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'No se pudo completar la accion';
      setError(msg);
      toast(msg, { type: 'error', title: 'Horas extra' });
    } finally {
      setAccionandoId('');
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-4">
        <BackToHome />
        <h3 className="mb-0">Horas extra</h3>
      </div>

      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={() => setError('')}
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="card bg-dark border-0 shadow-sm mb-4">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-5">
              <label className="form-label text-secondary">Empleado</label>
              <select
                className="form-select form-select-lg bg-dark text-white border-secondary"
                value={selectedEmpleado}
                onChange={(e) => setSelectedEmpleado(e.target.value)}
                disabled={loadingEmpleados}
              >
                <option value="">Todos los empleados</option>
                {empleadosLista.length === 0 ? (
                  <option value="__none" disabled>
                    Sin empleados
                  </option>
                ) : null}
                {empleadosLista.map((emp) => {
                  const id = getEmpleadoId(emp);
                  const value = id != null ? String(id) : '';
                  const nombre = formatNombre(emp);
                  const cedula = emp.cedula ?? '';
                  const etiqueta = cedula ? `${cedula} - ${nombre}` : nombre;
                  return (
                    <option key={`${value}-${nombre}`} value={value}>
                      {etiqueta}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label text-secondary">Buscar empleado</label>
              <input
                className="form-control form-control-lg bg-dark text-white border-secondary"
                placeholder="Filtrar por nombre o cedula"
                value={buscarEmpleado}
                onChange={(e) => setBuscarEmpleado(e.target.value)}
                disabled={loadingEmpleados}
              />
            </div>
            <div className="col-md-3">
              <div className="bg-secondary bg-opacity-10 rounded p-3 h-100 d-flex flex-column justify-content-center">
                <span className="text-secondary small mb-1">
                  Seleccion actual
                </span>
                <strong>
                  {selectedEmpleado
                    ? formatNombre(empleadoActual)
                    : 'Todos los empleados'}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <div className="card bg-dark border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="card-title text-secondary">Resumen de solicitudes</h5>
              <p className="mb-1">
                Total registros: <strong>{historial.length}</strong>
              </p>
              <p className="mb-1">
                Pendientes: <strong>{resumenEmpleado.Pendiente.registros}</strong>{' '}
                ({formatHoras(resumenEmpleado.Pendiente.horas)} h)
              </p>
              <p className="mb-1">
                Aprobadas: <strong>{resumenEmpleado.Aprobado.registros}</strong>{' '}
                ({formatHoras(resumenEmpleado.Aprobado.horas)} h)
              </p>
              <p className="mb-0">
                Denegadas: <strong>{resumenEmpleado.Denegado.registros}</strong>{' '}
                ({formatHoras(resumenEmpleado.Denegado.horas)} h)
              </p>
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card bg-dark border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="card-title text-secondary">Notas</h5>
              <ul className="mb-0">
                <li className="mb-2">
                  Usa el buscador para filtrar empleados y revisar sus horas
                  extra del dia.
                </li>
                <li className="mb-2">
                  Las solicitudes pendientes aparecen primero para que puedas
                  aprobar o denegar de inmediato.
                </li>
                <li>
                  Cada accion actualiza los totales y mueve la solicitud al
                  historial con su decision.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <section className="mb-4">
        <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <h5 className="mb-0">Solicitudes pendientes</h5>
            <span className="badge text-bg-warning">
              {pendienteFiltrado.length} regs / {formatHoras(totalPendientesHoras)} h
            </span>
          </div>
          <input
            className="form-control bg-dark text-white border-secondary"
            style={{ maxWidth: 280 }}
            placeholder="Buscar pendiente (empleado, fecha, cedula)"
            value={buscarPendiente}
            onChange={(e) => setBuscarPendiente(e.target.value)}
          />
        </div>
        <div className="table-responsive shadow-sm">
          <table className="table table-dark table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Empleado</th>
                <th>Cedula</th>
                <th className="text-center">Horas extra</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loadingPendientes ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-secondary">
                    Cargando solicitudes...
                  </td>
                </tr>
              ) : pendienteFiltrado.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-secondary">
                    Sin solicitudes pendientes para mostrar
                  </td>
                </tr>
              ) : (
                pendienteFiltrado.map((row) => (
                  <tr key={row.id}>
                    <td>{row.fecha}</td>
                    <td>{row.hora}</td>
                    <td>{row.empleado}</td>
                    <td>{row.cedula}</td>
                    <td className="text-center">
                      <strong>{formatHoras(row.horas)}</strong> h
                    </td>
                    <td className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={accionandoId === row.id}
                        onClick={() => onAccion(row, 'aprobar')}
                      >
                        {accionandoId === row.id ? 'Procesando...' : 'Aprobar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        disabled={accionandoId === row.id}
                        onClick={() => onAccion(row, 'denegar')}
                      >
                        Denegar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
          <h5 className="mb-0">Historial</h5>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <select
              className="form-select bg-dark text-white border-secondary"
              value={filtroDecision}
              onChange={(e) => setFiltroDecision(e.target.value)}
            >
              <option value="Todos">Todos</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Aprobado">Aprobado</option>
              <option value="Denegado">Denegado</option>
            </select>
            <input
              className="form-control bg-dark text-white border-secondary"
              style={{ maxWidth: 280 }}
              placeholder="Buscar en historial"
              value={buscarHistorial}
              onChange={(e) => setBuscarHistorial(e.target.value)}
            />
          </div>
        </div>
        <div className="d-flex justify-content-between text-secondary small mb-2">
          <span>{historialFiltrado.length} registros</span>
          <span>Total horas: {formatHoras(totalHistorialHoras)} h</span>
        </div>
        <div className="table-responsive shadow-sm">
          <table className="table table-dark table-striped align-middle mb-0">
            <thead>
              <tr>
                <th>Fecha asistencia</th>
                <th>Fecha registro</th>
                <th>Empleado</th>
                <th className="text-center">Horas extra</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {loadingHistorial ? (
                <tr>
                  <td colSpan={5} className="text-center py-4 text-secondary">
                    Cargando historial...
                  </td>
                </tr>
              ) : historialFiltrado.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-4 text-secondary">
                    Sin registros para mostrar
                  </td>
                </tr>
              ) : (
                historialFiltrado.map((row) => (
                  <tr key={`${row.id}-hist`}>
                    <td>{row.fecha}</td>
                    <td>{row.fechaRegistro}</td>
                    <td>{row.empleado}</td>
                    <td className="text-center">
                      <strong>{formatHoras(row.horas)}</strong> h
                    </td>
                    <td>
                      <span className={`badge text-bg-${toBadge(row.decision)}`}>
                        {row.decision || 'Pendiente'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

