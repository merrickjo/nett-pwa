// Nett sync — Cloudflare Worker + D1.
// GET  /state   (APP_KEY or VIEW_KEY)  → { events, settings, now }
// POST /sync    (APP_KEY only)         ← { events: [...], settings|null } → same as /state
// Last write wins per event id on updatedAt. Deletes are tombstones (deleted: true).

const KINDS = ['spend', 'unlogged', 'unlogged_in', 'checkin', 'topup', 'payback', 'sweep', 'fund'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-app-key',
  };
}
const json = (data, status, env) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(env) } });

function role(req, env) {
  const k = req.headers.get('x-app-key') || '';
  if (env.APP_KEY && k === env.APP_KEY) return 'owner';
  if (env.VIEW_KEY && k === env.VIEW_KEY) return 'viewer';
  return null;
}

function validEvent(e) {
  return e && typeof e.id === 'string' && e.id.length <= 64 && KINDS.includes(e.kind) &&
    DATE_RE.test(e.date) && typeof e.updatedAt === 'string' &&
    (e.amount === undefined || Number.isFinite(e.amount));
}

async function readState(env) {
  const { results } = await env.DB.prepare('SELECT data FROM events').all();
  const s = await env.DB.prepare("SELECT data FROM kv WHERE k = 'settings'").first();
  return { events: results.map(r => JSON.parse(r.data)), settings: s ? JSON.parse(s.data) : null, now: new Date().toISOString() };
}

async function applySync(env, body) {
  const stmts = [];
  for (const e of (body.events || []).slice(0, 500)) {
    if (!validEvent(e)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO events (id, data, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= events.updated_at`
    ).bind(e.id, JSON.stringify(e), e.updatedAt));
  }
  if (body.settings && typeof body.settings.updatedAt === 'string') {
    stmts.push(env.DB.prepare(
      `INSERT INTO kv (k, data, updated_at) VALUES ('settings', ?1, ?2)
       ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= kv.updated_at`
    ).bind(JSON.stringify(body.settings), body.settings.updatedAt));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const who = role(req, env);
    if (!who) return json({ error: 'unauthorized' }, 401, env);
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'GET' && pathname === '/state') return json(await readState(env), 200, env);
      if (req.method === 'POST' && pathname === '/sync') {
        if (who !== 'owner') return json({ error: 'read-only key' }, 403, env);
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') return json({ error: 'body must be JSON' }, 400, env);
        await applySync(env, body);
        return json(await readState(env), 200, env);
      }
      return json({ error: 'not found' }, 404, env);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500, env);
    }
  },
};
