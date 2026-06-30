/* ============================================================
   Мои финансы — локальный учёт (данные хранятся на устройстве)
   v1.1 — операции (расход/приход), источник оплаты, экспорт в Stories
   ============================================================ */

/* ---------- справочники ---------- */
const CURRENCIES = ['MYR', 'KZT', 'USD', 'SGD', 'EUR', 'RUB', 'THB', 'IDR', 'AED', 'TRY', 'GBP', 'CNY', 'INR'];
const SYMBOLS = {
  MYR: 'RM', KZT: '₸', USD: '$', SGD: 'S$', EUR: '€', RUB: '₽',
  THB: '฿', IDR: 'Rp', AED: 'AED', TRY: '₺', GBP: '£', CNY: '¥', INR: '₹'
};

const EXPENSE_CATS = [
  { key: 'housing',       label: 'Жильё',        color: '#4C6FB1' },
  { key: 'food',          label: 'Еда',          color: '#2E8B6F' },
  { key: 'restaurants',   label: 'Рестораны',    color: '#C8893A' },
  { key: 'transport',     label: 'Транспорт',    color: '#6C8EA0' },
  { key: 'loans',         label: 'Кредиты',      color: '#B23A2E' },
  { key: 'clothing',      label: 'Одежда',       color: '#9A6DB0' },
  { key: 'toys',          label: 'Игрушки',      color: '#D98A9E' },
  { key: 'entertainment', label: 'Развлечения',  color: '#E3B23C' }
];
const INCOME_CATS = [
  { key: 'salary',   label: 'Зарплата',  color: '#1F6F5C' },
  { key: 'refund',   label: 'Возврат',   color: '#2E8B6F' },
  { key: 'sidegig',  label: 'Подработка',color: '#4C8C6A' },
  { key: 'gift',     label: 'Подарок',   color: '#7BA86A' },
  { key: 'transfer', label: 'Перевод',   color: '#5C9A8B' },
  { key: 'other_in', label: 'Прочее',    color: '#8AA98F' }
];
const CAT_MAP = {};
EXPENSE_CATS.forEach(c => CAT_MAP[c.key] = c);
INCOME_CATS.forEach(c => CAT_MAP[c.key] = c);
function catsFor(type) { return type === 'income' ? INCOME_CATS : EXPENSE_CATS; }

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const NF = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- хранилище ---------- */
const K = {
  wallets: 'ft_v1_wallets',
  expenses: 'ft_v1_expenses', // старый ключ (для переноса)
  tx: 'ft_v1_tx',             // новый: операции (расход/приход)
  rates: 'ft_v1_rates',
  display: 'ft_v1_display'
};

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}

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

/* ---------- состояние ---------- */
let wallets = lsGet(K.wallets, null);
if (!Array.isArray(wallets)) {
  wallets = [
    { id: uid(), name: 'Kaspi',      currency: 'KZT', amount: 0 },
    { id: uid(), name: 'Alliance',   currency: 'MYR', amount: 0 },
    { id: uid(), name: 'Наличные',   currency: 'MYR', amount: 0 },
    { id: uid(), name: 'GrabPay',    currency: 'MYR', amount: 0 },
    { id: uid(), name: "Touch'n Go", currency: 'MYR', amount: 0 }
  ];
  lsSet(K.wallets, wallets);
}

// операции; перенос старых расходов при первом запуске v1.1
let transactions = lsGet(K.tx, null);
if (!Array.isArray(transactions)) {
  const old = lsGet(K.expenses, []);
  transactions = Array.isArray(old) ? old.map(e => ({
    id: e.id || uid(),
    created: e.created || Date.now(),
    type: 'expense',
    date: e.date,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    walletId: '',     // у старых записей источник неизвестен
    applied: 0,       // баланс не трогаем
    note: e.note || ''
  })) : [];
  lsSet(K.tx, transactions);
}

let display = lsGet(K.display, 'MYR');
if (CURRENCIES.indexOf(display) < 0) display = 'MYR';

let rates = lsGet(K.rates, null);   // { rates:{}, base, updatedUnix, fetchedAt }
let ratesBusy = false;

let opType = 'expense';             // текущий тип в форме

const now = new Date();
let viewMonth = { y: now.getFullYear(), m: now.getMonth() };

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

function findWallet(id) { return wallets.find(w => w.id === id) || null; }

