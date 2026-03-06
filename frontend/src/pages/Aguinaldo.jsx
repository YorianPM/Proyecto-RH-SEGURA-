import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authStore';
import { previewAguinaldo, generarAguinaldo, listarAguinaldo, obtenerMiAguinaldo, descargarMiAguinaldoPdf, descargarAguinaldoPersistidoPdf } from '../api/aguinaldo';
import BackToHome from '../components/BackToHome';
import { useToast } from '../context/toastStore';

function fmt(n){ return Number(n||0).toLocaleString('es-CR',{ style:'currency', currency:'CRC', maximumFractionDigits:2 }); }

function periodFromYear(y){
  const anio = Number(y||new Date().getFullYear());
  return { desde: `${anio-1}-12-01`, hasta: `${anio}-11-30` };
}

const MONTH_KEYS = [
  'diciembre','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre'
];

export default function Aguinaldo(){
  const { hasPerm, user } = useAuth();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [prev, setPrev] = useState({ data: [], meta: null, nota: null });
  const [persist, setPersist] = useState([]);
  const toast = useToast();
  const pf = useMemo(()=>periodFromYear(anio), [anio]);
  const puedeVerAdmin = hasPerm('planilla_ver_RH') || hasPerm('aguinaldos_ver_RH');
  const puedeGenerarAdmin = hasPerm('planilla_generar_RH') || hasPerm('aguinaldos_calcular_RH');
  const [miDetalle, setMiDetalle] = useState(null);
  const [miMeta, setMiMeta] = useState(null);
  const [loadingMi, setLoadingMi] = useState(false);
  const [mensajeMi, setMensajeMi] = useState('');
  const [mensajeMiTipo, setMensajeMiTipo] = useState('secondary');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingPersistPdf, setDownloadingPersistPdf] = useState(false);
  const formatLocalDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('es-CR');
  };

  const loadMiAguinaldo = useCallback(async ({ showStatus } = {}) => {
    if (!user?.idEmpleado) {
      setMiDetalle(null);
      setMiMeta(null);
      setMensajeMi('No hay un empleado asociado a tu usuario.');
      setMensajeMiTipo('danger');
      return;
    }
    setLoadingMi(true);
    setMensajeMi('');
    setMensajeMiTipo('secondary');
    try {
      const resp = await obtenerMiAguinaldo({ anio });
      setMiDetalle(resp?.data || null);
      setMiMeta(resp?.meta || null);
      setMensajeMi('');
      if (showStatus) {
        toast?.(`El aguinaldo ${anio} ya ha sido actualizado.`, { type: 'success', title: 'Aguinaldo' });
      }
    } catch (e) {
      if (e?.response?.status === 404) {
        setMiDetalle(null);
        setMiMeta(null);
        setMensajeMi(`Aún no se ha generado el aguinaldo ${anio}.`);
        setMensajeMiTipo('secondary');
        if (showStatus) {
          toast?.(`El aguinaldo ${anio} aún no ha sido generado.`, { type: 'info', title: 'Aguinaldo' });
        }
      } else {
        const text = e?.response?.data?.message || e.message || 'No se pudo obtener tu aguinaldo';
        setMiDetalle(null);
        setMiMeta(null);
        setMensajeMi(text);
        setMensajeMiTipo('danger');
        toast?.(text, { type: 'error', title: 'Aguinaldo' });
      }
    } finally {
      setLoadingMi(false);
    }
  }, [anio, toast, user?.idEmpleado]);

  useEffect(() => {
    loadMiAguinaldo();
  }, [loadMiAguinaldo]);

  const downloadMiPdf = useCallback(async () => {
    if (!miDetalle) {
      toast?.('Aún no hay datos de aguinaldo para descargar', { type: 'info', title: 'Aguinaldo' });
      return;
    }
    try {
      setDownloadingPdf(true);
      const blob = await descargarMiAguinaldoPdf({ anio });
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `aguinaldo_${anio}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast?.('Descarga generada', { type: 'success', title: 'Aguinaldo' });
    } catch (e) {
      const text = e?.response?.data?.message || e.message || 'No se pudo generar el PDF';
      toast?.(text, { type: 'error', title: 'Aguinaldo' });
    } finally {
      setDownloadingPdf(false);
    }
  }, [anio, miDetalle, toast]);

  const downloadPersistPdf = useCallback(async () => {
    try {
      setDownloadingPersistPdf(true);
      const blob = await descargarAguinaldoPersistidoPdf({ anio });
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `aguinaldo_${anio}_persistidos.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast?.('PDF generado', { type: 'success', title: 'Aguinaldo' });
    } catch (e) {
      const text = e?.response?.data?.message || e.message || 'No se pudo generar el PDF';
      toast?.(text, { type: 'error', title: 'Aguinaldo' });
    } finally {
      setDownloadingPersistPdf(false);
    }
  }, [anio, toast]);

  // Paginación (preview)
  const [pagePrev, setPagePrev] = useState(1);
  const [pageSizePrev, setPageSizePrev] = useState(25);
  const pagePrevData = useMemo(() => {
    const total = prev.data?.length || 0;
    const start = Math.max(0, (pagePrev - 1) * pageSizePrev);
    const end = Math.min(start + pageSizePrev, total);
    return {
      total, start, end,
      pageItems: (prev.data || []).slice(start, end),
      pageCount: Math.max(1, Math.ceil(total / pageSizePrev)),
    };
  }, [prev.data, pagePrev, pageSizePrev]);

  // Paginación (persistidos)
  const [pagePer, setPagePer] = useState(1);
  const [pageSizePer, setPageSizePer] = useState(25);
  const pagePerData = useMemo(() => {
    const total = persist?.length || 0;
    const start = Math.max(0, (pagePer - 1) * pageSizePer);
    const end = Math.min(start + pageSizePer, total);
    return {
      total, start, end,
      pageItems: (persist || []).slice(start, end),
      pageCount: Math.max(1, Math.ceil(total / pageSizePer)),
    };
  }, [persist, pagePer, pageSizePer]);

  async function doPreview(){
    if (!puedeVerAdmin) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const r = await previewAguinaldo({ anio });
      setPrev({ data: r.data||[], meta: r.meta||null, nota: r.nota||null });
      setPagePrev(1);
      toast?.('Previsualización lista', { type: 'success', title: 'Aguinaldo' });
    } catch(e){
      const text = e?.response?.data?.message || e.message || 'Error al previsualizar';
      setError(text);
      toast?.(text, { type: 'error', title: 'Aguinaldo' });
    }
    finally { setLoading(false); }
  }

  async function doGenerar(){
    if (!puedeGenerarAdmin) return;
    setLoading(true); setError(''); setMsg('');
    try {
      await generarAguinaldo({ anio });
      await doLoadPersist();
      setMsg('Aguinaldo generado');
      toast?.('Aguinaldo generado correctamente', { type: 'success', title: 'Aguinaldo' });
      await loadMiAguinaldo();
    } catch(e){
      if (e?.response?.status === 409) {
        const text = e?.response?.data?.message || 'El aguinaldo de este año ya fue generado.';
        setMsg(text);
        setError('');
        toast?.(text, { type: 'info', title: 'Aguinaldo' });
      } else {
        const text = e?.response?.data?.message || e.message || 'Error al generar aguinaldo';
        setError(text);
        toast?.(text, { type: 'error', title: 'Aguinaldo' });
      }
    }
    finally { setLoading(false); }
  }

  async function doLoadPersist(){
    if (!puedeVerAdmin) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const r = await listarAguinaldo({ anio });
      const list = r?.data || [];
      setPersist(list);
      setPagePer(1);
      if (list.length === 0) {
        toast?.('No hay aguinaldos generados para este año.', { type: 'info', title: 'Aguinaldo' });
      } else {
        toast?.('Registros cargados', { type: 'success', title: 'Aguinaldo' });
      }
    } catch(e){
      const text = e?.response?.data?.message || e.message || 'Error al cargar';
      setError(text);
      toast?.(text, { type: 'error', title: 'Aguinaldo' });
    }
    finally { setLoading(false); }
  }

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <BackToHome />
          <h2 className="mb-0">Aguinaldo</h2>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-3">
              <label className="form-label">Año</label>
              <input type="number" className="form-control" value={anio} onChange={(e)=>setAnio(Number(e.target.value)||new Date().getFullYear())} />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">Período legal</label>
              <div className="form-control" readOnly>{pf.desde} al {pf.hasta}</div>
            </div>
            <div className="col-12 col-md-3 d-flex gap-2 flex-wrap">
              {puedeVerAdmin ? (
                <>
                  <button className="btn btn-primary" onClick={doPreview} disabled={loading}>Previsualizar</button>
                  {puedeGenerarAdmin && (
                    <button className="btn btn-success" onClick={doGenerar} disabled={loading}>Generar</button>
                  )}
                  <button className="btn btn-outline-secondary" onClick={doLoadPersist} disabled={loading}>Persistidos</button>
                </>
              ) : (
                <button
                  className="btn btn-outline-primary w-100"
                  onClick={() => loadMiAguinaldo({ showStatus: true })}
                  disabled={loadingMi}
                >
                  {loadingMi ? 'Consultando...' : 'Actualizar mi aguinaldo'}
                </button>
              )}
            </div>
          </div>

        
          {error && <div className="alert alert-danger mt-3">{error}</div>}
          {msg && <div className="alert alert-success mt-3">{msg}</div>}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div>
              <h5 className="mb-0">Mi aguinaldo ({anio})</h5>
              <small className="text-secondary">
                Periodo legal: {(miMeta?.desde || pf.desde)} al {(miMeta?.hasta || pf.hasta)}
              </small>
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-outline-primary btn-sm"
                onClick={() => loadMiAguinaldo({ showStatus: true })}
                disabled={loadingMi}
              >
                {loadingMi ? 'Consultando...' : 'Actualizar'}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={downloadMiPdf}
                disabled={downloadingPdf || loadingMi || !miDetalle}
              >
                {downloadingPdf ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </div>
          </div>

          {loadingMi ? (
            <p className="text-secondary mb-0">Consultando...</p>
          ) : miDetalle ? (
            <>
              <div className="row g-3 mb-3">
                <div className="col-12 col-md-4">
                  <div className="p-3 border rounded h-100">
                    <small className="text-secondary text-uppercase d-block">Monto a recibir</small>
                    <div className="fs-4 fw-semibold mb-0">{fmt(miDetalle.monto_total_pagado)}</div>
                  </div>
                </div>
                <div className="col-12 col-md-4">
                  <div className="p-3 border rounded h-100">
                    <small className="text-secondary text-uppercase d-block">Total devengado</small>
                    <div className="fs-5 fw-semibold mb-0">{fmt(miDetalle.total_devengado)}</div>
                  </div>
                </div>
                <div className="col-12 col-md-4">
                  <div className="p-3 border rounded h-100">
                    <small className="text-secondary text-uppercase d-block">Generado el</small>
                    <div className="fs-6 fw-semibold mb-0">{formatLocalDate(miDetalle.fecha_generacion)}</div>
                  </div>
                </div>
              </div>
              <p className="mb-1"><strong>Empleado:</strong> {miDetalle.nombre}</p>
              <p className="mb-3"><strong>Puesto:</strong> {miDetalle.nombre_puesto || '-'}</p>
              <div className="table-responsive">
                <table className="table table-dark table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      {MONTH_KEYS.map(m => (
                        <th key={`mi-head-${m}`} className="text-end text-nowrap">
                          {m.charAt(0).toUpperCase()+m.slice(1)}
                        </th>
                      ))}
                      <th className="text-end">Total devengado</th>
                      <th className="text-end">Aguinaldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {MONTH_KEYS.map(m => (
                        <td key={`mi-${m}`} className="text-end">{fmt(miDetalle.meses?.[m] || 0)}</td>
                      ))}
                      <td className="text-end">{fmt(miDetalle.total_devengado)}</td>
                      <td className="text-end fw-semibold">{fmt(miDetalle.monto_total_pagado)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className={`mb-0 text-${mensajeMiTipo === 'danger' ? 'danger' : 'secondary'}`}>
              {mensajeMi || `Aún no se ha generado el aguinaldo ${anio}.`}
            </p>
          )}
        </div>
      </div>

      {puedeVerAdmin && prev.data?.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Previsualización {prev?.meta?.anio ? `(Año ${prev.meta.anio})` : ''}</h5>
              <div className="d-flex align-items-center gap-2">
                {prev?.meta && <small className="text-muted me-2">Del {prev.meta.desde} al {prev.meta.hasta}</small>}
                <select
                  className="form-select form-select-sm w-auto"
                  value={pageSizePrev}
                  onChange={e => { setPageSizePrev(Number(e.target.value)); setPagePrev(1); }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-dark table-striped align-middle">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    <th className="text-end">Salario base</th>
                    {MONTH_KEYS.map(m => (<th key={m} className="text-end text-nowrap">{m.charAt(0).toUpperCase()+m.slice(1)}</th>))}
                    <th className="text-end">Total devengado</th>
                    <th className="text-end">Aguinaldo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagePrevData.pageItems.map(r => (
                    <tr key={r.idEmpleado}>
                      <td>{r.nombre}</td>
                      <td>{r.puesto}</td>
                      <td className="text-end">{fmt(r.salario_base)}</td>
                      {MONTH_KEYS.map(m => (<td key={m} className="text-end">{fmt(r[m] || 0)}</td>))}
                      <td className="text-end">{fmt(r.total_devengado)}</td>
                      <td className="text-end fw-semibold">{fmt(r.monto_aguinaldo)}</td>
                    </tr>
                  ))}
                  {pagePrevData.total === 0 && (
                    <tr>
                      <td colSpan={MONTH_KEYS.length + 5} className="text-center text-secondary py-3">Sin datos</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pagePrevData.total > 0 && (
              <div className="d-flex justify-content-between align-items-center mt-2">
                <div className="text-secondary small">
                  Mostrando {pagePrevData.start + 1}-{pagePrevData.end} de {pagePrevData.total}
                </div>
                <div className="btn-group">
                  <button className="btn btn-outline-light btn-sm" disabled={pagePrev <= 1} onClick={() => setPagePrev(p => Math.max(1, p - 1))}>Anterior</button>
                  <span className="btn btn-outline-light btn-sm disabled">Página {pagePrev} / {pagePrevData.pageCount}</span>
                  <button className="btn btn-outline-light btn-sm" disabled={pagePrev >= pagePrevData.pageCount} onClick={() => setPagePrev(p => Math.min(pagePrevData.pageCount, p + 1))}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {puedeVerAdmin && persist.length > 0 && (
        <div className="card">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Aguinaldos generados (persistidos)</h5>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <small className="text-muted">Año {anio}</small>
                <select
                  className="form-select form-select-sm w-auto"
                  value={pageSizePer}
                  onChange={e => { setPageSizePer(Number(e.target.value)); setPagePer(1); }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={downloadPersistPdf}
                  disabled={downloadingPersistPdf || loading || !persist.length}
                >
                  {downloadingPersistPdf ? 'Generando PDF...' : 'Descargar PDF'}
                </button>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-dark table-striped align-middle">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    {MONTH_KEYS.map(m => (<th key={m} className="text-end text-nowrap">{m.charAt(0).toUpperCase()+m.slice(1)}</th>))}
                    <th className="text-end">Aguinaldo pagado</th>
                    <th className="text-nowrap">Generado</th>
                  </tr>
                </thead>
                <tbody>
                  {pagePerData.pageItems.map(r => (
                    <tr key={r.idAguinaldo}>
                      <td>{r.nombre}</td>
                      <td>{r.nombre_puesto}</td>
                      {MONTH_KEYS.map(m => (<td key={m} className="text-end">{fmt(r[m] || 0)}</td>))}
                      <td className="text-end fw-semibold">{fmt(r.monto_total_pagado)}</td>
                      <td>{r.fecha_generacion ? new Date(r.fecha_generacion).toLocaleDateString('es-CR') : '-'}</td>
                    </tr>
                  ))}
                  {pagePerData.total === 0 && (
                    <tr>
                      <td colSpan={MONTH_KEYS.length + 4} className="text-center text-secondary py-3">Sin datos</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pagePerData.total > 0 && (
              <div className="d-flex justify-content-between align-items-center mt-2">
                <div className="text-secondary small">
                  Mostrando {pagePerData.start + 1}-{pagePerData.end} de {pagePerData.total}
                </div>
                <div className="btn-group">
                  <button className="btn btn-outline-light btn-sm" disabled={pagePer <= 1} onClick={() => setPagePer(p => Math.max(1, p - 1))}>Anterior</button>
                  <span className="btn btn-outline-light btn-sm disabled">Página {pagePer} / {pagePerData.pageCount}</span>
                  <button className="btn btn-outline-light btn-sm" disabled={pagePer >= pagePerData.pageCount} onClick={() => setPagePer(p => Math.min(pagePerData.pageCount, p + 1))}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
