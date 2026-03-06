const jwt = require('jsonwebtoken');

const FORCE_PASSWORD_ALLOW = [
  { method: 'PATCH', pattern: /^\/api\/empleados\/\d+\/password\/?$/i },
  { method: 'GET', pattern: /^\/api\/auth\/me\/?$/i }
];

function allowsForcePasswordRoute(req) {
  const method = (req.method || '').toUpperCase();
  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  return FORCE_PASSWORD_ALLOW.some(rule => {
    const methodOk = rule.method === '*' || rule.method === method;
    return methodOk && rule.pattern.test(fullPath);
  });
}

function verifyJWT(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok:false, message:'Token requerido' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { sub, usuario, idRol, perms: {...} }

    if (req.user?.mustChangePassword && !allowsForcePasswordRoute(req)) {
      return res.status(428).json({ ok:false, message:'Debe cambiar su contrasena antes de continuar' });
    }

    next();
  } catch (e) {
    return res.status(401).json({ ok:false, message:'Token invalido o vencido' });
  }
}

// Requiere uno o mas flags del rol (cualquiera o todos)
function requirePerms(required = [], mode = 'ALL') {
  return (req, res, next) => {
    // Rol 3 = acceso total
    if (req.user?.idRol === 3) return next();
    if (!req.user?.perms) return res.status(403).json({ ok:false, message:'Sin permisos' });
    const perms = req.user.perms;
    const checks = required.map(f => !!perms[f]);

    const ok = mode === 'ANY' ? checks.some(Boolean) : checks.every(Boolean);
    if (!ok) return res.status(403).json({ ok:false, message:'Permisos insuficientes' });
    next();
  };
}

// Permite si es el propio usuario (req.user.sub == :id) o si tiene el permiso dado
function requireSelfOrPerm(perm, paramName = 'id') {
  return (req, res, next) => {
    try {
      const userId = Number(req.user?.sub);
      const targetId = Number(req.params?.[paramName]);
      if (userId && targetId && userId === targetId) return next();
    } catch {}
    // Si no es el propio, requiere permiso
    return requirePerms([perm])(req, res, next);
  };
}

module.exports = { verifyJWT, requirePerms, requireSelfOrPerm };
