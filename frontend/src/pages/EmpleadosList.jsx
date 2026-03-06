import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEmpleados, deleteEmpleado, getPuestos, updatePuesto, crearPuesto } from '../api/empleados';
import RequirePerms from '../components/RequirePerms';
import BackToHome from '../components/BackToHome';
import { useToast } from '../context/toastStore';

export default function EmpleadosList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [puestos, setPuestos] = useState([]);
  const [puestoSel, setPuestoSel] = useState('');
  const [puestoNombre, setPuestoNombre] = useState('');
  const [puestoSalario, setPuestoSalario] = useState('');
  const [puestoMsg, setPuestoMsg] = useState('');
  const [guardandoPuesto, setGuardandoPuesto] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [modoPanel, setModoPanel] = useState('editar'); // editar | crear
  const [puestoNuevoNombre, setPuestoNuevoNombre] = useState('');
  const [puestoNuevoSalario, setPuestoNuevoSalario] = useState('');
  const toast = useToast();
  const closePanel = () => {
    setPanelAbierto(false);
    setPuestoMsg('');
  };
  const navigate = useNavigate();

  const cargar = async () => {
    setLoading(true);
    try {
      const data = await getEmpleados();
      setRows(data);
    } catch (err) {
      console.error('No se pudieron cargar empleados', err);
      toast?.('No se pudieron cargar los empleados', { type: 'error', title: 'Empleados' });
    } finally { setLoading(false); }
  };

  const cargarPuestos = useCallback(async () => {
    try {
      const data = await getPuestos();
      setPuestos(data);
      if (data.length) {
        if (!puestoSel) {
          const primerId = String(data[0].idPuesto);
          setPuestoSel(primerId);
          setPuestoNombre(data[0].nombre_puesto || '');
          setPuestoSalario(
            data[0].salario_base != null ? String(Number(data[0].salario_base)) : ''
          );
        } else {
          const encontrado = data.find(p => String(p.idPuesto) === String(puestoSel));
          if (encontrado) {
            setPuestoNombre(encontrado.nombre_puesto || '');
            setPuestoSalario(
              encontrado.salario_base != null ? String(Number(encontrado.salario_base)) : ''
            );
          }
        }
      }
    } catch {
      const text = 'No se pudieron cargar los puestos.';
      setPuestoMsg(text);
      toast?.(text, { type: 'error', title: 'Puestos' });
    }
  }, [puestoSel, toast]);

  useEffect(()=> { cargar(); },[]);
  useEffect(()=> { cargarPuestos(); },[cargarPuestos]);

  useEffect(() => {
    if (!puestos.length) return;
    const existe = puestos.some(p => String(p.idPuesto) === String(puestoSel));
    if (!puestoSel || !existe) {
      const first = String(puestos[0].idPuesto);
      setPuestoSel(first);
      setPuestoNombre(puestos[0].nombre_puesto || '');
      setPuestoSalario(
        puestos[0].salario_base != null ? String(Number(puestos[0].salario_base)) : ''
      );
    }
  }, [puestos, puestoSel]);

  const onDelete = async (id) => {
    if (!confirm('��Eliminar este empleado? Esta acci��n no se puede deshacer.')) return;
    setMsg('');
    try {
      await deleteEmpleado(id);
      setMsg('Empleado eliminado.');
      toast?.('Empleado eliminado', { type: 'success', title: 'Empleados' });
      cargar();
    } catch {
      const text = 'Error al eliminar.';
      setMsg(text);
      toast?.(text, { type: 'error', title: 'Empleados' });
    }
  };

  const syncCamposPuesto = (id, source) => {
    const base = source ?? puestos;
    const info = base.find(p => String(p.idPuesto) === String(id));
    if (info) {
      setPuestoNombre(info.nombre_puesto || '');
      setPuestoSalario(
        info.salario_base != null ? String(Number(info.salario_base)) : ''
      );
    } else {
      setPuestoNombre('');
      setPuestoSalario('');
    }
  };

  const onSelectPuesto = (value) => {
    setPuestoSel(value);
    syncCamposPuesto(value);
    setPuestoMsg('');
  };

  const onGuardarPuesto = async (event) => {
    event.preventDefault();
    if (!puestoSel) return;
    const parsed = Number(puestoSalario);
    if (!Number.isFinite(parsed)) {
      setPuestoMsg('Ingrese un salario válido.');
      return;
    }
    setGuardandoPuesto(true);
    setPuestoMsg('');
    try {
      await updatePuesto(puestoSel, {
        nombre_puesto: puestoNombre,
        salario_base: parsed,
      });
      setPuestoMsg('Puesto actualizado.');
      toast?.('Puesto actualizado', { type: 'success', title: 'Puestos' });
      await cargarPuestos();
    } catch (err) {
      setPuestoMsg(err?.response?.data?.message || 'No se pudo actualizar el puesto.');
      toast?.(err?.response?.data?.message || 'No se pudo actualizar el puesto.', { type: 'error', title: 'Puestos' });
    } finally {
      setGuardandoPuesto(false);
    }
  };

  if (loading) return <div className="container py-4">Cargando...</div>;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex align-items-center gap-2">
          <BackToHome />
          <h2 className="mb-0">Empleados</h2>
        </div>
        <RequirePerms need={["seguridad_gestion_usuarios_RH"]}>
          <div className="btn-group">
            <Link to="/empleados/nuevo" className="btn btn-warning">Nuevo empleado</Link>
            <button
              className="btn btn-outline-light"
              onClick={() => {
                if (panelAbierto && modoPanel === 'editar') {
                  closePanel();
                } else {
                  setPanelAbierto(true);
                  setModoPanel('editar');
                  setPuestoMsg('');
                }
              }}
            >
              {panelAbierto && modoPanel === 'editar' ? 'Ocultar puestos' : 'Editar puestos'}
            </button>
            <button
              className="btn btn-outline-light"
              onClick={() => {
                if (panelAbierto && modoPanel === 'crear') {
                  closePanel();
                } else {
                  setPanelAbierto(true);
                  setModoPanel('crear');
                  setPuestoMsg('');
                }
              }}
            >
              {panelAbierto && modoPanel === 'crear' ? 'Ocultar' : 'Agregar puesto'}
            </button>
          </div>
        </RequirePerms>
      </div>

      <RequirePerms need={['reportes_ver_RH']} mode="ANY">
        <small className="text-secondary">Tenés permiso para ver reportes.</small>
      </RequirePerms>

      {msg && <div className="alert alert-dark my-2">{msg}</div>}

      <div className="row g-3 align-items-start mt-2">
        <div className={`col-12 ${panelAbierto ? 'col-xl-7' : 'col-xl-12'}`}>
          <div className="table-responsive">
            <table className="table table-dark table-striped align-middle">
              <thead>
                <tr>
                  <th>ID</th><th>Nombre</th><th>Correo</th><th>Cédula</th><th>Puesto</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.idEmpleado}>
                    <td>{r.idEmpleado}</td>
                    <td>{r.nombre} {r.apellido1}</td>
                    <td>{r.correo}</td>
                    <td>{r.cedula}</td>
                    <td>{r.nombre_puesto || r.idPuesto}</td>
                    <td className="d-flex flex-wrap gap-2">
                      <RequirePerms need={["seguridad_gestion_usuarios_RH"]}>
                        <button className="btn btn-sm btn-secondary" onClick={()=>navigate(`/empleados/${r.idEmpleado}/editar`)}>Editar</button>
                        <button className="btn btn-sm btn-outline-warning" onClick={()=>navigate(`/empleados/${r.idEmpleado}/password`)}>Clave</button>
                        <button className="btn btn-sm btn-danger" onClick={()=>onDelete(r.idEmpleado)}>Eliminar</button>
                      </RequirePerms>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan="6" className="text-center text-secondary">No hay empleados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {panelAbierto && (
          <div className="col-12 col-xl-5">
            <RequirePerms need={["seguridad_gestion_usuarios_RH"]}>
              <div className="card border-0 shadow-sm h-100 position-relative">
                <div className="card-body d-flex flex-column">
                  {modoPanel === 'editar' ? (
                    <>
                      <h5 className="card-title">Editar puestos y salarios</h5>
                      <p className="text-secondary small">
                        Selecciona un puesto y ajusta su salario base según corresponda.
                      </p>
                      <form className="d-grid gap-3 mt-2" onSubmit={onGuardarPuesto}>
                        <div>
                          <label className="form-label">Puesto</label>
                          <select
                            className="form-select"
                            value={puestoSel}
                            onChange={(e)=>onSelectPuesto(e.target.value)}
                          >
                            {puestos.map(p => (
                              <option key={p.idPuesto} value={p.idPuesto}>
                                #{p.idPuesto} - {p.nombre_puesto}
                              </option>
                            ))}
                            {!puestos.length && <option value="">Sin puestos</option>}
                          </select>
                        </div>
                        <div>
                          <label className="form-label">Nombre del puesto</label>
                          <input
                            className="form-control"
                            value={puestoNombre}
                            onChange={(e)=>{ setPuestoNombre(e.target.value); setPuestoMsg(''); }}
                            maxLength={60}
                            required
                          />
                        </div>
                        <div>
                          <label className="form-label">Salario base (CRC)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="form-control"
                            value={puestoSalario}
                            onChange={(e)=>{ setPuestoSalario(e.target.value); setPuestoMsg(''); }}
                            required
                          />
                        </div>
                        <button className="btn btn-warning" disabled={guardandoPuesto || !puestoSel}>
                          {guardandoPuesto ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                        {puestoMsg && <div className="alert alert-info mb-0 mt-2">{puestoMsg}</div>}
                      </form>
                    </>
                  ) : (
                    <>
                      <h5 className="card-title">Agregar nuevo puesto</h5>
                      <p className="text-secondary small">
                        Define el nombre y el salario base para crear un nuevo puesto.
                      </p>
                      <form className="d-grid gap-3 mt-2" onSubmit={async (e) => {
                        e.preventDefault();
                        const nombre = puestoNuevoNombre.trim();
                        const salario = Number(puestoNuevoSalario);
                        if (!nombre || !Number.isFinite(salario)) {
                          setPuestoMsg('Ingrese nombre y salario válido.');
                          return;
                        }
                        setGuardandoPuesto(true);
                        setPuestoMsg('');
                        try {
                          await crearPuesto({ nombre_puesto: nombre, salario_base: salario, tarifa_hora: 0 });
                          setPuestoMsg('Puesto creado.');
                          toast?.('Puesto creado', { type: 'success', title: 'Puestos' });
                          setPuestoNuevoNombre('');
                          setPuestoNuevoSalario('');
                          await cargarPuestos();
                        } catch (err) {
                          const text = err?.response?.data?.message || 'No se pudo crear el puesto.';
                          setPuestoMsg(text);
                          toast?.(text, { type: 'error', title: 'Puestos' });
                        } finally {
                          setGuardandoPuesto(false);
                        }
                      }}>
                        <div>
                          <label className="form-label">Nombre del puesto</label>
                          <input
                            className="form-control"
                            value={puestoNuevoNombre}
                            onChange={(e)=>{ setPuestoNuevoNombre(e.target.value); setPuestoMsg(''); }}
                            maxLength={60}
                            required
                          />
                        </div>
                        <div>
                          <label className="form-label">Salario base (CRC)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="form-control"
                            value={puestoNuevoSalario}
                            onChange={(e)=>{ setPuestoNuevoSalario(e.target.value); setPuestoMsg(''); }}
                            required
                          />
                        </div>
                        <button className="btn btn-warning" disabled={guardandoPuesto}>
                          {guardandoPuesto ? 'Guardando…' : 'Crear puesto'}
                        </button>
                        {puestoMsg && <div className="alert alert-info mb-0 mt-2">{puestoMsg}</div>}
                      </form>
                    </>
                  )}
                </div>
              </div>
            </RequirePerms>
          </div>
        )}
      </div>
    </div>
  );
}
