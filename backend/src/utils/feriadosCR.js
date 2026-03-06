// Lista de feriados fijos con mes, dia e identificadores.
const FIXED_HOLIDAYS = [
  { month: 1, day: 1, id: 'ano-nuevo', nombre: 'Año Nuevo' },
  { month: 4, day: 11, id: 'batalla-rivas', nombre: 'Batalla de Rivas' },
  { month: 5, day: 1, id: 'dia-trabajador', nombre: 'Día del Trabajador' },
  { month: 7, day: 25, id: 'anexion-guanacaste', nombre: 'Anexión del Partido de Nicoya' },
  { month: 8, day: 2, id: 'virgen-angeles', nombre: 'Virgen de los Ángeles' },
  { month: 8, day: 15, id: 'dia-madre', nombre: 'Día de la Madre' },
  { month: 9, day: 15, id: 'independencia', nombre: 'Día de la Independencia' },
  { month: 10, day: 12, id: 'culturas', nombre: 'Día de las Culturas' },
  { month: 12, day: 1, id: 'abolicion-ejercito', nombre: 'Abolición del Ejército' },
  { month: 12, day: 25, id: 'navidad', nombre: 'Navidad' },
];

// Convierte un numero a string de dos digitos.
function pad2(v) {
  return String(v).padStart(2, '0');
}

// Calcula la fecha de domingo de Pascua usando Meeus/Jones/Butcher.
function easterSunday(year) {
  // Meeus/Jones/Butcher Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Devuelve una nueva fecha sumando dias en UTC.
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Formatea una fecha en string ISO YYYY-MM-DD.
function toISO(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// Cachea los calendarios generados por año.
const cache = new Map();

// Genera el mapa de feriados para un año, mezclando fijos y semana santa.
function buildYear(year) {
  const map = new Map();
  for (const h of FIXED_HOLIDAYS) {
    const key = `${year}-${pad2(h.month)}-${pad2(h.day)}`;
    map.set(key, { ...h, fecha: key });
  }

  const easter = easterSunday(year);
  const jueves = addDays(easter, -3);
  const viernes = addDays(easter, -2);
  map.set(toISO(jueves), { id: 'jueves-santo', nombre: 'Jueves Santo', fecha: toISO(jueves) });
  map.set(toISO(viernes), { id: 'viernes-santo', nombre: 'Viernes Santo', fecha: toISO(viernes) });

  return map;
}

// Recupera (o construye) el mapa de feriados para un año.
function getFeriadosCR(year) {
  if (!cache.has(year)) {
    cache.set(year, buildYear(year));
  }
  return cache.get(year);
}

// Responde si una fecha especifica es feriado en Costa Rica.
function esFeriadoCR(fecha) {
  if (!fecha) return { esFeriado: false, fecha: null };
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return { esFeriado: false, fecha: null };
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const key = `${year}-${pad2(month)}-${pad2(day)}`;
  const hit = getFeriadosCR(year).get(key);
  if (hit) {
    return { esFeriado: true, fecha: key, id: hit.id, nombre: hit.nombre };
  }
  return { esFeriado: false, fecha: key };
}

// Expone un listado simple de feriados para el año dado.
function listarFeriadosCR(year = new Date().getFullYear()) {
  return Array.from(getFeriadosCR(year).values());
}

module.exports = {
  esFeriadoCR,
  getFeriadosCR,
  listarFeriadosCR,
};
