import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';

const S = { ...E.DEFAULT_SETTINGS };
const ev = (o) => ({ id: Math.random().toString(36).slice(2), ts: o.ts || `${o.date}T05:00:00.000Z`, updatedAt: '2026-10-01T00:00:00Z', ...o });
const state = (events) => ({ settings: S, events: Object.fromEntries(events.map(e => [e.id, e])) });

test('dates and day types', () => {
  assert.equal(E.isoWeekday('2026-10-26'), 1);            // Monday
  assert.equal(E.weekStart('2026-10-29'), '2026-10-26');
  assert.equal(E.dayType('2026-10-27', S), 'wfo');        // Tue
  assert.equal(E.dayType('2026-10-30', S), 'wfh');        // Fri
  assert.equal(E.dayType('2026-11-01', S), 'we');         // Sun
});

test('pay cycle 25th → 24th', () => {
  assert.deepEqual(E.payCycle('2026-10-25'), { start: '2026-10-25', end: '2026-11-24' });
  assert.deepEqual(E.payCycle('2026-11-10'), { start: '2026-10-25', end: '2026-11-24' });
  assert.deepEqual(E.payCycle('2027-01-05'), { start: '2026-12-25', end: '2027-01-24' });
});

test('weekly envelope from 3M/month ≈ 692k; WFO Monday-start guide', () => {
  assert.equal(E.weeklyMe(S), 692308);
  const t = E.today(state([]), '2026-10-26');             // Monday WFH, full week ahead
  const wSum = 0.4 + 1 + 1 + 1 + 0.4 + 0.5 + 0.5;          // 4.8
  assert.equal(t.guide, Math.round(692308 * 0.4 / wSum));
  const tue = E.today(state([]), '2026-10-27');
  assert.equal(tue.guide, Math.round(692308 * 1 / (wSum - 0.4)));
});

test('overspend shrinks the rest of the week; payback nets out', () => {
  const s = state([
    ev({ date: '2026-10-27', kind: 'spend', env: 'me', amount: 600000, payback: 450000 }),
  ]);
  const wed = E.today(s, '2026-10-28');
  assert.equal(wed.week.spent, 150000);
  const pool = 692308 - 150000;
  assert.equal(wed.guide, Math.round(pool * 1 / (1 + 1 + 0.4 + 0.5 + 0.5)));
  assert.equal(E.pendingPayback(s), 450000);
});

test('family spend never touches Me', () => {
  const s = state([ev({ date: '2026-10-31', kind: 'spend', env: 'family', amount: 800000 })]);
  const sat = E.today(s, '2026-10-31');
  assert.equal(sat.week.spent, 0);
  assert.equal(sat.family.week, 800000);
});

test('overspend carries into next week, underspend does not', () => {
  const over = state([ev({ date: '2026-10-27', kind: 'spend', env: 'me', amount: 900000 })]);
  assert.equal(E.weekResult(E.liveEvents(over.events), '2026-11-02', S).carry, 692308 - 900000);
  const under = state([ev({ date: '2026-10-27', kind: 'spend', env: 'me', amount: 100000 })]);
  assert.equal(E.weekResult(E.liveEvents(under.events), '2026-11-02', S).carry, 0);
});

test('reconcile: balance gap becomes unlogged spend', () => {
  const s = state([
    ev({ date: '2026-10-26', ts: '2026-10-26T01:00:00Z', kind: 'checkin', balance: 1000000 }),
    ev({ date: '2026-10-26', ts: '2026-10-26T02:00:00Z', kind: 'spend', env: 'me', amount: 50000 }),
    ev({ date: '2026-10-27', ts: '2026-10-27T01:00:00Z', kind: 'payback', amount: 100000, toDaily: true }),
  ]);
  const r = E.reconcile(s, 900000, '2026-10-27', '2026-10-27T10:00:00Z');
  assert.equal(r.expected, 1050000);
  assert.equal(r.diff, 150000);
});

test('fund milestones', () => {
  const s = state([ev({ date: '2026-10-26', kind: 'fund', amount: 12_500_000 })]);
  const f = E.fund(s);
  assert.equal(f.balance, 12_500_000);
  assert.equal(f.next.key, 'M1');
});

test('amount parsing', () => {
  assert.equal(E.parseAmount('144k'), 144000);
  assert.equal(E.parseAmount('1,2jt'), 1200000);
  assert.equal(E.parseAmount('Rp 1.250.000'), 1250000);
  assert.equal(E.parseAmount('35000'), 35000);
  assert.ok(Number.isNaN(E.parseAmount('abc')));
});

// ── v0.2: liquid-fund plan ──
test('planned payday sweep = base − family − drilling − leakage', () => {
  assert.equal(E.plannedSweep('2026-09-25', S), 0);                       // before the plan starts
  assert.equal(E.plannedSweep('2026-10-25', S), 15_050_000 - 2_000_000 - 870_000);
  assert.equal(E.plannedSweep('2027-01-25', S), 19_340_000 - 2_870_000);
  assert.equal(E.plannedSweep('2027-03-25', { ...S, drilling: false, leakage: 500_000 }), 21_110_000 - 2_000_000 - 500_000);
});

test('ETA: M1 62jt lands on the 25 Feb 2027 payday with the default plan', () => {
  const g = E.eta(state([]), '2026-10-01');
  assert.equal(g.key, 'M1');
  assert.equal(g.date, '2027-02-25');
  const lean = E.eta({ settings: { ...S, drilling: false, familyAssumed: 0 }, events: {} }, '2026-10-01');
  assert.equal(lean.date, '2027-01-25');
});

test('ETA: a logged payday sweep moves the start to the next cycle', () => {
  const s = state([ev({ date: '2026-10-25', kind: 'fund', amount: 30_000_000, payday: '2026-10-25', plan: 12_180_000 })]);
  const g = E.eta(s, '2026-10-26');
  assert.equal(g.balance, 30_000_000);
  assert.equal(g.date, '2027-01-25');                                      // 30 + 12.18 (Nov) + 12.18 (Dec) = 54.4 < 62; + 16.47 (Jan) ≥ 62
});

test('payday log shows plan vs actual per cycle', () => {
  const s = state([ev({ date: '2026-10-25', kind: 'fund', amount: 10_000_000, payday: '2026-10-25', plan: 12_180_000 })]);
  const log = E.paydayLog(s, '2026-11-30');
  assert.deepEqual(log.map(r => [r.cycle, r.plan, r.actual, r.logged]), [
    ['2026-10-25', 12_180_000, 10_000_000, true],
    ['2026-11-25', 12_180_000, 0, false],
  ]);
});

test('levers: drilling on pushes the date out; family needs a week of data', () => {
  const L = Object.fromEntries(E.levers(state([]), '2026-10-01').map(l => [l.key, l]));
  assert.ok(L.drilling.days > 0);
  assert.equal(L.family.days, null);
  assert.equal(L.leakage.days, 0);
});

test('sweep plan text round-trips', () => {
  const txt = E.formatSweepBase(S.sweepBase);
  assert.deepEqual(E.parseSweepBase(txt), S.sweepBase);
  assert.equal(E.parseSweepBase('nonsense'), null);
});
