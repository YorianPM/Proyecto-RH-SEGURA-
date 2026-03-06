import { Link } from 'react-router-dom';

export default function BackToHome({ label = 'Regresar al principal' }) {
  return (
    <Link to="/" className="btn btn-outline-primary btn-sm">
      ← {label}
    </Link>
  );
}

