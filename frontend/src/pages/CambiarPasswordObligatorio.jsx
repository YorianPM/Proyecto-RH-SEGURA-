import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authStore';
import { changeEmpleadoPassword } from '../api/empleados';
import './Login.css';

export default function CambiarPasswordObligatorio() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [msg, setMsg] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const usuarioDebeCambiar = auth?.user?.mustChangePassword;
  const userId = auth?.user?.idEmpleado;

  if (!auth?.token) {
    return <Navigate to="/login" replace />;
  }

  if (!usuarioDebeCambiar) {
    return <Navigate to="/" replace />;
  }
  if (!userId) {
    return <Navigate to="/login" replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setSuccess('');

    if (nueva.length < 8) {
      setMsg('La contrasena debe tener al menos 8 caracteres.');
      return;
    }
    if (nueva !== confirmar) {
      setMsg('Las contrasenas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      await changeEmpleadoPassword(userId, nueva);
      setSuccess('Contrasena actualizada. Vuelve a iniciar sesion.');
      setTimeout(() => {
        auth.logout();
        navigate('/login', { replace: true });
      }, 1200);
    } catch (err) {
      const errMsg = err?.response?.data?.message || 'Error actualizando la contrasena.';
      setMsg(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-view position-relative">
      <div className="login-bg" />
      <div className="container py-5">
        <div className="login-shell mx-auto">
          <div className="glass-card login-card border-0 shadow-lg p-4 p-md-5">
            <div className="d-flex align-items-center mb-3 gap-2 brand">
              <img src="/logo-rhsegurasinfondo.png" alt="RH Segura" className="brand-logo" />
              <span className="brand-name">RH SEGURA</span>
            </div>
            <h2 className="mb-2 fw-bold">Actualiza tu contrasena</h2>
            <p className="text-secondary mb-4">
              Por seguridad debes elegir una nueva contrasena permanente antes de continuar.
            </p>
            <form onSubmit={onSubmit} className="d-grid gap-3" autoComplete="off">
              <div className="field">
                <label className="form-label">Nueva contrasena</label>
                <input
                  type="password"
                  className="form-control form-control-lg"
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                  placeholder="********"
                  minLength={8}
                  required
                />
              </div>
              <div className="field">
                <label className="form-label">Confirmar contrasena</label>
                <input
                  type="password"
                  className="form-control form-control-lg"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  placeholder="********"
                  minLength={8}
                  required
                />
              </div>
              <button className="btn btn-primary btn-lg w-100 login-cta" disabled={loading}>
                {loading ? 'Guardando...' : 'Guardar y continuar'}
              </button>
              {msg && (
                <div className="alert alert-danger text-center fw-semibold" role="alert">
                  {msg}
                </div>
              )}
              {success && (
                <div className="alert alert-success text-center fw-semibold" role="alert">
                  {success}
                </div>
              )}
            </form>
          </div>
          <div className="text-center text-secondary small mt-4">
            © 2025 RH Segura – Sistema de RRHH
          </div>
        </div>
      </div>
    </div>
  );
}
