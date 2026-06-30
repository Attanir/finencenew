/* ============================================================
   Мои финансы — локальный учёт (данные хранятся на устройстве)
   ============================================================ */

/* ---------- справочники ---------- */
const CURRENCIES = ['MYR', 'KZT', 'USD', 'SGD', 'EUR', 'RUB', 'THB', 'IDR', 'AED', 'TRY', 'GBP', 'CNY', 'INR'];
const SYMBOLS = {
  MYR: 'RM', KZT: '₸', USD: '$', SGD: 'S$', EUR: '€', RUB: '₽',
  THB: '฿', IDR: 'Rp', AED: 'AED', TRY: '₺', GBP: '£', CNY: '¥', INR: '₹'
};
const CATEGORIES = [
  { key: 'housing',       label: 'Жильё',        color: '#4C6FB1' },
  { key: 'food',          label: 'Еда',          color: '#2E8B6F' },
  { key: 'restaurants',   label: 'Рестораны',    color: '#C8893A' },
  { key: 'transport',     label: 'Транспорт',    color: '#6C8EA0' },
  { key: 'loans',         label: 'Кредиты',      color: '#B23A2E' },
  { key: 'clothing',      label: 'Одежда',       color: '#9A6DB0' },
  { key: 'toys',          label: 'Игрушки',      color: '#D98A9E' },
  { key: 'entertainment', label: 'Развлечения',  color: '#E3B23C' }
];
const CAT_MAP = {};
CATEGORIES.forEach(c => CAT_MAP[c.key] = c);
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const NF = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- хранилище ---------- */
const K = { wallets: 'ft_v1_wallets', expenses: 'ft_v1_expenses', rates: 'ft_v1_rates', display: 'ft_v1_display' };

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}

/* ---------- состояние ---------- */
let wallets = lsGet(K.wallets, null);
if (!Array.isArray(wallets)) {
  wallets = [
    { id: uid(), name: 'Kaspi',     currency: 'KZT', amount: 0 },
    { id: uid(), name: 'Alliance',  currency: 'MYR', amount: 0 },
    { id: uid(), name: 'Наличные',  currency: 'MYR', amount: 0 },
    { id: uid(), name: 'GrabPay',   currency: 'MYR', amount: 0 },
    { id: uid(), name: "Touch'n Go", currency: 'MYR', amount: 0 }
  ];
  lsSet(K.wallets, wallets);
}
let expenses = lsGet(K.expenses, []);
if (!Array.isArray(expenses)) expenses = [];

let display = lsGet(K.display, 'MYR');
if (CURRENCIES.indexOf(display) < 0) display = 'MYR';

let rates = lsGet(K.rates, null);   // { rates:{}, base, updatedUnix, fetchedAt }
let ratesBusy = false;

const now = new Date();
let viewMonth = { y: now.getFullYear(), m: now.getMonth() };

/* ---------- утилиты ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseAmount(str) {
  if (typeof str === 'number') return str;
  const v = parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
  return isFinite(v) ? v : 0;
}
function fmt(v, cur) {
  const sym = SYMBOLS[cur] || cur;
  return sym + '\u00A0' + NF.format(v || 0);
}
function convert(amount, from, to) {
  if (from === to) return amount;
  if (!rates || !rates.rates) return null;
  const rf = rates.rates[from], rt = rates.rates[to];
  if (!rf || !rt) return null;
  return amount * (rt / rf);
}

/* ---------- курс валют ---------- */
function b64ToString(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch (e) { return bin; }
}

function refreshRates() {
  if (ratesBusy) return;
  ratesBusy = true;
  updateRefreshUI();
  if (window.AndroidRates && typeof window.AndroidRates.fetchRates === 'function') {
    try { window.AndroidRates.fetchRates('USD'); }
    catch (e) { ratesBusy = false; renderRateStatus('Не удалось обновить'); updateRefreshUI(); }
  } else {
    // запасной путь (например, при открытии в обычном браузере)
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(r => r.json())
      .then(handleRatesData)
      .catch(() => renderRateStatus('Нет сети'))
      .then(() => { ratesBusy = false; updateRefreshUI(); });
  }
}

window.onRatesResult = function (b64) {
  ratesBusy = false;
  try {
    const data = JSON.parse(b64ToString(b64));
    handleRatesData(data);
  } catch (e) {
    renderRateStatus(rates ? null : 'Ошибка данных курса');
  }
  updateRefreshUI();
};

