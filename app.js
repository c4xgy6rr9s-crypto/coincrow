'use strict';

/* ===== CoinCrow — personal budget tracker (static PWA) ===== */

const STORAGE_KEY = 'coincrow.v1';
const FX_URL = 'https://api.frankfurter.dev/v1/latest?from=USD&to=GBP';
const DEFAULT_CAT_EMOJI = {
  Groceries: '🛒', 'Eating out': '🍽️', Transport: '🚌', Bills: '🧾',
  Shopping: '🛍️', Fun: '🎉', Other: '📦',
};

const ACCOUNT_COLORS = ['#e9c46a', '#5b8cff', '#57c98a', '#e8615f', '#c78bff', '#4ec5d6', '#f29e4c'];

const DEFAULT_STATE = () => ({
  transactions: [],
  trips: [], // { id, name, budgetGbp, startISO, endISO }
  accounts: [
    { name: 'Current account', currency: 'GBP', color: '#e9c46a' },
    { name: 'Credit card', currency: 'GBP', color: '#5b8cff' },
    { name: 'Savings', currency: 'GBP', color: '#57c98a' },
  ],
  categories: [
    { name: 'Groceries', monthlyBudgetGbp: 300, emoji: '🛒' },
    { name: 'Eating out', monthlyBudgetGbp: 120, emoji: '🍽️' },
    { name: 'Transport', monthlyBudgetGbp: 100, emoji: '🚌' },
    { name: 'Bills', monthlyBudgetGbp: 600, emoji: '🧾' },
    { name: 'Shopping', monthlyBudgetGbp: 150, emoji: '🛍️' },
    { name: 'Fun', monthlyBudgetGbp: 120, emoji: '🎉' },
    { name: 'Travel', monthlyBudgetGbp: 0, emoji: '✈️', tripBased: true },
    { name: 'Other', monthlyBudgetGbp: 80, emoji: '📦' },
  ],
  settings: {
    monthStartDay: 1,
    baseCurrency: 'GBP',
    lastFxRate: null, // { rate, fetchedAtISO }
    rollover: false,  // carry each category's leftover/overspend into the next month
    txnSort: 'txn',   // 'txn' = by transaction date, 'entered' = by date entered
  },
});

/* ---------- storage ---------- */
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE();
    const parsed = JSON.parse(raw);
    const base = DEFAULT_STATE();
    return {
      transactions: migrateTransactions(parsed.transactions) || base.transactions,
      trips: Array.isArray(parsed.trips) ? parsed.trips : base.trips,
      accounts: migrateAccounts(parsed.accounts) || base.accounts,
      categories: migrateCategories(parsed.categories) || base.categories,
      settings: Object.assign(base.settings, parsed.settings || {}),
    };
  } catch (e) {
    console.error('[coincrow] load failed, using defaults', e);
    return DEFAULT_STATE();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// accept legacy string accounts or {name,currency,color}; normalise to objects
function migrateAccounts(accts) {
  if (!Array.isArray(accts) || !accts.length) return null;
  return accts.map((a, i) => {
    if (typeof a === 'string') return { name: a, currency: 'GBP', color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] };
    return {
      name: a.name || 'Account',
      currency: a.currency === 'USD' ? 'USD' : 'GBP',
      color: a.color || ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
    };
  });
}
function accountByName(name) { return state.accounts.find((a) => a.name === name); }
function accountColor(name) { const a = accountByName(name); return a ? a.color : '#888888'; }

// add emoji + tripBased flag to legacy categories; ensure a trip-based Travel exists
function migrateCategories(cats) {
  if (!Array.isArray(cats) || !cats.length) return null;
  const out = cats.map((c) => ({
    name: c.name,
    monthlyBudgetGbp: c.monthlyBudgetGbp || 0,
    emoji: c.emoji || DEFAULT_CAT_EMOJI[c.name] || '🏷️',
    tripBased: !!c.tripBased,
  }));
  if (!out.some((c) => c.tripBased)) {
    out.push({ name: 'Travel', monthlyBudgetGbp: 0, emoji: '✈️', tripBased: true });
  }
  return out;
}
function categoryByName(name) { return state.categories.find((c) => c.name === name); }
function categoryEmoji(name) { const c = categoryByName(name); return c && c.emoji ? c.emoji : '🏷️'; }
function isTripCategory(name) { const c = categoryByName(name); return !!(c && c.tripBased); }

/* ---------- trips ---------- */
function tripById(id) { return state.trips.find((t) => t.id === id); }
function tripName(id) { const t = tripById(id); return t ? t.name : ''; }
function tripSpent(id) {
  return round2(state.transactions
    .filter((t) => t.tripId === id)
    .reduce((s, t) => s + t.gbpAmount, 0));
}
// trip whose [startISO,endISO] contains the given date (for auto-select)
function tripForDate(dateISO) {
  return state.trips.find((t) => t.startISO && t.endISO && dateISO >= t.startISO && dateISO <= t.endISO);
}

// ensure every transaction has a createdAt so "date entered" sorting is stable
// (legacy rows fall back to midday on their transaction date)
function migrateTransactions(txns) {
  if (!Array.isArray(txns)) return null;
  return txns.map((t) => (t.createdAt ? t : { ...t, createdAt: `${t.dateISO}T12:00:00` }));
}

