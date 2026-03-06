// Utilidades de cálculo de planilla para Costa Rica (2025)
// Enfocado en retenciones básicas y aportes sociales.
// Notas:
// - Tasas por defecto: Obrero 10.34%, Patronal 26.33% (CCSS + otros)
// - Impuesto sobre la renta: tramos mensuales Decreto 44772-H (2025)
// - Conversión de período: mensual | quincenal | semanal

const DEFAULTS = {
  obreroRate: 0.1034, // 10.34%
  patronalRate: 0.2633, // 26.33%
  horasMes: 208, // usado para cálculo de horas extra
  tasaHoraExtra: 1.5, // tiempo y medio por defecto
  rentaBase: 'neto_ccss', // 'neto_ccss' o 'bruto'
  diasMesBase: 30,
};

// Tramos mensuales por defecto (2025). Si la BD provee tramos (tabla Renta_Tramo), se usarán esos.
// Estructura de tramo mensual: { hasta: number | Infinity, tasa: number, sobre: number }
const RENTAS_MENSUAL_2025 = [
  { hasta: 922000, tasa: 0,     sobre: 922000 },
  { hasta: 1352000, tasa: 0.10, sobre: 922000 },
  { hasta: 2373000, tasa: 0.15, sobre: 1352000 },
  { hasta: 4745000, tasa: 0.20, sobre: 2373000 },
  { hasta: Infinity, tasa: 0.25, sobre: 4745000 },
];