function handleRatesData(data) {
  if (data && data.result === 'success' && data.rates) {
    rates = {
      rates: data.rates,
      base: data.base_code || 'USD',
      updatedUnix: data.time_last_update_unix || null,
      fetchedAt: Date.now()
    };
    lsSet(K.rates, rates);
    renderRateStatus();
    renderAll();
  } else {
    renderRateStatus(rates ? null : 'Курс недоступен');
  }
}

function updateRefreshUI() {
  const btn = document.getElementById('refreshRates');
  if (!btn) return;
  btn.classList.toggle('busy', ratesBusy);
  btn.textContent = ratesBusy ? '…' : '↻ обновить';
}

function renderRateStatus(overrideMsg) {
  const el = document.getElementById('rateStatus');
  if (!el) return;
  if (overrideMsg) { el.textContent = overrideMsg; return; }
  if (rates && rates.fetchedAt) {
    const d = new Date(rates.fetchedAt);
    el.textContent = 'Курс от ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) +
      ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  } else {
    el.textContent = 'Курс не загружен';
  }
}

/* ============================================================
   ВКЛАДКА: БАЛАНС
   ============================================================ */
function renderDisplaySelect() {
  const sel = document.getElementById('displayCurrency');
  sel.innerHTML = '';
  CURRENCIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === display) o.selected = true;
    sel.appendChild(o);
  });
}

function buildCurrencyOptions(selected) {
  const frag = document.createDocumentFragment();
  CURRENCIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    if (c === selected) o.selected = true;
    frag.appendChild(o);
  });
  return frag;
}

function renderWallets() {
  const list = document.getElementById('walletList');
  list.innerHTML = '';

  wallets.forEach(w => {
    const card = document.createElement('div');
    card.className = 'wallet';

    // верхняя строка: имя, валюта, удалить
    const top = document.createElement('div');
    top.className = 'wallet-top';

    const name = document.createElement('input');
    name.className = 'wallet-name';
    name.type = 'text';
    name.value = w.name;
    name.setAttribute('aria-label', 'Название кошелька');
    name.addEventListener('input', () => { w.name = name.value; lsSet(K.wallets, wallets); });

    const curSel = document.createElement('select');
    curSel.className = 'wallet-cur';
    curSel.appendChild(buildCurrencyOptions(w.currency));
    curSel.addEventListener('change', () => {
      w.currency = curSel.value; lsSet(K.wallets, wallets);
      renderHeroTotal(); updateConv();
    });

    const del = document.createElement('button');
    del.className = 'wallet-del'; del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Удалить кошелёк');
    del.addEventListener('click', () => {
      wallets = wallets.filter(x => x.id !== w.id);
      lsSet(K.wallets, wallets);
      renderWallets(); renderHeroTotal();
    });

    top.appendChild(name); top.appendChild(curSel); top.appendChild(del);

    // нижняя строка: сумма + конвертация
    const bottom = document.createElement('div');
    bottom.className = 'wallet-bottom';

    const amt = document.createElement('input');
    amt.className = 'wallet-amount';
    amt.type = 'number'; amt.inputMode = 'decimal'; amt.step = '0.01'; amt.min = '0';
    amt.placeholder = '0.00';
    amt.value = w.amount ? w.amount : '';
    amt.setAttribute('aria-label', 'Сумма на кошельке');

    const conv = document.createElement('div');
    conv.className = 'wallet-conv';

    function setConv() {
      if (w.currency === display) { conv.textContent = ''; return; }
      const c = convert(w.amount, w.currency, display);
      conv.textContent = (c == null) ? 'нужен курс' : '≈ ' + fmt(c, display);
    }
    setConv();

    amt.addEventListener('input', () => {
      w.amount = parseAmount(amt.value);
      setConv(); renderHeroTotal();
    });
    amt.addEventListener('change', () => { lsSet(K.wallets, wallets); });

    card._setConv = setConv; // для массового обновления при смене курса/валюты
    bottom.appendChild(amt); bottom.appendChild(conv);

    card.appendChild(top); card.appendChild(bottom);
    list.appendChild(card);
  });
}

function updateConv() {
  document.querySelectorAll('#walletList .wallet').forEach(card => {
    if (typeof card._setConv === 'function') card._setConv();
  });
}

