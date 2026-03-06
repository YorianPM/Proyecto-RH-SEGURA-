import { api } from './index';

export async function fetchHorasExtras(params = {}) {
  const { data } = await api.get('/horas-extras', { params });
  return data;
}

export async function fetchHorasExtrasResumen(params = {}) {
  const { data } = await api.get('/horas-extras/resumen', { params });
  return data;
}

export async function aprobarHorasExtra(id, payload = {}) {
  const { data } = await api.patch(`/horas-extras/${id}/aprobar`, payload);
  return data;
}

export async function denegarHorasExtra(id, payload = {}) {
  const { data } = await api.patch(`/horas-extras/${id}/denegar`, payload);
  return data;
}

