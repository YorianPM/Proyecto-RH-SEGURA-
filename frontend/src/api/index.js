import axios from 'axios';

const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api')
  .replace(/\/+$/, '');

const api = axios.create({
  baseURL: base,
  withCredentials: false,
});

function isLoginRequest(error) {
  const url = error?.config?.url || '';
  return url.includes('/auth/login');
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 428) {
      try {
        const stored = JSON.parse(localStorage.getItem('user') || 'null');
        if (stored) {
          stored.mustChangePassword = true;
          localStorage.setItem('user', JSON.stringify(stored));
        }
      } catch (storageError) {
        console.warn('No se pudo actualizar el usuario en localStorage', storageError);
      }
      window.location.href = '/cambiar-password';
      return Promise.reject(err);
    }

    if (err?.response?.status === 401 && !isLoginRequest(err)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
export { api };