const PERIOD_FACTORS = {
  mensual: 1,
  quincenal: 2,
  semanal: 4.3333333333, // 52 semanas / 12 meses
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getPeriodsPerMonth(periodo = 'mensual') {
  const p = String(periodo || 'mensual').toLowerCase();
  return PERIOD_FACTORS[p] || 1;
}

function toPeriodoDesdeMensual(montoMensual, periodo = 'mensual') {
  const ppm = getPeriodsPerMonth(periodo);
  return montoMensual / ppm;
}

// Calcula renta para un MONTO por período, ajustando los tramos mensuales
// dividiéndolos por el número de períodos por mes. Esto aproxima la retención
// por planilla según periodicidad.
function rentaPeriodo(montoPeriodo, periodo = 'mensual', tramosMensuales = RENTAS_MENSUAL_2025) {
  const ppm = getPeriodsPerMonth(periodo);
  const baseTramos = (tramosMensuales && tramosMensuales.length ? tramosMensuales : RENTAS_MENSUAL_2025);
  const tramos = baseTramos.map(t => ({
    hasta: (t.hasta === Infinity ? Infinity : (Number(t.hasta) / ppm)),
    tasa: Number(t.tasa || 0),
    sobre: (t.sobre === Infinity ? Infinity : Number(t.sobre || 0) / ppm),
  }));

  if (!tramos.length) return 0;
  const y = Number(montoPeriodo) || 0;
  if (y <= tramos[0].hasta) return 0;
  let impuesto = 0;
  for (let i = 1; i < tramos.length; i++) {
    const seg = tramos[i];
    const prevHasta = tramos[i - 1].hasta;
    if (y > prevHasta) {
      const base = Math.max(0, Math.min(y, seg.hasta) - seg.sobre);
      if (base > 0) impuesto += base * seg.tasa;
    } else {
      break;
    }
  }
  return round2(impuesto);
}

// Compatibilidad: usa tramos 2025 por defecto
function rentaPeriodoCR2025(montoPeriodo, periodo = 'mensual') {
  return rentaPeriodo(montoPeriodo, periodo, RENTAS_MENSUAL_2025);
}

// Convierte filas de BD Renta_Tramo a estructura de tramos mensuales
// rows: [{ monto_min, monto_max, tasa_pct }]
function buildTramosMensualesFromDb(rows = []) {
  // Normaliza filas de BD en estructura: [{hasta, tasa, sobre}] mensual
  // Reglas:
  // - Si existe tramo con tasa 0, el límite exento es el mayor "max" de esos tramos.
  // - Si no existe tramo 0%, el exento es el menor "min" del primer tramo gravado.
  // - Para cada tramo gravado, "sobre" es el límite del tramo anterior (para evitar off‑by‑one y bases negativas).
  const src = (rows || []).map(r => ({
    min: Number(r.monto_min ?? 0),
    max: r.monto_max == null ? Infinity : Number(r.monto_max),
    tasa: Number(r.tasa_pct ?? 0) / 100,
  })).sort((a,b)=>a.min-b.min);
  if (!src.length) return RENTAS_MENSUAL_2025;

  const tr = [];
  const exentos = src.filter(r => r.tasa === 0);
  const exentoHasta = exentos.length
    ? Math.max(...exentos.map(r => (r.max === Infinity ? 0 : r.max))) // si alguno es infinito, caerá a 0 y no afectará
    : (src[0]?.min ?? 0);
  const exento = Number.isFinite(exentoHasta) && exentoHasta > 0 ? exentoHasta : (src[0]?.min ?? 0);
  tr.push({ hasta: exento, tasa: 0, sobre: exento });

  let prevHasta = exento;
  for (const r of src) {
    if (r.tasa <= 0) { // ya incorporado en exento; solo actualiza prevHasta si su max es mayor
      if (r.max !== Infinity && r.max > prevHasta) prevHasta = r.max;
      continue;
    }
    const hasta = r.max;
    const sobre = prevHasta;
    tr.push({ hasta, tasa: r.tasa, sobre });
    if (hasta !== Infinity) prevHasta = hasta;
  }
  return tr.length ? tr : RENTAS_MENSUAL_2025;
}

function aportesSociales(brutoPeriodo, opts = {}) {
  const { obreroRate = DEFAULTS.obreroRate, patronalRate = DEFAULTS.patronalRate } = opts;
  const obrero = round2(brutoPeriodo * obreroRate);
  const patronal = round2(brutoPeriodo * patronalRate);
  return { obrero, patronal };
}

function montoHoraDesdeMensual(salarioMensual, horasMes = DEFAULTS.horasMes) {
  const h = Number(horasMes) || DEFAULTS.horasMes;
  return Number(salarioMensual) / h;
}

function montoHorasExtra({ salarioMensual, horasExtras = 0, horasMes = DEFAULTS.horasMes, tasa = DEFAULTS.tasaHoraExtra }) {
  const salarioHora = montoHoraDesdeMensual(salarioMensual, horasMes);
  return round2(Number(horasExtras) * salarioHora * Number(tasa));
}

// Cálculo completo para un empleado en un período
// params: {
//  salarioMensual,
//  periodo: 'mensual'|'quincenal'|'semanal',
//  horasExtras: number,
//  horasExtrasFactorizadas?: number, // suma de horas * factor individual (opcional)
//  horasMes?: number,
//  tasaHoraExtra?: number,
//  rentaBase?: 'neto_ccss'|'bruto',
//  obreroRate?: number,
//  patronalRate?: number,
//  otrasDeducciones?: number (monto fijo en el período)
// }
function calcularEmpleadoPeriodo(params) {
  const {
    salarioMensual,
    periodo = 'mensual',
    horasExtras = 0,
    horasExtrasFactorizadas = null,
    horasMes = DEFAULTS.horasMes,
    tasaHoraExtra = DEFAULTS.tasaHoraExtra,
    rentaBase = DEFAULTS.rentaBase,
    obreroRate = DEFAULTS.obreroRate,
    patronalRate = DEFAULTS.patronalRate,
    otrasDeducciones = 0,
  } = params || {};
  const sueldoPeriodo = toPeriodoDesdeMensual(Number(salarioMensual), periodo);
  const salarioHora = montoHoraDesdeMensual(salarioMensual, horasMes);
  let extrasPeriodo;
  if (horasExtrasFactorizadas !== null && horasExtrasFactorizadas !== undefined) {
    extrasPeriodo = round2(Number(horasExtrasFactorizadas) * salarioHora);
  } else {
    extrasPeriodo = montoHorasExtra({ salarioMensual, horasExtras, horasMes, tasa: tasaHoraExtra });
  }
  const bruto = round2(sueldoPeriodo + extrasPeriodo);

  const { obrero, patronal } = aportesSociales(bruto, { obreroRate, patronalRate });
  const baseRenta = rentaBase === 'bruto' ? bruto : Math.max(0, bruto - obrero);
  const renta = rentaPeriodoCR2025(baseRenta, periodo);
  const otras = round2(Number(otrasDeducciones) || 0);
  const neto = round2(bruto - obrero - renta - otras);

  return {
    periodo,
    sueldoPeriodo: round2(sueldoPeriodo),
    horasExtras: Number(horasExtras) || 0,
    extrasPeriodo,
    bruto,
    obrero,
    patronal,
    rentaBase: rentaBase,
    renta,
    otrasDeducciones: otras,
    neto,
  };
}

/* ===================== Ausencias / Incapacidades ===================== */

function diasEntre(fechaInicio, fechaFin) {
  const a = new Date(fechaInicio);
  const b = new Date(fechaFin);
  if (isNaN(a) || isNaN(b)) return 0;
  const one = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const two = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const diff = (two - one) / (24 * 60 * 60 * 1000);
  return diff >= 0 ? Math.floor(diff) + 1 : 0; // inclusivo
}

function diasSolapados(a1, a2, b1, b2) {
  const ini = new Date(Math.max(new Date(a1), new Date(b1)));
  const fin = new Date(Math.min(new Date(a2), new Date(b2)));
  return diasEntre(ini, fin);
}

function diasBasePorPeriodo(periodo = 'mensual') {
  const p = String(periodo || 'mensual').toLowerCase();
  if (p === 'mensual') return 30;
  if (p === 'quincenal') return 15;
  if (p === 'semanal') return 7;
  return 30;
}

// Cuenta días hábiles de Costa Rica (Lunes-Sábado) en un rango inclusivo
function diasHabilesEntre(desde, hasta) {
  const a = new Date(desde);
  const b = new Date(hasta);
  if (isNaN(a) || isNaN(b)) return 0;
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  if (end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay(); // 0=Dom, 6=Sab
    if (dow !== 0) count++; // Lunes-Sábado
  }
  return count;
}

// Ajuste de política: 192h efectivas mensuales (8h x 6d x 4 semanas)
DEFAULTS.horasMes = 192;

// Reglas por defecto para cobertura de la empresa en incapacidades
// Se identifican por coincidencias en el texto del concepto.
const INCAP_RULES_DEFAULT = [
  // Enfermedad común: 50% primeros 3 días, luego 0%
  { match: /enfer/i, tramos: [{ dias: 3, rate: 0.5 }, { dias: Infinity, rate: 0 }] },
  // Riesgo del trabajo: INS asume subsidio, empresa 0%
  { match: /riesg|trabaj/i, tramos: [{ dias: Infinity, rate: 0 }] },
  // Maternidad: 50% empresa, 50% CCSS
  { match: /mater/i, tramos: [{ dias: Infinity, rate: 0.5 }] },
];

// Ajusta el sueldo del período por días de incapacidad según reglas.
// incapacidades: [{ fecha_inicio, fecha_fin, concepto }]
function ajustarSueldoPorIncapacidades({
  sueldoPeriodo,
  salarioMensual,
  periodo = 'mensual',
  diasMesBase = DEFAULTS.diasMesBase,
  desde,
  hasta,
  incapacidades = [],
  reglas = INCAP_RULES_DEFAULT,
}) {
  const salarioDiario = Number(salarioMensual) / Number(diasMesBase);
  let descuento = 0;
  const detalles = [];

  for (const inc of incapacidades) {
    const dSol = diasSolapados(desde, hasta, inc.fecha_inicio, inc.fecha_fin);
    if (dSol <= 0) continue;
    const concepto = String(inc.concepto || '').trim();
    const regla = reglas.find(r => r.match.test(concepto));
    if (!regla) continue;

    // Calcular desplazamiento dentro del registro de incapacidad
    const startDate = new Date(inc.fecha_inicio);
    const overlapStart = new Date(Math.max(new Date(desde), startDate));
    const startOffset = diasEntre(startDate, overlapStart) - 1; // 0-based

    let diasPend = dSol;
    let i = 0;
    let descInc = 0;
    let diaCursor = startOffset;
    while (diasPend > 0 && i < regla.tramos.length) {
      const tramo = regla.tramos[i];
      const avail = tramo.dias === Infinity ? Infinity : Math.max(0, tramo.dias - diaCursor);
      const toma = Math.min(avail, diasPend);
      if (toma <= 0) { i++; diaCursor = 0; continue; }
      const descuentoDias = salarioDiario * (1 - tramo.rate) * toma;
      descInc += descuentoDias;
      diasPend -= toma;
      i++; diaCursor = 0;
    }
    descuento += descInc;
    detalles.push(`${concepto}:${dSol}d`);
  }

  const sueldoAjustado = Math.max(0, Number(sueldoPeriodo) - descuento);
  return { sueldoAjustado: round2(sueldoAjustado), descuentoIncap: round2(descuento), resumen: detalles.join('; ') };
}

module.exports = {
  DEFAULTS,
  PERIOD_FACTORS,
  toPeriodoDesdeMensual,
  rentaPeriodoCR2025,
  rentaPeriodo,
  aportesSociales,
  montoHoraDesdeMensual,
  montoHorasExtra,
  calcularEmpleadoPeriodo,
  buildTramosMensualesFromDb,
  diasEntre,
  diasSolapados,
  diasBasePorPeriodo,
  ajustarSueldoPorIncapacidades,
  INCAP_RULES_DEFAULT,
  diasHabilesEntre,
};