function renderWallets() {
  const list = document.getElementById('walletList');
  list.innerHTML = '';

  wallets.forEach(w => {
    const card = document.createElement('div');
    card.className = 'wallet';

    const top = document.createElement('div');
    top.className = 'wallet-top';

    const name = document.createElement('input');
    name.className = 'wallet-name';
    name.type = 'text';
    name.value = w.name;
    name.setAttribute('aria-label', 'Название кошелька');
    name.addEventListener('input', () => { w.name = name.value; lsSet(K.wallets, wallets); });
    name.addEventListener('change', renderWalletSelect);

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
      renderWallets(); renderHeroTotal(); renderWalletSelect();
    });

    top.appendChild(name); top.appendChild(curSel); top.appendChild(del);

    const bottom = document.createElement('div');
    bottom.className = 'wallet-bottom';

    const amt = document.createElement('input');
    amt.className = 'wallet-amount';
    amt.type = 'number'; amt.inputMode = 'decimal'; amt.step = '0.01';
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

    card._setConv = setConv;
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
  let total = 0;
  wallets.forEach(w => {
    const c = convert(w.amount || 0, w.currency, display);
    if (c != null) total += c;
  });
  el.textContent = fmt(total, display);
}

/* ============================================================
   ВКЛАДКА: ОПЕРАЦИИ
   ============================================================ */
function renderOpControls() {
  renderCategorySelect();
  const cur = document.getElementById('opCurrency');
  cur.innerHTML = '';
  cur.appendChild(buildCurrencyOptions(display));
  renderWalletSelect();
  const date = document.getElementById('opDate');
  if (!date.value) date.value = todayStr();
  updateOpTypeUI();
}

function renderCategorySelect() {
  const cat = document.getElementById('opCategory');
  const prev = cat.value;
  cat.innerHTML = '';
  catsFor(opType).forEach(c => {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = c.label;
    cat.appendChild(o);
  });
  // сохранить выбор, если он есть в новом списке
  if (prev && catsFor(opType).some(c => c.key === prev)) cat.value = prev;
}

function renderWalletSelect() {
  const sel = document.getElementById('opWallet');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  wallets.forEach(w => {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = w.name + ' · ' + (SYMBOLS[w.currency] || w.currency);
    sel.appendChild(o);
  });
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— без кошелька —';
  sel.appendChild(none);
  if (prev && (prev === '' || wallets.some(w => w.id === prev))) sel.value = prev;
}

function updateOpTypeUI() {
  document.querySelectorAll('#typeToggle .type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === opType);
  });
  const card = document.querySelector('.add-card');
  if (card) card.classList.toggle('income-mode', opType === 'income');
  document.getElementById('walletFieldLabel').textContent =
    opType === 'income' ? 'Куда (кошелёк)' : 'Откуда (кошелёк)';
  document.getElementById('addOp').textContent =
    opType === 'income' ? 'Добавить приход' : 'Добавить расход';
}

function setOpType(type) {
  opType = (type === 'income') ? 'income' : 'expense';
  renderCategorySelect();
  updateOpTypeUI();
}

function monthKey() { return viewMonth.y + '-' + pad2(viewMonth.m + 1); }
function renderMonthLabel() {
  document.getElementById('monthLabel').textContent = MONTHS_RU[viewMonth.m] + ' ' + viewMonth.y;
}
function monthTx() {
  const mk = monthKey();
  return transactions.filter(t => typeof t.date === 'string' && t.date.slice(0, 7) === mk);
}

function renderSummary() {
  const items = monthTx();
  let income = 0, expense = 0;
  const byCat = {};
  let missing = false;

  items.forEach(t => {
    const c = convert(t.amount || 0, t.currency, display);
    const v = (c == null) ? 0 : c;
    if (c == null) missing = true;
    if (t.type === 'income') {
      income += v;
    } else {
      expense += v;
      byCat[t.category] = (byCat[t.category] || 0) + v;
    }
  });

  document.getElementById('monthIncome').textContent = '+' + fmt(income, display);
  document.getElementById('monthExpense').textContent = '−' + fmt(expense, display);

  const wrap = document.getElementById('catBreakdown');
  wrap.innerHTML = '';

  const used = EXPENSE_CATS.filter(c => byCat[c.key] > 0)
    .sort((a, b) => byCat[b.key] - byCat[a.key]);

  if (used.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'В этом месяце расходов пока нет';
    wrap.appendChild(p);
  } else {
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
  }

  if (missing) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'Часть сумм без курса — обновите курс на вкладке «Баланс»';
    wrap.appendChild(p);
  }
}