function renderHeroTotal() {
  const el = document.getElementById('heroTotal');
  let total = 0, missing = false;
  wallets.forEach(w => {
    const c = convert(w.amount || 0, w.currency, display);
    if (c == null) { missing = true; } else { total += c; }
  });
  el.textContent = fmt(total, display);
  // подсказка, если часть кошельков не конвертирована
  const status = document.getElementById('rateStatus');
  if (missing && status && !ratesBusy && !rates) {
    // статус уже сообщит про курс
  }
}

/* ============================================================
   ВКЛАДКА: РАСХОДЫ
   ============================================================ */
function renderExpenseControls() {
  const cat = document.getElementById('exCategory');
  cat.innerHTML = '';
  CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = c.label;
    cat.appendChild(o);
  });
  const cur = document.getElementById('exCurrency');
  cur.innerHTML = '';
  cur.appendChild(buildCurrencyOptions(display));
  const date = document.getElementById('exDate');
  if (!date.value) date.value = todayStr();
}

function monthKey() { return viewMonth.y + '-' + pad2(viewMonth.m + 1); }

function renderMonthLabel() {
  document.getElementById('monthLabel').textContent = MONTHS_RU[viewMonth.m] + ' ' + viewMonth.y;
}

function monthExpenses() {
  const mk = monthKey();
  return expenses.filter(e => typeof e.date === 'string' && e.date.slice(0, 7) === mk);
}

function renderSummary() {
  const items = monthExpenses();
  let total = 0;
  const byCat = {};
  let missing = false;
  items.forEach(e => {
    const c = convert(e.amount || 0, e.currency, display);
    const v = (c == null) ? 0 : c;
    if (c == null) missing = true;
    total += v;
    byCat[e.category] = (byCat[e.category] || 0) + v;
  });

  document.getElementById('monthTotal').textContent = fmt(total, display);

  const wrap = document.getElementById('catBreakdown');
  wrap.innerHTML = '';

  const used = CATEGORIES.filter(c => byCat[c.key] > 0)
    .sort((a, b) => byCat[b.key] - byCat[a.key]);

  if (used.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'В этом месяце расходов пока нет';
    wrap.appendChild(p);
    return;
  }
  const max = byCat[used[0].key] || 1;

  used.forEach(c => {
    const row = document.createElement('div');
    row.className = 'cat-row';

    const name = document.createElement('div');
    name.className = 'cat-name';
    const dot = document.createElement('span');
    dot.className = 'cat-dot'; dot.style.background = c.color;
    name.appendChild(dot);
    name.appendChild(document.createTextNode(c.label));

    const val = document.createElement('div');
    val.className = 'cat-val';
    val.textContent = fmt(byCat[c.key], display);

    const bar = document.createElement('div');
    bar.className = 'cat-bar';
    const span = document.createElement('span');
    span.style.width = Math.max(4, Math.round(byCat[c.key] / max * 100)) + '%';
    span.style.background = c.color;
    bar.appendChild(span);

    row.appendChild(name); row.appendChild(val); row.appendChild(bar);
    wrap.appendChild(row);
  });

  if (missing) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'Часть сумм без курса — обновите курс на вкладке «Баланс»';
    wrap.appendChild(p);
  }
}

