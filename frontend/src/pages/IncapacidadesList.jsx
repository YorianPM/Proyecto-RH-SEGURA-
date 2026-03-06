import { useCallback, useEffect, useMemo, useState } from 'react';
import BackToHome from '../components/BackToHome';
import { getIncapacidades, updateIncapacidadEstado } from '../api/incapacidades';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';

// Mapeo de estados a etiquetas y clases Bootstrap
const STATUS_META = {
  0: { label: 'Pendiente', className: 'badge bg-secondary' },
  1: { label: 'Aprobada', className: 'badge bg-success' },
  2: { label: 'Desaprobada', className: 'badge bg-danger' }
};

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/api\/?$/, '');

const buildFileUrl = (path) => {
  if (!path) return null;
  return `${apiBase}/uploads/${path}`.replace(/([^:]\/)\/+/g, '$1');
};

const formatFecha = (value) => {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('es-CR');
  } catch {
    return value;
  }
};

const formatMoneda = (value) => {
  const num = Number(value || 0);
  const formatted = num.toLocaleString('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `₡ ${formatted}`;
};

export default function IncapacidadesList() {
  const { hasPerm, user } = useAuth();
  const esRH = Boolean(
    user?.idRol === 3 ||
    hasPerm?.('permisos_aprobar_RH') ||
    hasPerm?.('vacaciones_aprobar_RH')
  );
  const userId = user?.idEmpleado;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('all');
  const [notes, setNotes] = useState({});
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const list = await getIncapacidades();
      const filtered = esRH || !userId
        ? list
        : list.filter(r => Number(r.idEmpleado) === Number(userId));
      setRows(filtered);
    } catch (err) {
      console.error('Error cargando incapacidades', err);
      const text = 'Error cargando incapacidades';
      setMsg(text);
      toast?.(text, { type: 'error', title: 'Incapacidades' });
    } finally {
      setLoading(false);
    }
  }, [esRH, toast, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    switch (filter) {
      case 'pending':
        return rows.filter(r => Number(r.estado) === 0);
      case 'approved':
        return rows.filter(r => Number(r.estado) === 1);
      case 'rejected':
        return rows.filter(r => Number(r.estado) === 2);
      default:
        return rows;
    }
  }, [rows, filter]);

  const handleEstado = async (row, nextEstado) => {
    if (!esRH) return;
    setMsg('');
    const note = String(notes[row.idIncapacidad] ?? '').trim();
    if (nextEstado === 2 && !note) {
      const warn = 'Debe agregar observaciones para desaprobar la incapacidad.';
      setMsg(warn);
      toast?.(warn, { type: 'warning', title: 'Incapacidades' });
      return;
    }
    setSavingId(row.idIncapacidad);
    try {
      const updated = await updateIncapacidadEstado(row.idIncapacidad, nextEstado, note || null);
      setRows(prev =>
        prev.map(item =>
          item.idIncapacidad === updated.idIncapacidad
            ? { ...item, estado: updated.estado, observaciones: updated.observaciones }
            : item
        )
      );
      setNotes(prev => ({ ...prev, [row.idIncapacidad]: '' }));
      const successMsg = nextEstado === 1 ? 'Incapacidad aprobada' : 'Incapacidad desaprobada';
      toast?.(successMsg, { type: nextEstado === 1 ? 'success' : 'warning', title: 'Incapacidades' });
    } catch (err) {
      console.error('Error actualizando estado', err);
      const apiMsg = err?.response?.data?.message || 'No se pudo actualizar el estado';
      setMsg(apiMsg);
      toast?.(apiMsg, { type: 'error', title: 'Incapacidades' });
    } finally {
      setSavingId(null);
    }
  };

  const viewFile = (path) => {
    const url = buildFileUrl(path);
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h2 className="mb-0">Incapacidades registradas</h2>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        {esRH ? (
          <div className="form-floating" style={{ minWidth: 220 }}>
            <select
              id="filterEstado"
              className="form-select"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="pending">Pendientes</option>
              <option value="approved">Aprobadas</option>
              <option value="rejected">Desaprobadas</option>
            </select>
            <label htmlFor="filterEstado">Filtrar por estado</label>
          </div>
        ) : (
          <div className="text-secondary small">
            Mostrando tus incapacidades registradas
          </div>
        )}
        <button
          className="btn btn-outline-light"
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="table-responsive">
        <table className="table table-dark table-striped align-middle">
          <thead>
            <tr>
              <th>ID</th>
              <th>Boleta</th>
              <th>Empleado</th>
              <th>Tipo</th>
              <th>Fechas</th>
              <th>Subsidio CCSS</th>
              <th>Estado</th>
              <th>Archivo</th>
              <th>Observaciones</th>
              {esRH && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {/* Estado: cargando */}
            {loading && (
              <tr>
                <td colSpan={esRH ? 10 : 9} className="text-center py-4">
                  Cargando...
                </td>
              </tr>
            )}

            {/* Sin resultados */}
            {!loading && !filteredRows.length && (
              <tr>
                <td colSpan={esRH ? 10 : 9} className="text-center text-secondary py-4">
                  No hay incapacidades registradas.
                </td>
              </tr>
            )}

            {/* Resultados */}
            {!loading && filteredRows.length > 0 &&
              filteredRows.map((row) => {
                const estadoValue = Number(row.estado);
                const meta = STATUS_META[estadoValue] || STATUS_META[0];
                const fullName = [row.nombre, row.apellido1, row.apellido2]
                  .filter(Boolean)
                  .join(' ');
                const fileUrl = buildFileUrl(row.escaneo_boleta);

                return (
                  <tr key={row.idIncapacidad}>
                    <td>{row.idIncapacidad}</td>
                    <td>{row.numero_boleta || '-'}</td>
                    <td>{fullName || `#${row.idEmpleado}`}</td>
                    <td>{row.concepto || '-'}</td>
                    <td>
                      {formatFecha(row.fecha_inicio)}<br />
                      <small className="text-secondary">
                        al {formatFecha(row.fecha_fin)}
                      </small>
                    </td>
                    <td>{formatMoneda(row.monto_subsidio)}</td>
                    <td>
                      <span className={meta.className}>{meta.label}</span>
                    </td>
                    <td>
                      {fileUrl ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-info"
                          onClick={() => viewFile(row.escaneo_boleta)}
                        >
                          Ver
                        </button>
                      ) : (
                        <span className="text-secondary">Sin archivo</span>
                      )}
                    </td>
                    <td style={{ minWidth: '200px' }}>
                      {row.observaciones ? (
                        <div className="small text-light">{row.observaciones}</div>
                      ) : (
                        <span className="text-secondary small">Sin observaciones</span>
                      )}
                      {esRH && estadoValue === 0 && (
                        <textarea
                          className="form-control form-control-sm mt-2"
                          rows={2}
                          placeholder="Observaciones (obligatorio si desaprueba)"
                          value={notes[row.idIncapacidad] ?? ''}
                          onChange={(e) => setNotes(prev => ({ ...prev, [row.idIncapacidad]: e.target.value }))}
                        />
                      )}
                    </td>
                    {esRH && (
                      <td className="d-flex flex-column flex-lg-row gap-2">
                        {estadoValue === 0 ? (
                          <>
                            <button
                              className="btn btn-sm btn-success"
                              disabled={savingId === row.idIncapacidad}
                              onClick={() => handleEstado(row, 1)}
                            >
                              Aprobar
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              disabled={savingId === row.idIncapacidad}
                              onClick={() => handleEstado(row, 2)}
                            >
                              Desaprobar
                            </button>
                          </>
                        ) : (
                          <button
                            className={`btn btn-sm ${estadoValue === 1 ? 'btn-outline-success' : 'btn-outline-danger'}`}
                            disabled
                          >
                            {estadoValue === 1 ? 'Aprobada' : 'Desaprobada'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
