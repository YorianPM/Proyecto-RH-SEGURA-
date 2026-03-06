import { useMemo, useState } from 'react';
import BackToHome from '../components/BackToHome';
import { downloadPayslip } from '../api/planilla';
import { useToast } from '../context/toastStore';

function toYMD(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultPeriodoFechas(){
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  if (day <= 15) return { periodo:'quincenal', desde: toYMD(new Date(y,m,1)), hasta: toYMD(new Date(y,m,15)) };
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { periodo:'quincenal', desde: toYMD(new Date(y,m,16)), hasta: toYMD(new Date(y,m,lastDay)) };
}

function toISO(s){
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s); if (!isNaN(d)) return toYMD(d);
  return s;
}

export default function MiColetilla(){
  const def = useMemo(defaultPeriodoFechas, []);
  const [periodo] = useState('quincenal');
  const [desde, setDesde] = useState(def.desde);
  const [hasta, setHasta] = useState(def.hasta);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const rangoValido = () => !!desde && !!hasta && new Date(desde) <= new Date(hasta);

  async function doDownload(){
    try{
      if (!rangoValido()) {
        const warn = 'Rango de fechas inválido';
        setError(warn);
        toast?.(warn, { type: 'warning', title: 'Mi coletilla' });
        return;
      }
      setLoading(true); setError('');
      const blob = await downloadPayslip({ periodo, desde: toISO(desde), hasta: toISO(hasta) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `coletilla_${periodo}_${desde}_${hasta}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast?.('Descarga generada', { type: 'success', title: 'Mi coletilla' });
    } catch(e){
      const msg = e?.response?.status === 404 ? 'No hay planilla para el período seleccionado'
        : (e?.response?.status === 501 ? 'El servidor no tiene habilitada la generación de PDF'
        : (e?.response?.data?.message || e.message || 'Error al descargar'));
      setError(msg);
      toast?.(msg, { type: 'error', title: 'Mi coletilla' });
    } finally { setLoading(false); }
  }

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Mi Coletilla de Pago</h3>
      </div>
      <div className="card">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-3">
              <label className="form-label">Período</label>
              <input
                className="form-control"
                value="Quincenal"
                readOnly
                disabled
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label">Desde</label>
              <input type="date" className="form-control" value={desde} onChange={e=>setDesde(e.target.value)} />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label">Hasta</label>
              <input type="date" className="form-control" value={hasta} onChange={e=>setHasta(e.target.value)} />
            </div>
            <div className="col-12 col-md-3 d-grid">
              <button className="btn btn-primary" onClick={doDownload} disabled={loading}>
                {loading ? 'Generando…' : 'Descargar mi coletilla'}
              </button>
            </div>
          </div>
          {error && <div className="alert alert-warning mt-3 mb-0">{error}</div>}
          <small className="text-muted d-block mt-3">Selecciona el rango que corresponda a la planilla ya generada para descargar tu comprobante.</small>
        </div>
      </div>
    </div>
  );
}
