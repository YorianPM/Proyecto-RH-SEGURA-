const DAY_MS = 24 * 60 * 60 * 1000;

const toDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const d = value;
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const formatISODate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatHumanDate = (date, opts = { dateStyle: 'long' }, locale = 'es-CR') => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  } catch {
    return formatISODate(date);
  }
};

export const todayDateOnly = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const addDays = (date, amount) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !Number.isFinite(amount)) return null;
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  clone.setDate(clone.getDate() + amount);
  return clone;
};

export const addWeeks = (date, amount) => addDays(date, Math.round(amount * 7));

export const addMonths = (date, amount) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !Number.isFinite(amount)) return null;
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  clone.setMonth(clone.getMonth() + amount);
  return clone;
};

export const getTenureInfo = (fechaIngreso) => {
  const baseDate = toDateOnly(fechaIngreso);
  const today = todayDateOnly();
  if (!baseDate) {
    return {
      hasDate: false,
      baseDate: null,
      today,
      days: Infinity,
      weeks: Infinity,
      months: Infinity,
    };
  }
  const diffDays = Math.floor((today - baseDate) / DAY_MS);
  return {
    hasDate: true,
    baseDate,
    today,
    days: diffDays,
    weeks: diffDays / 7,
    months: diffDays / 30.4375,
  };
};

export const buildUnlockStatus = (fechaIngreso, { days = null, weeks = null, months = null } = {}) => {
  const info = getTenureInfo(fechaIngreso);
  if (!info.hasDate) {
    return { ...info, ready: true, unlockDate: null };
  }
  let unlockDate = info.baseDate;
  if (typeof days === 'number') {
    unlockDate = addDays(info.baseDate, days);
  } else if (typeof weeks === 'number') {
    unlockDate = addDays(info.baseDate, Math.round(weeks * 7));
  } else if (typeof months === 'number') {
    unlockDate = addMonths(info.baseDate, months);
  }
  const ready = !unlockDate ? true : info.today >= unlockDate;
  return { ...info, unlockDate, ready };
};
