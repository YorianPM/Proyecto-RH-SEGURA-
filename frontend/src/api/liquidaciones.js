import { api } from './index';

export async function guardarLiquidacion(payload) {
  const { data } = await api.post('/liquidaciones', payload);
  return data; // { ok:true, id }
}

export async function listarLiquidaciones(params) {
  const { data } = await api.get('/liquidaciones', { params });
  return data; // { ok:true, data: [...] }
}

export async function exportarLiquidacionPdf(payload){
  const res = await api.post('/liquidaciones/pdf', payload, { responseType: 'blob' });
  return res.data; // Blob PDF
}

export async function aguinaldoProporcionalEmpleado(payload){
  const { data } = await api.post('/liquidaciones/aguinaldo-proporcional', payload);
  return data; // { ok, devengado, aguinaldo, desde, hasta }
}
