// Utilidades de validacion reutilizables en el front

export const todayStr = () => {
  const d = new Date();
  // Ajuste a zona local para evitar off-by-one
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const adultMaxDateStr = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// Cadenas para atributo pattern
export const ONLY_LETTERS_PATTERN = "^[A-Za-z\\u00C0-\\u024F'\\s]+$";
export const ONLY_DIGITS_PATTERN = "^\\d+$";
export const CEDULA_PATTERN = "^\\d{9,12}$"; // ajustar si se requiere otro rango
