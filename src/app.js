import { dateKey, daysAfter, problemState, practiceQueue } from './state.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#attempt');
const form = document.querySelector('#attempt-form');
const notice = document.querySelector('#storage-status');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));
const formatDate = key => new Intl.DateTimeFormat('en', {
  weekday: 'long', month: 'long', day: 'numeric'
}).format(new Date(key + 'T12:00:00'));

let data, state, activeProblem, pendingAttempt;
const attemptError = document.querySelector("#attempt-error");
let busy = false;
let version = 0;
let filters = { query: '', topic: '', status: '' };
const pageNames = ['today', 'problems', 'review', 'progress'];
const page = () => pageNames.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';

async function request(url, body) {
  const response = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

const historyFor = problem => state.attempts[problem.id] || [];
const current = problem => problemState(problem, historyFor(problem));
const plannedFor = problem => state.dates[problem.id] || problem.date;
const reviewQueue = () => data.problems.filter(problem => current(problem).due)
  .sort((a, b) => current(a).due.localeCompare(current(b).due));

function hero(label, title, metric, caption) {
  return `<section class="hero">
    <div class="hero-copy"><p class="eyebrow"><span class="accent-mark"></span>${label}</p><h1>${title}</h1></div>
    <div class="hero-stat"><strong>${metric}</strong><span>${caption}</span></div>
  </section>`;
}

function rows(problems, empty, withDue = false) {
  if (!problems.length) return `<p class="empty">${empty}</p>`;
  return `<ul class="problem-list">${problems.map(problem => {
    const { status, due } = current(problem);
    const title = escape(problem.title);
    return `<li class="problem"><div class="problem-name">
      ${problem.url ? `<a href="${escape(problem.url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}
      <span>${escape(problem.topic)}${withDue ? ' · ' + formatDate(due) : ''}</span>
    </div><span class="difficulty ${problem.difficulty.toLowerCase()}">${escape(problem.difficulty)}</span>
    <span class="problem-status">${status}</span>
    <button class="log-button" data-problem="${problem.id}">Log attempt</button></li>`;
  }).join('')}</ul>`;
}

function renderProblemResults() {
  const matching = data.problems.filter(problem =>
    problem.title.toLowerCase().includes(filters.query.trim().toLowerCase()) &&
    (!filters.topic || filters.topic === problem.topic) &&
    (!filters.status || filters.status === current(problem).status) &&
    (!filters.difficulty || filters.difficulty === problem.difficulty)
  );
  document.querySelector('#results').innerHTML =
    `<p class="result-count">${matching.length} problems</p>` + rows(matching, 'No problems match your filters.');
}

function render() {
  const view = page();
  const today = dateKey();
  const solved = data.problems.filter(problem => current(problem).solved).length;
  const queue = reviewQueue();
  const due = queue.filter(problem => current(problem).due <= today);
  const topics = [...new Set(data.problems.map(problem => problem.topic))];
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === '#' + view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (view === 'today') {
    const practice = practiceQueue(data.problems, state, today);
    const sessions = data.sessions.filter(session => session.date === today);
    const overdue = data.problems.some(problem => current(problem).status === 'New' && plannedFor(problem) < today);
    main.innerHTML = hero(formatDate(today), 'Today’s<br>practice<span class="period">.</span>', solved, `of ${data.problems.length} solved`) +
      `<div class="workspace"><section class="work-panel">
        <div class="section-head"><h2>Practice queue</h2>${overdue ? '<button class="quiet" id="replan">Replan from today</button>' : ''}</div>
        ${sessions.map(session => `<p class="session">${escape(session.title)}</p>`).join('')}
        ${rows(practice, 'No new problems scheduled today.')}
      </section><aside class="side-panel"><p class="eyebrow">Review due</p><strong class="big-count">${due.length}</strong>
        <p>${due.length ? escape(due[0].title) + ' is first in your queue.' : 'Your review queue is clear.'}</p>
        <a href="#review">Open review queue</a></aside></div>`;
  } else if (view === 'problems') {
    main.innerHTML = hero('Problem catalog', 'All problems<span class="period">.</span>', data.problems.length, 'in the catalog') +
      `<section class="content"><div class="filters">
      <label>Search <input id="search" type="search" placeholder="Find a problem" value="${escape(filters.query)}"></label>
      <label>Topic <select id="topic"><option value="">All topics</option>${topics.map(topic =>
        `<option ${filters.topic === topic ? 'selected' : ''}>${escape(topic)}</option>`).join('')}</select></label>
      <label>Status <select id="status"><option value="">All statuses</option>${['New', 'Redo', 'Done'].map(status =>
        `<option ${filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
      <label>Difficulty <select id="difficulty"><option value="">All levels</option>${['Easy', 'Medium', 'Hard'].map(level =>
        `<option ${filters.difficulty === level ? 'selected' : ''}>${level}</option>`).join('')}</select></label>
      </div><div id="results"></div></section>`;
    renderProblemResults();
  } else if (view === 'review') {
    main.innerHTML = hero('Revision queue', 'Review<span class="period">.</span>', due.length, 'due today') +
      `<section class="content"><div class="section-head"><h2>Ready to revisit</h2></div>${rows(due, 'You’re caught up on reviews.', true)}
       <div class="section-head spaced"><h2>Upcoming</h2></div>${rows(queue.slice(due.length), 'No upcoming reviews yet.', true)}</section>`;
  } else {
    main.innerHTML = hero('Practice history', 'Your progress<span class="period">.</span>', solved, `of ${data.problems.length} solved`) +
      `<section class="content"><div class="section-head"><h2>By topic</h2></div><div class="topic-grid">${topics.map(topic => {
        const items = data.problems.filter(problem => problem.topic === topic);
        const count = items.filter(problem => current(problem).solved).length;
        return `<div class="topic"><span>${escape(topic)}</span><span>${count} / ${items.length}</span>
          <progress value="${count}" max="${items.length}" aria-label="${escape(topic)}"></progress></div>`;
      }).join('')}</div></section>`;
  }
}

