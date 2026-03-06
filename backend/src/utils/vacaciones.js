// Importa el helper que indica si una fecha es feriado en Costa Rica.
const { esFeriadoCR } = require('./feriadosCR');

// Genera un error estandarizado con mensaje, status y codigo opcional.
function buildError(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

// Intenta parsear cualquier valor a Date (00:00 UTC) retornando null si es invalido.
function parseISODate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value.getTime());
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const raw = typeof value === 'string' ? value.trim() : value;
  if (!raw) return null;
  let normalized = raw;
  if (typeof raw === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      normalized = raw.slice(0, 10);
    }
  }
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    const alt = new Date(raw);
    if (Number.isNaN(alt.getTime())) return null;
    alt.setUTCHours(0, 0, 0, 0);
    return alt;
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// Determina si una fecha cae en fin de semana (sabado o domingo).
function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// Cuenta dias habiles dentro de un rango, validando el input y soportando modo estricto.
function contarDiasHabilesRango(fechaInicio, fechaFin, { strict = false } = {}) {
  const start = parseISODate(fechaInicio);
  const end = parseISODate(fechaFin);
  if (!start || !end) throw buildError('Fechas de vacaciones invalidas', 400, 'VAC_FECHA_INVALIDA');
  if (end < start) throw buildError('La fecha de fin no puede ser anterior al inicio', 400, 'VAC_RANGO_INVALIDO');

  const cursor = new Date(start.getTime());
  let dias = 0;

  // Recorre el rango dia por dia sumando solo jornadas laborables.
  while (cursor.getTime() <= end.getTime()) {
    const weekend = isWeekend(cursor);
    const feriadoInfo = esFeriadoCR(cursor);
    const laborable = !weekend && !feriadoInfo.esFeriado;
    if (laborable) dias += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // En modo estricto obliga a que exista al menos un dia habil.
  if (strict && dias === 0) {
    throw buildError('Debes incluir al menos un dia habil (lunes a viernes) en la solicitud', 409, 'VAC_SIN_HABILES');
  }

  return dias;
}

// Alias estricto que obliga al menos un dia habil.
function contarDiasHabilesStrict(fechaInicio, fechaFin) {
  return contarDiasHabilesRango(fechaInicio, fechaFin, { strict: true });
}

// Alias flexible que permite rangos sin dias habiles.
function contarDiasHabilesFlexible(fechaInicio, fechaFin) {
  return contarDiasHabilesRango(fechaInicio, fechaFin, { strict: false });
}

// Calcula dias de calendario corridos sin distinguir habiles.
function diasCalendario(fechaInicio, fechaFin) {
  const start = parseISODate(fechaInicio);
  const end = parseISODate(fechaFin);
  if (!start || !end || end < start) return 0;
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

// Suma los dias pendientes en solicitudes, priorizando dias habiles y usando calendario como respaldo.
function sumarDiasPendientesSolicitudes(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  return rows.reduce(
    (acc, row) => {
      try {
        return acc + contarDiasHabilesFlexible(row.fecha_inicio_vac, row.fecha_fin_vac);
      } catch (_) {
        return acc + diasCalendario(row.fecha_inicio_vac, row.fecha_fin_vac);
      }
    },
    0
  );
}

// Expone helpers relevantes a otros modulos.
module.exports = {
  contarDiasHabilesFlexible,
  contarDiasHabilesStrict,
  sumarDiasPendientesSolicitudes,
  isWeekend,
};
