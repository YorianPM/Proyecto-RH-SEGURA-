import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/authStore'

export default function ProtectedRoute({ children, allowIfMustChange = true }) {
  const { token, user } = useAuth()
  if (!token) return <Navigate to="/login" replace />

  if (!allowIfMustChange && user?.mustChangePassword) {
    return <Navigate to="/cambiar-password" replace />
  }

  return children
}