async function mutate(url, body) {
  busy = true;
  version++;
  notice.textContent = 'Saving…';
  try {
    state = await request(url, body);
    notice.textContent = 'Synced across devices';
    return true;
  } catch (error) {
    if (error.status === 401) location.reload();
    notice.textContent = 'Save failed: ' + error.message;
    if (dialog.open) {
      attemptError.hidden = false;
      attemptError.textContent = error.message;
    }
    return false;
  } finally {
    busy = false;
  }
}

function openAttempt(problem) {
  activeProblem = problem;
  pendingAttempt = null;
  form.reset();
  attemptError.hidden = true;
  document.querySelector('#attempt-title').textContent = problem.title;
  const history = historyFor(problem).slice().reverse();
  document.querySelector('#history').innerHTML = history.length || problem.status || problem.note ?
    `<h3>Previous attempts</h3>${history.map(attempt => `<p><strong>${escape(attempt.outcome)}</strong> · ${formatDate(attempt.date)}
    ${attempt.minutes ? ' · ' + attempt.minutes + ' min' : ''}<br>${escape(attempt.note)}</p>`).join('')}
    ${problem.status || problem.note ? `<p>From spreadsheet · ${escape(problem.status)}<br>${escape(problem.note)}</p>` : ''}` : '';
  dialog.showModal();
}

main.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || busy || !state) return;
  if (button.dataset.problem) openAttempt(data.problems.find(problem => problem.id === button.dataset.problem));
  if (button.id === 'replan') {
    const dates = {};
    const today = dateKey();
    let next = today;
    let index = 0;
    for (const problem of data.problems.filter(problem => current(problem).status === 'New')) {
      if (new Date(next + 'T12:00:00').getDay() === 0) next = daysAfter(next, 1);
      dates[problem.id] = next;
      if (++index % 3 === 0) next = daysAfter(next, 1);
    }
    if (await mutate('/api/plan', dates)) render();
  }
});

main.addEventListener('input', event => {
  const field = event.target.id;
  if (!['search', 'topic', 'status', 'difficulty'].includes(field)) return;
  filters[field === 'search' ? 'query' : field] = event.target.value;
  renderProblemResults();
});

