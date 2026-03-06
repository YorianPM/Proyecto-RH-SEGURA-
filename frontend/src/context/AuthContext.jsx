import { useCallback, useEffect, useMemo, useState } from 'react';
import { jwtDecode } from 'jwt-decode';
import { AuthContext } from './authStore';

export default function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  });

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null); setUser(null);
  }, []);

  useEffect(() => {
    if (!token) return;
    try {
      const payload = jwtDecode(token);
      if (payload?.exp && payload.exp * 1000 < Date.now()) {
        logout();
      }
    } catch {
      logout();
    }
  }, [token, logout]);

  const loginOk = useCallback((t, u) => {
    setToken(t); setUser(u);
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
  }, []);

  const hasPerm = useCallback((perm) => {
    const p = user?.perms || {};
    return !!p[perm];
  }, [user]);

  const hasAny = useCallback((perms = []) => perms.some(hasPerm), [hasPerm]);
  const hasAll = useCallback((perms = []) => perms.every(hasPerm), [hasPerm]);

  const value = useMemo(
    () => ({ token, user, loginOk, logout, hasPerm, hasAny, hasAll }),
    [token, user, loginOk, logout, hasPerm, hasAny, hasAll]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