// hex (#rrggbb) -> rgba string with given alpha
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(136,136,136,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const gbp = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const todayISO = () => toISODate(new Date());

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const DAY_MS = 86400000;
const dayDiff = (a, b) => Math.round((stripTime(b) - stripTime(a)) / DAY_MS);
function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/* ---------- budget periods (honour monthStartDay) ---------- */
function periodForDate(date) {
  const startDay = clamp(state.settings.monthStartDay || 1, 1, 28);
  let y = date.getFullYear();
  let m = date.getMonth();
  if (date.getDate() < startDay) m -= 1; // belongs to previous period
  const start = new Date(y, m, startDay);
  const end = new Date(y, m + 1, startDay); // exclusive
  return makePeriod(start, end);
}
function makePeriod(start, end) {
  return {
    start,
    end,
    key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    shortLabel: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    days: Math.max(1, dayDiff(start, end)),
  };
}
function periodByOffset(offset) {
  const base = periodForDate(new Date());
  const start = new Date(base.start.getFullYear(), base.start.getMonth() + offset, base.start.getDate());
  const end = new Date(base.start.getFullYear(), base.start.getMonth() + offset + 1, base.start.getDate());
  return makePeriod(start, end);
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function txnsInPeriod(period) {
  return state.transactions.filter((t) => {
    const d = parseISO(t.dateISO);
    return d >= period.start && d < period.end;
  });
}
// fraction of the period elapsed as of today (0..1)
function periodElapsedFraction(period) {
  const now = new Date();
  if (now >= period.end) return 1;
  if (now < period.start) return 0;
  return clamp(dayDiff(period.start, now) / period.days, 0, 1);
}

// start of the budget period containing the earliest transaction (null if none)
function earliestPeriodStart() {
  if (!state.transactions.length) return null;
  const min = state.transactions.reduce((m, t) => (t.dateISO < m ? t.dateISO : m), state.transactions[0].dateISO);
  return periodForDate(parseISO(min)).start;
}

// cumulative leftover (budget − spent) for a category across every completed period
// from the first month of activity up to (not including) the displayed period.
// Positive = saved/rolls forward; negative = overspend carried as debt.
function carryInFor(catName, periodStart, baseBudget) {
  if (!state.settings.rollover || baseBudget <= 0) return 0;
  const start = earliestPeriodStart();
  if (!start) return 0;
  let carry = 0, guard = 0;
  let cur = new Date(start);
  while (cur < periodStart && guard++ < 120) {
    const p = periodForDate(cur);
    const spent = txnsInPeriod(p)
      .filter((t) => t.category === catName)
      .reduce((s, t) => s + t.gbpAmount, 0);
    carry += baseBudget - spent;
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
  }
  return round2(carry);
}

/* ---------- FX ---------- */
async function fetchLiveRate() {
  const res = await fetch(FX_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('FX HTTP ' + res.status);
  const data = await res.json();
  const rate = data && data.rates && data.rates.GBP;
  if (!rate) throw new Error('FX rate missing');
  state.settings.lastFxRate = { rate, fetchedAtISO: new Date().toISOString() };
  saveState();
  return state.settings.lastFxRate;
}
// returns { rate, fetchedAtISO, live:boolean }
async function getUsdRate() {
  try {
    const r = await fetchLiveRate();
    return { ...r, live: true };
  } catch (e) {
    if (state.settings.lastFxRate) return { ...state.settings.lastFxRate, live: false };
    throw e;
  }
}

/* ===========================================================
   NAVIGATION
   =========================================================== */
function goScreen(name) {
  $$('.screen').forEach((s) => (s.hidden = s.dataset.screen !== name));
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.go === name));
  if (name === 'dash') { dashOffset = 0; renderDashboard(); }
  if (name === 'trends') renderTrends();
  if (name === 'trips') renderTrips();
  if (name === 'settings') renderSettings();
  if (name === 'add') renderRecent();
  window.scrollTo(0, 0);
}
$$('.tab').forEach((t) => t.addEventListener('click', () => goScreen(t.dataset.go)));

/* ===========================================================
   ADD TRANSACTION
   =========================================================== */
let selectedCcy = 'GBP';
let selectedDir = 'out'; // 'out' = spend (positive), 'in' = refund/money in (negative)

function fillSelect(sel, items, current) {
  sel.innerHTML = '';
  items.forEach((v) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (v === current) o.selected = true;
    sel.appendChild(o);
  });
}

function setAddCcy(ccy) {
  selectedCcy = ccy;
  $$('#addForm .ccy-btn').forEach((x) => x.classList.toggle('is-active', x.dataset.ccy === ccy));
  updateFxNote();
}

function initAddForm() {
  fillSelect($('#accountSelect'), state.accounts.map((a) => a.name));
  fillSelect($('#categorySelect'), state.categories.map((c) => c.name));
  $('#dateInput').value = todayISO();

  $$('#addForm .ccy-btn').forEach((b) =>
    b.addEventListener('click', () => setAddCcy(b.dataset.ccy)));
  $$('#addForm .dir-btn').forEach((b) =>
    b.addEventListener('click', () => {
      selectedDir = b.dataset.dir;
      $$('#addForm .dir-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      updateFxNote();
    })
  );
  // default the currency from the chosen account (still overridable)
  $('#accountSelect').addEventListener('change', () => {
    const a = accountByName($('#accountSelect').value);
    if (a) setAddCcy(a.currency);
  });
  // show the trip picker when a trip-based category is chosen
  $('#categorySelect').addEventListener('change', updateAddTripField);
  $('#dateInput').addEventListener('change', () => { if (isTripCategory($('#categorySelect').value)) autoSelectTrip($('#tripSelect')); });

  $('#amountInput').addEventListener('input', updateFxNote);
  $('#addForm').addEventListener('submit', onAddSubmit);
  initEditModal();
  // seed currency from the first account
  const first = state.accounts[0];
  if (first) setAddCcy(first.currency);
  updateAddTripField();
}

// fill a trip <select>; returns whether any trips exist
function fillTripSelect(sel, currentId) {
  sel.innerHTML = '';
  state.trips.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    if (t.id === currentId) o.selected = true;
    sel.appendChild(o);
  });
  return state.trips.length > 0;
}
// pick the trip whose dates contain the add-form date
function autoSelectTrip(sel) {
  const trip = tripForDate($('#dateInput').value);
  if (trip) sel.value = trip.id;
}
function updateAddTripField() {
  const show = isTripCategory($('#categorySelect').value);
  $('#addTripField').hidden = !show;
  if (!show) return;
  const has = fillTripSelect($('#tripSelect'));
  $('#addTripHint').hidden = has;
  $('#tripSelect').hidden = !has;
  if (has) autoSelectTrip($('#tripSelect'));
}

