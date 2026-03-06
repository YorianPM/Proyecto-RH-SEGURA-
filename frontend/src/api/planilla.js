import { api } from './index';

// Vista previa de planilla
// params: { periodo, desde, hasta, horasMes?, tasaHE?, rentaBase? }
export async function previewPlanilla(params) {
  const { data } = await api.get('/planilla/preview', { params });
  return data; // { ok, data:[...], meta:{...} }
}

// Preview dinámico ingresos/deducciones
export async function previewPlanillaV2(params) {
  const { data } = await api.get('/planilla/preview-v2', { params });
  return data; // { ok, data:[{ingresos:[], deducciones:[], ...}], meta }
}

export async function generarPlanilla(payload) {
  const { data } = await api.post('/planilla/generar', payload);
  return data; // { ok, count, data:[inserted rows] }
}

export async function actualizarPlanilla(id, payload) {
  const { data } = await api.put(`/planilla/${id}`, payload);
  return data; // { ok, data }
}

export async function cerrarPlanilla(id) {
  const { data } = await api.patch(`/planilla/${id}/cerrar`);
  return data; // { ok, data|message }
}

export async function listarPlanillas(params) {
  const { data } = await api.get('/planilla', { params });
  return data; // { ok, data: [...] }
}

// ======= Nuevos endpoints especificación CR =======
export async function getPlanillaConfig(anio){
  const { data } = await api.get(`/planilla/config/${anio}`);
  return data; // { ccss_obrero, banco_popular_obrero, patronal_total }
}

export async function savePlanillaConfig(anio, cfg){
  const { data } = await api.put(`/planilla/config/${anio}`, cfg);
  return data; // { ok:true }
}

export async function previewPlanillaCR(payload){
  const { data } = await api.post('/planilla/preview', payload);
  return data; // { filas, totales, costo_total_empresa, snapshot }
}

export async function detallePlanilla(params){
  const { data } = await api.get('/planilla/detalle', { params });
  return data; // { ok, data, snapshot }
}

export async function overridePlanilla(payload){
  const { data } = await api.put('/planilla/override', payload);
  return data; // { ok:true }
}

export async function cerrarPlanillaRango(payload){
  const { data } = await api.post('/planilla/cerrar', payload);
  return data; // { ok:true }
}

export function pdfPlanillaUrl(params){
  const usp = new URLSearchParams(params);
  return `${api.defaults.baseURL}/planilla/pdf?${usp.toString()}`;
}

// Descargar PDF con cabecera Authorization
export async function downloadPlanillaPdf(params){
  const res = await api.get('/planilla/pdf', { params, responseType: 'blob' });
  return res.data; // Blob PDF
}

// Descargar la coletilla (payslip) del empleado autenticado
export async function downloadPayslip(params){
  const res = await api.get('/planilla/payslip', { params, responseType: 'blob' });
  return res.data; // Blob PDF
}
