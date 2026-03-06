import { api } from './index';

export async function fetchAsistenciaResumen(params = {}) {
  const { data } = await api.get('/asistencia/resumen', { params });
  return data;
}

export async function fetchAsistencia(params = {}) {
  const { data } = await api.get('/asistencia', { params });
  return data;
}

export async function marcarAsistencia(payload) {
  const { data } = await api.post('/asistencia', payload);
  return data;
}

export async function solicitarHorasExtra(payload) {
  const { data } = await api.post('/horas-extras/solicitar', payload);
  return data;
}
