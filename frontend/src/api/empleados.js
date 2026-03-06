import { api } from './index';

// LISTAR
export async function getEmpleados() {
  const { data } = await api.get('/empleados');
  return data.data || [];
}

// OBTENER POR ID
export async function getEmpleado(id) {
  const { data } = await api.get(`/empleados/${id}`);
  return data.data;
}

// CREAR
export async function createEmpleado(payload) {
  const { data } = await api.post('/empleados', payload);
  return data.data;
}

// ACTUALIZAR
export async function updateEmpleado(id, payload) {
  const { data } = await api.put(`/empleados/${id}`, payload);
  return data.data;
}

// ELIMINAR
export async function deleteEmpleado(id) {
  const { data } = await api.delete(`/empleados/${id}`);
  return data;
}

// CAMBIAR PASSWORD
export async function changeEmpleadoPassword(id, nueva) {
  const { data } = await api.patch(`/empleados/${id}/password`, { nueva });
  return data;
}

// AUX: PUESTOS y ROLES
export async function getPuestos() {
  const { data } = await api.get('/puestos');
  return data.data || [];
}

export async function updatePuesto(id, payload) {
  const { data } = await api.put(`/puestos/${id}`, payload);
  return data.data;
}

export async function crearPuesto(payload){
  const { data } = await api.post('/puestos', payload);
  return data.data;
}

export async function getRoles() {
  const { data } = await api.get('/roles');
  return data.data || [];
}
