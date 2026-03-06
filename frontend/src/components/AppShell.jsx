import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import BackToHome from './BackToHome';
import Footer from './Footer';

export default function AppShell() {
  const location = useLocation();
  const showBack = location && location.pathname === '/planilla';
  return (
    <div className="app-shell d-flex flex-column min-vh-100">
      <Navbar />
      <main className="flex-grow-1 w-100">
        {showBack && (
          <div className="container pt-3">
            <BackToHome />
          </div>
        )}
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
