import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api/client';
import { createIncapacidad, getIncapacidades } from '../api/incapacidades';
import { todayStr, ONLY_DIGITS_PATTERN } from '../utils/validation';
import BackToHome from '../components/BackToHome';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';
import { buildUnlockStatus, formatHumanDate, formatISODate } from '../utils/tenure';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCAPACIDADES_MIN_MONTHS = 3;

const round2 = (n) => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '0.00');

const diffDaysInclusive = (inicio, fin) => {
  if (!inicio || !fin) return 0;
  const start = new Date(inicio);
  const end = new Date(fin);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const ms = end.setHours(0,0,0,0) - start.setHours(0,0,0,0);
  if (ms < 0) return 0;
  return Math.floor(ms / MS_PER_DAY) + 1;
};

const SUBSIDIO_RULES = [
  {
    match: /accident|riesg|labor/i,
    calc: (daily, dias) => daily * dias * 0.6, // INS cubre 60% desde el día 1
  },
  {
    match: /mater/i,
    calc: (daily, dias) => daily * dias * 0.5, // CCSS cubre 50% todo el período
  },
  {
    match: /enfer/i,
    calc: (daily, dias) => daily * Math.max(dias - 3, 0) * 0.6, // CCSS cubre 60% desde el día 4
  },
];

const computeSubsidioLocal = ({ fecha_inicio, fecha_fin, idTipo_Incapacidad, idEmpleado }, tipos, empleados) => {
  if (!fecha_inicio || !fecha_fin || !idTipo_Incapacidad || !idEmpleado) return '0.00';

  const dias = diffDaysInclusive(fecha_inicio, fecha_fin);
  if (dias <= 0) return '0.00';

  const empleado = empleados.find(e => String(e.idEmpleado) === String(idEmpleado));
  const salarioMensual = Number(empleado?.salario_base || 0);
  if (!salarioMensual) return '0.00';

  const tipo = tipos.find(t => String(t.idTipo_Incapacidad) === String(idTipo_Incapacidad));
  const concepto = tipo?.concepto?.toLowerCase() || '';

  const diario = salarioMensual / 30;
  let monto = 0;

  const rule = SUBSIDIO_RULES.find(r => r.match.test(concepto));
  if (rule) {
    monto = rule.calc(diario, dias);
  }

  return round2(Math.max(monto, 0));
};

const parseInputDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const formatInputDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isWeekend = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
};

const moveBusinessDays = (date, delta) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !Number.isFinite(delta)) {
    return null;
  }
  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (delta === 0) return cursor;
  const direction = delta > 0 ? 1 : -1;
  let steps = Math.abs(delta);

  while (steps > 0) {
    cursor.setDate(cursor.getDate() + direction);
    if (!isWeekend(cursor)) {
      steps -= 1;
    }
  }
  return cursor;
};