function renderExpenseList() {
  const list = document.getElementById('expenseList');
  list.innerHTML = '';
  const items = monthExpenses().slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.created || 0) - (a.created || 0);
  });

  const countEl = document.getElementById('entriesCount');
  countEl.textContent = items.length ? items.length + ' шт.' : '';

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'list-empty';
    p.textContent = 'Записей нет. Добавьте первый расход выше.';
    list.appendChild(p);
    return;
  }

  let lastDay = '';
  const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

  items.forEach(e => {
    if (e.date !== lastDay) {
      lastDay = e.date;
      const h = document.createElement('div');
      h.className = 'ex-day-head';
      const parts = e.date.split('-');
      const dObj = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      h.textContent = dayFmt.format(dObj);
      list.appendChild(h);
    }

    const cat = CAT_MAP[e.category] || { label: e.category, color: '#888' };
    const row = document.createElement('div');
    row.className = 'ex-row';

    const dot = document.createElement('span');
    dot.className = 'ex-dot'; dot.style.background = cat.color;

    const main = document.createElement('div');
    main.className = 'ex-main';
    const t = document.createElement('div');
    t.className = 'ex-cat'; t.textContent = cat.label;
    main.appendChild(t);
    if (e.note) {
      const n = document.createElement('div');
      n.className = 'ex-note'; n.textContent = e.note;
      main.appendChild(n);
    }

    const amtWrap = document.createElement('div');
    amtWrap.className = 'ex-amt';
    const conv = convert(e.amount, e.currency, display);
    amtWrap.textContent = (conv == null) ? fmt(e.amount, e.currency) : fmt(conv, display);
    if (e.currency !== display) {
      const orig = document.createElement('span');
      orig.className = 'orig';
      orig.textContent = fmt(e.amount, e.currency);
      amtWrap.appendChild(orig);
    }

    const del = document.createElement('button');
    del.className = 'ex-del'; del.type = 'button'; del.textContent = '×';
    del.setAttribute('aria-label', 'Удалить запись');
    del.addEventListener('click', () => {
      expenses = expenses.filter(x => x.id !== e.id);
      lsSet(K.expenses, expenses);
      renderSummary(); renderExpenseList();
    });

    row.appendChild(dot); row.appendChild(main); row.appendChild(amtWrap); row.appendChild(del);
    list.appendChild(row);
  });
}

function addExpense() {
  const amtEl = document.getElementById('exAmount');
  const amount = parseAmount(amtEl.value);
  if (!(amount > 0)) {
    amtEl.style.borderColor = '#B23A2E';
    amtEl.focus();
    setTimeout(() => { amtEl.style.borderColor = ''; }, 1200);
    return;
  }
  const e = {
    id: uid(),
    created: Date.now(),
    date: document.getElementById('exDate').value || todayStr(),
    category: document.getElementById('exCategory').value,
    amount: amount,
    currency: document.getElementById('exCurrency').value,
    note: document.getElementById('exNote').value.trim()
  };
  expenses.push(e);
  lsSet(K.expenses, expenses);

  // переключимся на месяц добавленной записи, чтобы она была видна
  const p = e.date.split('-');
  viewMonth = { y: +p[0], m: +p[1] - 1 };
  renderMonthLabel();

  amtEl.value = '';
  document.getElementById('exNote').value = '';
  renderSummary(); renderExpenseList();
}

/* ============================================================
   ОБЩЕЕ
   ============================================================ */
function renderAll() {
  renderHeroTotal();
  updateConv();
  renderSummary();
  renderExpenseList();
}

function switchTab(tab) {
  document.getElementById('screen-balance').hidden = (tab !== 'balance');
  document.getElementById('screen-expenses').hidden = (tab !== 'expenses');
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function wire() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('displayCurrency').addEventListener('change', (ev) => {
    display = ev.target.value;
    lsSet(K.display, display);
    renderHeroTotal(); updateConv(); renderSummary(); renderExpenseList();
  });

  document.getElementById('refreshRates').addEventListener('click', refreshRates);

  document.getElementById('addWallet').addEventListener('click', () => {
    wallets.push({ id: uid(), name: 'Новый кошелёк', currency: display, amount: 0 });
    lsSet(K.wallets, wallets);
    renderWallets(); renderHeroTotal();
    const inputs = document.querySelectorAll('#walletList .wallet-name');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  document.getElementById('addExpense').addEventListener('click', addExpense);

  document.getElementById('monthPrev').addEventListener('click', () => {
    viewMonth.m--; if (viewMonth.m < 0) { viewMonth.m = 11; viewMonth.y--; }
    renderMonthLabel(); renderSummary(); renderExpenseList();
  });
  document.getElementById('monthNext').addEventListener('click', () => {
    viewMonth.m++; if (viewMonth.m > 11) { viewMonth.m = 0; viewMonth.y++; }
    renderMonthLabel(); renderSummary(); renderExpenseList();
  });
}

function init() {
  renderDisplaySelect();
  renderWallets();
  renderHeroTotal();
  renderExpenseControls();
  renderMonthLabel();
  renderSummary();
  renderExpenseList();
  renderRateStatus();
  wire();

  // автообновление курса: если нет данных или старше 6 часов
  const stale = !rates || !rates.fetchedAt || (Date.now() - rates.fetchedAt) > 6 * 3600 * 1000;
  if (stale) refreshRates();
}

document.addEventListener('DOMContentLoaded', init);
