const FIXED_HOLIDAYS = [
  { month: 1, day: 1, id: 'ano-nuevo', nombre: 'A\u00f1o Nuevo' },
  { month: 4, day: 11, id: 'batalla-rivas', nombre: 'Batalla de Rivas' },
  { month: 5, day: 1, id: 'dia-trabajador', nombre: 'D\u00eda del Trabajador' },
  { month: 7, day: 25, id: 'anexion-guanacaste', nombre: 'Anexi\u00f3n del Partido de Nicoya' },
  { month: 8, day: 2, id: 'virgen-angeles', nombre: 'Virgen de los \u00c1ngeles' },
  { month: 8, day: 15, id: 'dia-madre', nombre: 'D\u00eda de la Madre' },
  { month: 9, day: 15, id: 'independencia', nombre: 'D\u00eda de la Independencia' },
  { month: 10, day: 12, id: 'culturas', nombre: 'D\u00eda de las Culturas' },
  { month: 12, day: 1, id: 'abolicion-ejercito', nombre: 'Abolici\u00f3n del Ej\u00e9rcito' },
  { month: 12, day: 25, id: 'navidad', nombre: 'Navidad' },
];

const pad2 = (value) => String(value).padStart(2, '0');

function easterSunday(year) {
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

function addDaysUTC(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISO(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

const feriadosCache = new Map();

function buildYear(year) {
  const map = new Map();
  for (const h of FIXED_HOLIDAYS) {
    const key = `${year}-${pad2(h.month)}-${pad2(h.day)}`;
    map.set(key, { ...h, fecha: key });
  }
  const easter = easterSunday(year);
  const jueves = addDaysUTC(easter, -3);
  const viernes = addDaysUTC(easter, -2);
  map.set(toISO(jueves), { id: 'jueves-santo', nombre: 'Jueves Santo', fecha: toISO(jueves) });
  map.set(toISO(viernes), { id: 'viernes-santo', nombre: 'Viernes Santo', fecha: toISO(viernes) });
  return map;
}

function getYearMap(year) {
  if (!feriadosCache.has(year)) {
    feriadosCache.set(year, buildYear(year));
  }
  return feriadosCache.get(year);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function esFeriadoCR(fecha) {
  const date = normalizeDate(fecha);
  if (!date) return { esFeriado: false, fecha: null };
  const key = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  const hit = getYearMap(date.getUTCFullYear()).get(key);
  if (hit) return { esFeriado: true, fecha: key, id: hit.id, nombre: hit.nombre };
  return { esFeriado: false, fecha: key };
}

function classifyDay(date) {
  const iso = date.toISOString().slice(0, 10);
  const feriadoInfo = esFeriadoCR(date);
  if (feriadoInfo.esFeriado) {
    return {
      laborable: false,
      type: 'feriado',
      nombre: feriadoInfo.nombre || null,
      fecha: iso,
    };
  }
  const day = date.getUTCDay();
  if (day === 0) {
    return {
      laborable: false,
      type: 'domingo',
      nombre: null,
      fecha: iso,
    };
  }
  return {
    laborable: true,
    type: 'laboral',
    nombre: null,
    fecha: iso,
  };
}

export function analyzeLaboralRange(inicio, fin) {
  const start = normalizeDate(inicio);
  const end = normalizeDate(fin);
  if (!start || !end || end < start) return { count: 0, invalidEdges: [], note: null };

  const cursor = new Date(start.getTime());
  let count = 0;
  let note = null;

  const invalidEdges = [];
  const startInfo = classifyDay(start);
  if (!startInfo.laborable) invalidEdges.push({ ...startInfo, position: 'start' });
  const endInfo = classifyDay(end);
  const sameDay = start.getTime() === end.getTime();
  if (!endInfo.laborable && (!sameDay || invalidEdges.length === 0)) {
    invalidEdges.push({ ...endInfo, position: 'end' });
  }

  while (cursor.getTime() <= end.getTime()) {
    const info = classifyDay(cursor);
    if (info.laborable) {
      count += 1;
    } else if (
      !note &&
      info.type === 'feriado' &&
      cursor.getTime() !== start.getTime() &&
      cursor.getTime() !== end.getTime()
    ) {
      note = info;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { count, invalidEdges, note };
}
