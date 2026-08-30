// JWT auth middleware. Verifies the Bearer token on protected routes.
const jwt = require('jsonwebtoken');
const { canView } = require('../lib/visibility');

// A missing JWT_SECRET used to fall back to the literal 'dev-secret'. That is
// fine on a laptop and catastrophic anywhere else: the fallback is a known
// constant, so anyone who can read this file can mint a valid admin token. It is
// also exactly the kind of variable that gets forgotten when handing a build to
// a client, so production refuses to start without it.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] JWT_SECRET must be set in production — refusing to start');
  }
  console.warn('[auth] JWT_SECRET is not set; using the insecure development default');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const claims = jwt.verify(token, JWT_SECRET);
    // A correctly signed token whose employee_id is not a uuid cannot identify
    // anyone, and every scoped query would hand it to Postgres as a uuid. Reject
    // it here so a malformed identity is a 401 rather than a 500 from the
    // driver — and so no route has to defend against it individually.
    if (!UUID_RE.test(String(claims.employee_id || ''))) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = claims;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional gate: allow only if the user has one of the given permission roles.
function requireRole(...allowed) {
  return (req, res, next) => {
    const roles = (req.user && req.user.roles) || [];
    const ok = roles.some((r) => allowed.includes(r));
    if (!ok) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

// Gate for "my own record" routes: the employee themselves, or an admin.
// Expects the employee id in req.params[param] (default :id).
function requireSelfOrAdmin(param = 'id') {
  return (req, res, next) => {
    const roles = (req.user && req.user.roles) || [];
    const isSelf = req.user && req.user.employee_id === req.params[param];
    if (!isSelf && !roles.includes('admin')) {
      return res.status(403).json({ error: 'You can only edit your own profile' });
    }
    return next();
  };
}

// Read gate for another person's record: the target must be the caller
// themselves or someone in their subtree.
//
// Answers 404 rather than 403 on a miss. A 403 would confirm that the id names
// a real employee, which leaks exactly the org structure this rule exists to
// hide — an outsider could map the whole company by probing ids.
function requireVisible(param = 'id') {
  return async (req, res, next) => {
    try {
      if (await canView(req.user, req.params[param])) {
        return next();
      }
      return res.status(404).json({ error: 'Employee not found' });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireAuth, requireRole, requireSelfOrAdmin, requireVisible, JWT_SECRET };
