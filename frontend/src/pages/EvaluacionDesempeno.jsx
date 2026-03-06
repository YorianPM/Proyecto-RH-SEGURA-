import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { todayStr } from '../utils/validation';
import BackToHome from '../components/BackToHome';
import { useAuth } from '../context/authStore';
import { useToast } from '../context/toastStore';

export default function EvaluacionDesempeno() {
  const { user, hasPerm } = useAuth();
  const isRH = !!hasPerm('asistencia_ver_RH');
  const [empleados, setEmpleados] = useState([]);
  const [form, setForm] = useState({ idEmpleado: '', fecha: '', puntuacion: '', observaciones: '' });
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState([]);
  const toast = useToast();

  const cargarDatos = useCallback(async () => {
    try {
      if (isRH) {
        const [empRes, evalRes] = await Promise.all([
          api.get('/empleados'),
          api.get('/evaluacion'),
        ]);
        setEmpleados(empRes.data.data || []);
        setItems(evalRes.data.data || []);
      } else {
        setEmpleados([]);
        const mine = await api.get('/evaluacion/mias');
        setItems(mine.data?.data || []);
        setForm((f) => ({ ...f, idEmpleado: String(user?.idEmpleado || user?.sub || '') }));
      }
    } catch {
      const text = 'Error al cargar datos';
      setMsg(text);
      toast?.(text, { type: 'error', title: 'Evaluaciones' });
    }
  }, [isRH, toast, user]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      if (!isRH) {
        const warn = 'No tienes permiso para registrar evaluaciones';
        setMsg(warn);
        toast?.(warn, { type: 'warning', title: 'Evaluaciones' });
        return;
      }
      const { data } = await api.post('/evaluacion', form);
      const success = data.msg || 'Evaluación guardada correctamente';
      setMsg(success);
      toast?.(success, { type: 'success', title: 'Evaluaciones' });
      setForm({ idEmpleado: '', fecha: '', puntuacion: '', observaciones: '' });
      cargarDatos();
    } catch {
      const text = 'Error al guardar la evaluación';
      setMsg(text);
      toast?.(text, { type: 'error', title: 'Evaluaciones' });
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Evaluación de Desempeño</h3>
      </div>
      {msg && <div className="alert alert-dark">{msg}</div>}

      {isRH && (
        <form onSubmit={guardar} className="row g-3 mb-4" autoComplete="off">
          <div className="col-md-5">
            <label className="form-label">Empleado</label>
            <select
              className="form-select"
              name="idEmpleado"
              value={form.idEmpleado}
              onChange={onChange}
              required
            >
              <option value="">Seleccione...</option>
              {empleados.map((emp) => (
                <option key={emp.idEmpleado} value={emp.idEmpleado}>
                  {emp.cedula} - {emp.nombre} {emp.apellido1}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Fecha</label>
            <input
              type="date"
              className="form-control"
              name="fecha"
              value={form.fecha}
              onChange={onChange}
              min={todayStr()}
              required
            />
          </div>

          <div className="col-md-2">
            <label className="form-label">Puntuación</label>
            <input
              type="number"
              step="0.01"
              className="form-control"
              name="puntuacion"
              min="0"
              max="100"
              value={form.puntuacion}
              onChange={onChange}
              required
            />
          </div>

          <div className="col-md-12">
            <label className="form-label">Observaciones</label>
            <textarea
              className="form-control"
              name="observaciones"
              rows="2"
              value={form.observaciones}
              onChange={onChange}
              minLength={5}
            />
          </div>

          <div className="col-12">
            <button className="btn btn-warning">Guardar Evaluación</button>
          </div>
        </form>
      )}

      <h5>{isRH ? 'Historial de Evaluaciones' : 'Mis Evaluaciones'}</h5>
      <div className="table-responsive">
        <table className="table table-dark table-striped align-middle">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Empleado</th>
              <th>Cédula</th>
              <th>Puntuación</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((it) => (
                <tr key={it.idEvaluacion}>
                  <td>{it.fecha?.slice(0, 10)}</td>
                  <td>{it.empleado}</td>
                  <td>{it.cedula}</td>
                  <td>{it.puntuacion}</td>
                  <td>{it.observaciones}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="text-center text-secondary py-3">No hay evaluaciones registradas</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

