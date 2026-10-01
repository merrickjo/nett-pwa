// Nett — app shell. State lives in localStorage (local-first); an optional
// Cloudflare Worker syncs it so Tesa can view the same numbers.
import * as E from './engine.js';

const VERSION = '0.1.0';
const KEY = 'nett-state-v1';
const SYNC_KEY = 'nett-sync-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ── state ────────────────────────────────────────────────────────────────
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) return { settings: { ...E.DEFAULT_SETTINGS, ...raw.settings }, events: raw.events || {}, dirty: raw.dirty || [] , settingsDirty: !!raw.settingsDirty };
  } catch { /* fall through */ }
  return { settings: { ...E.DEFAULT_SETTINGS }, events: {}, dirty: [], settingsDirty: false };
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}
function syncCfg() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null') || { url: '', key: '', role: 'owner' }; }
  catch { return { url: '', key: '', role: 'owner' }; }
}
const isViewer = () => syncCfg().role === 'viewer';

function addEvent(fields) {
  const now = new Date().toISOString();
  const e = { id: crypto.randomUUID(), ts: now, updatedAt: now, date: E.jktDate(), ...fields };
  state.events[e.id] = e;
  state.dirty.push(e.id);
  save(); render(); push();
  return e;
}
function deleteEvent(id) {
  const e = state.events[id]; if (!e) return;
  state.events[id] = { ...e, deleted: true, updatedAt: new Date().toISOString() };
  state.dirty.push(id); save(); render(); push();
}

