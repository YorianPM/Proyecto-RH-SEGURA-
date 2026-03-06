import { api } from './index';

export async function obtenerNotificaciones(params = {}) {
  const { data } = await api.get('/notificaciones', { params });
  return data; // { ok:true, data:[...] }
}

