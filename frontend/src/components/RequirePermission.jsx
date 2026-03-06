import { useAuth } from '../context/authStore';

export default function RequirePermission({ perm, children, fallback = null }) {
  const { hasPerm } = useAuth();
  if (!hasPerm(perm)) return fallback;
  return children;
}
