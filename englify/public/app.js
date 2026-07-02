/* Englify frontend */
'use strict';

const $ = id => document.getElementById(id);
const state = {
  config: null,
  user: null,
  view: 'login',
  exType: 'mix',      // selected mode
  current: null,      // current exercise
  answered: false,
  sessionCount: 0,
  selectedOption: -1,
  orderPicked: []
};

const TYPE_LABELS = {
  mchoice: 'Тест', gap: 'Пропуски', translate: 'Перевод',
  order: 'Конструктор', listen: 'Аудирование', mix: 'Микс'
};

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || ('HTTP ' + res.status));
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function snackbar(msg, ms = 3500) {
  const el = $('snackbar');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function show(view) {
  state.view = view;
  for (const v of ['login', 'home', 'exercise', 'premium', 'profile']) {
    $('view-' + v).hidden = v !== view;
  }
  $('appbar').hidden = view === 'login';
  if (view === 'home') renderHome();
  if (view === 'premium') renderPremium();
  if (view === 'profile') renderProfile();
  window.scrollTo(0, 0);
}

function renderAppbar() {
  const u = state.user;
  if (!u) return;
  $('xpVal').textContent = u.xp;
  $('streakVal').textContent = u.streak;
  $('avatarLetter').textContent = (u.name || '?')[0].toUpperCase();
  if (u.picture) {
    $('avatarImg').src = u.picture;
    $('avatarImg').hidden = false;
    $('avatarLetter').hidden = true;
  } else {
    $('avatarImg').hidden = true;
    $('avatarLetter').hidden = false;
  }
}

function renderHome() {
  const u = state.user;
  renderAppbar();
  $('greeting').textContent = `Привет, ${u.name.split(' ')[0]}!`;
  $('stDone').textContent = u.done;
  $('stAcc').textContent = u.done ? Math.round(u.correct / u.done * 100) + '%' : '—';
  $('stStreak').textContent = u.streak;
  $('stXp').textContent = u.xp;
  $('premiumBanner').hidden = u.premium;
  if (!u.premium) {
    $('premiumBannerText').textContent =
      `Сегодня использовано ${u.usedToday} из ${u.dailyLimit} бесплатных упражнений. Premium — безлимит и ИИ-проверка перевода.`;
  }
  // level chips
  const holder = $('levelChips');
  holder.innerHTML = '';
  for (const lvl of state.config.levels) {
    const b = document.createElement('button');
    b.className = 'level-chip' + (lvl === u.level ? ' active' : '');
    b.textContent = lvl;
    b.onclick = async () => {
      const { user } = await api('/api/level', { method: 'POST', body: { level: lvl } });
      state.user = user;
      renderHome();
    };
    holder.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function init() {
  state.config = await api('/api/config');
  try {
    const { user } = await api('/api/me');
    state.user = user;
    show('home');
  } catch {
    setupLogin();
    show('login');
  }
}

function setupLogin() {
  if (state.config.googleClientId) {
    const tryRender = () => {
      if (!window.google || !google.accounts) return setTimeout(tryRender, 200);
      google.accounts.id.initialize({
        client_id: state.config.googleClientId,
        callback: async resp => {
          try {
            const { user } = await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } });
            state.user = user;
            show('home');
          } catch (e) { snackbar(e.message); }
        }
      });
      google.accounts.id.renderButton($('googleBtnHolder'), {
        theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', width: 280
      });
    };
    tryRender();
  } else {
    $('devLoginHolder').hidden = false;
  }
}

$('btnDevLogin').onclick = async () => {
  try {
    const { user } = await api('/api/auth/dev', { method: 'POST', body: { name: $('devName').value } });
    state.user = user;
    show('home');
  } catch (e) { snackbar(e.message); }
};

$('btnLogout').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  setupLogin();
  show('login');
};

// ---------------------------------------------------------------------------
// Exercise flow
// ---------------------------------------------------------------------------
async function startExercises(type) {
  state.exType = type;
  state.sessionCount = 0;
  show('exercise');
  await loadExercise();
}

