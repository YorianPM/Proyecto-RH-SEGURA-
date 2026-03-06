//Author:ByYPM

import { useAuth } from '../context/authStore';

// Muestra elementos secundarios solo si el usuario tiene los permisos necesarios.
// Si no está autorizado, muestra `fallback` (valor predeterminado nulo) en lugar de una advertencia en línea.
export default function RequirePerms({ need = [], mode = 'ALL', children, fallback = null }) {
  const { hasPerm } = useAuth();
  const checks = need.map(hasPerm);
  const ok = mode === 'ANY' ? checks.some(Boolean) : checks.every(Boolean);
  if (!ok) return fallback;
  return children;
}

