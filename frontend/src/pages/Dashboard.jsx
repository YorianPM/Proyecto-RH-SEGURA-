import { useEffect, useState } from 'react';
import { useAuth } from '../context/authStore';
import RequirePerms from '../components/RequirePerms';
import { Link, useNavigate } from 'react-router-dom';

function Drawer({ open, onClose, children }) {
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <nav className={`app-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-header d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-2">
            <img src="/logo-rhsegurasinfondo.png" alt="RH Segura" style={{height: 28}} />
            <strong>Menú</strong>
          </div>
          <button className="hamburger-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="drawer-content">
          {children}
        </div>
      </nav>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  })();

  useEffect(() => {
    const onKey = (ev) => {
      const map = {
        '1': '/incapacidades/nueva',
        '2': '/evaluaciones',
        '3': '/asistencia',
        '4': '/vacaciones',
        '5': '/permisos',
        '6': '/planilla',
        '7': '/empleados',
        '8': '/incapacidades'
      };
      if (map[ev.key]) {
        ev.preventDefault();
        navigate(map[ev.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="hamburger-btn" aria-label="Abrir menú" onClick={()=>setOpen(true)}>☰</button>
          <div>
            <h2 className="mb-0">Menu Principal</h2>
            <p className="text-secondary mb-0">{greeting}, <span className="text-primary fw-semibold">{user?.usuario}</span>.</p>
          </div>
        </div>
      </div>

      <Drawer open={open} onClose={()=>setOpen(false)}>
        <div className="menu-section">
          <div className="menu-section-title">General</div>
          <Link to="/incapacidades/nueva" className="menu-item" onClick={()=>setOpen(false)}>Incapacidades</Link>
          <Link to="/evaluaciones" className="menu-item" onClick={()=>setOpen(false)}>Evaluaciones</Link>
        </div>
        <div className="menu-section">
          <div className="menu-section-title">Operación</div>
          <RequirePerms need={["asistencia_marcar_EMPLEADO","asistencia_ver_RH"]} mode="ANY">
            <Link to="/asistencia" className="menu-item" onClick={()=>setOpen(false)}>Asistencia</Link>
          </RequirePerms>
          <Link to="/mi-coletilla" className="menu-item" onClick={()=>setOpen(false)}>Mi coletilla</Link>
          <RequirePerms need={["horas_extras_ver_RH"]}>
            <Link to="/horas-extras" className="menu-item" onClick={()=>setOpen(false)}>Horas extra (RH)</Link>
          </RequirePerms>
          <RequirePerms need={["vacaciones_ver_EMPLEADO","vacaciones_solicitar_EMPLEADO","vacaciones_aprobar_RH"]} mode="ANY">
            <Link to="/vacaciones" className="menu-item" onClick={()=>setOpen(false)}>Vacaciones</Link>
          </RequirePerms>
          <RequirePerms need={["permisos_ver_EMPLEADO","permisos_aprobar_RH"]} mode="ANY">
            <Link to="/permisos" className="menu-item" onClick={()=>setOpen(false)}>Permisos</Link>
          </RequirePerms>
          <RequirePerms need={["planilla_ver_RH","planilla_generar_RH"]} mode="ANY">
            <Link to="/planilla" className="menu-item" onClick={()=>setOpen(false)}>Planilla</Link>
          </RequirePerms>
          <Link to="/aguinaldo" className="menu-item" onClick={()=>setOpen(false)}>Aguinaldo</Link>
          <RequirePerms need={["planilla_ver_RH"]}>
            <Link to="/liquidaciones" className="menu-item" onClick={()=>setOpen(false)}>Liquidaciones</Link>
          </RequirePerms>
        </div>
        <RequirePerms need={["seguridad_gestion_usuarios_RH"]}>
          <div className="menu-section">
            <div className="menu-section-title">Recursos Humanos</div>
            <Link to="/empleados" className="menu-item" onClick={()=>setOpen(false)}>Empleados</Link>
            <Link to="/incapacidades" className="menu-item" onClick={()=>setOpen(false)}>Incapacidades registradas</Link>
          </div>
        </RequirePerms>
      </Drawer>

      <section className="hero-banner text-center mb-4 py-5">
        <img src="logo-rhsegurasinfondo.png" alt="RH Segura" style={{height: 96}} />
        <h4 className="mt-3 mb-3">Alquileres Segura</h4>
        <p className="text-secondary" style={{maxWidth: 1200, margin: '0 auto'}}>
          Somos una empresa de alquileres de maquinaria de construcción. Nuestra misión es ofrecer soluciones confiables y seguras en alquiler de equipo,
          con disponibilidad y un servicio ágil, para impulsar los proyectos de nuestros clientes.
        </p>
      </section>
    </div>
  );
}
