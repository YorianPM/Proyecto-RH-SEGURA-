import { api } from './index';

export async function previewAguinaldo(params) {
  const { data } = await api.get('/aguinaldo/preview', { params });
  return data; // { ok, data, meta, nota }
}

export async function generarAguinaldo(payload) {
  const { data } = await api.post('/aguinaldo/generar', payload);
  return data; // { ok, count, ops }
}

export async function listarAguinaldo(params) {
  const { data } = await api.get('/aguinaldo', { params });
  return data; // { ok, data:[...] }
}

export async function obtenerMiAguinaldo(params) {
  const { data } = await api.get('/aguinaldo/mio', { params });
  return data; // { ok, data:{...}, meta:{...} }
}

export async function descargarMiAguinaldoPdf(params) {
  const { data } = await api.get('/aguinaldo/mio/pdf', {
    params,
    responseType: 'blob',
  });
  return data; // Blob PDF
}

export async function descargarAguinaldoPersistidoPdf(params) {
  const { data } = await api.get('/aguinaldo/pdf', {
    params,
    responseType: 'blob',
  });
  return data;
}