document.querySelector('#close').onclick = () => { if (!busy) dialog.close(); };
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
form.addEventListener('input', () => { pendingAttempt = null; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const fields = new FormData(form);
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  pendingAttempt ||= {
    id: crypto.randomUUID(), problem: activeProblem.id, date: dateKey(),
    outcome: fields.get('outcome'), minutes: Number(fields.get('minutes')) || null, note: fields.get('note').trim(),
  };
  const saved = await mutate('/api/attempts', pendingAttempt);
  submit.disabled = false;
  if (saved) {
    dialog.close();
    render();
  } else {
    submit.textContent = 'Retry save';
  }
});
dialog.addEventListener('close', () => { form.querySelector('[type=submit]').textContent = 'Save attempt'; });

document.querySelector('#backup').onclick = () => {
  if (!state) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...state }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'loop-club-' + dateKey() + '.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function refresh() {
  if (!state || appShell.hidden || busy || dialog.open || document.visibilityState === 'hidden') return;
  const revision = version;
  try {
    const incoming = await request('/api/state');
    if (busy || revision !== version) return;
    const changed = JSON.stringify(state) !== JSON.stringify(incoming);
    state = incoming;
    if (changed && !appShell.hidden && !dialog.open) {
      if (page() === 'problems' && document.querySelector('#results')) renderProblemResults();
      else render();
    }
    notice.textContent = 'Synced across devices';
  } catch (error) {
    if (error.status === 401) location.reload();
    notice.textContent = 'Sync unavailable. Retrying…';
  }
}

const authScreen = document.querySelector('#auth-screen');
const authForm = document.querySelector('#auth-form');
const authError = document.querySelector('#auth-error');
const authSwitch = document.querySelector('#auth-switch');
const passwordField = authForm.elements.password;
const appShell = document.querySelector('.app-shell');
const landing = document.querySelector('#landing');
const landingAccount = document.querySelector('#landing-account');
const landingStart = document.querySelector('#landing-start');
let signingUp = false;
let initializationError = '';

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = !message;
}

function setAuthMode(createAccount) {
  signingUp = createAccount;
  const title = signingUp ? 'Create an account' : 'Sign in';
  document.querySelector('#auth-title').textContent = title;
  authForm.querySelector('[type=submit]').textContent = title;
  authSwitch.textContent = signingUp ? 'Back to sign in' : 'Create an account';
  passwordField.autocomplete = signingUp ? 'new-password' : 'current-password';
  passwordField.minLength = signingUp ? 12 : 1;
  passwordField.placeholder = signingUp ? 'At least 12 characters' : '';
  passwordField.value = '';
  showAuthError(initializationError);
}

authSwitch.onclick = () => { location.hash = signingUp ? 'sign-in' : 'sign-up'; };

authForm.onsubmit = async event => {
  event.preventDefault();
  const submit = authForm.querySelector('[type=submit]');
  submit.disabled = authSwitch.disabled = true;
  showAuthError('');
  try {
    await request(signingUp ? '/api/auth/sign-up' : '/api/auth/sign-in', Object.fromEntries(new FormData(authForm)));
    if (['#sign-in', '#sign-up'].includes(location.hash)) history.replaceState(null, '', '#today');
    location.reload();
  } catch (error) {
    showAuthError(error.message);
    submit.disabled = authSwitch.disabled = false;
  }
};

document.querySelector('#sign-out').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request('/api/auth/sign-out', {});
    history.replaceState(null, '', '#home');
    location.reload();
  } catch (error) {
    notice.textContent = 'Sign-out failed: ' + error.message;
    button.disabled = false;
  }
};

function showRoute() {
  const route = location.hash.slice(1);
  const showLanding = !route || route === 'home';
  const showApp = Boolean(state && data) && !showLanding;
  landing.hidden = !showLanding;
  appShell.hidden = !showApp;
  authScreen.hidden = showLanding || showApp;

  if (showApp) render();
  else if (!showLanding) setAuthMode(route === 'sign-up');
}

try {
  const saved = await request('/api/state');
  data = await request('./src/schedule.json');
  state = saved;
  landingAccount.href = landingStart.href = '#today';
  landingAccount.textContent = 'Today';
  landingStart.textContent = 'Open your tracker';
  notice.textContent = 'Synced across devices';
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 15_000);
} catch (error) {
  if (error.status !== 401) initializationError = error.message;
}

window.addEventListener('hashchange', showRoute);
showRoute();