async function updateFxNote() {
  const note = $('#fxNote');
  if (selectedCcy !== 'USD') { note.hidden = true; return; }
  const raw = parseFloat($('#amountInput').value);
  const amt = isFinite(raw) ? Math.abs(raw) * (selectedDir === 'in' ? -1 : 1) : NaN;
  note.hidden = false;
  note.textContent = 'Fetching live USD→GBP rate…';
  try {
    const r = await getUsdRate();
    const conv = isFinite(amt) ? ` ≈ ${gbp(round2(amt * r.rate))}` : '';
    note.textContent = `1 USD = ${r.rate.toFixed(4)} GBP${conv}` +
      (r.live ? '' : ` · cached ${new Date(r.fetchedAtISO).toLocaleDateString('en-GB')}`);
    note.classList.toggle('is-stale', !r.live);
  } catch (e) {
    note.textContent = 'No rate available — set one in Settings.';
    note.classList.add('is-stale');
  }
}

async function onAddSubmit(ev) {
  ev.preventDefault();
  const raw = parseFloat($('#amountInput').value);
  if (!isFinite(raw) || raw === 0) return;
  const amount = round2(Math.abs(raw)) * (selectedDir === 'in' ? -1 : 1);

  const btn = $('#saveBtn');
  btn.disabled = true;

  let gbpAmount = amount;
  let fxRate = null;
  if (selectedCcy === 'USD') {
    try {
      const r = await getUsdRate();
      fxRate = r.rate;
      gbpAmount = round2(amount * r.rate);
    } catch (e) {
      btn.disabled = false;
      flashSave('No USD rate — set one in Settings first.', true);
      return;
    }
  }

  const txn = {
    id: uid(),
    createdAt: new Date().toISOString(),
    dateISO: $('#dateInput').value || todayISO(),
    amount,
    currency: selectedCcy,
    gbpAmount,
    fxRate,
    account: $('#accountSelect').value,
    category: $('#categorySelect').value,
    tripId: isTripCategory($('#categorySelect').value) ? ($('#tripSelect').value || null) : null,
    note: $('#noteInput').value.trim(),
    pending: $('#pendingInput').checked,
  };
  state.transactions.push(txn);
  saveState();

  // reset for next quick entry
  $('#amountInput').value = '';
  $('#noteInput').value = '';
  $('#pendingInput').checked = false;
  $('#fxNote').hidden = true;
  selectedDir = 'out';
  $$('#addForm .dir-btn').forEach((x) => x.classList.toggle('is-active', x.dataset.dir === 'out'));
  btn.disabled = false;
  flashSave(`${gbpAmount < 0 ? 'Logged' : 'Added'} ${gbp(gbpAmount)} · ${txn.category}`);
  rerenderAll();
}

function flashSave(msg, isError) {
  const el = $('#saveFlash');
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  clearTimeout(flashSave._t);
  flashSave._t = setTimeout(() => { el.hidden = true; }, 2600);
}

const enteredKey = (t) => t.createdAt || t.id;
// sort newest-first by the chosen key
function sortTxns(list) {
  if (state.settings.txnSort === 'entered') {
    return [...list].sort((a, b) => enteredKey(b).localeCompare(enteredKey(a)));
  }
  return [...list].sort((a, b) =>
    b.dateISO.localeCompare(a.dateISO) || enteredKey(b).localeCompare(enteredKey(a)));
}

function renderRecent() {
  const list = $('#recentList');
  const sortSel = $('#recentSort');
  if (sortSel) sortSel.value = state.settings.txnSort;
  const recent = sortTxns(state.transactions).slice(0, 12);
  $('#recentCount').textContent = state.transactions.length + ' total';
  if (!recent.length) { list.innerHTML = '<li class="empty">No charges yet — add one above.</li>'; return; }
  list.innerHTML = '';
  recent.forEach((t) => list.appendChild(txnRow(t)));
}