async function loadExercise() {
  const type = state.exType === 'mix' ? '' : state.exType;
  $('exBody').innerHTML = '';
  $('exFeedback').hidden = true;
  $('exLoading').hidden = false;
  $('btnCheck').hidden = true;
  $('btnNext').hidden = true;
  $('btnAiCheck').hidden = true;
  $('exSource').textContent = '';
  state.answered = false;
  state.selectedOption = -1;
  state.orderPicked = [];
  try {
    const data = await api(`/api/exercise?level=${state.user.level}&type=${type}`);
    state.current = data.exercise;
    state.sessionCount++;
    $('exLoading').hidden = true;
    $('exTypeLabel').textContent = TYPE_LABELS[data.exercise.type] || data.exercise.type;
    $('exLevelLabel').textContent = data.level;
    $('exCounter').textContent = data.premium ? `#${state.sessionCount}` : `${data.usedToday} / ${data.dailyLimit}`;
    $('exSource').textContent = data.source === 'ai'
      ? 'Задание сгенерировано ИИ ✦'
      : 'Базовое задание (ИИ уже готовит новые…)';
    renderExercise(data.exercise);
    $('btnCheck').hidden = false;
    $('btnCheck').disabled = false;
  } catch (e) {
    $('exLoading').hidden = true;
    if (e.status === 402) {
      $('exBody').innerHTML = `<div class="ex-question">Дневной лимит исчерпан 😔</div>
        <p class="muted">Возвращайтесь завтра или оформите Premium — безлимитные упражнения и ИИ-проверка.</p>`;
      const b = document.createElement('button');
      b.className = 'btn btn-primary';
      b.textContent = 'Оформить Premium';
      b.onclick = () => show('premium');
      $('exBody').appendChild(b);
    } else {
      $('exBody').innerHTML = `<div class="ex-question">Не удалось загрузить задание</div><p class="muted">${e.message}</p>`;
    }
  }
}

function renderExercise(ex) {
  const body = $('exBody');
  body.innerHTML = '';
  if (ex.type === 'mchoice') {
    body.innerHTML = `<div class="ex-question">${esc(ex.question)}</div><div class="options" id="optList"></div>`;
    ex.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'option';
      b.textContent = opt;
      b.onclick = () => {
        if (state.answered) return;
        state.selectedOption = i;
        document.querySelectorAll('.option').forEach((o, j) => o.classList.toggle('selected', j === i));
      };
      $('optList').appendChild(b);
    });
  } else if (ex.type === 'gap') {
    const parts = ex.sentence.split('___');
    const q = document.createElement('div');
    q.className = 'ex-question';
    q.append(parts[0] || '');
    const input = document.createElement('input');
    input.className = 'gap-input';
    input.id = 'gapInput';
    input.autocomplete = 'off';
    q.append(input, parts[1] || '');
    body.appendChild(q);
    if (ex.translation) body.insertAdjacentHTML('beforeend', `<p class="ex-hint">Перевод: ${esc(ex.translation)}</p>`);
    input.focus();
  } else if (ex.type === 'translate') {
    body.innerHTML = `<div class="ex-question">Переведите на английский:<br><b>${esc(ex.ru)}</b></div>` +
      (ex.hint ? `<p class="ex-hint">Подсказка: ${esc(ex.hint)}</p>` : '') +
      `<textarea class="text-input" id="translateInput" rows="2" placeholder="Ваш перевод…"></textarea>`;
    $('translateInput').focus();
  } else if (ex.type === 'order') {
    body.innerHTML = `<div class="ex-question">Соберите предложение:</div>` +
      (ex.ru ? `<p class="ex-hint">${esc(ex.ru)}</p>` : '') +
      `<div class="order-area" id="orderArea"></div><div class="order-bank" id="orderBank"></div>`;
    ex.words.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'word-chip';
      b.textContent = w;
      b.dataset.idx = i;
      b.onclick = () => {
        if (state.answered || b.classList.contains('used')) return;
        b.classList.add('used');
        state.orderPicked.push({ word: w, idx: i });
        renderOrderArea();
      };
      $('orderBank').appendChild(b);
    });
    renderOrderArea();
  } else if (ex.type === 'listen') {
    body.innerHTML = `<div class="ex-question">Прослушайте и напечатайте предложение:</div>
      <button class="listen-play" id="btnPlay"><span class="ico">🔊</span>Прослушать</button>
      <input class="text-input" id="listenInput" placeholder="Что вы услышали?" autocomplete="off">`;
    $('btnPlay').onclick = () => speak(ex.text);
    speak(ex.text);
  }
}

function renderOrderArea() {
  const area = $('orderArea');
  area.innerHTML = '';
  state.orderPicked.forEach((p, k) => {
    const b = document.createElement('button');
    b.className = 'word-chip';
    b.textContent = p.word;
    b.title = 'Убрать';
    b.onclick = () => {
      if (state.answered) return;
      state.orderPicked.splice(k, 1);
      document.querySelectorAll('#orderBank .word-chip')[p.idx].classList.remove('used');
      renderOrderArea();
    };
    area.appendChild(b);
  });
}

