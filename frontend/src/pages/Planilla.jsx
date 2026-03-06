import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';
import {
  previewPlanillaCR as previewPlanilla,
  generarPlanilla,
  detallePlanilla,
  overridePlanilla,
  cerrarPlanillaRango,
  downloadPlanillaPdf,
  getPlanillaConfig,
  savePlanillaConfig,
} from '../api/planilla';

// ===== Helpers =====
function fmt(n) {
  const v = Number(n || 0);
  return v.toLocaleString('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 });
}

// YYYY-MM-DD con hora local (evita desfases por zona horaria)
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() { return toYMD(new Date()); }

function defaultPeriodoFechas() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  if (day <= 15) {
    return { periodo: 'quincenal', desde: toYMD(new Date(y, m, 1)), hasta: toYMD(new Date(y, m, 15)) };
  } else {
    const lastDay = new Date(y, m + 1, 0).getDate();
    return { periodo: 'quincenal', desde: toYMD(new Date(y, m, 16)), hasta: toYMD(new Date(y, m, lastDay)) };
  }
}

// Normaliza a YYYY-MM-DD sin toISOString()
function toISO(s) {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d)) return toYMD(d);
  return s;
}

function EditableCell({ value, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);
  if (disabled) return <span>{fmt(value)}</span>;
  return (
    <div>
      {editing ? (
        <div className="d-flex gap-1">
          <input
            type="number"
            className="form-control form-control-sm"
            value={val}
            onChange={(e) => setVal(Number(e.target.value) || 0)}
            style={{ maxWidth: 120 }}
          />
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              onSave(Number(val) || 0);
              setEditing(false);
            }}
          >
            Guardar
          </button>
          <button className="btn btn-sm btn-light" onClick={() => { setVal(value); setEditing(false); }}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="d-flex justify-content-between align-items-center">
          <span>{fmt(value)}</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(true)} title="Editar" aria-label="Editar">
            ?
          </button>
        </div>
      )}
    </div>
  );
}

const DEFAULT_TASA_HE = 1.5;

