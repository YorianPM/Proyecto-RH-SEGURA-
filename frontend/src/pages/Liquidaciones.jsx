import { useEffect, useMemo, useState } from 'react';
import { getEmpleados } from '../api/empleados';
import BackToHome from '../components/BackToHome';
import { guardarLiquidacion, listarLiquidaciones, exportarLiquidacionPdf, aguinaldoProporcionalEmpleado } from '../api/liquidaciones';
import { api } from '../api';
import { useToast } from '../context/toastStore';

const TIPOS_LIQUIDACION = [
  {
    value: 'con',
    label: 'Con responsabilidad patronal',
    detalle: 'Preaviso, cesantía, vacaciones proporcionales, aguinaldo proporcional y salarios pendientes.',
    aplicaPreaviso: true,
    aplicaCesantia: true,
  },
  {
    value: 'sin',
    label: 'Sin responsabilidad patronal',
    detalle: 'Vacaciones proporcionales, aguinaldo proporcional y salarios pendientes. (No preaviso ni cesantía).',
    aplicaPreaviso: false,
    aplicaCesantia: false,
  },
  {
    value: 'renuncia',
    label: 'Renuncia del trabajador',
    detalle: 'Vacaciones proporcionales, aguinaldo proporcional y salarios pendientes. (No preaviso ni cesantía).',
    aplicaPreaviso: false,
    aplicaCesantia: false,
  },
];

function fmt(n){ return Number(n||0).toLocaleString('es-CR',{ style:'currency', currency:'CRC', maximumFractionDigits:2 }); }
function toISO(d){ if(!d) return null; const x = new Date(d); if(isNaN(x)) return null; return x.toISOString().slice(0,10); }

function diffDays(a,b){ const da=new Date(a), db=new Date(b); const ms=24*60*60*1000; return Math.max(0, Math.round((db - da) / ms)); }
function isLeap(y){ return (y%4===0 && y%100!==0) || (y%400===0); }

