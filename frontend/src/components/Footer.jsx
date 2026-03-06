export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="app-footer border-top mt-5 pt-4 pb-3 text-center text-secondary">
      <div className="container">
        <small>© {year} RH Segura – Sistema de RRHH</small>
      </div>
    </footer>
  );
}