export default function Planilla() {
  const { hasPerm } = useAuth();
  const def = useMemo(defaultPeriodoFechas, []);
  const periodo = def.periodo;
  const [desde, setDesde] = useState(def.desde);
  const [hasta, setHasta] = useState(def.hasta);
  const [horasMes, setHorasMes] = useState(192);
  const tasaHE = DEFAULT_TASA_HE;
  const [rentaBase, setRentaBase] = useState('Bruto');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rowsPrev, setRowsPrev] = useState([]);
  const [totalesPrev, setTotalesPrev] = useState(null);
  const [rowsDB, setRowsDB] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [locked, setLocked] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [bonosCustom, setBonosCustom] = useState({});
  const [bonoEditorOpen, setBonoEditorOpen] = useState(false);
  const [bonoDraft, setBonoDraft] = useState({});

  
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfg, setCfg] = useState({ ccss_obrero: 0.1034, banco_popular_obrero: 0.01, patronal_total: 0.2633 });
  const [cfgAnio, setCfgAnio] = useState(new Date(hasta).getFullYear());
  const [cfgMsg, setCfgMsg] = useState('');
  const toast = useToast();

  function rangoValido() {
    if (!desde || !hasta) return false;
    return new Date(desde) <= new Date(hasta);
  }

  const openBonoEditor = () => {
    const draft = {};
    rowsPrev.forEach(row => {
      draft[row.idEmpleado] = Number(bonosCustom[row.idEmpleado] ?? row.bono ?? 0);
    });
    setBonoDraft(draft);
    setBonoEditorOpen(true);
  };

  const applyBonoEditor = async () => {
    setBonosCustom(bonoDraft);
    setBonoEditorOpen(false);
    await doPreview(bonoDraft, { silent: true });
    toast?.('Bonos personalizados aplicados', { type: 'success', title: 'Planilla' });
  };

  const cancelBonoEditor = () => setBonoEditorOpen(false);

  async function doPreview(customBonos = bonosCustom, opts = {}) {
    try {
      if (!rangoValido()) {
        const warn = 'Rango de fechas invalido';
        setError(warn);
        toast?.(warn, { type: 'warning', title: 'Planilla' });
        return;
      }
      setLoading(true); setError(''); setGenMsg('');
      const bonosArr = Object.entries(customBonos || {}).map(([id, monto]) => ({
        idEmpleado: Number(id),
        monto: Number(monto) || 0,
      }));
      const payload = { periodo, fecha_inicio: toISO(desde), fecha_fin: toISO(hasta), horas_mes: horasMes, tasa_he: tasaHE, base_renta: rentaBase, bonos: bonosArr };
      const r = await previewPlanilla(payload);
      setRowsPrev(r?.filas || []);
      setTotalesPrev({ ...(r?.totales || {}), costoTotalEmpresa: r?.costo_total_empresa || 0 });
      if (!opts.silent) {
        if (!r?.filas?.length) {
          toast?.('No hay datos para la fecha seleccionada.', { type: 'info', title: 'Planilla' });
        } else {
          toast?.('Previsualizacion actualizada', { type: 'success', title: 'Planilla' });
        }
      }
    } catch (e) {
      setRowsPrev([]); setTotalesPrev(null);
      const text = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error al previsualizar';
      setError(text);
      toast?.(text, { type: 'error', title: 'Planilla' });
    } finally { setLoading(false); }
  }

    const existePlanillaActual = async () => {
    try {
      const { ok, data } = await detallePlanilla({ periodo, desde: toISO(desde), hasta: toISO(hasta) });
      return ok && Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  };

  async function doGenerar() {
    try {
      if (!rangoValido()) {
        const warn = 'Rango de fechas inválido';
        setError(warn);
        toast?.(warn, { type: 'warning', title: 'Planilla' });
        return;
      }
      setLoading(true); setError('');
      if (rowsDB.length > 0 || await existePlanillaActual()) {
        setLoading(false);
        const dup = 'Ya existe una planilla generada para este período. Cargue la persistida o cambie el rango.';
        setError(dup);
        toast?.(dup, { type: 'warning', title: 'Planilla' });
        return;
      }
      const bonosArr = Object.entries(bonosCustom || {}).map(([id, monto]) => ({
        idEmpleado: Number(id),
        monto: Number(monto) || 0,
      }));
      const payload = { periodo, fecha_inicio: toISO(desde), fecha_fin: toISO(hasta),
        horas_mes: horasMes, tasa_he: tasaHE, base_renta: rentaBase, bonos: bonosArr };
      const r = await generarPlanilla(payload);
      if (!r?.ok) throw new Error(r?.message || 'No se pudo generar');
      setGenMsg('Planilla generada');
      toast?.('Planilla generada correctamente', { type: 'success', title: 'Planilla' });
      await loadPersisted(true);
    } catch (e) {
      const msg = e?.response?.status === 409
        ? 'Planilla cerrada para este rango'
        : (e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error al generar');
      setError(msg);
      toast?.(msg, { type: 'error', title: 'Planilla' });
    } finally { setLoading(false); }
  }


  async function loadPersisted(silentParam = false) {
    const silent = typeof silentParam === 'boolean' ? silentParam : false;
    try {
      setLoading(true); setError('');
      const { ok, data, snapshot: snap, locked: isL } = await detallePlanilla({ periodo, desde: toISO(desde), hasta: toISO(hasta) });
      if (!ok) throw new Error('No se pudo cargar detalle');
      setRowsDB(data || []);
      setSnapshot(snap || null);
      setLocked(!!isL);
      if (!silent) {
        if (!data?.length) {
          toast?.('No hay planillas generadas para las fechas indicadas.', { type: 'info', title: 'Planilla' });
        } else {
          toast?.('Planilla cargada', { type: 'success', title: 'Planilla' });
        }
      }
    } catch (e) {
      setRowsDB([]); setSnapshot(null); setLocked(false);
      const text = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error al cargar detalle';
      setError(text);
      toast?.(text, { type: 'error', title: 'Planilla' });
    } finally { setLoading(false); }
  }

  async function loadConfig() {
    try {
      const anio = new Date(hasta).getFullYear();
      setCfgAnio(anio);
      const data = await getPlanillaConfig(anio);
      setCfg({
        ccss_obrero: Number(data?.ccss_obrero ?? 0.1034),
        banco_popular_obrero: Number(data?.banco_popular_obrero ?? 0.01),
        patronal_total: Number(data?.patronal_total ?? 0.2633),
      });
      setCfgOpen(true);
      setCfgMsg('');
    } catch {
      setCfgOpen(true);
      const warn = 'No se pudo cargar la configuración. Usando valores por defecto.';
      setCfgMsg(warn);
      toast?.(warn, { type: 'warning', title: 'Planilla' });
    }
  }

  async function saveConfig() {
    try {
      setCfgMsg('');
      await savePlanillaConfig(cfgAnio, cfg);
      const msg = 'Tasas guardadas. Nuevos calculos usaran estos valores.';
      setCfgMsg(msg);
      toast?.(msg, { type: 'success', title: 'Planilla' });
    } catch (e) {
      const text = e?.response?.data?.message || 'Error al guardar';
      setCfgMsg(text);
      toast?.(text, { type: 'error', title: 'Planilla' });
    }
  }

  async function exportPDF() {
    try {
      const blob = await downloadPlanillaPdf({ periodo, desde: toISO(desde), hasta: toISO(hasta) });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url; a.download = `planilla_${periodo}_${desde}_${hasta}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast?.('Descarga generada', { type: 'success', title: 'Planilla' });
  } catch (e) {
    const text = e?.response?.data?.message || 'No se pudo generar el PDF';
    setError(text);
    toast?.(text, { type: 'error', title: 'Planilla' });
  }
}

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Planilla</h2>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12 col-md-2">
              <label className="form-label">Período</label>
              <input className="form-control" value="Quincenal" disabled readOnly />
            </div>
            <div className="col-12 col-md-2">
              <label className="form-label">Desde</label>
              <input type="date" className="form-control" value={desde} max={todayISO()} onChange={e => setDesde(e.target.value)} />
            </div>
            <div className="col-12 col-md-2">
              <label className="form-label">Hasta</label>
              <input type="date" className="form-control" value={hasta} max={todayISO()} onChange={e => setHasta(e.target.value)} />
            </div>
            <div className="col-12 col-md-2">
              <label className="form-label">Horas/mes</label>
              <input type="number" className="form-control" value={horasMes} onChange={e => setHorasMes(Number(e.target.value) || 0)} />
            </div>
            <div className="col-12 col-md-2">
              <label className="form-label">Base Renta</label>
              <select className="form-select" value={rentaBase} onChange={e => setRentaBase(e.target.value)}>
                <option value="Neto">Neto (Bruto - CCSS - BP)</option>
                <option value="Bruto">Bruto</option>
              </select>
            </div>
          </div>

          <div className="d-flex gap-2 mt-3">
            <button className="btn btn-primary" onClick={doPreview} disabled={loading}>Previsualizar</button>
            <button className="btn btn-outline-secondary" onClick={loadConfig}>Configurar tasas…</button>
            {hasPerm('planilla_ver_RH') && (
              <button className="btn btn-outline-primary" onClick={loadPersisted} disabled={loading}>Cargar persistidas</button>
            )}
            {hasPerm('planilla_generar_RH') && (
              <button className="btn btn-success" onClick={doGenerar} disabled={loading || locked}>Generar planilla</button>
            )}
            {rowsDB.length > 0 && (
              <button className="btn btn-outline-secondary" onClick={exportPDF} disabled={loading}>Exportar PDF</button>
            )}
            {hasPerm('planilla_cerrar_RH') && (
              <button
                className="btn btn-outline-danger"
                onClick={async () => {
                  try {
                    await cerrarPlanillaRango({ periodo, fecha_inicio: toISO(desde), fecha_fin: toISO(hasta) });
                    setLocked(true);
                    toast?.('Planilla cerrada', { type: 'success', title: 'Planilla' });
                  } catch (e) {
                    const text = e?.response?.data?.message || e.message;
                    setError(text);
                    toast?.(text || 'Error al cerrar', { type: 'error', title: 'Planilla' });
                  }
                }}
                disabled={locked}
              >
                Cerrar
              </button>
            )}
          </div>

          {error && <div className="alert alert-danger mt-3">{error}</div>}
          {genMsg && <div className="alert alert-success mt-3">{genMsg}</div>}
          {locked && <div className="alert alert-warning mt-3">Planilla cerrada para este rango. Edición deshabilitada.</div>}
        </div>
      </div>

      {rowsPrev.length > 0 && (
        <div className="card">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Previsualización (no persiste)</h5>
              <div className="d-flex align-items-center gap-2">
                <button className="btn btn-sm btn-outline-secondary" onClick={loadConfig} title="Editar tasas">Tasas %</button>
                <button
                  className="btn btn-sm btn-outline-light"
                  onClick={openBonoEditor}
                  disabled={!rowsPrev.length}
                >
                  Editar bonos
                </button>
              </div>
            </div>
            {bonoEditorOpen && (
              <div className="card border-warning mb-3">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <strong>Bonos personalizados</strong>
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={applyBonoEditor}>Aplicar</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={cancelBonoEditor}>Cancelar</button>
                    </div>
                  </div>
                  <div className="row g-2">
                    {rowsPrev.map(row => (
                      <div key={`draft-${row.idEmpleado}`} className="col-12 col-md-6">
                        <label className="form-label small text-muted">
                          {row.nombre}
                        </label>
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={bonoDraft[row.idEmpleado] ?? bonosCustom[row.idEmpleado] ?? row.bono ?? 0}
                          onChange={e => setBonoDraft(d => ({ ...d, [row.idEmpleado]: Number(e.target.value) || 0 }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="table-responsive">
              <table className="table table-sm table-striped table-hover align-middle">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    <th className="text-end">Salario mensual</th>
                    <th className="text-end">Sueldo período</th>
                    <th className="text-end text-nowrap" style={{ minWidth: 110 }}>H.E. monto</th>
                    <th className="text-end text-nowrap" style={{ minWidth: 140 }}>Bono</th>
                    <th className="text-end">Vac. pago</th>
                    <th className="text-end">Permisos (sin goce)</th>
                    <th className="text-end">Bruto</th>
                    <th className="text-end">CCSS obrero</th>
                    <th className="text-end">Banco Popular</th>
                    <th className="text-end">Renta</th>
                    <th className="text-end">Préstamo</th>
                    <th className="text-end">Neto</th>
                    <th className="text-end">Patronal</th>
                    <th>Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsPrev.map((r) => (
                    <tr key={r.idEmpleado}>
                      <td>{r.nombre}</td>
                      <td>{r.puesto}</td>
                      <td className="text-end">{fmt(r.salario_mensual)}</td>
                      <td className="text-end">{fmt(r.sueldo_periodo)}</td>
                      <td className="text-end text-nowrap" style={{ minWidth: 110, paddingRight: 12 }}>{fmt(r.he_monto)}</td>
                      <td className="text-end text-nowrap" style={{ minWidth: 140 }}>{fmt(r.bono)}</td>
                      <td className="text-end">{fmt(r.vac_pago)}</td>
                      <td className="text-end">{fmt(r.permisos_sin_goce)}</td>
                      <td className="text-end">{fmt(r.bruto)}</td>
                      <td className="text-end">{fmt(r.ccss_obrero)}</td>
                      <td className="text-end">{fmt(r.banco_popular)}</td>
                      <td className="text-end">{fmt(r.renta)}</td>
                      <td className="text-end">{fmt(r.prestamo || r.prestamo_monto || 0)}</td>
                      <td className="text-end">{fmt(r.neto)}</td>
                      <td className="text-end">{fmt(r.patronal)}</td>
                      <td>{r.obs}</td>
                    </tr>
                  ))}
                </tbody>
                {totalesPrev && (
                  <tfoot>
                    <tr>
                      <th colSpan={8} className="text-end">Totales</th>
                      <th className="text-end">{fmt(totalesPrev.totalBruto)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalObrero)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalBancoPopular || 0)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalRenta)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalPrestamo || 0)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalNeto)}</th>
                      <th className="text-end">{fmt(totalesPrev.totalPatronal)}</th>
                      <th></th>
                    </tr>
                    <tr>
                      <th colSpan={14} className="text-end">Costo total empresa</th>
                      <th className="text-end">{fmt(totalesPrev.costoTotalEmpresa)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {rowsDB.length > 0 && (
        <div className="card mt-3">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Persistidas en BD</h5>
              <div className="d-flex align-items-center gap-2">
                {snapshot?.tasas && (
                  <small className="text-muted">
                    Tasas: CCSS {Math.round(snapshot.tasas.ccss_obrero * 10000) / 100}% | BP {Math.round(snapshot.tasas.banco_popular_obrero * 10000) / 100}% | Patronal {Math.round(snapshot.tasas.patronal_total * 10000) / 100}%
                  </small>
                )}
                <button className="btn btn-sm btn-outline-secondary" onClick={exportPDF} disabled={loading}>Descargar PDF</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={loadConfig} title="Editar tasas">Tasas %</button>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    <th className="text-end">Salario mensual</th>
                    <th className="text-end">Sueldo período</th>
                    <th className="text-end text-nowrap">H.E. monto</th>
                    <th className="text-end text-nowrap">Bono</th>
                    <th className="text-end">Vac. pago</th>
                    <th className="text-end">Permisos (sin goce)</th>
                    <th className="text-end">Bruto</th>
                    <th className="text-end">CCSS obrero</th>
                    <th className="text-end">Banco Popular</th>
                    <th className="text-end">Renta</th>
                    <th className="text-end">Neto</th>
                    <th className="text-end">Patronal</th>
                    <th>Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsDB.map((r) => {
                    const he = Number(r.monto_horas_extras || r.horas_extras_monto || 0);
                    const patronalRate = snapshot?.tasas?.patronal_total || 0;
                    const patronal = Number(r.salario_bruto || 0) * Number(patronalRate);
                    const obsPieces = [];
                    if (r.incapacidades) obsPieces.push(`Inc: ${r.incapacidades}`);
                    if (r.vacaciones) obsPieces.push(`Vac: ${r.vacaciones}`);
                    return (
                      <tr key={r.idPlanilla}>
                        <td>{r.nombre}</td>
                        <td>{r.nombre_puesto}</td>
                        <td className="text-end">{fmt(r.salario_base || 0)}</td>
                        <td className="text-end">{fmt(r.monto_horas_ordinarias || 0)}</td>
                        <td className="text-end">
                          <EditableCell
                            value={he}
                            disabled
                            onSave={async (val, motivo) => {
                              await overridePlanilla({
                                periodo,
                                fecha_inicio: toISO(desde),
                                fecha_fin: toISO(hasta),
                                idPlanilla: r.idPlanilla,
                                campo: 'monto_horas_extras',
                                valor: val,
                                motivo,
                              });
                              await loadPersisted(true);
                            }}
                          />
                        </td>
                        <td className="text-end">
                          <EditableCell
                            value={r.monto_Bono || 0}
                            disabled
                            onSave={async (val, motivo) => {
                              await overridePlanilla({
                                periodo,
                                fecha_inicio: toISO(desde),
                                fecha_fin: toISO(hasta),
                                idPlanilla: r.idPlanilla,
                                campo: 'monto_Bono',
                                valor: val,
                                motivo,
                              });
                              await loadPersisted(true);
                            }}
                          />
                        </td>
                        <td className="text-end">-</td>
                        <td className="text-end">-</td>
                        <td className="text-end">{fmt(r.salario_bruto)}</td>
                        <td className="text-end">{fmt(r.deduccion_ccss)}</td>
                        <td className="text-end">{fmt(r.deduccion_bancopopular)}</td>
                        <td className="text-end">{fmt(r.deduccion_renta)}</td>
                        <td className="text-end">
                          <EditableCell
                            value={r.deduccion_prestamo || 0}
                            disabled
                            onSave={async (val, motivo) => {
                              await overridePlanilla({
                                periodo,
                                fecha_inicio: toISO(desde),
                                fecha_fin: toISO(hasta),
                                idPlanilla: r.idPlanilla,
                                campo: 'deduccion_prestamo',
                                valor: val,
                                motivo,
                              });
                              await loadPersisted(true);
                            }}
                          />
                        </td>
                        <td className="text-end">{fmt(r.monto_pagado)}</td>
                        <td className="text-end">{fmt(patronal)}</td>
                        <td>{obsPieces.join(' | ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {cfgOpen && (
        <div className="modal d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Tasas del año {cfgAnio}</h5>
                <button className="btn-close" onClick={() => setCfgOpen(false)}></button>
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12 col-md-4">
                    <div className="card h-100">
                      <div className="card-body">
                        <h6 className="card-title">Aportes Obrero</h6>
                        <div className="mb-2">
                          <label className="form-label">CCSS (%)</label>
                          <input
                            type="number"
                            step="0.0001"
                            className="form-control"
                            value={(cfg.ccss_obrero * 100).toFixed(4)}
                            onChange={(e) => setCfg((s) => ({ ...s, ccss_obrero: Number(e.target.value) / 100 }))}
                          />
                        </div>
                        <div className="mb-2">
                          <label className="form-label">Banco Popular (%)</label>
                          <input
                            type="number"
                            step="0.0001"
                            className="form-control"
                            value={(cfg.banco_popular_obrero * 100).toFixed(4)}
                            onChange={(e) => setCfg((s) => ({ ...s, banco_popular_obrero: Number(e.target.value) / 100 }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="card h-100">
                      <div className="card-body">
                        <h6 className="card-title">Aporte Patronal</h6>
                        <div className="mb-2">
                          <label className="form-label">Total Patronal (%)</label>
                          <input
                            type="number"
                            step="0.0001"
                            className="form-control"
                            value={(cfg.patronal_total * 100).toFixed(4)}
                            onChange={(e) => setCfg((s) => ({ ...s, patronal_total: Number(e.target.value) / 100 }))}
                          />
                        </div>
                        <small className="text-muted">Usado para costo total empresa.</small>
                      </div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="card h-100">
                      <div className="card-body">
                        <h6 className="card-title">Renta (desde BD)</h6>
                        <p className="mb-1">
                          Los tramos del impuesto sobre la renta se leen de <code>dbo.Renta_Tramo</code> según la fecha fin del período.
                        </p>
                        <p className="text-muted mb-0">No se editan aquí.</p>
                      </div>
                    </div>
                  </div>
                </div>
                {cfgMsg && <div className="alert alert-info mt-3">{cfgMsg}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setCfgOpen(false)}>Cerrar</button>
                <button className="btn btn-primary" onClick={saveConfig}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
