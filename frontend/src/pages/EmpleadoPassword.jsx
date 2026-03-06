import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getEmpleado, changeEmpleadoPassword } from '../api/empleados';
import BackToHome from '../components/BackToHome';
import { useToast } from '../context/toastStore';

export default function EmpleadoPassword() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [empleado, setEmpleado] = useState(null);
  const [nueva, setNueva] = useState('');
  const [msg, setMsg] = useState('');
  const toast = useToast();

  useEffect(()=> {
    (async ()=>{
      try {
        const e = await getEmpleado(id);
        setEmpleado(e);
      } catch {
        const text = 'Error cargando empleado';
        setMsg(text);
        toast?.(text, { type: 'error', title: 'Empleados' });
      }
    })();
  }, [id, toast]);

  const onSubmit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      await changeEmpleadoPassword(id, nueva);
      setMsg('Contraseña actualizada');
      toast?.('Contraseña actualizada', { type: 'success', title: 'Empleados' });
      setTimeout(()=> navigate('/empleados', { replace: true }), 700);
    } catch {
      const text = 'Error actualizando contraseña';
      setMsg(text);
      toast?.(text, { type: 'error', title: 'Empleados' });
    }
  };

  if (!empleado) return <div className="container py-4">Cargando…</div>;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Cambiar contraseña</h3>
      </div>
      {msg && <div className="alert alert-dark">{msg}</div>}
      <div className="mb-2 text-secondary">
        Empleado: <strong>{empleado.nombre} {empleado.apellido1}</strong> — {empleado.cedula}
      </div>
      <form onSubmit={onSubmit} className="row g-3" style={{maxWidth:520}}>
        <div className="col-12">
          <label className="form-label">Nueva contraseña</label>
          <input type="password" className="form-control" value={nueva} onChange={e=>setNueva(e.target.value)} minLength={8} required/>
        </div>
        <div className="col-12 d-flex gap-2">
          <button className="btn btn-warning">Guardar</button>
          <button type="button" className="btn btn-outline-light" onClick={()=>navigate('/empleados')}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
