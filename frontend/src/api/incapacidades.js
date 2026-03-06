import api from './client';

export async function createIncapacidad(formData) {
  const { data } = await api.post('/incapacidades', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

export async function getIncapacidades() {
  const { data } = await api.get('/incapacidades');
  return data.data || [];
}

export async function updateIncapacidadEstado(id, estado, observaciones) {
  const payload = { estado };
  if (observaciones !== undefined) payload.observaciones = observaciones;
  const { data } = await api.patch(`/incapacidades/${id}/estado`, payload);
  return data.data;
}