function speak(text) {
  if (!window.speechSynthesis) return snackbar('Ваш браузер не поддерживает озвучку');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.92;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9' ]/gi, '').replace(/\s+/g, ' ').trim();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('btnCheck').onclick = async () => {
  const ex = state.current;
  if (!ex || state.answered) return;
  let correct = false, feedback = '';

  if (ex.type === 'mchoice') {
    if (state.selectedOption === -1) return snackbar('Выберите вариант ответа');
    correct = state.selectedOption === ex.correct;
    document.querySelectorAll('.option').forEach((o, j) => {
      if (j === ex.correct) o.classList.add('right');
      else if (j === state.selectedOption && !correct) o.classList.add('wrong');
    });
    feedback = (correct ? 'Верно! ' : `Правильный ответ: «${ex.options[ex.correct]}». `) + (ex.explanation || '');
  } else if (ex.type === 'gap') {
    const v = $('gapInput').value;
    if (!norm(v)) return snackbar('Введите слово');
    correct = norm(v) === norm(ex.answer);
    feedback = (correct ? 'Верно! ' : `Правильный ответ: «${ex.answer}». `) + (ex.explanation || '');
  } else if (ex.type === 'translate') {
    const v = $('translateInput').value;
    if (!norm(v)) return snackbar('Введите перевод');
    correct = (ex.answers || []).some(a => norm(a) === norm(v));
    feedback = correct
      ? 'Отлично, перевод совпал с эталоном!'
      : `Эталонный перевод: «${ex.answers[0]}». Если считаете свой вариант верным — проверьте его с ИИ.`;
    if (!correct) $('btnAiCheck').hidden = false;
  } else if (ex.type === 'order') {
    if (!state.orderPicked.length) return snackbar('Соберите предложение из слов');
    const built = state.orderPicked.map(p => p.word).join(' ');
    correct = norm(built) === norm(ex.answer);
    feedback = correct ? 'Верно!' : `Правильно: «${ex.answer}»`;
  } else if (ex.type === 'listen') {
    const v = $('listenInput').value;
    if (!norm(v)) return snackbar('Напечатайте, что услышали');
    correct = norm(v) === norm(ex.text);
    feedback = correct ? 'Отличный слух!' : `Было сказано: «${ex.text}»` + (ex.ru ? ` — ${ex.ru}` : '');
  }

  state.answered = true;
  showFeedback(correct, feedback);
  $('btnCheck').hidden = true;
  $('btnNext').hidden = false;
  try {
    const { user } = await api('/api/result', { method: 'POST', body: { correct } });
    state.user = user;
    renderAppbar();
  } catch { /* non-fatal */ }
};

// Лама-маскот: хвалит за верные ответы и подбадривает при ошибках.
const LLAMA_PRAISE = [
  'Отлично! Так держать! 🎉', 'Молодец! Лама гордится тобой! 🧡', 'Верно! Ты на волне!',
  'Супер! Ещё одно? 😎', 'Идеально! Просто блеск!', 'Точно в цель! 🎯', 'Вот это уровень!'
];
const LLAMA_ENCOURAGE = [
  'Не беда — на ошибках учатся!', 'Почти получилось! Взгляни на разбор 👇',
  'Лама верит в тебя — попробуем ещё!', 'Ничего страшного, идём дальше!',
  'Ошибка — это шаг к успеху!', 'Спокойно, сейчас разберёмся 🤓'
];

function showFeedback(ok, text) {
  const fb = $('exFeedback');
  const list = ok ? LLAMA_PRAISE : LLAMA_ENCOURAGE;
  const phrase = list[Math.floor(Math.random() * list.length)];
  fb.className = 'ex-feedback ' + (ok ? 'ok' : 'bad');
  fb.innerHTML = `<span class="llama${ok ? ' llama-happy' : ''}">🦙</span>` +
    `<div class="llama-bubble"><b>${phrase}</b>${text ? '<br>' + esc(text) : ''}</div>`;
  fb.hidden = false;
}

