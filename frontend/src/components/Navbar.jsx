import { Link } from 'react-router-dom';
import { useAuth } from '../context/authStore';
import NotificationBell from './NotificationBell';
import './Navbar.css';

export default function Navbar() {
  const auth = useAuth();
  if (!auth) return null;
  const { user, logout } = auth;

  return (
    <nav className="navbar app-navbar navbar-dark border-bottom">
      <div className="container d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center gap-1">
          <Link className="navbar-brand d-flex align-items-center gap-2" to="/">
            <img src="/logo-rhsegurasinfondo.png" alt="RH Segura" />
          </Link>
          <span className="navbar-app-title">Alquileres Segura</span>
        </div>

        <div className="d-flex align-items-center gap-2">
          {user && <NotificationBell />}
          {user && (
            <button className="btn btn-outline-primary btn-sm btn-logout" onClick={logout}>Salir</button>
          )}
        </div>
      </div>
    </nav>
  );
}