function renderOpList() {
  const list = document.getElementById('opList');
  list.innerHTML = '';
  const items = monthTx().slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.created || 0) - (a.created || 0);
  });

  const countEl = document.getElementById('entriesCount');
  countEl.textContent = items.length ? items.length + ' шт.' : '';

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'list-empty';
    p.textContent = 'Записей нет. Добавьте операцию выше.';
    list.appendChild(p);
    return;
  }

  let lastDay = '';
  const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });

  items.forEach(t => {
    if (t.date !== lastDay) {
      lastDay = t.date;
      const h = document.createElement('div');
      h.className = 'ex-day-head';
      const parts = t.date.split('-');
      const dObj = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      h.textContent = dayFmt.format(dObj);
      list.appendChild(h);
    }

    const isIncome = t.type === 'income';
    const cat = CAT_MAP[t.category] || { label: t.category, color: '#888' };
    const row = document.createElement('div');
    row.className = 'ex-row';

    const dot = document.createElement('span');
    dot.className = 'ex-dot'; dot.style.background = cat.color;

    const main = document.createElement('div');
    main.className = 'ex-main';
    const tcat = document.createElement('div');
    tcat.className = 'ex-cat'; tcat.textContent = cat.label;
    main.appendChild(tcat);

    const sub = [];
    const w = findWallet(t.walletId);
    if (w) sub.push(w.name);
    if (t.note) sub.push(t.note);
    if (sub.length) {
      const n = document.createElement('div');
      n.className = 'ex-note'; n.textContent = sub.join(' · ');
      main.appendChild(n);
    }

    const amtWrap = document.createElement('div');
    amtWrap.className = 'ex-amt ' + (isIncome ? 'amt-in' : 'amt-out');
    const conv = convert(t.amount, t.currency, display);
    const sign = isIncome ? '+' : '−';
    amtWrap.textContent = sign + ((conv == null) ? fmt(t.amount, t.currency) : fmt(conv, display));
    if (t.currency !== display) {
      const orig = document.createElement('span');
      orig.className = 'orig';
      orig.textContent = fmt(t.amount, t.currency);
      amtWrap.appendChild(orig);
    }

    const del = document.createElement('button');
    del.className = 'ex-del'; del.type = 'button'; del.textContent = '×';
    del.setAttribute('aria-label', 'Удалить запись');
    del.addEventListener('click', () => deleteTx(t.id));

    row.appendChild(dot); row.appendChild(main); row.appendChild(amtWrap); row.appendChild(del);
    list.appendChild(row);
  });
}

function addOp() {
  const amtEl = document.getElementById('opAmount');
  const amount = parseAmount(amtEl.value);
  if (!(amount > 0)) {
    amtEl.style.borderColor = '#B23A2E';
    amtEl.focus();
    setTimeout(() => { amtEl.style.borderColor = ''; }, 1200);
    return;
  }

  const currency = document.getElementById('opCurrency').value;
  const walletId = document.getElementById('opWallet').value;
  const w = findWallet(walletId);

  // на сколько изменить баланс кошелька (в валюте кошелька)
  let applied = 0;
  if (w) {
    if (w.currency === currency) {
      applied = amount;
    } else {
      const c = convert(amount, currency, w.currency);
      applied = (c == null) ? 0 : c; // без курса баланс не трогаем
    }
  }

  const t = {
    id: uid(),
    created: Date.now(),
    type: opType,
    date: document.getElementById('opDate').value || todayStr(),
    category: document.getElementById('opCategory').value,
    amount: amount,
    currency: currency,
    walletId: walletId,
    applied: applied,
    note: document.getElementById('opNote').value.trim()
  };
  transactions.push(t);
  lsSet(K.tx, transactions);

  // изменить баланс кошелька
  if (w && applied > 0) {
    w.amount = (parseAmount(w.amount) || 0) + (opType === 'income' ? applied : -applied);
    lsSet(K.wallets, wallets);
  }

  // показать месяц добавленной записи
  const p = t.date.split('-');
  viewMonth = { y: +p[0], m: +p[1] - 1 };
  renderMonthLabel();

  amtEl.value = '';
  document.getElementById('opNote').value = '';

  renderWallets(); renderHeroTotal();
  renderSummary(); renderOpList();

  if (w && applied === 0 && w.currency !== currency) {
    flashNote('Баланс кошелька не изменён: нет курса ' + currency + '→' + w.currency + '. Обновите курс.');
  }
}