$('btnAiCheck').onclick = async () => {
  const ex = state.current;
  const answer = $('translateInput') ? $('translateInput').value : '';
  $('btnAiCheck').disabled = true;
  $('btnAiCheck').innerHTML = '<span class="ico">⏳</span>ИИ проверяет…';
  try {
    const r = await api('/api/ai/check', { method: 'POST', body: { ru: ex.ru, expected: ex.answers[0], answer } });
    showFeedback(r.ok, 'ИИ: ' + r.comment);
    if (r.ok) {
      const { user } = await api('/api/result', { method: 'POST', body: { correct: true } });
      state.user = user;
      renderAppbar();
    }
  } catch (e) {
    snackbar(e.status === 402 ? 'Лимит исчерпан — нужен Premium' : e.message);
  }
  $('btnAiCheck').hidden = true;
  $('btnAiCheck').disabled = false;
  $('btnAiCheck').innerHTML = '<span class="ico">🧠</span>Проверить с ИИ';
};

$('btnNext').onclick = () => loadExercise();
$('btnExClose').onclick = () => show('home');
document.addEventListener('keydown', e => {
  if (state.view !== 'exercise' || e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  if (!state.answered && !$('btnCheck').hidden) $('btnCheck').click();
  else if (!$('btnNext').hidden) $('btnNext').click();
});

document.querySelectorAll('.type-card').forEach(c => {
  c.onclick = () => startExercises(c.dataset.type);
});

// ---------------------------------------------------------------------------
// Premium
// ---------------------------------------------------------------------------
function renderPremium() {
  const u = state.user, cfg = state.config;
  $('premPrice').textContent = cfg.premiumPriceRub;
  $('payPrice').textContent = cfg.premiumPriceRub;
  $('premDays').textContent = cfg.premiumDays;
  $('freeLimitText').textContent = `${u.dailyLimit} упражнений в день`;
  $('payCode').innerHTML = `${esc(u.payCode)} <span class="ico">content_copy</span>`;
  if (cfg.donateUrl) {
    $('donateLink').href = cfg.donateUrl;
    $('donateLink').hidden = false;
    $('donateNotConfigured').hidden = true;
  } else {
    $('donateLink').hidden = true;
    $('donateNotConfigured').hidden = false;
  }
  $('premiumActiveCard').hidden = !u.premium;
  $('payCard').hidden = u.premium;
  if (u.premium) {
    $('premiumUntilText').textContent = new Date(u.premiumUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  $('payStatus').textContent = cfg.daConnected ? '' : 'Приём платежей ещё не настроен владельцем сайта (DonationAlerts не подключен).';
}

$('payCode').onclick = () => {
  navigator.clipboard.writeText(state.user.payCode).then(() => snackbar('Код скопирован: ' + state.user.payCode));
};

$('btnCheckPay').onclick = async () => {
  $('btnCheckPay').disabled = true;
  try {
    const r = await api('/api/subscription/check', { method: 'POST' });
    state.user = r.user;
    if (r.user.premium) {
      snackbar('Premium активирован! Спасибо за поддержку 💙');
      renderPremium();
      renderAppbar();
    } else {
      snackbar(r.checked
        ? 'Платёж пока не найден. Донаты доходят за 1–2 минуты, попробуйте ещё раз.'
        : ('Не удалось проверить: ' + (r.reason || 'ошибка')));
    }
  } catch (e) { snackbar(e.message); }
  $('btnCheckPay').disabled = false;
};

$('btnGoPremium').onclick = () => show('premium');
$('btnBannerPremium').onclick = () => show('premium');
$('btnPremiumBack').onclick = () => show('home');

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function renderProfile() {
  const u = state.user;
  $('profileName').textContent = u.name;
  $('profileEmail').textContent = u.email || '';
  $('profileLetter').textContent = (u.name || '?')[0].toUpperCase();
  if (u.picture) { $('profileImg').src = u.picture; $('profileImg').hidden = false; $('profileLetter').hidden = true; }
  else { $('profileImg').hidden = true; $('profileLetter').hidden = false; }
  $('profilePremium').innerHTML = u.premium
    ? `<span class="c-green">● Premium до ${new Date(u.premiumUntil).toLocaleDateString('ru-RU')}</span>`
    : '<span class="muted">Бесплатный план</span>';
  $('pDone').textContent = u.done;
  $('pAcc').textContent = u.done ? Math.round(u.correct / u.done * 100) + '%' : '—';
  $('pStreak').textContent = u.streak;
  $('pXp').textContent = u.xp;
}

$('avatarBtn').onclick = () => show('profile');
$('btnProfileBack').onclick = () => show('home');
$('logoHome').onclick = e => { e.preventDefault(); if (state.user) show('home'); };

init().catch(e => snackbar('Ошибка запуска: ' + e.message));