function txnRow(t) {
  const li = document.createElement('li');
  li.className = 'txn clickable' + (t.gbpAmount < 0 ? ' txn-credit' : '');
  const color = accountColor(t.account);
  li.style.background = hexToRgba(color, 0.22);
  li.style.borderLeft = `4px solid ${color}`;
  const orig = t.currency === 'USD'
    ? `<span class="txn-orig">$${Math.abs(t.amount).toFixed(2)} → </span>` : '';
  const title = (t.note && t.note.trim()) ? t.note.trim() : t.category;
  li.innerHTML = `
    <span class="txn-emoji" title="${escapeHtml(t.category)}">${categoryEmoji(t.category)}</span>
    <div class="txn-main">
      <span class="txn-cat">${escapeHtml(title)}${t.pending ? ' <em class="pending-tag">pending</em>' : ''}</span>
      <span class="txn-sub">${parseISO(t.dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    </div>
    <div class="txn-amt">${orig}${gbp(t.gbpAmount)}</div>
    <span class="txn-chev" aria-hidden="true">›</span>`;
  li.addEventListener('click', () => openEdit(t.id));
  return li;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===========================================================
   DASHBOARD (prorated pacing)
   =========================================================== */
let dashOffset = 0;

$('#prevMonth').addEventListener('click', () => { dashOffset -= 1; renderDashboard(); });
$('#nextMonth').addEventListener('click', () => { if (dashOffset < 0) { dashOffset += 1; renderDashboard(); } });

function renderDashboard() {
  const period = periodByOffset(dashOffset);
  const frac = periodElapsedFraction(period);
  // trip-based categories (Travel) are tracked under Trips, not the monthly budget
  const txns = txnsInPeriod(period).filter((t) => !isTripCategory(t.category));

  $('#dashMonthLabel').textContent = period.label;
  $('#monthPill').textContent = periodByOffset(0).label;
  $('#nextMonth').disabled = dashOffset >= 0;

  const spentByCat = {};
  const txnsByCat = {};
  txns.forEach((t) => {
    spentByCat[t.category] = (spentByCat[t.category] || 0) + t.gbpAmount;
    (txnsByCat[t.category] = txnsByCat[t.category] || []).push(t);
  });

  let totSpent = 0, totBudget = 0, totExpected = 0;
  const rows = state.categories.filter((c) => !c.tripBased).map((c) => {
    const spent = round2(spentByCat[c.name] || 0);
    const base = c.monthlyBudgetGbp || 0;
    const carry = carryInFor(c.name, period.start, base);
    const budget = round2(base + carry); // effective budget incl. rollover
    const expected = round2(budget * frac);
    totSpent += spent; totBudget += budget; totExpected += expected;
    return { name: c.name, spent, budget, expected, carry };
  });
  // categories with spend but no budget config
  Object.keys(spentByCat).forEach((name) => {
    if (!rows.some((r) => r.name === name)) {
      const spent = round2(spentByCat[name]);
      totSpent += spent;
      rows.push({ name, spent, budget: 0, expected: 0, carry: 0 });
    }
  });

  totSpent = round2(totSpent);
  $('#sumSpent').textContent = gbp(totSpent);
  $('#sumBudget').textContent = gbp(totBudget);
  $('#sumExpected').textContent = gbp(round2(totExpected));
  $('#sumRemaining').textContent = gbp(round2(totBudget - totSpent));

  const banner = $('#paceBanner');
  const pace = paceStatus(totSpent, totExpected, totBudget);
  banner.className = 'pace-banner pace-' + pace.level;
  banner.textContent = pace.label + (dashOffset === 0 ? ` · ${Math.round(frac * 100)}% through period` : '');

  const wrap = $('#catCards');
  wrap.innerHTML = '';
  // keep configured budget order (no-budget extras already appended at the end)
  rows.forEach((r) => wrap.appendChild(catCard(r, frac, txnsByCat[r.name] || [])));
}

function paceStatus(spent, expected, budget) {
  if (budget > 0 && spent > budget) return { level: 'over', label: '🚨 Over budget' };
  if (spent > expected * 1.05 && expected > 0) return { level: 'over', label: '🚨 Over pace' };
  if (spent > expected * 0.9 && expected > 0) return { level: 'warn', label: '⚠️ Near pace' };
  return { level: 'ok', label: '✅ On track' };
}

function catCard(r, frac, txns) {
  const div = document.createElement('div');
  div.className = 'card cat-card';
  const pct = r.budget > 0 ? clamp((r.spent / r.budget) * 100, 0, 100) : (r.spent > 0 ? 100 : 0);
  const markerPct = clamp(frac * 100, 0, 100);
  const pace = paceStatus(r.spent, r.expected, r.budget);
  const noBudget = r.budget <= 0;
  const remaining = round2(r.budget - r.spent);
  const count = txns.length;
  div.innerHTML = `
    <div class="cat-head clickable">
      <span class="cat-name">${categoryEmoji(r.name)} ${escapeHtml(r.name)} ${count ? `<span class="cat-count">${count}</span>` : ''}</span>
      <span class="cat-figs">${gbp(r.spent)} ${noBudget ? '' : '/ ' + gbp(r.budget)}</span>
    </div>
    <div class="bar">
      <div class="bar-fill pace-${pace.level}" style="width:${pct}%"></div>
      ${noBudget ? '' : `<div class="bar-marker" style="left:${markerPct}%" title="Expected by now"></div>`}
    </div>
    <div class="cat-foot">
      <span class="badge badge-${pace.level}">${pace.label}</span>
      ${noBudget ? '<span class="muted small">no budget set</span>'
        : `<span class="muted small">${remaining >= 0 ? `${gbp(remaining)} left` : `${gbp(-remaining)} over`}${r.carry ? ` · incl. ${r.carry > 0 ? '+' : ''}${gbp(r.carry)} rolled over` : ''}</span>`}
    </div>
    <ul class="txn-list cat-txns" hidden></ul>`;
  if (count) {
    const head = div.querySelector('.cat-head');
    const sub = div.querySelector('.cat-txns');
    head.addEventListener('click', () => {
      if (sub.hidden) {
        sub.innerHTML = '';
        sortTxns(txns).forEach((t) => sub.appendChild(txnRow(t)));
      }
      sub.hidden = !sub.hidden;
      div.classList.toggle('expanded', !sub.hidden);
    });
  }
  return div;
}

/* ===========================================================
   TRENDS (hand-rolled inline SVG, no external libs)
   =========================================================== */
$('#trendRange').addEventListener('change', renderTrends);
$('#trendCategory').addEventListener('change', renderTrends);

function renderTrends() {
  const n = parseInt($('#trendRange').value, 10) || 12;
  const periods = [];
  for (let i = n - 1; i >= 0; i--) periods.push(periodByOffset(-i));

  // total per period (excludes Travel / trip-based categories — those live under Trips)
  const monthTxns = (p) => txnsInPeriod(p).filter((t) => !isTripCategory(t.category));
  const totals = periods.map((p) => round2(monthTxns(p).reduce((s, t) => s + t.gbpAmount, 0)));
  $('#trendTotalChart').innerHTML = barChart(periods.map((p) => p.shortLabel), totals, null);

  // category dropdown (trip-based categories excluded)
  const catSel = $('#trendCategory');
  if (!catSel.dataset.ready) {
    fillSelect(catSel, state.categories.filter((c) => !c.tripBased).map((c) => c.name));
    catSel.dataset.ready = '1';
  }
  const cat = catSel.value || (state.categories[0] && state.categories[0].name);
  const catBudget = (state.categories.find((c) => c.name === cat) || {}).monthlyBudgetGbp || 0;
  const catVals = periods.map((p) =>
    round2(txnsInPeriod(p).filter((t) => t.category === cat).reduce((s, t) => s + t.gbpAmount, 0)));
  $('#trendCatChart').innerHTML = barChart(periods.map((p) => p.shortLabel), catVals, catBudget || null);
}

function barChart(labels, values, refLine) {
  const W = 640, H = 240, padL = 44, padB = 28, padT = 12, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(refLine || 0, ...values, 1);
  const niceMax = niceCeil(maxV);
  const n = values.length;
  const slot = plotW / n;
  const bw = Math.min(36, slot * 0.62);
  const yOf = (v) => padT + plotH - (v / niceMax) * plotH;

  let bars = '', xlabels = '';
  values.forEach((v, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const y = yOf(v);
    const h = padT + plotH - y;
    const over = refLine && v > refLine;
    bars += `<rect class="cc-bar ${over ? 'cc-bar-over' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3">
      <title>${labels[i]}: ${gbp(v)}</title></rect>`;
    if (v > 0) bars += `<text class="cc-val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}">${Math.round(v)}</text>`;
    xlabels += `<text class="cc-xlab" x="${(padL + slot * i + slot / 2).toFixed(1)}" y="${H - 8}">${labels[i]}</text>`;
  });

  // y axis gridlines (0, mid, max)
  let grid = '';
  [0, 0.5, 1].forEach((f) => {
    const val = niceMax * f;
    const y = yOf(val);
    grid += `<line class="cc-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />
      <text class="cc-ylab" x="${padL - 6}" y="${(y + 3).toFixed(1)}">${Math.round(val)}</text>`;
  });

  let ref = '';
  if (refLine) {
    const y = yOf(refLine);
    ref = `<line class="cc-ref" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" />
      <text class="cc-reflab" x="${W - padR}" y="${(y - 4).toFixed(1)}">budget ${gbp(refLine)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="cc-chart" preserveAspectRatio="xMidYMid meet" role="img">
    ${grid}${bars}${ref}${xlabels}</svg>`;
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* ===========================================================
   TRIPS
   =========================================================== */
let editingTripId = null;

function tripStatus(trip) {
  const today = todayISO();
  if (trip.startISO && today < trip.startISO) return 'upcoming';
  if (trip.endISO && today > trip.endISO) return 'past';
  return 'ongoing';
}
function tripDateLabel(trip) {
  const fmt = (iso) => iso ? parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  if (!trip.startISO && !trip.endISO) return 'no dates';
  return `${fmt(trip.startISO)} → ${fmt(trip.endISO)}`;
}

function renderTrips() {
  const wrap = $('#tripCards');
  wrap.innerHTML = '';
  if (!state.trips.length) {
    wrap.innerHTML = '<div class="card"><p class="muted" style="margin:0">No trips yet. Add one below, then pick it when you log a Travel transaction.</p></div>';
    return;
  }
  const rank = { ongoing: 0, upcoming: 1, past: 2 };
  const sorted = [...state.trips].sort((a, b) => {
    const ra = rank[tripStatus(a)], rb = rank[tripStatus(b)];
    if (ra !== rb) return ra - rb;
    return (a.startISO || '').localeCompare(b.startISO || '');
  });
  sorted.forEach((trip) => wrap.appendChild(tripCard(trip)));
}

function tripCard(trip) {
  const div = document.createElement('div');
  div.className = 'card cat-card';
  const spent = tripSpent(trip.id);
  const budget = trip.budgetGbp || 0;
  const remaining = round2(budget - spent);
  const pct = budget > 0 ? clamp((spent / budget) * 100, 0, 100) : (spent > 0 ? 100 : 0);
  const level = (budget > 0 && spent > budget) ? 'over' : (spent > budget * 0.9 && budget > 0 ? 'warn' : 'ok');
  const status = tripStatus(trip);
  const txns = state.transactions.filter((t) => t.tripId === trip.id);
  div.innerHTML = `
    <div class="cat-head clickable">
      <span class="cat-name">${escapeHtml(trip.name)} ${txns.length ? `<span class="cat-count">${txns.length}</span>` : ''}
        <span class="trip-status trip-${status}">${status}</span></span>
      <span class="cat-figs">${gbp(spent)} / ${gbp(budget)}</span>
    </div>
    <div class="trip-dates muted small">${tripDateLabel(trip)}</div>
    <div class="bar"><div class="bar-fill pace-${level}" style="width:${pct}%"></div></div>
    <div class="cat-foot">
      <span class="muted small">${remaining >= 0 ? `${gbp(remaining)} left` : `${gbp(-remaining)} over`}</span>
      <span class="trip-actions">
        <button class="btn ghost small-btn trip-edit" type="button">Edit</button>
        <button class="btn ghost small-btn danger trip-del" type="button">Delete</button>
      </span>
    </div>
    <ul class="txn-list cat-txns" hidden></ul>`;
  const head = div.querySelector('.cat-head');
  const sub = div.querySelector('.cat-txns');
  head.addEventListener('click', () => {
    if (sub.hidden) {
      sub.innerHTML = '';
      if (txns.length) sortTxns(txns).forEach((t) => sub.appendChild(txnRow(t)));
      else sub.innerHTML = '<li class="empty">No transactions assigned yet.</li>';
    }
    sub.hidden = !sub.hidden;
    div.classList.toggle('expanded', !sub.hidden);
  });
  div.querySelector('.trip-edit').addEventListener('click', () => startEditTrip(trip.id));
  div.querySelector('.trip-del').addEventListener('click', () => {
    const n = txns.length;
    const msg = n ? `Delete trip "${trip.name}"? ${n} transaction(s) will keep the Travel category but lose their trip link.` : `Delete trip "${trip.name}"?`;
    if (!confirm(msg)) return;
    state.transactions.forEach((t) => { if (t.tripId === trip.id) t.tripId = null; });
    state.trips = state.trips.filter((x) => x.id !== trip.id);
    if (editingTripId === trip.id) resetTripForm();
    saveState();
    renderTrips();
  });
  return div;
}

function startEditTrip(id) {
  const trip = tripById(id);
  if (!trip) return;
  editingTripId = id;
  $('#newTripName').value = trip.name;
  $('#newTripBudget').value = trip.budgetGbp || '';
  $('#newTripStart').value = trip.startISO || '';
  $('#newTripEnd').value = trip.endISO || '';
  $('#addTripBtn').textContent = 'Save changes';
  $('#newTripName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetTripForm() {
  editingTripId = null;
  $('#newTripName').value = ''; $('#newTripBudget').value = '';
  $('#newTripStart').value = ''; $('#newTripEnd').value = '';
  $('#addTripBtn').textContent = 'Add trip';
}

$('#addTripBtn').addEventListener('click', () => {
  const name = $('#newTripName').value.trim();
  if (!name) { alert('Give the trip a name.'); return; }
  const budgetGbp = Math.max(0, parseFloat($('#newTripBudget').value) || 0);
  const startISO = $('#newTripStart').value || '';
  const endISO = $('#newTripEnd').value || '';
  if (startISO && endISO && endISO < startISO) { alert('End date is before start date.'); return; }
  if (editingTripId) {
    Object.assign(tripById(editingTripId), { name, budgetGbp, startISO, endISO });
  } else {
    state.trips.push({ id: uid(), name, budgetGbp, startISO, endISO });
  }
  saveState();
  resetTripForm();
  renderTrips();
});

/* ===========================================================
   SETTINGS
   =========================================================== */
function renderSettings() {
  renderCategoryEdit();
  renderAccountEdit();
  $('#monthStartDay').value = state.settings.monthStartDay;
  $('#rolloverInput').checked = !!state.settings.rollover;
  const r = state.settings.lastFxRate;
  $('#fxRateInput').value = r ? r.rate : '';
  $('#fxRateMeta').textContent = r
    ? `last updated ${new Date(r.fetchedAtISO).toLocaleString('en-GB')}`
    : 'no rate stored yet';
}

function renderCategoryEdit() {
  const ul = $('#categoryEditList');
  ul.innerHTML = '';
  state.categories.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'edit-row';
    li.innerHTML = `
      <div class="reorder">
        <button class="reorder-btn up" type="button" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
        <button class="reorder-btn down" type="button" aria-label="Move down"${i === state.categories.length - 1 ? ' disabled' : ''}>▼</button>
      </div>
      <input class="cat-emoji-input" type="text" value="${escapeHtml(c.emoji || '🏷️')}" aria-label="Emoji" maxlength="4" />
      <input class="edit-name grow" type="text" value="${escapeHtml(c.name)}" maxlength="40" />
      <div class="edit-budget"><span>£</span><input type="number" min="0" step="1" value="${c.monthlyBudgetGbp}" /></div>
      <button class="btn ghost del" aria-label="Remove">✕</button>`;
    const emojiI = li.querySelector('.cat-emoji-input');
    const nameI = li.querySelector('.edit-name');
    const budgetI = li.querySelector('.edit-budget input');
    emojiI.addEventListener('change', () => { c.emoji = emojiI.value.trim() || '🏷️'; saveState(); });
    nameI.addEventListener('change', () => { c.name = nameI.value.trim() || c.name; saveState(); refreshDynamicSelects(); });
    budgetI.addEventListener('change', () => { c.monthlyBudgetGbp = Math.max(0, parseFloat(budgetI.value) || 0); saveState(); updateCategoryTotal(); });
    li.querySelector('.up').addEventListener('click', () => moveCategory(i, -1));
    li.querySelector('.down').addEventListener('click', () => moveCategory(i, 1));
    li.querySelector('.del').addEventListener('click', () => {
      if (confirm(`Remove category "${c.name}"? Existing transactions keep their label.`)) {
        state.categories.splice(i, 1); saveState(); renderCategoryEdit(); refreshDynamicSelects();
      }
    });
    ul.appendChild(li);
  });
  updateCategoryTotal();
}

function moveCategory(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.categories.length) return;
  const [c] = state.categories.splice(i, 1);
  state.categories.splice(j, 0, c);
  saveState();
  renderCategoryEdit();
}

function updateCategoryTotal() {
  const total = state.categories.reduce((s, c) => s + (c.monthlyBudgetGbp || 0), 0);
  $('#categoryTotal').textContent = `Total ${gbp(round2(total))}/mo`;
}

function renderAccountEdit() {
  const ul = $('#accountEditList');
  ul.innerHTML = '';
  state.accounts.forEach((a, i) => {
    const li = document.createElement('li');
    li.className = 'edit-row account-row';
    li.innerHTML = `
      <input class="acct-color" type="color" value="${a.color}" aria-label="Colour" />
      <input class="edit-name grow" type="text" value="${escapeHtml(a.name)}" maxlength="40" />
      <select class="acct-ccy" aria-label="Default currency">
        <option value="GBP"${a.currency === 'GBP' ? ' selected' : ''}>£ GBP</option>
        <option value="USD"${a.currency === 'USD' ? ' selected' : ''}>$ USD</option>
      </select>
      <button class="btn ghost del" aria-label="Remove">✕</button>`;
    const colorI = li.querySelector('.acct-color');
    const nameI = li.querySelector('.edit-name');
    const ccyI = li.querySelector('.acct-ccy');
    colorI.addEventListener('change', () => { a.color = colorI.value; saveState(); renderRecent(); });
    nameI.addEventListener('change', () => { a.name = nameI.value.trim() || a.name; saveState(); refreshDynamicSelects(); });
    ccyI.addEventListener('change', () => { a.currency = ccyI.value; saveState(); });
    li.querySelector('.del').addEventListener('click', () => {
      if (state.accounts.length <= 1) { alert('Keep at least one account.'); return; }
      state.accounts.splice(i, 1); saveState(); renderAccountEdit(); refreshDynamicSelects();
    });
    ul.appendChild(li);
  });
}

function refreshDynamicSelects() {
  fillSelect($('#accountSelect'), state.accounts.map((a) => a.name), $('#accountSelect').value);
  fillSelect($('#categorySelect'), state.categories.map((c) => c.name), $('#categorySelect').value);
  $('#trendCategory').dataset.ready = '';
}

$('#addCategoryBtn').addEventListener('click', () => {
  const name = $('#newCategoryName').value.trim();
  const budget = Math.max(0, parseFloat($('#newCategoryBudget').value) || 0);
  const emoji = $('#newCategoryEmoji').value.trim() || '🏷️';
  if (!name) return;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { alert('Category exists.'); return; }
  state.categories.push({ name, monthlyBudgetGbp: budget, emoji });
  saveState();
  $('#newCategoryName').value = ''; $('#newCategoryBudget').value = ''; $('#newCategoryEmoji').value = '';
  renderCategoryEdit(); refreshDynamicSelects();
});

$('#recentSort').addEventListener('change', (e) => {
  state.settings.txnSort = e.target.value === 'entered' ? 'entered' : 'txn';
  saveState();
  renderRecent();
});

$('#addAccountBtn').addEventListener('click', () => {
  const name = $('#newAccountName').value.trim();
  if (!name) return;
  if (state.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) { alert('Account exists.'); return; }
  state.accounts.push({ name, currency: 'GBP', color: ACCOUNT_COLORS[state.accounts.length % ACCOUNT_COLORS.length] });
  saveState();
  $('#newAccountName').value = '';
  renderAccountEdit(); refreshDynamicSelects();
});

$('#monthStartDay').addEventListener('change', (e) => {
  state.settings.monthStartDay = clamp(parseInt(e.target.value, 10) || 1, 1, 28);
  e.target.value = state.settings.monthStartDay;
  saveState();
});

$('#rolloverInput').addEventListener('change', (e) => {
  state.settings.rollover = e.target.checked;
  saveState();
});

$('#fxRateInput').addEventListener('change', (e) => {
  const rate = parseFloat(e.target.value);
  if (isFinite(rate) && rate > 0) {
    state.settings.lastFxRate = { rate, fetchedAtISO: new Date().toISOString() };
    saveState();
    renderSettings();
  }
});

$('#refreshRateBtn').addEventListener('click', async () => {
  const btn = $('#refreshRateBtn');
  btn.disabled = true; btn.textContent = '…';
  try { await fetchLiveRate(); renderSettings(); }
  catch (e) { alert('Could not fetch live rate (offline?). You can type one in manually.'); }
  finally { btn.disabled = false; btn.textContent = 'Refresh'; }
});

/* ---------- export / import ---------- */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

$('#exportTxnBtn').addEventListener('click', () => {
  const head = ['Date', 'Account', 'Category', 'Trip', 'Currency', 'Amount', 'GBP amount', 'FX rate', 'Pending', 'Note'];
  const rows = [...state.transactions]
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .map((t) => [t.dateISO, t.account, t.category, t.tripId ? tripName(t.tripId) : '', t.currency, t.amount.toFixed(2),
      t.gbpAmount.toFixed(2), t.fxRate != null ? t.fxRate : '', t.pending ? 'yes' : 'no', t.note]
      .map(csvCell).join(','));
  const csv = [head.join(','), ...rows].join('\r\n');
  download(`coincrow-transactions-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
});

$('#exportSummaryBtn').addEventListener('click', () => {
  const period = periodByOffset(dashOffset);
  const txns = txnsInPeriod(period);
  const spentByCat = {};
  txns.forEach((t) => { spentByCat[t.category] = (spentByCat[t.category] || 0) + t.gbpAmount; });
  const head = ['Category', 'Budget (GBP)', 'Spent (GBP)', 'Remaining (GBP)'];
  const rows = state.categories.map((c) => {
    const spent = round2(spentByCat[c.name] || 0);
    return [c.name, c.monthlyBudgetGbp.toFixed(2), spent.toFixed(2),
      (c.monthlyBudgetGbp - spent).toFixed(2)].map(csvCell).join(',');
  });
  const csv = [`Month summary,${period.label}`, '', head.join(','), ...rows].join('\r\n');
  download(`coincrow-summary-${period.key}.csv`, csv, 'text/csv;charset=utf-8');
});

$('#backupBtn').addEventListener('click', () => {
  download(`coincrow-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
});

$('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
$('#restoreFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.transactions)) throw new Error('not a CoinCrow backup');
      if (!confirm(`Restore ${data.transactions.length} transactions? This replaces all current data.`)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      state = loadState();
      refreshDynamicSelects();
      renderSettings(); renderRecent();
      alert('Restored.');
    } catch (err) {
      alert('Could not restore: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

/* ===========================================================
   EDIT MODAL
   =========================================================== */
let editingId = null;
let editCcy = 'GBP';
let editDir = 'out';

function setEditCcy(ccy) {
  editCcy = ccy;
  $$('#editModal .ccy-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.ccy === ccy));
  $('#editRateField').hidden = ccy !== 'USD';
}
function setEditDir(dir) {
  editDir = dir;
  $$('#editModal .dir-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.dir === dir));
}

function initEditModal() {
  $$('#editModal .ccy-btn').forEach((b) => b.addEventListener('click', () => setEditCcy(b.dataset.ccy)));
  $$('#editModal .dir-btn').forEach((b) => b.addEventListener('click', () => setEditDir(b.dataset.dir)));
  $('#editCategory').addEventListener('change', () => setEditTripField($('#editCategory').value));
  $('#editClose').addEventListener('click', closeEdit);
  $('#editModal').addEventListener('click', (e) => { if (e.target.id === 'editModal') closeEdit(); });
  $('#editSave').addEventListener('click', saveEdit);
  $('#editDelete').addEventListener('click', deleteEdit);
}

// show/fill the trip picker in the edit modal for trip-based categories
function setEditTripField(category, currentTripId) {
  const show = isTripCategory(category);
  $('#editTripField').hidden = !show;
  if (show) fillTripSelect($('#editTrip'), currentTripId);
}

function openEdit(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  fillSelect($('#editAccount'), state.accounts.map((a) => a.name), t.account);
  fillSelect($('#editCategory'), state.categories.map((c) => c.name), t.category);
  $('#editAmount').value = Math.abs(t.amount);
  $('#editNote').value = t.note || '';
  $('#editDate').value = t.dateISO;
  $('#editPending').checked = !!t.pending;
  $('#editRate').value = t.fxRate != null ? t.fxRate
    : (state.settings.lastFxRate ? state.settings.lastFxRate.rate : '');
  setEditCcy(t.currency);
  setEditDir(t.amount < 0 ? 'in' : 'out');
  setEditTripField(t.category, t.tripId);
  $('#editModal').hidden = false;
}

function closeEdit() {
  $('#editModal').hidden = true;
  editingId = null;
}

async function saveEdit() {
  const t = state.transactions.find((x) => x.id === editingId);
  if (!t) return;
  const raw = parseFloat($('#editAmount').value);
  if (!isFinite(raw) || raw === 0) { alert('Enter a non-zero amount.'); return; }
  const signed = round2(Math.abs(raw)) * (editDir === 'in' ? -1 : 1);

  let fxRate = null, gbpAmount = signed;
  if (editCcy === 'USD') {
    let rate = parseFloat($('#editRate').value);
    if (!isFinite(rate) || rate <= 0) {
      try { rate = (await getUsdRate()).rate; }
      catch (e) { alert('Need a USD→GBP rate — enter one in the rate field.'); return; }
    }
    fxRate = rate;
    gbpAmount = round2(signed * rate);
  }

  Object.assign(t, {
    amount: signed,
    currency: editCcy,
    gbpAmount,
    fxRate,
    account: $('#editAccount').value,
    category: $('#editCategory').value,
    tripId: isTripCategory($('#editCategory').value) ? ($('#editTrip').value || null) : null,
    note: $('#editNote').value.trim(),
    pending: $('#editPending').checked,
    dateISO: $('#editDate').value || t.dateISO,
  });
  saveState();
  closeEdit();
  rerenderAll();
}

function deleteEdit() {
  if (!editingId) return;
  if (!confirm('Delete this transaction?')) return;
  state.transactions = state.transactions.filter((x) => x.id !== editingId);
  saveState();
  closeEdit();
  rerenderAll();
}

// refresh recent + whichever data screen is currently visible
function rerenderAll() {
  renderRecent();
  if (!$('[data-screen=dash]').hidden) renderDashboard();
  if (!$('[data-screen=trends]').hidden) renderTrends();
  if (!$('[data-screen=trips]').hidden) renderTrips();
}

/* ===========================================================
   INIT
   =========================================================== */
initAddForm();
renderRecent();
goScreen('add');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW reg failed', e));
  });
}
