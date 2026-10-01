// Nett engine — pure budgeting math. No DOM, no storage: app.js and the
// tests both import this. All dates are Jakarta-local 'YYYY-MM-DD' strings.

export const DAY_MS = 86400000;
export const MILESTONES = [
  { key: 'M1', label: '1 month', amount: 62_000_000 },
  { key: 'M2', label: '3 months', amount: 187_000_000 },
  { key: 'M3', label: '6 months', amount: 374_000_000 },
];

export const DEFAULT_SETTINGS = {
  monthlyMe: 3_000_000,            // lockdown allowance (Nov 2026 – Jan 2027)
  weights: { wfo: 1.0, wfh: 0.4, we: 0.5 },
  wfoDays: [2, 3, 4],              // ISO weekday: Tue, Wed, Thu
  payday: 25,
  familyMode: 'observe',           // 'observe' (track, no cap) | 'budget'
  familyWeekly: 0,
  fundBase: 0,                     // liquid-fund balance before Nett started
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function jktDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}
function toUTC(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUTC(t) { return new Date(t).toISOString().slice(0, 10); }
export function addDays(s, n) { return fromUTC(toUTC(s) + n * DAY_MS); }
export function isoWeekday(s) { const w = new Date(toUTC(s)).getUTCDay(); return w === 0 ? 7 : w; }
export function weekStart(s) { return addDays(s, 1 - isoWeekday(s)); }
export function weekDays(s) { const m = weekStart(s); return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(m, i)); }

export function dayType(s, settings) {
  const w = isoWeekday(s);
  if (w >= 6) return 'we';
  return settings.wfoDays.includes(w) ? 'wfo' : 'wfh';
}
export function weight(s, settings) { return settings.weights[dayType(s, settings)] ?? 1; }

export function weeklyMe(settings) { return Math.round((settings.monthlyMe * 12) / 52); }

// Pay cycle: payday (25th) to the day before the next payday.
export function payCycle(s, payday = 25) {
  const [y, m, d] = s.split('-').map(Number);
  let sy = y, sm = m;
  if (d < payday) { sm -= 1; if (sm === 0) { sm = 12; sy -= 1; } }
  let ey = sy, em = sm + 1; if (em === 13) { em = 1; ey += 1; }
  const pad = n => String(n).padStart(2, '0');
  const start = `${sy}-${pad(sm)}-${pad(payday)}`;
  const end = addDays(`${ey}-${pad(em)}-${pad(payday)}`, -1);
  return { start, end };
}

export function liveEvents(events) {
  return Object.values(events || {}).filter(e => !e.deleted)
    .sort((a, b) => (a.date === b.date ? a.ts.localeCompare(b.ts) : a.date.localeCompare(b.date)));
}

// What an event costs the Me envelope.
export function meCost(e) {
  if (e.kind === 'unlogged') return e.amount;               // unexplained balance drop
  if (e.kind === 'spend' && e.env === 'me') return e.amount - (e.payback || 0);
  return 0;
}
export function familyCost(e) {
  if (e.kind === 'spend' && e.env === 'family') return e.amount - (e.payback || 0);
  return 0;
}

const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const inRange = (e, a, b) => e.date >= a && e.date <= b;

// Week result with one-step carry: an overspend in the previous week
// reduces this week's envelope; an underspend is swept, never carried.
export function weekResult(evs, monday, settings, depth = 8) {
  const sunday = addDays(monday, 6);
  let carry = 0;
  if (depth > 0) {
    const prevMon = addDays(monday, -7);
    const hasPrev = evs.some(e => inRange(e, prevMon, addDays(prevMon, 6)));
    if (hasPrev) carry = Math.min(0, weekResult(evs, prevMon, settings, depth - 1).left);
  }
  const envelope = weeklyMe(settings) + carry;
  const spent = sum(evs.filter(e => inRange(e, monday, sunday)), meCost);
  return { monday, sunday, envelope, carry, spent, left: envelope - spent };
}

export function today(state, date = jktDate()) {
  const { settings } = state;
  const evs = liveEvents(state.events);
  const days = weekDays(date);
  const wk = weekResult(evs, days[0], settings);
  const spentOn = d => sum(evs.filter(e => e.date === d), meCost);
  const spentBefore = sum(evs.filter(e => e.date >= days[0] && e.date < date), meCost);
  const spentToday = spentOn(date);
  const rest = days.filter(d => d >= date);
  const wSum = sum(rest, d => weight(d, settings));
  const pool = wk.envelope - spentBefore;
  const guide = wSum > 0 ? Math.max(0, pool) * weight(date, settings) / wSum : 0;
  const future = rest.filter(d => d > date);
  const wFuture = sum(future, d => weight(d, settings));
  const poolAfterToday = Math.max(0, pool - Math.max(spentToday, guide));
  const strip = days.map(d => ({
    date: d, type: dayType(d, settings), isToday: d === date,
    spent: d > date ? 0 : spentOn(d),
    plan: d === date ? Math.round(guide)
      : d > date && wFuture > 0 ? Math.round(poolAfterToday * weight(d, settings) / wFuture) : null,
  }));
  const famWeek = sum(evs.filter(e => inRange(e, days[0], days[6])), familyCost);
  return {
    date, type: dayType(date, settings), guide: Math.round(guide),
    left: Math.round(guide - spentToday), spentToday, week: wk, strip,
    family: { week: famWeek, left: settings.familyMode === 'budget' ? settings.familyWeekly - famWeek : null },
  };
}

