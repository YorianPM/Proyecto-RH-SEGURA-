import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authStore';
import api from '../api';
import Footer from '../components/Footer';
import './Login.css';
import { useToast } from '../context/toastStore';

export default function Login() {
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();

  const handleInputChange = (setter) => (event) => {
    if (msg) {
      setMsg('');
    }
    setter(event.target.value);
  };

  const showLoginError = () => {
    const message = 'Correo o contrase\u00f1a incorrectos. Intente nuevamente.';
    setMsg(message);
    toast?.(message, { type: 'error', title: 'Acceso denegado', duration: 6000 });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { usuario, contrasena });
      if (data?.ok && data?.token) {
        const userPayload = data.user || { usuario };
        auth?.loginOk(data.token, userPayload);
        const destination = userPayload?.mustChangePassword ? '/cambiar-password' : '/';
        navigate(destination, { replace: true });
      } else {
        showLoginError();
      }
    } catch (error) {
      console.error('Login error', error);
      showLoginError();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="login-view position-relative">
        <div className="login-bg" />

        <div className="container py-4">
          <div className="login-shell mx-auto">
            <div className="row align-items-start login-grid g-2">
              <div className="col-12 col-lg-6 order-1 order-lg-1 d-flex">
                <div className="glass-card login-card border-0 shadow-lg p-3 p-md-4 w-100 animate-fade-in">
                  <div className="d-flex align-items-center mb-3 gap-2 brand">
                    <img src="/logo-rhsegurasinfondo.png" alt="RH Segura" className="brand-logo" />
                    <span className="brand-name">RH SEGURA</span>
                  </div>
                  <h2 className="mb-1 fw-bold">Bienvenido</h2>
                  <p className="text-secondary mb-3">Inicia sesión para continuar</p>

                  <form onSubmit={onSubmit} className="d-grid gap-3" autoComplete="off">
                    <div className="field">
                      <label className="form-label">Correo</label>
                      <div className="input-wrapper">
                        <span className="input-icon" aria-hidden>✉</span>
                        <input
                          className="form-control form-control-lg"
                          value={usuario}
                          onChange={handleInputChange(setUsuario)}
                          placeholder="correo@empresa.com"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label className="form-label">Contraseña</label>
                      <div className="input-wrapper">
                        <span className="input-icon" aria-hidden>🔒</span>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          className="form-control form-control-lg"
                          value={contrasena}
                          onChange={handleInputChange(setContrasena)}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          className="toggle-pass"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        >
                          {showPassword ? '🙈' : '👁'}
                        </button>
                      </div>
                    </div>

                    <button className="btn btn-primary btn-lg w-100 login-cta" disabled={loading}>
                      {loading ? 'Entrando…' : 'Entrar'}
                    </button>

                    {msg && (
                      <div className="alert alert-danger text-center fw-semibold" role="alert">
                        {msg}
                      </div>
                    )}
                  </form>
                </div>
              </div>

              <div className="col-12 col-lg-6 order-2 order-lg-2">
                <div className="brand-panel glass-card shadow-lg p-3 p-md-4 animate-slide-up">
                  <div className="brand-panel-logo mb-3">
                    <img src="/logo-rhsegurasinfondo.png" alt="RH Segura" />
                  </div>
                  <h2 className="brand-panel-title mb-2">Alquileres Segura</h2>
                  <p className="brand-panel-text">
                    Somos una empresa dedicada al alquiler de maquinaria de construcción. 
                    Ofrecemos soluciones confiables, seguras y con disponibilidad inmediata para 
                    impulsar los proyectos de nuestros clientes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}
