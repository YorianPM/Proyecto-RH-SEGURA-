import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getEmpleado,
  createEmpleado,
  updateEmpleado,
  getPuestos,
  getRoles
} from '../api/empleados';
import {
  ONLY_LETTERS_PATTERN,
  CEDULA_PATTERN,
  ONLY_DIGITS_PATTERN,
  todayStr
} from '../utils/validation';
import BackToHome from '../components/BackToHome';
import { useToast } from '../context/toastStore';

const ROLE_LABELS = {
  1: 'Empleado',
  2: 'Admin',
  3: 'S.Admin'
};

const LETTER_FIELDS = new Set(['nombre', 'apellido1', 'apellido2']);
const DIGIT_FIELDS = new Set(['cedula', 'telefono']);

const empty = {
  nombre: '',
  apellido1: '',
  apellido2: '',
  genero: 'No especifica',
  fecha_ingreso: '',
  estado: 1,
  correo: '',
  contrasena: '',
  telefono: '',
  estado_civil: 'Soltero/a',
  hijos: 0,
  idPuesto: '',
  idRol: '',
  conyuge_aplica: 'No',
  cedula: ''
};

const sanitizeValue = (name, value) => {
  const raw = String(value ?? '');
  if (LETTER_FIELDS.has(name)) return raw.replace(/[^A-Za-z\u00C0-\u024F'\s]/g, '');
  if (DIGIT_FIELDS.has(name)) return raw.replace(/\D+/g, '');
  return raw;
};

const sanitizeRecord = (record = {}) => {
  const clean = { ...record };
  LETTER_FIELDS.forEach(field => {
    if (field in clean) clean[field] = sanitizeValue(field, clean[field]);
  });
  DIGIT_FIELDS.forEach(field => {
    if (field in clean) clean[field] = sanitizeValue(field, clean[field]);
  });
  return clean;
};

const buildRoleOptions = (list = []) => {
  const map = new Map();
  list.forEach(item => {
    const id = Number(item.idRol);
    if (!Number.isFinite(id)) return;
    if (!map.has(id)) {
      map.set(id, {
        idRol: id,
        label: ROLE_LABELS[id] || item.nombre || `Rol ${id}`
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.idRol - b.idRol);
};

export default function EmpleadoForm() {
  const { id } = useParams();
  const editMode = Boolean(id);
  const navigate = useNavigate();
  const today = todayStr();
  const [form, setForm] = useState(empty);
  const [puestos, setPuestos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [msg, setMsg] = useState('');
  const toast = useToast();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [puestosResp, rolesResp] = await Promise.all([getPuestos(), getRoles()]);
        if (!active) return;
        setPuestos(puestosResp);
        setRoles(buildRoleOptions(rolesResp));
        if (editMode) {
          const data = await getEmpleado(id);
          if (!active) return;
          const sanitized = sanitizeRecord({
            ...empty,
            ...data
          });
          const fechaIngreso = sanitized.fecha_ingreso ? sanitized.fecha_ingreso.slice(0, 10) : '';
          const future = fechaIngreso && fechaIngreso > today;
          setForm({
            ...sanitized,
            fecha_ingreso: fechaIngreso,
            estado: future ? 0 : sanitized.estado,
            contrasena: ''
          });
        } else {
          setForm({ ...empty, fecha_ingreso: today });
        }
      } catch {
        if (active) {
          const text = 'Error cargando datos';
          setMsg(text);
          toast?.(text, { type: 'error', title: 'Empleados' });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [editMode, id, today, toast]);

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm(prev => {
      const sanitized = sanitizeValue(name, value);
      if (name === 'estado') {
        const future = prev.fecha_ingreso && prev.fecha_ingreso > today;
        if (future) return prev;
        return { ...prev, estado: Number(sanitized) };
      }
      if (name === 'fecha_ingreso') {
        if (!sanitized) return { ...prev, fecha_ingreso: '' };
        let normalized = sanitized;
        if (!editMode && normalized < today) {
          normalized = today;
        }
        const next = {
          ...prev,
          fecha_ingreso: normalized
        };
        if (normalized > today) {
          next.estado = 0;
        } else if (prev.estado === 0) {
          next.estado = 1;
        }
        return next;
      }
      return {
        ...prev,
        [name]: sanitized
      };
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setMsg('');
    try {
      if (editMode) {
        const payload = { ...form };
        if (!payload.contrasena) delete payload.contrasena;
        await updateEmpleado(id, payload);
        setMsg('Empleado actualizado');
        toast?.('Cambios guardados', { type: 'success', title: 'Empleados' });
      } else {
        await createEmpleado(form);
        setMsg('Empleado creado');
        toast?.('Empleado creado correctamente', { type: 'success', title: 'Empleados' });
      }
      setTimeout(() => navigate('/empleados', { replace: true }), 600);
    } catch (err) {
      const fallback = err?.response?.data?.message || 'Error guardando';
      setMsg(fallback);
      toast?.(fallback, { type: 'error', title: 'Empleados' });
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">{editMode ? 'Editar empleado' : 'Nuevo empleado'}</h3>
      </div>
      {msg && <div className="alert alert-dark">{msg}</div>}

      <form onSubmit={onSubmit} className="row g-3" autoComplete="off">
        <div className="col-md-4">
          <label className="form-label">Nombre</label>
          <input
            className="form-control"
            name="nombre"
            value={form.nombre}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
        </div>
        <div className="col-md-4">
          <label className="form-label">Primer apellido</label>
          <input
            className="form-control"
            name="apellido1"
            value={form.apellido1}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
        </div>
        <div className="col-md-4">
          <label className="form-label">Segundo apellido</label>
          <input
            className="form-control"
            name="apellido2"
            value={form.apellido2}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
        </div>

        <div className="col-md-3">
          <label className="form-label">Cedula</label>
          <input
            className="form-control"
            name="cedula"
            value={form.cedula}
            onChange={onChange}
            inputMode="numeric"
            pattern={CEDULA_PATTERN}
            maxLength={12}
            title="Solo numeros (9 a 12 digitos)"
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">Correo</label>
          <input
            type="email"
            className="form-control"
            name="correo"
            value={form.correo}
            onChange={onChange}
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">
            Contrasena{' '}
            {editMode && <small className="text-secondary">(dejar en blanco para no cambiar)</small>}
          </label>
          <input
            type="password"
            className="form-control"
            name="contrasena"
            value={form.contrasena}
            onChange={onChange}
            minLength={8}
            {...(!editMode ? { required: true } : {})}
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">Telefono</label>
          <input
            className="form-control"
            name="telefono"
            value={form.telefono}
            onChange={onChange}
            inputMode="tel"
            pattern={ONLY_DIGITS_PATTERN}
            maxLength={15}
            title="Solo numeros"
          />
        </div>

        <div className="col-md-3">
          <label className="form-label">Fecha ingreso</label>
          <input
            type="date"
            className="form-control"
            name="fecha_ingreso"
            value={form.fecha_ingreso}
            onChange={onChange}
            min={editMode ? undefined : today}
            max="9999-12-31"
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">Estado</label>
          <select
            className="form-select"
            name="estado"
            value={form.estado}
            onChange={onChange}
            disabled={form.fecha_ingreso && form.fecha_ingreso > today}
          >
            <option value={1}>Activo</option>
            <option value={0}>Inactivo</option>
          </select>
          {form.fecha_ingreso && form.fecha_ingreso > today && (
            <small className="text-warning d-block mt-1">
              Se activara automaticamente en la fecha de ingreso.
            </small>
          )}
        </div>
        <div className="col-md-3">
          <label className="form-label">Genero</label>
          <select className="form-select" name="genero" value={form.genero} onChange={onChange}>
            <option>No especifica</option>
            <option>Femenino</option>
            <option>Masculino</option>
            <option>Otro</option>
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">Estado civil</label>
          <select className="form-select" name="estado_civil" value={form.estado_civil} onChange={onChange}>
            <option>Soltero/a</option>
            <option>Casado/a</option>
            <option>Divorciado/a</option>
            <option>Union libre</option>
          </select>
        </div>

        <div className="col-md-3">
          <label className="form-label">Hijos</label>
          <input
            type="number"
            className="form-control"
            name="hijos"
            value={form.hijos}
            onChange={onChange}
            min={0}
            step={1}
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">Conyuge aplica</label>
          <select
            className="form-select"
            name="conyuge_aplica"
            value={form.conyuge_aplica}
            onChange={onChange}
          >
            <option>No</option>
            <option>Si</option>
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">Puesto</label>
          <select className="form-select" name="idPuesto" value={form.idPuesto} onChange={onChange} required>
            <option value="">Seleccione...</option>
            {puestos.map(p => (
              <option key={p.idPuesto} value={p.idPuesto}>
                {p.nombre_puesto}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">Rol</label>
          <select className="form-select" name="idRol" value={form.idRol} onChange={onChange} required>
            <option value="">Seleccione...</option>
            {roles.map(r => (
              <option key={r.idRol} value={r.idRol}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="col-12 d-flex gap-2">
          <button className="btn btn-warning">Guardar</button>
          <button
            type="button"
            className="btn btn-outline-light"
            onClick={() => navigate('/empleados')}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