export default function Liquidaciones(){
  const [empleados, setEmpleados] = useState([]);
  const [empleadoId, setEmpleadoId] = useState('');
  const [fechaIngreso, setFechaIngreso] = useState('');
  const [fechaSalida, setFechaSalida] = useState('');
  const [salarioPromQuincenal, setSalarioPromQuincenal] = useState('');
  const [vacDias, setVacDias] = useState('');
  const [deducciones, setDeducciones] = useState('');
  const [tipoLiquidacion, setTipoLiquidacion] = useState('');
  const [loadingVacPend, setLoadingVacPend] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [resultado, setResultado] = useState(null);
  const [persistidos, setPersistidos] = useState([]);
  const toast = useToast();

  const showError = (text) => {
    const msgText = text || 'Error al procesar la acción';
    setError(msgText);
    if (toast) toast(msgText, { type: 'error', title: 'Liquidaciones' });
  };

  const showSuccess = (text) => {
    const msgText = text || 'Operación realizada';
    setMsg(msgText);
    if (toast) toast(msgText, { type: 'success', title: 'Liquidaciones' });
  };

  useEffect(()=>{
    (async () => {
      try{
        const data = await getEmpleados();
        setEmpleados(data || []);
      } catch (err) {
        console.error('Error cargando empleados para liquidaciones', err);
      }
    })();
  },[]);

  useEffect(()=>{
    const emp = empleados.find(e => String(e.idEmpleado) === String(empleadoId));
    if (emp){
      if (emp.fecha_ingreso) setFechaIngreso(toISO(emp.fecha_ingreso));
      // salario_base se asume mensual → quincenal aproximado = mensual/2
      if (emp.salario_base != null && String(salarioPromQuincenal).trim()===''){
        const q = Number(emp.salario_base || 0) / 2;
        setSalarioPromQuincenal(String(Math.round(q*100)/100));
      }
    }
  }, [empleadoId, empleados, salarioPromQuincenal]);

  useEffect(()=>{
    let active = true;
    async function cargarVacPend(){
      if (!empleadoId) {
        setVacDias('');
        return;
      }
      setLoadingVacPend(true);
      try{
        const { data } = await api.get('/vacaciones', { params: { idEmpleado: empleadoId } });
        if (!active) return;
        const registros = data?.data || [];
        if (registros.length){
          // API devuelve más recientes primero; tomamos el primero
          const registro = registros[0];
          const dias = Number(registro.dias_calc_disponibles ?? registro.dias_disponibles ?? 0);
          setVacDias(String(Math.max(0, Math.round(dias * 100) / 100)));
        } else {
          setVacDias('0');
        }
      } catch(err){
        if (active) {
          console.error('No se pudieron consultar las vacaciones pendientes', err);
        }
      } finally {
        if (active) setLoadingVacPend(false);
      }
    }
    cargarVacPend();
    return () => { active = false; };
  }, [empleadoId]);

  const tipoSeleccionado = useMemo(
    () => TIPOS_LIQUIDACION.find(t => t.value === tipoLiquidacion) || null,
    [tipoLiquidacion]
  );

  const antiguedad = useMemo(()=>{
    if (!fechaIngreso || !fechaSalida) return { dias:0, meses:0, anios:0 };
    const di = new Date(fechaIngreso); const ds = new Date(fechaSalida);
    if (isNaN(di) || isNaN(ds) || ds < di) return { dias:0, meses:0, anios:0 };
    const dias = diffDays(di, ds) + 1;
    const anios = Math.floor(dias / 365);
    const meses = Math.floor((dias % 365) / 30);
    return { dias, meses, anios };
  }, [fechaIngreso, fechaSalida]);




  async function calcular(){
    setError(''); setMsg('');
    // Validaciones básicas
    if (!empleadoId) { showError('Seleccione un empleado.'); return; }
    if (!fechaIngreso || !fechaSalida) { showError('Ingrese fecha de ingreso y salida.'); return; }
    const di = new Date(fechaIngreso); const ds = new Date(fechaSalida);
    if (isNaN(di) || isNaN(ds) || ds < di) { showError('Fechas inválidas (salida debe ser ≥ ingreso).'); return; }
    if (!tipoLiquidacion) { showError('Seleccione el tipo de liquidación.'); return; }
    const salQ = Number(salarioPromQuincenal||0);
    if (!(salQ > 0)) { showError('Salario promedio quincenal debe ser mayor a 0.'); return; }
    const vacPend = Math.max(0, Number(vacDias||0));
    const ded = Math.max(0, Number(deducciones||0));

    setLoading(true);
    try{
      const salMensual = salQ * 2;
      const salDiario = salMensual / 30; // aproximación usual

      // Vacaciones pendientes
      const pagoVac = salDiario * vacPend;

      // Aguinaldo proporcional usando Planillas (incluye horas extra y demás)
      let aguinaldo = 0;
      let workedDays = 0; let totalPeriodDays = 0;
      try {
        const r = await aguinaldoProporcionalEmpleado({ idEmpleado: Number(empleadoId), fecha_salida: toISO(fechaSalida) });
        aguinaldo = Number(r.aguinaldo || 0);
        // métricas informativas de periodo legal (1 Dic año anterior -> fecha de salida)
        const salidaDate = new Date(fechaSalida);
        const y = salidaDate.getFullYear();
        const periodStart = new Date(y - 1, 11, 1);
        const hastaApi = r.hasta ? new Date(r.hasta) : salidaDate;
        const desde2 = (di > periodStart) ? di : periodStart;
        const hasta2 = hastaApi < periodStart ? periodStart : hastaApi;
        totalPeriodDays = Number(r.dias_periodo || 0) || (diffDays(periodStart, hasta2) + 1);
        workedDays = Number(r.dias_trabajados || 0) || Math.max(0, diffDays(desde2, hasta2) + 1);
      } catch (e) {
        console.warn('Fallo calculo de aguinaldo con planillas, usando estimacion', e);
        // Si falla, fallback a método aproximado
        const salidaDate = new Date(fechaSalida);
        const y = salidaDate.getFullYear();
        const periodStart = new Date(y - 1, 11, 1);
        const periodEnd   = salidaDate;
        const desde = (di > periodStart) ? di : periodStart;
        const hasta = ds < periodStart ? periodStart : periodEnd;
        totalPeriodDays = diffDays(periodStart, periodEnd) + 1;
        workedDays = Math.max(0, diffDays(desde, hasta) + 1);
        aguinaldo = salMensual * (workedDays / totalPeriodDays);
      }

      // Preaviso (Art. 28 CR) si aplica
      let preavisoDias = 0;
      if (tipoSeleccionado?.aplicaPreaviso) {
        const dias = antiguedad.dias;
        const meses = dias/30;
        if (meses >= 12) preavisoDias = 30;
        else if (meses >= 6) preavisoDias = 15;
        else if (meses >= 3) preavisoDias = 7;
        else preavisoDias = 0;
      }
      const preaviso = salDiario * preavisoDias;

      // Cesantía (Art. 29 CR) si aplica - esquema simplificado con tope de 8 años
      let cesantiaDias = 0;
      if (tipoSeleccionado?.aplicaCesantia) {
        const dias = antiguedad.dias;
        const meses = dias/30;
        if (meses >= 12){
          const years = Math.min(8, Math.floor(dias / 365));
          cesantiaDias = years * 20;
          // prorrateo simple por fracción del siguiente año si aún bajo tope
          const rem = dias % 365;
          if (years < 8 && rem > 0) {
            cesantiaDias += Math.min(20 * (rem / (isLeap(new Date(fechaSalida).getFullYear()) ? 366 : 365)), 20);
          }
        } else if (meses >= 6) cesantiaDias = 14;
        else if (meses >= 3) cesantiaDias = 7;
        else cesantiaDias = 0;
      }
      const cesantia = salDiario * cesantiaDias;

      const subtotal = pagoVac + aguinaldo + preaviso + cesantia;
      const total = subtotal - ded;

      setResultado({
        empleadoId: Number(empleadoId),
        fechaIngreso: toISO(fechaIngreso),
        fechaSalida: toISO(fechaSalida),
        salQ, salMensual, salDiario,
        vacPend, pagoVac,
        workedDays, totalPeriodDays, aguinaldo,
        aplicaPreaviso: Boolean(tipoSeleccionado?.aplicaPreaviso), preavisoDias, preaviso,
        aplicaCesantia: Boolean(tipoSeleccionado?.aplicaCesantia), cesantiaDias, cesantia,
        deducciones: ded,
        total: Math.round(total*100)/100,
        subtotal: Math.round(subtotal*100)/100,
        antiguedad,
        tipoLiquidacion,
        tipoLiquidacionLabel: tipoSeleccionado?.label || '',
        tipoLiquidacionDetalle: tipoSeleccionado?.detalle || '',
      });
      toast?.('Cálculo actualizado', { type: 'success', title: 'Liquidaciones' });
    } finally {
      setLoading(false);
    }
  }

  async function onGuardar(){
    if (!resultado) return;
    // Bloquear si ya existe liquidación para este empleado
    const ya = persistidos.find(p => String(p.idEmpleado) === String(empleadoId));
    if (ya) { showError('Este empleado ya fue liquidado previamente.'); return; }
    setLoading(true); setError(''); setMsg('');
    try{
      const payload = {
        fecha: toISO(new Date()),
        pago_vacaciones: resultado.pagoVac,
        idEmpleado: resultado.empleadoId,
        aguinaldo: resultado.aguinaldo,
        preaviso: resultado.preaviso,
        cesantia: resultado.cesantia,
        monto_total: resultado.total,
        fecha_ingreso: resultado.fechaIngreso,
      };
      await guardarLiquidacion(payload);
      showSuccess('Liquidación guardada.');
      await cargarPersistidos();
    } catch(e){
      showError(e?.response?.data?.message || e.message || 'Error al guardar');
    }
    finally { setLoading(false); }
  }

  async function cargarPersistidos(showToast = false){
    try{
      const r = await listarLiquidaciones({ idEmpleado: empleadoId || undefined });
      setPersistidos(r?.data || []);
      if (showToast) {
        toast?.('Liquidaciones cargadas', { type: 'success', title: 'Liquidaciones' });
      }
    } catch (err) {
      console.error('Error al listar liquidaciones', err);
      showError('Error al listar liquidaciones');
    }
  }

  async function onExportPdf(){
    if (!resultado) return;
    setLoading(true); setError(''); setMsg('');
    try{
      const emp = empleados.find(e => String(e.idEmpleado) === String(empleadoId));
      const blob = await exportarLiquidacionPdf({
        empleado: emp ? {
          idEmpleado: emp.idEmpleado,
          nombre: emp.nombre,
          apellido1: emp.apellido1,
          apellido2: emp.apellido2
        } : null,
        desglose: resultado,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ymd = new Date().toISOString().slice(0,10);
      a.href = url;
      a.download = `Liquidacion_${empleadoId||'empleado'}_${ymd}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showSuccess('PDF generado.');
    } catch(e){ showError(e?.response?.data?.message || e.message || 'Error al generar PDF'); }
    finally { setLoading(false); }
  }

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <BackToHome />
          <h2 className="mb-0">Liquidaciones</h2>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary" onClick={() => cargarPersistidos(true)} disabled={loading}>Ver registradas</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <label className="form-label">Empleado</label>
              <select className="form-select" value={empleadoId} onChange={e=>setEmpleadoId(e.target.value)}>
                <option value="">Seleccione…</option>
                {empleados.map(e => (
                  <option key={e.idEmpleado} value={e.idEmpleado}>
                    #{e.idEmpleado} - {e.nombre} {e.apellido1}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-4">
              <label className="form-label">Fecha ingreso</label>
              <input type="date" className="form-control" value={fechaIngreso} onChange={e=>setFechaIngreso(e.target.value)} />
            </div>
            <div className="col-6 col-md-4">
              <label className="form-label">Fecha salida</label>
              <input type="date" className="form-control" value={fechaSalida} onChange={e=>setFechaSalida(e.target.value)} />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">Salario promedio quincenal</label>
              <input type="number" min="0" step="0.01" className="form-control" value={salarioPromQuincenal} onChange={e=>setSalarioPromQuincenal(e.target.value)} />
            </div>
            <div className="col-6 col-md-4">
              <label className="form-label">Vacaciones pendientes (días)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                className="form-control"
                value={vacDias}
                onChange={e=>setVacDias(e.target.value)}
                placeholder={loadingVacPend ? 'Cargando...' : ''}
                aria-busy={loadingVacPend}
              />
            </div>
            <div className="col-6 col-md-4">
              <label className="form-label">Deducciones (monto)</label>
              <input type="number" min="0" step="0.01" className="form-control" value={deducciones} onChange={e=>setDeducciones(e.target.value)} />
            </div>
            <div className="col-12">
              <label className="form-label">Tipo de liquidacion</label>
              <div className="row g-3">
                {TIPOS_LIQUIDACION.map(tipo => {
                  const checked = tipoLiquidacion === tipo.value;
                  return (
                    <div className="col-12 col-lg-4" key={tipo.value}>
                      <div className={`border rounded p-3 h-100 ${checked ? 'border-primary shadow-sm' : 'border-secondary'}`}>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            name="tipoLiquidacion"
                            id={`tipo-${tipo.value}`}
                            value={tipo.value}
                            checked={checked}
                            onChange={()=>setTipoLiquidacion(tipo.value)}
                          />
                          <label className="form-check-label fw-semibold" htmlFor={`tipo-${tipo.value}`}>
                            {tipo.label}
                          </label>
                        </div>
                        <small className="text-muted d-block mt-2">
                          {`\u{1F539} ${tipo.label}: ${tipo.detalle}`}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="col-12 d-flex align-items-center">
              <div className="small text-muted">
                {tipoLiquidacion ? `Se aplicar\u00e1n los pagos indicados para ${tipoSeleccionado?.label || 'el tipo seleccionado'}.` : 'Seleccione un tipo para saber qu\u00e9 rubros se incluyen.'}
              </div>
              <button className="btn btn-primary ms-auto" onClick={calcular} disabled={loading}>Calcular liquidacion</button>
            </div>
          </div>
        </div>
      </div>

      {resultado && (
      <div className="card mb-3">
      <div className="card-body">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex align-items-center gap-2">
          <h5 className="mb-0">Desglose</h5>
          {resultado.tipoLiquidacionLabel && (
            <span className="badge bg-info text-dark text-uppercase">
              {resultado.tipoLiquidacionLabel}
            </span>
          )}
        </div>
        <div className="d-flex gap-2">
          <button
            className="btn btn-success"
            onClick={onGuardar}
            disabled={loading || persistidos.some(p => String(p.idEmpleado) === String(empleadoId))}
          >
            Guardar liquidación
          </button>
          <button
            className="btn btn-outline-light"
            onClick={onExportPdf}
            disabled={loading}
          >
            Exportar PDF
          </button>
        </div>
      </div>

      {persistidos.some(p => String(p.idEmpleado) === String(empleadoId)) && (
        <div className="alert alert-warning py-2">
          Este empleado ya fue liquidado previamente. No se puede registrar nuevamente.
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-md-6">
          {resultado.tipoLiquidacionDetalle && (
            <div className="alert alert-secondary py-2">
              {`\u{1F539} ${resultado.tipoLiquidacionLabel}: ${resultado.tipoLiquidacionDetalle}`}
            </div>
          )}
          <ul className="list-group list-group-flush">
            <li className="list-group-item bg-transparent d-flex justify-content-between">
              <span>Salario diario (aprox.)</span>
              <span>{fmt(resultado.salDiario)}</span>
            </li>
            <li className="list-group-item bg-transparent d-flex justify-content-between">
              <span>Vacaciones pendientes</span>
              <span>{resultado.vacPend} días → {fmt(resultado.pagoVac)}</span>
            </li>
            <li className="list-group-item bg-transparent d-flex justify-content-between">
              <span>Aguinaldo proporcional</span>
              <span>{fmt(resultado.aguinaldo)}</span>
            </li>
            {resultado.aplicaPreaviso && (
              <li className="list-group-item bg-transparent d-flex justify-content-between">
                <span>Preaviso ({resultado.preavisoDias} días)</span>
                <span>{fmt(resultado.preaviso)}</span>
              </li>
            )}
            {resultado.aplicaCesantia && (
              <li className="list-group-item bg-transparent d-flex justify-content-between">
                <span>Cesantía ({resultado.cesantiaDias.toFixed(2)} días)</span>
                <span>{fmt(resultado.cesantia)}</span>
              </li>
            )}
            <li className="list-group-item bg-transparent d-flex justify-content-between">
              <span>Deducciones</span>
              <span>- {fmt(resultado.deducciones)}</span>
            </li>
            <li className="list-group-item bg-transparent d-flex justify-content-between fw-semibold">
              <span>Total a pagar</span>
              <span>{fmt(resultado.total)}</span>
            </li>
          </ul>
        </div>

        <div className="col-12 col-md-6">
          <div className="alert alert-info">
            <strong>Referencia legal (Costa Rica):</strong>
            <ul className="mb-0">
              <li>
                Art. 28 – Preaviso: 7 días (3–6 meses), 15 días (6–12 meses), 30 días (&gt; 1 año) si corresponde.
              </li>
              <li>
                Art. 29 – Auxilio de cesantía: escala simplificada con tope de 8 años; aquí se usa 20 días/año para ≥ 1 año.
              </li>
              <li>
                Aguinaldo proporcional: fracción del período legal Dic 1 – Nov 30 según días trabajados.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    </div>
    )}


      {persistidos.length > 0 && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-2">Liquidaciones registradas</h5>
            <div className="table-responsive">
              <table className="table table-dark table-striped align-middle">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    <th className="text-end">Vacaciones</th>
                    <th className="text-end">Aguinaldo</th>
                    <th className="text-end">Preaviso</th>
                    <th className="text-end">Cesantía</th>
                    <th className="text-end">Total</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {persistidos.map(r => (
                    <tr key={r.idLiquidacion}>
                      <td>{r.idLiquidacion}</td>
                      <td>{r.nombre}</td>
                      <td>{r.nombre_puesto}</td>
                      <td className="text-end">{fmt(r.pago_vacaciones)}</td>
                      <td className="text-end">{fmt(r.aguinaldo)}</td>
                      <td className="text-end">{fmt(r.preaviso)}</td>
                      <td className="text-end">{fmt(r.cesantia)}</td>
                      <td className="text-end fw-semibold">{fmt(r.monto_total)}</td>
                      <td>{r.fecha ? new Date(r.fecha).toLocaleDateString('es-CR') : '-'}</td>
                    </tr>
                  ))}
                  {persistidos.length === 0 && (
                    <tr><td colSpan="9" className="text-center text-secondary">Sin datos</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