function deleteTx(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  // вернуть баланс кошелька
  const w = findWallet(t.walletId);
  if (w && t.applied > 0) {
    w.amount = (parseAmount(w.amount) || 0) + (t.type === 'income' ? -t.applied : t.applied);
    lsSet(K.wallets, wallets);
  }
  transactions = transactions.filter(x => x.id !== id);
  lsSet(K.tx, transactions);
  renderWallets(); renderHeroTotal();
  renderSummary(); renderOpList();
}

let _noteTimer = null;
function flashNote(msg) {
  let el = document.getElementById('flashNote');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flashNote';
    el.className = 'flash-note';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_noteTimer);
  _noteTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ============================================================
   ЭКСПОРТ В STORIES (картинка 1080×1920)
   ============================================================ */
function roundRect(x, rx, ry, w, h, r) {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}

function buildStoryImage() {
  const W = 1080, H = 1920, PAD = 90;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');

  // фон
  const g = x.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, '#1F6F5C');
  g.addColorStop(1, '#0E3528');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  // подсчёты
  let total = 0;
  wallets.forEach(w => { const c = convert(w.amount || 0, w.currency, display); if (c != null) total += c; });

  const items = monthTx();
  let income = 0, expense = 0;
  const byCat = {};
  items.forEach(t => {
    const c = convert(t.amount || 0, t.currency, display);
    const v = (c == null) ? 0 : c;
    if (t.type === 'income') income += v;
    else { expense += v; byCat[t.category] = (byCat[t.category] || 0) + v; }
  });

  const mono = '"Roboto Mono", "DejaVu Sans Mono", monospace';
  const sans = 'system-ui, "Roboto", "Helvetica Neue", Arial, sans-serif';

  // шапка
  x.textBaseline = 'alphabetic';
  x.fillStyle = 'rgba(243,247,242,0.72)';
  x.font = '600 34px ' + sans;
  x.fillText('МОИ ФИНАНСЫ', PAD, 150);

  x.fillStyle = '#F3F7F2';
  x.font = '700 56px ' + sans;
  x.fillText(MONTHS_RU[viewMonth.m] + ' ' + viewMonth.y, PAD, 220);

  // главный итог
  x.fillStyle = 'rgba(243,247,242,0.72)';
  x.font = '400 38px ' + sans;
  x.fillText('Всего на всех кошельках', PAD, 380);

  x.fillStyle = '#FFFFFF';
  x.font = '700 118px ' + mono;
  let totalStr = fmt(total, display);
  // ужать шрифт, если строка длинная
  let fs = 118;
  while (x.measureText(totalStr).width > W - PAD * 2 && fs > 60) {
    fs -= 4; x.font = '700 ' + fs + 'px ' + mono;
  }
  x.fillText(totalStr, PAD, 490);

  // карточка месяца
  const cardY = 580, cardH = 250;
  x.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(x, PAD, cardY, W - PAD * 2, cardH, 36); x.fill();

  const colW = (W - PAD * 2) / 2;
  x.fillStyle = 'rgba(243,247,242,0.72)';
  x.font = '600 32px ' + sans;
  x.fillText('Приход', PAD + 44, cardY + 78);
  x.fillText('Расход', PAD + colW + 44, cardY + 78);

  x.fillStyle = '#9FE2C9';
  x.font = '700 56px ' + mono;
  x.fillText('+' + fmt(income, display), PAD + 44, cardY + 152);
  x.fillStyle = '#F3B0A6';
  x.fillText('−' + fmt(expense, display), PAD + colW + 44, cardY + 152);

  // топ категорий расходов
  let y = cardY + cardH + 110;
  x.fillStyle = 'rgba(243,247,242,0.72)';
  x.font = '600 34px ' + sans;
  x.fillText('Куда уходят деньги', PAD, y);
  y += 40;

  const used = EXPENSE_CATS.filter(c => byCat[c.key] > 0)
    .sort((a, b) => byCat[b.key] - byCat[a.key]).slice(0, 5);

  if (used.length === 0) {
    x.fillStyle = 'rgba(243,247,242,0.55)';
    x.font = '400 38px ' + sans;
    x.fillText('Расходов в этом месяце нет', PAD, y + 60);
  } else {
    const max = byCat[used[0].key] || 1;
    const barW = W - PAD * 2;
    used.forEach(c => {
      y += 96;
      x.fillStyle = '#F3F7F2';
      x.font = '600 40px ' + sans;
      x.fillText(c.label, PAD, y - 18);

      x.fillStyle = 'rgba(243,247,242,0.92)';
      x.font = '600 38px ' + mono;
      const valStr = fmt(byCat[c.key], display);
      x.textAlign = 'right';
      x.fillText(valStr, W - PAD, y - 18);
      x.textAlign = 'left';

      // полоса
      x.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(x, PAD, y, barW, 16, 8); x.fill();
      x.fillStyle = c.color;
      const wpx = Math.max(24, Math.round(byCat[c.key] / max * barW));
      roundRect(x, PAD, y, wpx, 16, 8); x.fill();
    });
  }

  // подвал
  x.fillStyle = 'rgba(243,247,242,0.55)';
  x.font = '400 30px ' + sans;
  x.textAlign = 'center';
  x.fillText('Мои финансы · курсы open.er-api.com', W / 2, H - 90);
  x.textAlign = 'left';

  return cv.toDataURL('image/png');
}

