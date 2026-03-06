import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { obtenerNotificaciones } from '../api/notificaciones';
import { useAuth } from '../context/authStore';

const STORAGE_KEY = 'hr-notifications-read';
const TYPE_LABELS = {
  vacaciones: 'Vacaciones',
  permisos: 'Permisos',
  horas_extras: 'Horas extra',
  incapacidades: 'Incapacidades',
  planilla: 'Planilla',
  aguinaldo: 'Aguinaldo',
};

export default function NotificationBell() {
  const { user } = useAuth() || {};
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readIds, setReadIds] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((v) => String(v)));
    } catch {
      return new Set();
    }
  });
  const mountedRef = useRef(true);
  const containerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const payload = await obtenerNotificaciones({ limit: 20 });
      const list = Array.isArray(payload?.data) ? payload.data : [];
      if (mountedRef.current) setItems(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(err?.response?.data?.message || err.message || 'No se pudieron cargar las notificaciones');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return () => {};
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [user, fetchNotifications]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(readIds)));
  }, [readIds]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!open || !containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const unreadCount = useMemo(
    () => items.filter((item) => !readIds.has(String(item.id))).length,
    [items, readIds]
  );

  const badgeClass = (item) => {
    const status = String(item?.status || '').toLowerCase();
    if (status.includes('aprob') || status.includes('disponible')) return 'text-bg-success';
    if (status.includes('rechaz') || status.includes('deneg') || status.includes('desaprob')) return 'text-bg-danger';
    return 'text-bg-secondary';
  };

  const formatDateTime = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      fetchNotifications();
      const nextSet = new Set(readIds);
      items.forEach(item => nextSet.add(String(item.id)));
      setReadIds(nextSet);
    }
  };

  if (!user) return null;

  const BellIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      role="img"
      aria-hidden="true"
    >
      <path d="M12 2a6 6 0 0 0-6 6v3.09c0 .49-.18.97-.5 1.34L4 14.2c-.75.83-.18 2.13.93 2.13H19.1c1.1 0 1.67-1.3.92-2.13l-1.5-1.67a2 2 0 0 1-.5-1.34V8a6 6 0 0 0-6-6Zm0 20a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Z" />
    </svg>
  );

  return (
    <div className="navbar-bell" ref={containerRef}>
      <button className="navbar-bell-btn" onClick={toggleOpen} aria-label="Notificaciones">
        <span className="navbar-bell-icon">
          {BellIcon}
        </span>
        {unreadCount > 0 && <span className="navbar-bell-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="navbar-bell-menu">
          <div className="navbar-bell-header">
            <strong>Notificaciones</strong>
          </div>
          {loading && <p className="text-secondary small mb-0">Cargando...</p>}
          {error && <p className="text-danger small mb-0">{error}</p>}
          {!loading && !items.length && !error && (
            <p className="text-secondary small mb-0">Sin novedades</p>
          )}
          <ul className="navbar-bell-list">
            {items.map(item => (
              <li key={item.id} className="navbar-bell-item">
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <div className="fw-semibold">{item.title}</div>
                    {item.message && <div className="small text-secondary">{item.message}</div>}
                    <div className="text-secondary tiny">{formatDateTime(item.date)}</div>
                    {item.link && (
                      <Link
                        to={item.link}
                        className="small"
                        onClick={() => setOpen(false)}
                      >
                        Ver detalle
                      </Link>
                    )}
                  </div>
                  <div className="text-end">
                    <div className={`badge ${badgeClass(item)}`}>{item.status || 'Actualizado'}</div>
                    <div className="text-uppercase small text-muted">
                      {TYPE_LABELS[item.type] || item.type || ''}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
