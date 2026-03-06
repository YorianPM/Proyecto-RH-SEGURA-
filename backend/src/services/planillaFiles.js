const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(process.cwd(), 'data', 'planilla');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function dirs() {
  const cfg = path.join(BASE_DIR, 'config');
  const shots = path.join(BASE_DIR, 'snapshots');
  const locks = path.join(BASE_DIR, 'locks');
  const audit = path.join(BASE_DIR, 'audit');
  [cfg, shots, locks, audit].forEach(ensureDir);
  return { cfg, shots, locks, audit };
}

function normalizePeriodoLabel(p) {
  const s = String(p || '').toLowerCase();
  if (s.startsWith('sem')) return 'Semanal';
  if (s.startsWith('quin')) return 'Quincenal';
  return 'Mensual';
}

function rangeKey(periodo, desde, hasta) {
  return `${normalizePeriodoLabel(periodo)}_${String(desde).slice(0,10)}_${String(hasta).slice(0,10)}`;
}

function configPath(year) {
  const { cfg } = dirs();
  return path.join(cfg, `${year}.json`);
}

function readJSONSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function lockPath(periodo, desde, hasta) {
  const { locks } = dirs();
  return path.join(locks, `${rangeKey(periodo, desde, hasta)}.lock`);
}

function isLocked(periodo, desde, hasta) {
  return fs.existsSync(lockPath(periodo, desde, hasta));
}

function createLock(periodo, desde, hasta, info = {}) {
  const p = lockPath(periodo, desde, hasta);
  writeJSON(p, {
    ...info,
    created_at: new Date().toISOString(),
  });
}

function snapshotPath(periodo, desde, hasta) {
  const { shots } = dirs();
  return path.join(shots, `${rangeKey(periodo, desde, hasta)}.json`);
}

function saveSnapshot(periodo, desde, hasta, snapshot) {
  writeJSON(snapshotPath(periodo, desde, hasta), snapshot);
}

function readSnapshot(periodo, desde, hasta) {
  return readJSONSafe(snapshotPath(periodo, desde, hasta), null);
}

function auditPath(periodo, desde, hasta) {
  const { audit } = dirs();
  return path.join(audit, `${rangeKey(periodo, desde, hasta)}.log.jsonl`);
}

function appendAuditLine(periodo, desde, hasta, obj) {
  const p = auditPath(periodo, desde, hasta);
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

module.exports = {
  BASE_DIR,
  dirs,
  normalizePeriodoLabel,
  rangeKey,
  configPath,
  readJSONSafe,
  writeJSON,
  lockPath,
  isLocked,
  createLock,
  snapshotPath,
  saveSnapshot,
  readSnapshot,
  auditPath,
  appendAuditLine,
};

