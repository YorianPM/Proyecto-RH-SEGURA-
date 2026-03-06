
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEmpleado, getPuestos, getRoles, getEmpleados } from '../api/empleados';
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

const REQUIRED_FIELDS = [
  'nombre',
  'apellido1',
  'apellido2',
  'cedula',
  'correo',
  'contrasena',
  'telefono',
  'fecha_ingreso',
  'genero',
  'estado_civil',
  'hijos',
  'idPuesto',
  'idRol',
  'conyuge_aplica'
];

const sanitizeValue = (name, value) => {
  const raw = String(value ?? '');
  if (LETTER_FIELDS.has(name)) return raw.replace(/[^A-Za-z\u00C0-\u024F'\s]/g, '');
  if (DIGIT_FIELDS.has(name)) return raw.replace(/\D+/g, '');
  return raw;
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

export default function EmpleadoCrear() {
  const navigate = useNavigate();
  const today = todayStr();
  const [form, setForm] = useState({ ...empty, fecha_ingreso: today });
  const [puestos, setPuestos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('dark');
  const [loading, setLoading] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const toast = useToast();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [puestosResp, rolesResp, empleadosResp] = await Promise.all([
          getPuestos(),
          getRoles(),
          getEmpleados()
        ]);
        if (!active) return;
        setPuestos(puestosResp);
        setRoles(buildRoleOptions(rolesResp));
        setEmpleados(empleadosResp || []);
      } catch {
        if (active) {
          const text = 'Error cargando catalogos';
          setMsg(text);
          setMsgType('danger');
          toast?.(text, { type: 'error', title: 'Empleados' });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [toast]);

  const normalizeCorreo = (value) => String(value ?? '').trim().toLowerCase();
  const normalizeCedula = (value) => String(value ?? '').trim();

  const correoYaExiste = (value) => {
    const current = normalizeCorreo(value);
    if (!current) return false;
    return empleados.some(emp => normalizeCorreo(emp.correo) === current);
  };

  const cedulaYaExiste = (value) => {
    const current = normalizeCedula(value);
    if (!current) return false;
    return empleados.some(emp => normalizeCedula(emp.cedula) === current);
  };

  const onChange = (event) => {
    const { name, value } = event.target;
    const sanitized = sanitizeValue(name, value);
    setForm(prev => {
      if (name === 'estado') {
        const future = prev.fecha_ingreso && prev.fecha_ingreso > today;
        if (future) return prev;
      }
      const next = { ...prev, [name]: sanitized };
      if (name === 'fecha_ingreso') {
        let normalized = sanitized;
        if (normalized && normalized < today) normalized = today;
        next.fecha_ingreso = normalized;
        if (normalized && normalized > today) {
          next.estado = 0;
        }
        if (!normalized) {
          next.estado = 1;
        } else if (normalized <= today) {
          next.estado = 1;
        }
      }
      return next;
    });
    setFormErrors(prev => {
      let next = prev;
      let changed = false;
      if (prev[name]) {
        next = { ...prev };
        delete next[name];
        changed = true;
      }
      let duplicateMessage = null;
      if (name === 'correo' && correoYaExiste(sanitized)) {
        duplicateMessage = 'Ya existe un empleado con este correo.';
      }
      if (name === 'cedula' && cedulaYaExiste(sanitized)) {
        duplicateMessage = 'Ya existe un empleado con esta cedula.';
      }
      if (duplicateMessage) {
        if (!changed) next = { ...prev };
        next[name] = duplicateMessage;
        changed = true;
      }
      return changed ? next : prev;
    });
  };

  const validateForm = () => {
    const errors = {};
    REQUIRED_FIELDS.forEach(field => {
      const raw = form[field];
      const value = raw === 0 ? '0' : String(raw ?? '').trim();
      if (!value) errors[field] = 'Este campo es obligatorio.';
    });
    if (form.contrasena && form.contrasena.trim().length < 8) {
      errors.contrasena = 'La contrasena debe tener al menos 8 caracteres.';
    }
    if (!form.fecha_ingreso) {
      errors.fecha_ingreso = 'Seleccione una fecha de ingreso.';
    } else if (form.fecha_ingreso < today) {
      errors.fecha_ingreso = 'La fecha de ingreso no puede ser anterior a hoy.';
    }
    if (correoYaExiste(form.correo)) {
      errors.correo = 'Ya existe un empleado con este correo.';
    }
    if (cedulaYaExiste(form.cedula)) {
      errors.cedula = 'Ya existe un empleado con esta cedula.';
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      const warn = 'Revise los campos marcados antes de guardar.';
      setMsg(warn);
      setMsgType('danger');
      toast?.(warn, { type: 'warning', title: 'Empleados' });
      return false;
    }
    return true;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;
    setMsg('');
    setMsgType('dark');
    setLoading(true);
    try {
      await createEmpleado(form);
      setMsg('Empleado creado');
      setMsgType('success');
      toast?.('Empleado creado correctamente', { type: 'success', title: 'Empleados' });
      setTimeout(() => navigate('/empleados', { replace: true }), 600);
    } catch (err) {
      const fallback = err?.response?.data?.message || 'Error guardando';
      setMsg(fallback);
      setMsgType('danger');
      toast?.(fallback, { type: 'error', title: 'Empleados' });
    } finally {
      setLoading(false);
    }
  };

  const futureHire = form.fecha_ingreso && form.fecha_ingreso > today;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center gap-2 mb-3">
        <BackToHome />
        <h3 className="mb-0">Nuevo empleado</h3>
      </div>
      {msg && <div className={`alert alert-${msgType}`} role="alert">{msg}</div>}

      <form onSubmit={onSubmit} className="row g-3" autoComplete="off">
        <div className="col-md-4">
          <label className="form-label">Nombre</label>
          <input
            className={`form-control${formErrors.nombre ? ' is-invalid' : ''}`}
            name="nombre"
            value={form.nombre}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
          {formErrors.nombre && <div className="invalid-feedback">{formErrors.nombre}</div>}
        </div>
        <div className="col-md-4">
          <label className="form-label">Primer apellido</label>
          <input
            className={`form-control${formErrors.apellido1 ? ' is-invalid' : ''}`}
            name="apellido1"
            value={form.apellido1}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
          {formErrors.apellido1 && <div className="invalid-feedback">{formErrors.apellido1}</div>}
        </div>
        <div className="col-md-4">
          <label className="form-label">Segundo apellido</label>
          <input
            className={`form-control${formErrors.apellido2 ? ' is-invalid' : ''}`}
            name="apellido2"
            value={form.apellido2}
            onChange={onChange}
            pattern={ONLY_LETTERS_PATTERN}
            title="Solo letras y espacios"
            maxLength={60}
            required
          />
          {formErrors.apellido2 && <div className="invalid-feedback">{formErrors.apellido2}</div>}
        </div>

        <div className="col-md-3">
          <label className="form-label">Cedula</label>
          <input
            className={`form-control${formErrors.cedula ? ' is-invalid' : ''}`}
            name="cedula"
            value={form.cedula}
            onChange={onChange}
            inputMode="numeric"
            pattern={CEDULA_PATTERN}
            maxLength={12}
            title="Solo numeros (9 a 12 digitos)"
            required
          />
          {formErrors.cedula && <div className="invalid-feedback">{formErrors.cedula}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Correo</label>
          <input
            type="email"
            className={`form-control${formErrors.correo ? ' is-invalid' : ''}`}
            name="correo"
            value={form.correo}
            onChange={onChange}
            required
          />
          {formErrors.correo && <div className="invalid-feedback">{formErrors.correo}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Contrasena</label>
          <input
            type="password"
            className={`form-control${formErrors.contrasena ? ' is-invalid' : ''}`}
            name="contrasena"
            value={form.contrasena}
            onChange={onChange}
            minLength={8}
            title="Minimo 8 caracteres"
            required
          />
          {formErrors.contrasena && <div className="invalid-feedback">{formErrors.contrasena}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Telefono</label>
          <input
            className={`form-control${formErrors.telefono ? ' is-invalid' : ''}`}
            name="telefono"
            value={form.telefono}
            onChange={onChange}
            inputMode="tel"
            pattern={ONLY_DIGITS_PATTERN}
            maxLength={15}
            title="Solo numeros"
            required
          />
          {formErrors.telefono && <div className="invalid-feedback">{formErrors.telefono}</div>}
        </div>

        <div className="col-md-3">
          <label className="form-label">Fecha ingreso</label>
          <input
            type="date"
            className={`form-control${formErrors.fecha_ingreso ? ' is-invalid' : ''}`}
            name="fecha_ingreso"
            value={form.fecha_ingreso}
            onChange={onChange}
            min={today}
            max="9999-12-31"
            required
          />
          {formErrors.fecha_ingreso && <div className="invalid-feedback">{formErrors.fecha_ingreso}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Estado</label>
          <select
            className={`form-select${formErrors.estado ? ' is-invalid' : ''}`}
            name="estado"
            value={form.estado}
            onChange={onChange}
            disabled={futureHire}
          >
            <option value={1}>Activo</option>
            <option value={0}>Inactivo</option>
          </select>
          {formErrors.estado && <div className="invalid-feedback">{formErrors.estado}</div>}
          {futureHire && (
            <small className="text-warning d-block mt-1">
              Se activara automaticamente en la fecha de ingreso.
            </small>
          )}
        </div>
        <div className="col-md-3">
          <label className="form-label">Genero</label>
          <select
            className={`form-select${formErrors.genero ? ' is-invalid' : ''}`}
            name="genero"
            value={form.genero}
            onChange={onChange}
            required
          >
            <option>No especifica</option>
            <option>Femenino</option>
            <option>Masculino</option>
            <option>Otro</option>
          </select>
          {formErrors.genero && <div className="invalid-feedback">{formErrors.genero}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Estado civil</label>
          <select
            className={`form-select${formErrors.estado_civil ? ' is-invalid' : ''}`}
            name="estado_civil"
            value={form.estado_civil}
            onChange={onChange}
            required
          >
            <option>Soltero/a</option>
            <option>Casado/a</option>
            <option>Divorciado/a</option>
            <option>Union libre</option>
          </select>
          {formErrors.estado_civil && <div className="invalid-feedback">{formErrors.estado_civil}</div>}
        </div>

        <div className="col-md-3">
          <label className="form-label">Hijos</label>
          <input
            type="number"
            className={`form-control${formErrors.hijos ? ' is-invalid' : ''}`}
            name="hijos"
            value={form.hijos}
            onChange={onChange}
            min={0}
            step={1}
            required
          />
          {formErrors.hijos && <div className="invalid-feedback">{formErrors.hijos}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Conyuge aplica</label>
          <select
            className={`form-select${formErrors.conyuge_aplica ? ' is-invalid' : ''}`}
            name="conyuge_aplica"
            value={form.conyuge_aplica}
            onChange={onChange}
            required
          >
            <option>No</option>
            <option>Si</option>
          </select>
          {formErrors.conyuge_aplica && <div className="invalid-feedback">{formErrors.conyuge_aplica}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Puesto</label>
          <select
            className={`form-select${formErrors.idPuesto ? ' is-invalid' : ''}`}
            name="idPuesto"
            value={form.idPuesto}
            onChange={onChange}
            required
          >
            <option value="">Seleccione...</option>
            {puestos.map(p => (
              <option key={p.idPuesto} value={p.idPuesto}>
                {p.nombre_puesto}
              </option>
            ))}
          </select>
          {formErrors.idPuesto && <div className="invalid-feedback">{formErrors.idPuesto}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Rol</label>
          <select
            className={`form-select${formErrors.idRol ? ' is-invalid' : ''}`}
            name="idRol"
            value={form.idRol}
            onChange={onChange}
            required
          >
            <option value="">Seleccione...</option>
            {roles.map(r => (
              <option key={r.idRol} value={r.idRol}>
                {r.label}
              </option>
            ))}
          </select>
          {formErrors.idRol && <div className="invalid-feedback">{formErrors.idRol}</div>}
        </div>

        <div className="col-12 d-flex gap-2">
          <button className="btn btn-warning" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
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