function exportStory() {
  let dataUrl;
  try { dataUrl = buildStoryImage(); }
  catch (e) { flashNote('Не удалось сделать картинку'); return; }

  if (window.AndroidShare && typeof window.AndroidShare.shareImage === 'function') {
    try {
      window.AndroidShare.shareImage(dataUrl);
      flashNote('Откройте Instagram → Истории и выберите картинку');
    } catch (e) {
      fallbackDownload(dataUrl);
    }
  } else {
    fallbackDownload(dataUrl);
  }
}

function fallbackDownload(dataUrl) {
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'moi-finansy-story.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) { flashNote('Сохранение недоступно в этом режиме'); }
}

/* ============================================================
   ОБЩЕЕ
   ============================================================ */
function renderAll() {
  renderHeroTotal();
  updateConv();
  renderWalletSelect();
  renderSummary();
  renderOpList();
}

function switchTab(tab) {
  document.getElementById('screen-balance').hidden = (tab !== 'balance');
  document.getElementById('screen-ops').hidden = (tab !== 'ops');
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function wire() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('displayCurrency').addEventListener('change', (ev) => {
    display = ev.target.value;
    lsSet(K.display, display);
    renderHeroTotal(); updateConv(); renderSummary(); renderOpList();
  });

  document.getElementById('refreshRates').addEventListener('click', refreshRates);
  document.getElementById('shareStory').addEventListener('click', exportStory);

  document.getElementById('addWallet').addEventListener('click', () => {
    wallets.push({ id: uid(), name: 'Новый кошелёк', currency: display, amount: 0 });
    lsSet(K.wallets, wallets);
    renderWallets(); renderHeroTotal(); renderWalletSelect();
    const inputs = document.querySelectorAll('#walletList .wallet-name');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  document.querySelectorAll('#typeToggle .type-btn').forEach(btn => {
    btn.addEventListener('click', () => setOpType(btn.dataset.type));
  });

  document.getElementById('addOp').addEventListener('click', addOp);

  document.getElementById('monthPrev').addEventListener('click', () => {
    viewMonth.m--; if (viewMonth.m < 0) { viewMonth.m = 11; viewMonth.y--; }
    renderMonthLabel(); renderSummary(); renderOpList();
  });
  document.getElementById('monthNext').addEventListener('click', () => {
    viewMonth.m++; if (viewMonth.m > 11) { viewMonth.m = 0; viewMonth.y++; }
    renderMonthLabel(); renderSummary(); renderOpList();
  });
}

function init() {
  renderDisplaySelect();
  renderWallets();
  renderHeroTotal();
  renderOpControls();
  renderMonthLabel();
  renderSummary();
  renderOpList();
  renderRateStatus();
  wire();

  const stale = !rates || !rates.fetchedAt || (Date.now() - rates.fetchedAt) > 6 * 3600 * 1000;
  if (stale) refreshRates();
}

document.addEventListener('DOMContentLoaded', init);