// ── sync ─────────────────────────────────────────────────────────────────
let syncing = false;
function setStatus(t) { $('#sync-status').textContent = t; }
async function call(method, path, body) {
  const { url, key } = syncCfg();
  const res = await fetch(url.replace(/\/$/, '') + path, {
    method, headers: { 'content-type': 'application/json', 'x-app-key': key },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.json();
}
async function push() {
  const cfg = syncCfg();
  if (!cfg.url || !cfg.key || syncing) return;
  syncing = true; setStatus('Syncing');
  try {
    let remote;
    if (cfg.role === 'owner') {
      const ids = [...new Set(state.dirty)];
      remote = await call('POST', '/sync', {
        events: ids.map(id => state.events[id]).filter(Boolean),
        settings: state.settingsDirty ? state.settings : null,
      });
      state.dirty = state.dirty.filter(id => !ids.includes(id));
      state.settingsDirty = false;
    } else {
      remote = await call('GET', '/state');
    }
    state = { ...E.merge(state, remote), dirty: state.dirty, settingsDirty: state.settingsDirty };
    save(); render();
    setStatus('Synced ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }));
    $('#sync-detail').textContent = '';
  } catch (err) {
    setStatus(state.dirty.length ? `Offline · ${state.dirty.length} queued` : 'Offline');
    $('#sync-detail').textContent = 'Sync failed: ' + err.message;
  } finally { syncing = false; }
}

// ── render ───────────────────────────────────────────────────────────────
const TYPE = { wfo: 'WFO', wfh: 'WFH', we: 'Wkd' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDay = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function render() {
  document.body.classList.toggle('viewer', isViewer());
  renderToday(); renderMonth(); renderPlan();
}

function renderToday() {
  const t = E.today(state);
  $('#today-label').textContent = `Safe to spend today · ${DOW[E.isoWeekday(t.date) - 1]} · ${TYPE[t.type]}`;
  const hero = $('#today-left');
  hero.textContent = E.rp(Math.floor(t.left / 1000) * 1000); // whole thousands: easier to read at a glance
  hero.classList.toggle('neg', t.left < 0);
  $('#today-meta').textContent = t.spentToday
    ? `Guide ${E.rp(Math.floor(t.guide / 1000) * 1000)} · spent ${E.rp(t.spentToday)} today`
    : `Guide for today ${E.rp(Math.floor(t.guide / 1000) * 1000)}`;
  $('#week-strip').innerHTML = t.strip.map((d, i) => {
    const cls = d.isToday ? 'today' : (d.date < t.date ? 'past' : '');
    const v = d.date < t.date ? E.rp(d.spent, { short: true }) : d.isToday ? E.rp(t.left, { short: true }) : E.rp(d.plan, { short: true });
    return `<li class="${cls}"><span class="d">${DOW[i]}</span><span class="t">${TYPE[d.type]}</span><span class="v">${v}</span></li>`;
  }).join('');
  const w = t.week;
  $('#week-meta').textContent = `Week ${E.rp(w.spent)} of ${E.rp(w.envelope)}` + (w.carry ? ` (incl. ${E.rp(w.carry)} carried)` : '') + ` · left ${E.rp(w.left)}`;

  const s = state.settings;
  $('#family-label').textContent = `Family · ${s.familyMode === 'budget' ? 'budget' : 'observe'}`;
  $('#family-week').textContent = E.rp(t.family.week);
  $('#family-left-row').hidden = s.familyMode !== 'budget';
  if (s.familyMode === 'budget') $('#family-left').textContent = E.rp(t.family.left);
  $('#pending').textContent = E.rp(E.pendingPayback(state));

  // Sweep: on Mon–Tue, offer last week's leftover to the liquid fund.
  const evs = E.liveEvents(state.events);
  const lastMon = E.addDays(E.weekStart(t.date), -7);
  const last = E.weekResult(evs, lastMon, s);
  const swept = evs.some(e => e.kind === 'sweep' && e.week === lastMon);
  const card = $('#sweep-card');
  const hasLastWeek = evs.some(e => e.date >= lastMon && e.date <= last.sunday);
  card.hidden = !(hasLastWeek && last.left > 0 && !swept && E.isoWeekday(t.date) <= 2 && !isViewer());
  if (!card.hidden) {
    card.innerHTML = `<p class="row"><span class="ck-label">Last week left</span><span class="ck-num big">${E.rp(last.left)}</span></p>
      <button class="btn primary" id="do-sweep">Sweep to liquid fund</button>`;
    $('#do-sweep').onclick = () => addEvent({ kind: 'sweep', amount: last.left, week: lastMon, note: `Week of ${fmtDay(lastMon)}` });
  }

  const label = e => ({
    spend: `${e.env === 'family' ? 'Family' : 'Me'} · ${e.note || 'spend'}${e.payback ? ` (−${E.rp(e.payback, { short: true })} back)` : ''}`,
    unlogged: 'Me · unlogged (balance check)', checkin: `Balance check ${E.rp(e.balance)}`,
    topup: 'Top-up', payback: `Payback${e.note ? ' · ' + e.note : ''}${e.toDaily ? '' : ' (other acct)'}`,
    sweep: `Swept to fund · ${e.note || ''}`, fund: `Fund deposit${e.note ? ' · ' + e.note : ''}`, unlogged_in: 'Unexplained inflow',
  })[e.kind] || e.kind;
  const sign = e => (['topup', 'payback', 'unlogged_in'].includes(e.kind) ? '+' : ['sweep', 'fund'].includes(e.kind) ? '→ ' : '−');
  $('#recent').innerHTML = [...evs].reverse().slice(0, 12).map(e => `
    <li><span class="when">${fmtDay(e.date)}</span><span class="what">${esc(label(e))}</span>
    <span class="amt">${e.kind === 'checkin' ? '' : sign(e) + E.rp(e.amount, { short: true })}</span>
    ${isViewer() ? '' : `<button class="del" data-del="${e.id}" aria-label="Delete">×</button>`}</li>`).join('')
    || '<li><span class="what meta">Nothing logged yet. Start with a balance check.</span></li>';
}

function renderMonth() {
  const c = E.cycle(state);
  $('#cycle-label').textContent = `${fmtDay(c.start)} – ${fmtDay(c.end)}`;
  const used = Math.max(0, Math.min(1, c.meSpent / (c.allowance || 1)));
  const r = 48, C = 2 * Math.PI * r;
  $('#donut').innerHTML = `
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#DBDBDB" stroke-width="16"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#000" stroke-width="16"
      stroke-dasharray="${(used * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 60 60)"/>`;
  $('#me-left').textContent = E.rp(c.meLeft);
  $('#me-allow').textContent = E.rp(c.allowance);
  $('#me-spent').textContent = E.rp(c.meSpent);
  $('#fam-spent').textContent = E.rp(c.familySpent);
  $('#swept').textContent = E.rp(c.swept);
  const f = E.fund(state);
  $('#fund-balance').textContent = E.rp(f.balance);
  $('#fund-bar').style.width = (f.progress * 100).toFixed(1) + '%';
  $('#fund-meta').textContent = f.balance >= E.MILESTONES[2].amount
    ? 'All three milestones reached'
    : `${f.next.key} · ${f.next.label} of baseline = ${E.rp(f.next.amount)} · ${E.rp(f.next.amount - f.balance)} to go`;
  $('#weeks').innerHTML = '<tr><th>Week</th><th>Budget</th><th>Spent</th><th>Left</th></tr>' +
    c.weeks.map(w => `<tr><td>${fmtDay(w.monday)}</td><td>${E.rp(w.envelope, { short: true })}</td><td>${E.rp(w.spent, { short: true })}</td><td>${E.rp(w.left, { short: true })}</td></tr>`).join('');
}

function renderPlan() {
  const s = state.settings, f = $('#plan-form');
  if (document.activeElement && f.contains(document.activeElement)) return; // don't clobber typing
  f.monthlyMe.value = s.monthlyMe.toLocaleString('id-ID');
  f.w_wfo.value = s.weights.wfo; f.w_wfh.value = s.weights.wfh; f.w_we.value = s.weights.we;
  f.payday.value = s.payday;
  $$('input[name=familyMode]', f).forEach(i => (i.checked = i.value === s.familyMode));
  f.familyWeekly.value = (s.familyWeekly || 0).toLocaleString('id-ID');
  f.fundBase.value = (s.fundBase || 0).toLocaleString('id-ID');
  $('#weekly-preview').textContent = `= ${E.rp(E.weeklyMe(s))} a week, topped up every Monday`;
  $('#wfo-days').innerHTML = [1, 2, 3, 4, 5].map(d =>
    `<label><input type="checkbox" value="${d}" ${s.wfoDays.includes(d) ? 'checked' : ''}>${DOW[d - 1]}</label>`).join('');
  const sc = syncCfg(), sf = $('#sync-form');
  if (!sf.contains(document.activeElement)) {
    sf.url.value = sc.url; sf.key.value = sc.key;
    $$('input[name=role]', sf).forEach(i => (i.checked = i.value === sc.role));
  }
  $('#version').textContent = `Nett ${VERSION}`;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── sheets ───────────────────────────────────────────────────────────────
const amountField = (name, label, value = '') =>
  `<label>${label}<input name="${name}" inputmode="decimal" autocomplete="off" value="${value}" placeholder="e.g. 45k, 1,2jt"></label>`;
const SHEETS = {
  checkin: {
    label: 'Daily account', title: 'Check balance',
    body: () => amountField('balance', 'Balance in the Daily account now'),
    hint: () => 'Open myBCA, read the stand-by account balance, type it here. Anything not logged becomes "unlogged" Me spend.',
    save: f => {
      const balance = E.parseAmount(f.balance.value);
      if (!Number.isFinite(balance)) return 'Enter the balance';
      const r = E.reconcile(state, balance);
      if (r.diff > 0) addEvent({ kind: 'unlogged', amount: r.diff, auto: true });
      if (r.diff < 0) addEvent({ kind: 'unlogged_in', amount: -r.diff, auto: true });
      addEvent({ kind: 'checkin', balance, amount: 0 });
    },
  },
  spend: {
    label: 'Log', title: 'Spend',
    body: () => amountField('amount', 'Amount paid') +
      `<div class="seg"><label><input type="radio" name="env" value="me" checked>Me</label><label><input type="radio" name="env" value="family">Family</label></div>` +
      `<label>What <input name="note" autocomplete="off" placeholder="lunch, coffee, ice cream…"></label>` +
      amountField('payback', 'Expected payback (group meal, badminton) — optional'),
    hint: () => 'Group meal: enter what you paid and what friends will send back. Only your share counts.',
    save: f => {
      const amount = E.parseAmount(f.amount.value);
      if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount';
      const payback = f.payback.value ? E.parseAmount(f.payback.value) : 0;
      if (!Number.isFinite(payback) || payback < 0 || payback > amount) return 'Payback must be between 0 and the amount';
      addEvent({ kind: 'spend', amount, env: f.env.value, note: f.note.value.trim(), payback });
    },
  },
  payback: {
    label: 'Received', title: 'Payback',
    body: () => amountField('amount', 'Amount received') +
      `<label>From <input name="note" autocomplete="off" placeholder="Colin, badminton…"></label>` +
      `<div class="seg"><label><input type="radio" name="dest" value="daily" checked>Into Daily acct</label><label><input type="radio" name="dest" value="other">Other account</label></div>`,
    hint: () => 'Settles pending paybacks. It does not add to your allowance — your share was already netted.',
    save: f => {
      const amount = E.parseAmount(f.amount.value);
      if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount';
      addEvent({ kind: 'payback', amount, note: f.note.value.trim(), toDaily: f.dest.value === 'daily' });
    },
  },
  topup: {
    label: 'Monday', title: 'Top-up',
    body: () => amountField('amount', 'Transferred into the Daily account', E.weeklyMe(state.settings).toLocaleString('id-ID')),
    hint: () => 'Log the weekly myBCA scheduled transfer (or any extra top-up) so balance checks stay accurate.',
    save: f => {
      const amount = E.parseAmount(f.amount.value);
      if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount';
      addEvent({ kind: 'topup', amount });
    },
  },
  fund: {
    label: 'Liquid fund', title: 'Fund deposit',
    body: () => amountField('amount', 'Deposited into the liquid fund') + `<label>Note <input name="note" autocomplete="off" placeholder="payday transfer, bonus…"></label>`,
    hint: () => 'Payday transfers, bonuses, item sales. Weekly sweeps are added automatically.',
    save: f => {
      const amount = E.parseAmount(f.amount.value);
      if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount';
      addEvent({ kind: 'fund', amount, note: f.note.value.trim() });
    },
  },
};
let openSheet = null;
function showSheet(name) {
  const s = SHEETS[name]; openSheet = s;
  $('#sheet-label').textContent = s.label; $('#sheet-title').textContent = s.title;
  $('#sheet-body').innerHTML = s.body(); $('#sheet-hint').textContent = s.hint();
  $('#sheet').hidden = false;
  $('#sheet-body input')?.focus();
}
function closeSheet() { $('#sheet').hidden = true; openSheet = null; }

// ── wiring ───────────────────────────────────────────────────────────────
function showView(v) {
  $$('.view').forEach(s => (s.hidden = s.id !== 'view-' + v));
  $$('.gn-item').forEach(b => (b.dataset.gn === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-gn],[data-sheet],[data-del]');
  if (!t) return;
  if (t.dataset.gn) showView(t.dataset.gn);
  if (t.dataset.sheet && !isViewer()) showSheet(t.dataset.sheet);
  if (t.dataset.del && confirmDelete(t.dataset.del)) deleteEvent(t.dataset.del);
});
let pendingDelete = null;
function confirmDelete(id) {          // two taps instead of a blocking dialog
  if (pendingDelete === id) { pendingDelete = null; return true; }
  pendingDelete = id;
  const b = $(`[data-del="${id}"]`); if (b) b.textContent = 'Delete?';
  setTimeout(() => { if (pendingDelete === id) { pendingDelete = null; render(); } }, 3000);
  return false;
}
$('#sheet-cancel').onclick = closeSheet;
$('#sheet-form').onsubmit = e => {
  e.preventDefault();
  const err = openSheet?.save(e.target);
  if (err) { $('#sheet-hint').textContent = err; return; }
  closeSheet();
};
$('#plan-form').onsubmit = e => {
  e.preventDefault();
  const f = e.target, num = v => E.parseAmount(v), w = v => Number(String(v).replace(',', '.'));
  const next = {
    ...state.settings,
    monthlyMe: num(f.monthlyMe.value),
    weights: { wfo: w(f.w_wfo.value), wfh: w(f.w_wfh.value), we: w(f.w_we.value) },
    wfoDays: $$('#wfo-days input:checked').map(i => Number(i.value)),
    payday: Math.min(28, Math.max(1, Number(f.payday.value) || 25)),
    familyMode: f.familyMode.value, familyWeekly: num(f.familyWeekly.value) || 0,
    fundBase: num(f.fundBase.value) || 0, updatedAt: new Date().toISOString(),
  };
  if (!Number.isFinite(next.monthlyMe) || Object.values(next.weights).some(x => !(x >= 0))) return;
  state.settings = next; state.settingsDirty = true; save();
  document.activeElement?.blur(); render(); push(); showView('today');
};
$('#sync-form').onsubmit = e => {
  e.preventDefault();
  const f = e.target;
  localStorage.setItem(SYNC_KEY, JSON.stringify({ url: f.url.value.trim(), key: f.key.value.trim(), role: f.role.value || 'owner' }));
  if (f.role.value === 'owner') { state.dirty = Object.keys(state.events); state.settingsDirty = true; save(); }
  document.activeElement?.blur(); render(); push();
};
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify({ settings: state.settings, events: state.events }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `nett-${E.jktDate()}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$('#import').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    state = { ...E.merge(state, { events: Object.values(data.events || {}), settings: data.settings }), dirty: Object.keys(data.events || {}), settingsDirty: true };
    save(); render(); push();
  } catch { alertless('Import failed: not a Nett export'); }
};
function alertless(msg) { $('#sync-detail').textContent = msg; }

document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); push(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render(); push();
