import { useCallback, useMemo, useState } from 'react';
import { ToastContext } from './toastStore';

function mapType(t) {
  switch (t) {
    case 'success': return 'success';
    case 'error':   return 'danger';
    case 'warning': return 'warning';
    case 'info':    return 'info';
    default:        return 'secondary';
  }
}

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    const t = {
      id,
      message: String(message || ''),
      title: opts.title || '',
      type: opts.type || 'info',
      duration: opts.duration || 4000,
    };
    setToasts((all) => [...all, t]);
    if (t.duration > 0) setTimeout(() => remove(id), t.duration);
  }, [remove]);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="position-fixed top-0 end-0 p-3" style={{ zIndex: 1060 }}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast show text-bg-${mapType(t.type)} border-0 shadow mb-2`} role="alert" aria-live="assertive" aria-atomic="true">
            {t.title ? (
              <div className="toast-header text-bg-dark border-0">
                <strong className="me-auto">{t.title}</strong>
                <button type="button" className="btn-close btn-close-white" onClick={() => remove(t.id)} aria-label="Close"></button>
              </div>
            ) : null}
            <div className="toast-body d-flex align-items-start justify-content-between">
              <span>{t.message}</span>
              {!t.title && (
                <button type="button" className="btn-close btn-close-white ms-3" onClick={() => remove(t.id)} aria-label="Close"></button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
