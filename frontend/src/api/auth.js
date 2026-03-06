import api from './client';
export async function login({ usuario, contrasena }) {
  const { data } = await api.post('/api/auth/login', { usuario, contrasena });
  return data; // { ok, token, user }
}
