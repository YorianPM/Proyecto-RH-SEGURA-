import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import EmpleadosList from './pages/EmpleadosList'
import IncapacidadesNew from './pages/IncapacidadesNew'
import IncapacidadesList from './pages/IncapacidadesList'
import Asistencia from './pages/Asistencia';
import EvaluacionDesempeno from './pages/EvaluacionDesempeno';
import Vacaciones from './pages/Vacaciones';
import Permisos from './pages/Permisos';
import EmpleadoForm from './pages/EmpleadoForm';
import EmpleadoPassword from './pages/EmpleadoPassword';
import EmpleadoCrear from './pages/EmpleadoCrear';
import Planilla from './pages/Planilla';
import HorasExtras from './pages/HorasExtras';
import Aguinaldo from './pages/Aguinaldo';
import Liquidaciones from './pages/Liquidaciones';
import MiColetilla from './pages/MiColetilla';
import CambiarPasswordObligatorio from './pages/CambiarPasswordObligatorio';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login/>} />
      <Route path="/cambiar-password" element={
        <ProtectedRoute>
          <CambiarPasswordObligatorio />
        </ProtectedRoute>
      }/>
      <Route element={<ProtectedRoute allowIfMustChange={false}><AppShell/></ProtectedRoute>}>
        <Route path="/" element={<Dashboard/>} />
        <Route path="/empleados" element={<EmpleadosList/>} />
        <Route path="/incapacidades" element={<IncapacidadesList/>} />
        <Route path="/incapacidades/nueva" element={<IncapacidadesNew/>} />
        <Route path="/asistencia" element={<Asistencia />} />
        <Route path="/evaluaciones" element={<EvaluacionDesempeno />} />
        <Route path="/vacaciones" element={<Vacaciones />} />
        <Route path="/permisos" element={<Permisos />} />
        <Route path="/empleados/:id/editar" element={<EmpleadoForm />} />
        <Route path="/empleados/:id/password" element={<EmpleadoPassword />} />
        <Route path="/empleados/nuevo" element={<EmpleadoCrear />} />
        <Route path="/planilla" element={<Planilla />} />
        <Route path="/mi-coletilla" element={<MiColetilla />} />
        <Route path="/aguinaldo" element={<Aguinaldo />} />
        <Route path="/liquidaciones" element={<Liquidaciones />} />
        <Route path="/horas-extras" element={<HorasExtras />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