export default function IncapacidadesNew() {
  const { hasPerm, user } = useAuth();
  const toast = useToast();
  const esRH = Boolean(user?.idRol === 3 || hasPerm('vacaciones_aprobar_RH') || hasPerm('permisos_aprobar_RH'));
  const userId = user?.idEmpleado ? String(user.idEmpleado) : '';
  const today = todayStr();
  const incapUnlockInfo = useMemo(
    () => buildUnlockStatus(user?.fecha_ingreso, { months: INCAPACIDADES_MIN_MONTHS }),
    [user?.fecha_ingreso]
  );
  const incapBlocked = !esRH && incapUnlockInfo.hasDate && !incapUnlockInfo.ready;
  const incapUnlockLabel = incapUnlockInfo.unlockDate ? formatHumanDate(incapUnlockInfo.unlockDate, { dateStyle: 'long' }) : null;
  const incapUnlockISO = incapUnlockInfo.unlockDate ? formatISODate(incapUnlockInfo.unlockDate) : '';
  const [file, setFile] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [form, setForm] = useState({
    fecha_inicio: today,
    fecha_fin: today,
    numero_boleta: '',
    idTipo_Incapacidad: '',
    idEmpleado: userId
  });
  const [msg, setMsg] = useState('');
  const clearMsg = useCallback(() => setMsg(''), []);
  const todayDate = useMemo(() => parseInputDate(today), [today]);
  const fechaMinima = useMemo(() => {
    const limit = todayDate ? moveBusinessDays(todayDate, -3) : null;
    return limit ? formatInputDate(limit) : today;
  }, [today, todayDate]);
  const fechaMaxima = useMemo(() => {
    const limit = todayDate ? moveBusinessDays(todayDate, 3) : null;
    return limit ? formatInputDate(limit) : today;
  }, [today, todayDate]);

  const showError = useCallback((text) => {
    setMsg(text);
    toast?.(text, { type: 'error', title: 'Incapacidades' });
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, eRes] = await Promise.all([
          api.get('/tipo_incapacidades'),
          api.get('/empleados')
        ]);
        setTipos(tRes?.data?.data || []);
        setEmpleados(eRes?.data?.data || []);
      } catch (err) {
        console.error('Error cargando tipos/empleados:', err);
        setTipos([]);
        setEmpleados([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!esRH && userId) {
      setForm(f => ({ ...f, idEmpleado: userId }));
    }
  }, [esRH, userId]);

  const loadHistorial = useCallback(async () => {
    setHistLoading(true);
    try {
      const list = await getIncapacidades();
      const filtered = esRH ? list : list.filter(r => Number(r.idEmpleado) === Number(userId));
      setHistorial(filtered.sort((a, b) => new Date(b.fecha_inicio || 0) - new Date(a.fecha_inicio || 0)));
    } catch (err) {
      console.error('Error cargando historial de incapacidades', err);
      setHistorial([]);
    } finally {
      setHistLoading(false);
    }
  }, [esRH, userId]);

  useEffect(() => {
    loadHistorial();
  }, [loadHistorial]);

  const handleChange = useCallback((name, rawValue) => {
    if (name === 'numero_boleta') {
      const digits = String(rawValue || '').replace(/\D/g, '');
      setForm(prev => ({ ...prev, numero_boleta: digits }));
      return;
    }

    if (name === 'fecha_inicio') {
      if (!rawValue) {
        showError('Seleccione una fecha de inicio');
        return;
      }
      const parsed = parseInputDate(rawValue);
      const min = parseInputDate(fechaMinima);
      const max = parseInputDate(fechaMaxima);
      if (!parsed || !min || !max) {
        showError('Fecha no valida');
        return;
      }
      if (isWeekend(parsed)) {
        showError('No se permiten fechas en fin de semana');
        return;
      }
      if (parsed < min || parsed > max) {
        showError('Solo se permiten fechas hasta 3 dias habiles antes o despues de hoy');
        return;
      }
      const formatted = formatInputDate(parsed);
      clearMsg();
      setForm(prev => {
        const next = { ...prev, fecha_inicio: formatted };
        const finParsed = parseInputDate(prev.fecha_fin);
        if (finParsed && finParsed < parsed) {
          next.fecha_fin = formatted;
        }
        return next;
      });
      return;
    }

    if (name === 'fecha_fin') {
      if (!rawValue) {
        showError('Seleccione una fecha de fin');
        return;
      }
      const parsed = parseInputDate(rawValue);
      if (!parsed) {
        showError('Seleccione una fecha de fin valida');
        return;
      }
      if (isWeekend(parsed)) {
        showError('La fecha de fin no puede ser fin de semana');
        return;
      }
      setForm(prev => {
        const inicioParsed = parseInputDate(prev.fecha_inicio);
        if (inicioParsed && parsed < inicioParsed) {
          showError('La fecha de fin no puede ser anterior al inicio');
          return prev;
        }
        clearMsg();
        return { ...prev, fecha_fin: formatInputDate(parsed) };
      });
      return;
    }

    setForm(prev => ({ ...prev, [name]: rawValue }));
  }, [fechaMinima, fechaMaxima, showError, clearMsg]);

  const subsidioCalculado = useMemo(
    () => computeSubsidioLocal(form, tipos, empleados),
    [form, tipos, empleados]
  );

  const formatFecha = (value) => {
    if (!value) return '-';
    try { return new Date(value).toLocaleDateString('es-CR'); }
    catch { return value; }
  };

  const statusMeta = {
    0: { label: 'Pendiente', className: 'badge bg-secondary' },
    1: { label: 'Aprobada', className: 'badge bg-success' },
    2: { label: 'Desaprobada', className: 'badge bg-danger' }
  };
  const fechaFinMin =
    form.fecha_inicio && form.fecha_inicio > fechaMinima
      ? form.fecha_inicio
      : fechaMinima;

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (incapBlocked) {
      const unlockText = incapUnlockLabel || incapUnlockISO || 'la fecha permitida';
      showError(`Aún estás en período de prueba. Podrás registrar incapacidades a partir del ${unlockText}.`);
      return;
    }
    const min = parseInputDate(fechaMinima);
    const max = parseInputDate(fechaMaxima);
    const fechaInicio = parseInputDate(form.fecha_inicio);
    const fechaFin = parseInputDate(form.fecha_fin);

    if (!fechaInicio || !min || !max) {
      showError('Seleccione una fecha de inicio valida');
      return;
    }
    if (isWeekend(fechaInicio)) {
      showError('La fecha de inicio no puede ser fin de semana');
      return;
    }
    if (fechaInicio < min || fechaInicio > max) {
      showError('La fecha de inicio debe estar dentro de los 3 dias habiles permitidos');
      return;
    }
    if (!fechaFin) {
      showError('Seleccione una fecha de fin valida');
      return;
    }
    if (isWeekend(fechaFin)) {
      showError('La fecha de fin no puede ser fin de semana');
      return;
    }
    if (fechaFin < fechaInicio) {
      showError('La fecha de fin no puede ser anterior al inicio');
      return;
    }
    if (!form.numero_boleta) {
      showError('Ingrese el numero de boleta');
      return;
    }
    if (!/^\d+$/.test(form.numero_boleta)) {
      showError('El numero de boleta solo admite digitos');
      return;
    }
    if (!form.idTipo_Incapacidad) {
      showError('Seleccione un tipo de incapacidad');
      return;
    }
    if (!form.idEmpleado) {
      showError('Seleccione el empleado');
      return;
    }
    if (!file) {
      showError('Adjunte el escaneo de la boleta emitida al empleado');
      return;
    }
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      fd.append('monto_subsidio', subsidioCalculado);
      fd.append('archivo', file);
      const r = await createIncapacidad(fd);
      if (r?.ok) {
        const successMsg = 'Incapacidad registrada correctamente';
        setMsg(successMsg);
        toast?.(successMsg, { type: 'success', title: 'Incapacidades' });
        setForm({
          fecha_inicio: today,
          fecha_fin: today,
          numero_boleta: '',
          idTipo_Incapacidad: '',
          idEmpleado: esRH ? '' : userId
        });
        setFile(null);
        loadHistorial();
      } else setMsg('Error al crear');
    } catch (err) {
      const status = err?.response?.status;
      const apiMsg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        (status === 409
          ? 'Ya existe una incapacidad con ese número de boleta'
          : 'Error al crear');
      showError(apiMsg);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h2 className="mb-0">Nueva Incapacidad</h2>
      </div>

      {msg && (
        <div className="alert alert-info" role="alert">
          {msg}
        </div>
      )}
      {!esRH && incapBlocked && (
        <div className="alert alert-warning" role="alert">
          Eres un colaborador nuevo. Podrás registrar incapacidades a partir del {incapUnlockLabel || incapUnlockISO || 'cumplir 3 meses de ingreso'}.
        </div>
      )}

      <form onSubmit={onSubmit} className="row g-3" autoComplete="off">
        <fieldset className="row g-3" disabled={incapBlocked}>
          <div className="col-md-6">
            <label className="form-label">Fecha inicio</label>
            <input
              type="date"
              className="form-control"
              value={form.fecha_inicio ?? ''}
              min={fechaMinima}
              max={fechaMaxima}
              onChange={e => handleChange('fecha_inicio', e.target.value)}
              required
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Fecha fin</label>
            <input
              type="date"
              className="form-control"
              value={form.fecha_fin ?? ''}
              min={fechaFinMin}
              onChange={e => handleChange('fecha_fin', e.target.value)}
              required
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Monto subsidio (automático)</label>
            <input
              type="text"
              className="form-control"
              value={subsidioCalculado}
              readOnly
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Número de boleta</label>
            <input
              type="text"
              className="form-control"
              value={form.numero_boleta ?? ''}
              inputMode="numeric" pattern={ONLY_DIGITS_PATTERN} maxLength={20}
              onChange={e => handleChange('numero_boleta', e.target.value)}
              placeholder="Ingrese número de boleta"
              required
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Tipo de incapacidad</label>
            <select
              className="form-select"
              value={form.idTipo_Incapacidad ?? ''}
              onChange={e => handleChange('idTipo_Incapacidad', e.target.value)}
              required
            >
              <option value="">-- Seleccione tipo --</option>
              {tipos.map(t => (
                <option key={t.idTipo_Incapacidad} value={t.idTipo_Incapacidad}>
                  {t.concepto}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-6">
            <label className="form-label">Empleado</label>
            {esRH ? (
              <select
                className="form-select"
                value={form.idEmpleado ?? ''}
                onChange={e => handleChange('idEmpleado', e.target.value)}
                required
              >
                <option value="">-- Seleccione empleado --</option>
                {empleados.map(emp => (
                  <option key={emp.idEmpleado} value={emp.idEmpleado}>
                    {emp.nombre} {emp.apellido1 ?? ''} {emp.apellido2 ?? ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="form-control"
                value={
                  (() => {
                    const emp = empleados.find(e => String(e.idEmpleado) === userId);
                    if (emp) {
                      return `${emp.nombre} ${emp.apellido1 ?? ''} ${emp.apellido2 ?? ''}`.trim();
                    }
                    return user?.usuario || 'Empleado';
                  })()
                }
                disabled
              />
            )}
          </div>

          <div className="col-12">
            <label className="form-label">Escaneo de boleta</label>
            <input
              type="file"
              className="form-control"
              onChange={e => setFile(e.target.files?.[0] || null)}
              accept=".pdf,.jpg,.jpeg,.png"
              required
            />
            <small className="text-muted">Solicite al empleado la boleta emitida y adjunte el archivo (PDF/JPG/PNG).</small>
          </div>

          <div className="col-12">
            <button type="submit" className="btn btn-primary">
              Guardar
            </button>
          </div>
        </fieldset>
      </form>

      <div className="card border-0 shadow-sm mt-4">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h5 className="card-title mb-0">Historial de incapacidades</h5>
            <small className="text-secondary">
              {esRH ? 'Todos los registros' : 'Tus registros'}
            </small>
          </div>
          <div className="table-responsive">
            <table className="table table-dark table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Empleado</th>
                  <th>Tipo</th>
                  <th>Fechas</th>
                  <th>Subsidio</th>
                  <th>Estado</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {histLoading && (
                  <tr>
                    <td colSpan="7" className="text-center py-3 text-secondary">Cargando...</td>
                  </tr>
                )}
                {!histLoading && !historial.length && (
                  <tr>
                    <td colSpan="7" className="text-center py-3 text-secondary">No hay incapacidades registradas.</td>
                  </tr>
                )}
                {!histLoading && historial.length > 0 && historial.map(row => {
                  const meta = statusMeta[Number(row.estado)] || statusMeta[0];
                  const fullName = [row.nombre, row.apellido1, row.apellido2].filter(Boolean).join(' ');
                  return (
                    <tr key={row.idIncapacidad}>
                      <td>{row.idIncapacidad}</td>
                      <td>{fullName || `#${row.idEmpleado}`}</td>
                      <td>{row.concepto || '-'}</td>
                      <td>
                        {formatFecha(row.fecha_inicio)}
                        <br />
                        <small className="text-secondary">al {formatFecha(row.fecha_fin)}</small>
                      </td>
                      <td>₡ {Number(row.monto_subsidio || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td><span className={meta.className}>{meta.label}</span></td>
                      <td>
                        {row.observaciones ? (
                          <small>{row.observaciones}</small>
                        ) : (
                          <span className="text-secondary small">Sin observaciones</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
