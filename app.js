'use strict';

/* ===== CoinCrow — personal budget tracker (static PWA) ===== */

const STORAGE_KEY = 'coincrow.v1';
const FX_URL = 'https://api.frankfurter.app/latest?from=USD&to=GBP';

const DEFAULT_STATE = () => ({
  transactions: [],
  accounts: ['Current account', 'Credit card', 'Savings'],
  categories: [
    { name: 'Groceries', monthlyBudgetGbp: 300 },
    { name: 'Eating out', monthlyBudgetGbp: 120 },
    { name: 'Transport', monthlyBudgetGbp: 100 },
    { name: 'Bills', monthlyBudgetGbp: 600 },
    { name: 'Shopping', monthlyBudgetGbp: 150 },
    { name: 'Fun', monthlyBudgetGbp: 120 },
    { name: 'Other', monthlyBudgetGbp: 80 },
  ],
  settings: {
    monthStartDay: 1,
    baseCurrency: 'GBP',
    lastFxRate: null, // { rate, fetchedAtISO }
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
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : base.transactions,
      accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : base.accounts,
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : base.categories,
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
  if (name === 'settings') renderSettings();
  if (name === 'add') renderRecent();
  window.scrollTo(0, 0);
}
$$('.tab').forEach((t) => t.addEventListener('click', () => goScreen(t.dataset.go)));

/* ===========================================================
   ADD TRANSACTION
   =========================================================== */
let selectedCcy = 'GBP';

function fillSelect(sel, items, current) {
  sel.innerHTML = '';
  items.forEach((v) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (v === current) o.selected = true;
    sel.appendChild(o);
  });
}

function initAddForm() {
  fillSelect($('#accountSelect'), state.accounts);
  fillSelect($('#categorySelect'), state.categories.map((c) => c.name));
  $('#dateInput').value = todayISO();

  $$('.ccy-btn').forEach((b) =>
    b.addEventListener('click', () => {
      selectedCcy = b.dataset.ccy;
      $$('.ccy-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      updateFxNote();
    })
  );

  $('#amountInput').addEventListener('input', updateFxNote);
  $('#addForm').addEventListener('submit', onAddSubmit);
}

async function updateFxNote() {
  const note = $('#fxNote');
  if (selectedCcy !== 'USD') { note.hidden = true; return; }
  const amt = parseFloat($('#amountInput').value);
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
  const amount = round2(parseFloat($('#amountInput').value));
  if (!isFinite(amount) || amount <= 0) return;

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
    dateISO: $('#dateInput').value || todayISO(),
    amount,
    currency: selectedCcy,
    gbpAmount,
    fxRate,
    account: $('#accountSelect').value,
    category: $('#categorySelect').value,
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
  btn.disabled = false;
  flashSave(`Added ${gbp(gbpAmount)} · ${txn.category}`);
  renderRecent();
}

function flashSave(msg, isError) {
  const el = $('#saveFlash');
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
  clearTimeout(flashSave._t);
  flashSave._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function renderRecent() {
  const list = $('#recentList');
  const recent = [...state.transactions].sort((a, b) => b.id < a.id ? -1 : 1).slice(0, 12);
  $('#recentCount').textContent = state.transactions.length + ' total';
  if (!recent.length) { list.innerHTML = '<li class="empty">No charges yet — add one above.</li>'; return; }
  list.innerHTML = '';
  recent.forEach((t) => list.appendChild(txnRow(t)));
}

function txnRow(t) {
  const li = document.createElement('li');
  li.className = 'txn';
  const orig = t.currency === 'USD'
    ? `<span class="txn-orig">$${t.amount.toFixed(2)} → </span>` : '';
  li.innerHTML = `
    <div class="txn-main">
      <span class="txn-cat">${escapeHtml(t.category)}${t.pending ? ' <em class="pending-tag">pending</em>' : ''}</span>
      <span class="txn-sub">${escapeHtml(t.account)} · ${parseISO(t.dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${t.note ? ' · ' + escapeHtml(t.note) : ''}</span>
    </div>
    <div class="txn-amt">${orig}${gbp(t.gbpAmount)}</div>
    <button class="txn-del" aria-label="Delete" title="Delete">✕</button>`;
  li.querySelector('.txn-del').addEventListener('click', () => {
    if (confirm('Delete this charge?')) {
      state.transactions = state.transactions.filter((x) => x.id !== t.id);
      saveState();
      renderRecent();
    }
  });
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
  const txns = txnsInPeriod(period);

  $('#dashMonthLabel').textContent = period.label;
  $('#monthPill').textContent = periodByOffset(0).label;
  $('#nextMonth').disabled = dashOffset >= 0;

  const spentByCat = {};
  txns.forEach((t) => { spentByCat[t.category] = (spentByCat[t.category] || 0) + t.gbpAmount; });

  let totSpent = 0, totBudget = 0, totExpected = 0;
  const rows = state.categories.map((c) => {
    const spent = round2(spentByCat[c.name] || 0);
    const budget = c.monthlyBudgetGbp || 0;
    const expected = round2(budget * frac);
    totSpent += spent; totBudget += budget; totExpected += expected;
    return { name: c.name, spent, budget, expected };
  });
  // categories with spend but no budget config
  Object.keys(spentByCat).forEach((name) => {
    if (!rows.some((r) => r.name === name)) {
      const spent = round2(spentByCat[name]);
      totSpent += spent;
      rows.push({ name, spent, budget: 0, expected: 0 });
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
  rows.sort((a, b) => (b.spent / (b.budget || 1)) - (a.spent / (a.budget || 1)));
  rows.forEach((r) => wrap.appendChild(catCard(r, frac)));
}

function paceStatus(spent, expected, budget) {
  if (budget > 0 && spent > budget) return { level: 'over', label: '🚨 Over budget' };
  if (spent > expected * 1.05 && expected > 0) return { level: 'over', label: '🚨 Over pace' };
  if (spent > expected * 0.9 && expected > 0) return { level: 'warn', label: '⚠️ Near pace' };
  return { level: 'ok', label: '✅ On track' };
}

function catCard(r, frac) {
  const div = document.createElement('div');
  div.className = 'card cat-card';
  const pct = r.budget > 0 ? clamp((r.spent / r.budget) * 100, 0, 100) : (r.spent > 0 ? 100 : 0);
  const markerPct = clamp(frac * 100, 0, 100);
  const pace = paceStatus(r.spent, r.expected, r.budget);
  const noBudget = r.budget <= 0;
  div.innerHTML = `
    <div class="cat-head">
      <span class="cat-name">${escapeHtml(r.name)}</span>
      <span class="cat-figs">${gbp(r.spent)} ${noBudget ? '' : '/ ' + gbp(r.budget)}</span>
    </div>
    <div class="bar">
      <div class="bar-fill pace-${pace.level}" style="width:${pct}%"></div>
      ${noBudget ? '' : `<div class="bar-marker" style="left:${markerPct}%" title="Expected by now"></div>`}
    </div>
    <div class="cat-foot">
      <span class="badge badge-${pace.level}">${pace.label}</span>
      ${noBudget ? '<span class="muted small">no budget set</span>'
        : `<span class="muted small">${gbp(round2(r.budget - r.spent))} left</span>`}
    </div>`;
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

  // total per period
  const totals = periods.map((p) => round2(txnsInPeriod(p).reduce((s, t) => s + t.gbpAmount, 0)));
  $('#trendTotalChart').innerHTML = barChart(periods.map((p) => p.shortLabel), totals, null);

  // category dropdown
  const catSel = $('#trendCategory');
  if (!catSel.dataset.ready) {
    fillSelect(catSel, state.categories.map((c) => c.name));
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
   SETTINGS
   =========================================================== */
function renderSettings() {
  renderCategoryEdit();
  renderAccountEdit();
  $('#monthStartDay').value = state.settings.monthStartDay;
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
      <input class="edit-name" type="text" value="${escapeHtml(c.name)}" maxlength="40" />
      <div class="edit-budget"><span>£</span><input type="number" min="0" step="1" value="${c.monthlyBudgetGbp}" /></div>
      <button class="btn ghost del" aria-label="Remove">✕</button>`;
    const [nameI, budgetI] = li.querySelectorAll('input');
    nameI.addEventListener('change', () => { c.name = nameI.value.trim() || c.name; saveState(); refreshDynamicSelects(); });
    budgetI.addEventListener('change', () => { c.monthlyBudgetGbp = Math.max(0, parseFloat(budgetI.value) || 0); saveState(); });
    li.querySelector('.del').addEventListener('click', () => {
      if (confirm(`Remove category "${c.name}"? Existing transactions keep their label.`)) {
        state.categories.splice(i, 1); saveState(); renderCategoryEdit(); refreshDynamicSelects();
      }
    });
    ul.appendChild(li);
  });
}

function renderAccountEdit() {
  const ul = $('#accountEditList');
  ul.innerHTML = '';
  state.accounts.forEach((a, i) => {
    const li = document.createElement('li');
    li.className = 'edit-row';
    li.innerHTML = `<input class="edit-name grow" type="text" value="${escapeHtml(a)}" maxlength="40" />
      <button class="btn ghost del" aria-label="Remove">✕</button>`;
    const input = li.querySelector('input');
    input.addEventListener('change', () => { state.accounts[i] = input.value.trim() || a; saveState(); refreshDynamicSelects(); });
    li.querySelector('.del').addEventListener('click', () => {
      if (state.accounts.length <= 1) { alert('Keep at least one account.'); return; }
      state.accounts.splice(i, 1); saveState(); renderAccountEdit(); refreshDynamicSelects();
    });
    ul.appendChild(li);
  });
}

function refreshDynamicSelects() {
  fillSelect($('#accountSelect'), state.accounts, $('#accountSelect').value);
  fillSelect($('#categorySelect'), state.categories.map((c) => c.name), $('#categorySelect').value);
  $('#trendCategory').dataset.ready = '';
}

$('#addCategoryBtn').addEventListener('click', () => {
  const name = $('#newCategoryName').value.trim();
  const budget = Math.max(0, parseFloat($('#newCategoryBudget').value) || 0);
  if (!name) return;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { alert('Category exists.'); return; }
  state.categories.push({ name, monthlyBudgetGbp: budget });
  saveState();
  $('#newCategoryName').value = ''; $('#newCategoryBudget').value = '';
  renderCategoryEdit(); refreshDynamicSelects();
});

$('#addAccountBtn').addEventListener('click', () => {
  const name = $('#newAccountName').value.trim();
  if (!name) return;
  if (state.accounts.some((a) => a.toLowerCase() === name.toLowerCase())) { alert('Account exists.'); return; }
  state.accounts.push(name);
  saveState();
  $('#newAccountName').value = '';
  renderAccountEdit(); refreshDynamicSelects();
});

$('#monthStartDay').addEventListener('change', (e) => {
  state.settings.monthStartDay = clamp(parseInt(e.target.value, 10) || 1, 1, 28);
  e.target.value = state.settings.monthStartDay;
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
  const head = ['Date', 'Account', 'Category', 'Currency', 'Amount', 'GBP amount', 'FX rate', 'Pending', 'Note'];
  const rows = [...state.transactions]
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .map((t) => [t.dateISO, t.account, t.category, t.currency, t.amount.toFixed(2),
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