export function pendingPayback(state) {
  const evs = liveEvents(state.events);
  const expected = sum(evs.filter(e => e.kind === 'spend'), e => e.payback || 0);
  const received = sum(evs.filter(e => e.kind === 'payback'), e => e.amount);
  return Math.max(0, expected - received);
}

export function fund(state) {
  const evs = liveEvents(state.events);
  const balance = (state.settings.fundBase || 0) + sum(evs.filter(e => e.kind === 'sweep' || e.kind === 'fund'), e => e.amount);
  const next = MILESTONES.find(m => balance < m.amount) || MILESTONES[MILESTONES.length - 1];
  const prevAmt = MILESTONES[MILESTONES.indexOf(next) - 1]?.amount || 0;
  return { balance, next, progress: Math.min(1, (balance - prevAmt) / (next.amount - prevAmt)) };
}

export function cycle(state, date = jktDate()) {
  const { settings } = state;
  const { start, end } = payCycle(date, settings.payday);
  const evs = liveEvents(state.events).filter(e => inRange(e, start, end));
  const meSpent = sum(evs, meCost);
  const weeks = [];
  for (let m = weekStart(start); m <= end; m = addDays(m, 7)) weeks.push(weekResult(liveEvents(state.events), m, settings));
  return {
    start, end, allowance: settings.monthlyMe, meSpent, meLeft: settings.monthlyMe - meSpent,
    familySpent: sum(evs, familyCost),
    swept: sum(evs.filter(e => e.kind === 'sweep'), e => e.amount),
    funded: sum(evs.filter(e => e.kind === 'fund'), e => e.amount),
    weeks,
  };
}

// Balance check-in → expected vs actual. Expected = last check-in balance
// + inflows (top-ups, paybacks into the Daily account) − logged outflows
// (spends, sweeps) since then. Any gap becomes an 'unlogged' event.
export function reconcile(state, balance, date = jktDate(), ts = new Date().toISOString()) {
  const evs = liveEvents(state.events);
  const last = [...evs].reverse().find(e => e.kind === 'checkin');
  if (!last) return { expected: null, diff: 0 };
  const after = evs.filter(e => e.ts > last.ts && e.ts <= ts);
  const inflow = sum(after.filter(e => e.kind === 'topup' || (e.kind === 'payback' && e.toDaily)), e => e.amount);
  const outflow = sum(after.filter(e => e.kind === 'spend' || e.kind === 'sweep'), e => e.amount);
  const expected = last.balance + inflow - outflow;
  return { expected, diff: expected - balance };
}

export function parseAmount(input) {
  if (typeof input === 'number') return Math.round(input);
  let s = String(input || '').trim().toLowerCase().replace(/^rp\.?\s*/, '');
  const m = s.match(/^([\d.,]+)\s*(k|rb|ribu|jt|juta|m)?$/);
  if (!m) return NaN;
  let num = m[1];
  const unit = m[2];
  if (unit) {
    num = Number(num.replace(',', '.'));
    return Math.round(num * (unit === 'jt' || unit === 'juta' || unit === 'm' ? 1e6 : 1e3));
  }
  return Number(num.replace(/[.,]/g, ''));
}

export function rp(n, { short = false } = {}) {
  const v = Math.round(n || 0);
  const neg = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (short) {
    if (a >= 1e6) return `${neg}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}jt`;
    if (a >= 1e3) return `${neg}${Math.round(a / 1e3)}k`;
    return `${neg}${a}`;
  }
  return `${neg}Rp ${a.toLocaleString('id-ID')}`;
}

// Merge remote events/settings into local: newest updatedAt wins.
export function merge(local, remote) {
  const events = { ...(local.events || {}) };
  for (const e of remote.events || []) {
    const mine = events[e.id];
    if (!mine || (e.updatedAt || '') >= (mine.updatedAt || '')) events[e.id] = e;
  }
  let settings = local.settings;
  if (remote.settings && (remote.settings.updatedAt || '') > (settings.updatedAt || '')) settings = { ...DEFAULT_SETTINGS, ...remote.settings };
  return { ...local, events, settings };
}
