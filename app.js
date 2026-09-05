import { askAssistant, createCalendarEvent, isConnected, pullPocketAthleteTraining, requestDashboard, saveCapture, saveMetric, savePocketAthleteConfig, savePulse, saveReview, saveSocialReminder, saveTask, updateTask } from './src/api.js';
import { buildPlan } from './src/planner.js';
import { buildBriefing } from './src/briefing.js';
import { areaSplit, completionsByDay as completionsFor, domainStatus, daysUntil, momentumInsight, nextDeadline, streak } from './src/insights.js';
import { CAPABILITIES, matchTask, parseCommand } from './src/commands.js';
import { biometricFromMetric, canPushBiometrics, canReadTraining, pushBiometrics, readConfig as readPocketAthleteConfig, saveConfig as savePocketAthleteTokens } from './src/pocketathlete.js';

const taskList = document.querySelector('#task-list');
const focusCount = document.querySelector('#focus-count');
const toast = document.querySelector('#toast');
const briefingCopy = document.querySelector('#briefing-copy');
const assistantLog = document.querySelector('#assistant-log');
const assistantInput = document.querySelector('#assistant-input');
const pulseStatus = document.querySelector('#pulse-status');
const syncLabel = document.querySelector('#sync-label');
const emailList = document.querySelector('#email-list');
const socialList = document.querySelector('#social-list');
const agendaList = document.querySelector('#agenda-list');
const proposalList = document.querySelector('#proposal-list');
const attachmentName = document.querySelector('#attachment-name');
const trainingList = document.querySelector('#training-list');
const paStatus = document.querySelector('#pa-status');
let tasks = JSON.parse(localStorage.getItem('jarvis-tasks') || '[]');
let focusTimer;
let focusSeconds = 0;
let pendingImage = '';
let socialReminders = JSON.parse(localStorage.getItem('jarvis-social') || '[]');
let profile = JSON.parse(localStorage.getItem('jarvis-profile') || 'null') || { name: '', university: '', business: '', training: '' };
let metrics = JSON.parse(localStorage.getItem('jarvis-metrics') || '[]');
let objective = JSON.parse(localStorage.getItem('jarvis-objective') || 'null');
let reviews = JSON.parse(localStorage.getItem('jarvis-reviews') || '[]');
// Real history behind the performance panel. Focus minutes and energy were
// fixed strings in the markup; they are now only ever what was actually logged.
let focusLog = JSON.parse(localStorage.getItem('jarvis-focus-log') || '[]');
let pulseLog = JSON.parse(localStorage.getItem('jarvis-pulse-log') || '[]');
let training = JSON.parse(localStorage.getItem('jarvis-training') || 'null') || { configured: false, sessions: [] };
let calendarEvents = [];
let latestEmails = [];
// Which domain the queue is filtered to, or '' for all of them.
let areaFilter = '';
let plan = JSON.parse(localStorage.getItem('jarvis-plan') || 'null');
// Which reminders have already been announced, so a notification fires once
// rather than every time the scheduler ticks.
let announced = new Set(JSON.parse(localStorage.getItem('jarvis-announced') || '[]'));
let activeFocus = JSON.parse(localStorage.getItem('jarvis-active-focus') || 'null');

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return profile.name ? `${part}, ${profile.name}.` : `${part}.`;
}

function updateDate() {
  const now = new Date();
  document.querySelector('#current-date').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now).toUpperCase();
  document.querySelector('#page-title').textContent = greeting();
}

function agendaRow(time, title, detail, tagText, tagClass) {
  const item = document.createElement('div');
  item.className = 'agenda-item synced-event';
  const slot = document.createElement('time');
  slot.textContent = time;
  const copy = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const note = document.createElement('span');
  note.textContent = detail;
  copy.append(heading, note);
  const tag = document.createElement('b');
  tag.className = `tag ${tagClass}`;
  tag.textContent = tagText;
  item.append(slot, copy, tag);
  return item;
}

/**
 * Today, from both calendars at once.
 *
 * Google Calendar events have clock times; PocketAthlete sessions are all-day,
 * because the programme is ordered rather than scheduled. So a training session
 * is shown as "ALL DAY" and sorted to the top rather than given an invented
 * time — the feed's own comment is explicit that a made-up 18:00 would be a
 * fact it does not have.
 */
function renderAgenda() {
  const todaysTraining = training.sessions.filter((session) => session.date === localDate());
  const rows = [
    ...todaysTraining.map((session) => agendaRow('ALL DAY', session.title, session.exerciseCount ? `PocketAthlete • ${session.exerciseCount} exercises` : 'PocketAthlete', 'TRAINING', 'orange')),
    ...calendarEvents.slice(0, 6).map((event) => agendaRow(
      new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      event.title,
      event.location || 'Google Calendar',
      'CALENDAR',
      'blue'
    ))
  ];
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = isConnected()
      ? 'Nothing scheduled today.'
      : "Connect Google sync for today's calendar, and PocketAthlete for training days.";
    agendaList.replaceChildren(empty);
    return;
  }
  agendaList.replaceChildren(...rows);
}

function renderCalendar(events = []) {
  calendarEvents = events;
  renderAgenda();
}

function loadProfileFields() {
  document.querySelector('#profile-name').value = profile.name;
  document.querySelector('#profile-university').value = profile.university;
  document.querySelector('#profile-business').value = profile.business;
  document.querySelector('#profile-training').value = profile.training;
}

function updateSyncLabel() {
  syncLabel.textContent = isConnected() ? 'Google sync connected' : 'Local mode';
  // These three said LOCAL AI, READY and CADENCE whatever was true. The first
  // two now report whether the reasoning is running locally or on the backend,
  // which is the one thing about them worth knowing.
  const badge = isConnected() ? 'BACKEND' : 'LOCAL';
  document.querySelector('#briefing-badge').textContent = badge;
  document.querySelector('#assistant-badge').textContent = badge;
}

function collectLocalBackup() {
  // Version 2 adds the focus and pulse logs and the PocketAthlete connection.
  // A version 1 file still restores; it simply has none of those to restore.
  return { version: 2, exportedAt: new Date().toISOString(), profile, tasks, metrics, reviews, socialReminders, objective, focusLog, pulseLog, pocketAthlete: readPocketAthleteConfig(), apiUrl: localStorage.getItem('jarvis-api-url') || '' };
}

function restoreLocalBackup(backup) {
  if (!backup || (backup.version !== 1 && backup.version !== 2)) throw new Error('Unsupported backup version.');
  profile = backup.profile || profile;
  tasks = Array.isArray(backup.tasks) ? backup.tasks : tasks;
  metrics = Array.isArray(backup.metrics) ? backup.metrics : metrics;
  reviews = Array.isArray(backup.reviews) ? backup.reviews : reviews;
  socialReminders = Array.isArray(backup.socialReminders) ? backup.socialReminders : socialReminders;
  objective = backup.objective || objective;
  localStorage.setItem('jarvis-profile', JSON.stringify(profile));
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  localStorage.setItem('jarvis-metrics', JSON.stringify(metrics));
  localStorage.setItem('jarvis-reviews', JSON.stringify(reviews));
  localStorage.setItem('jarvis-social', JSON.stringify(socialReminders));
  localStorage.setItem('jarvis-objective', JSON.stringify(objective));
  if (backup.apiUrl) localStorage.setItem('jarvis-api-url', backup.apiUrl);
  focusLog = Array.isArray(backup.focusLog) ? backup.focusLog : focusLog;
  pulseLog = Array.isArray(backup.pulseLog) ? backup.pulseLog : pulseLog;
  localStorage.setItem('jarvis-focus-log', JSON.stringify(focusLog));
  localStorage.setItem('jarvis-pulse-log', JSON.stringify(pulseLog));
  // A malformed token in a backup must not take the whole restore down with it.
  if (backup.pocketAthlete) { try { savePocketAthleteTokens(backup.pocketAthlete); } catch (error) { showToast('Backup restored, but its PocketAthlete tokens were not valid.'); } }
  renderTasks(); renderMetrics(); renderSocialReminders(); renderObjective(); loadProfileFields(); updateDate(); updateSyncLabel(); renderPerformance(); renderTraining();
}

function renderEmails(emails = []) {
  latestEmails = emails;
  emailList.replaceChildren();
  if (!emails.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = isConnected() ? 'No important unread mail in the last three days.' : 'Connect Google sync to surface important mail without reading your whole inbox.';
    emailList.append(empty);
    return;
  }
  emails.forEach((email) => {
    const item = document.createElement('div');
    item.className = 'email-item';
    const copy = document.createElement('div');
    const subject = document.createElement('strong');
    subject.textContent = email.subject;
    const meta = document.createElement('small');
    meta.textContent = `${email.from} • ${new Date(email.receivedAt).toLocaleDateString()}`;
    copy.append(subject, meta);
    item.append(copy);
    emailList.append(item);
  });
}

function renderSocialReminders() {
  socialList.replaceChildren();
  if (!socialReminders.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No posting reminders yet.';
    socialList.append(empty);
    return;
  }
  socialReminders.slice().sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt)).forEach((reminder) => {
    const item = document.createElement('div');
    item.className = 'social-item';
    const topic = document.createElement('strong');
    topic.textContent = reminder.topic;
    const detail = document.createElement('small');
    detail.textContent = `${reminder.channel} • ${new Date(reminder.remindAt).toLocaleString()}`;
    item.append(topic, detail);
    socialList.append(item);
  });
}

function renderMetrics() {
  const list = document.querySelector('#metric-list');
  list.replaceChildren();
  if (!metrics.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Log a number to make progress visible.'; list.append(empty); return; }
  metrics.slice(-5).reverse().forEach((metric) => {
    const item = document.createElement('div');
    item.className = 'metric-item';
    const name = document.createElement('strong');
    name.textContent = metric.name;
    const value = document.createElement('span');
    value.textContent = `${metric.value} • ${metric.area}`;
    item.append(name, value);
    list.append(item);
  });
}

function createTaskFromForm() {
  const title = document.querySelector('#task-title').value.trim();
  if (!title) return null;
  return { id: Date.now(), title, detail: 'Added from command queue', type: document.querySelector('#task-type').value, priority: document.querySelector('#task-priority').value, dueAt: document.querySelector('#task-due').value, objective: document.querySelector('#task-objective').checked, done: false, completedAt: '' };
}

function applyDashboardSignals(dashboard) {
  renderEmails(dashboard?.importantEmails || []);
  if (!dashboard?.socialReminders) return;
  socialReminders = dashboard.socialReminders;
  localStorage.setItem('jarvis-social', JSON.stringify(socialReminders));
  renderSocialReminders();
  if (dashboard.metrics) { metrics = dashboard.metrics; localStorage.setItem('jarvis-metrics', JSON.stringify(metrics)); renderMetrics(); }
}

function notifyUpcoming() {
  if (!('Notification' in window)) { showToast('This browser cannot show notifications. Due items are listed in the app.'); renderReminderNote(); return; }
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      renderReminderNote();
      if (permission === 'granted') { runScheduler(); showToast('Reminders on. JARVIS will tell you when something is due.'); }
      else showToast('Reminders stayed off. Due items are still listed in the app.');
    });
    return;
  }
  if (Notification.permission !== 'granted') { showToast('Reminders are blocked in your browser settings for this site.'); renderReminderNote(); return; }
  const pending = socialReminders.filter((reminder) => !reminder.done && new Date(reminder.remindAt) > new Date()).length;
  runScheduler();
  showToast(pending ? `Reminders on. ${pending} scheduled.` : 'Reminders on. Nothing scheduled yet.');
}

function renderTasks() {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  /**
   * Open work, plus what you finished today.
   *
   * Completed tasks used to stay in the queue forever. Now that completions are
   * kept for the momentum panel that is a queue which only ever grows, and the
   * open work — the entire point of the panel — gets pushed off the bottom.
   * Today's are kept so ticking something still feels like something, and so a
   * mis-tick can be undone; older ones live in the history the panels below
   * count, not in the list of what to do next.
   */
  const visible = tasks.filter((task) => (!areaFilter || task.type === areaFilter)
    && (!task.done || !task.completedAt || localDate(new Date(task.completedAt)) === localDate()));
  const hidden = tasks.filter((task) => (!areaFilter || task.type === areaFilter) && task.done).length - visible.filter((task) => task.done).length;
  const orderedTasks = visible.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const priorityDifference = (priorityRank[a.priority || 'medium'] ?? 1) - (priorityRank[b.priority || 'medium'] ?? 1);
    if (priorityDifference) return priorityDifference;
    if (!a.dueAt && !b.dueAt) return 0;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return new Date(a.dueAt) - new Date(b.dueAt);
  });
  if (!orderedTasks.length) {
    // Previously the seeded tasks meant this could never be empty. It can now,
    // and an empty panel with no words in it reads as a broken one.
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = areaFilter
      ? `Nothing open under ${AREA_LABELS[areaFilter] || areaFilter}.`
      : 'Nothing queued. Add the one move that would make today count.';
    taskList.replaceChildren(empty);
    if (hidden > 0) {
      const note = document.createElement('p');
      note.className = 'muted queue-hidden';
      note.textContent = `${hidden} completed before today ${hidden === 1 ? 'is' : 'are'} kept in your history.`;
      taskList.append(note);
    }
    focusCount.textContent = '00';
    document.querySelector('#completed-count').textContent = '00';
    if (objective) renderObjective();
    renderLifeGrid();
    renderMomentum();
    return;
  }
  taskList.replaceChildren(...orderedTasks.map((task) => {
    const item = document.createElement('div');
    item.className = `task ${task.done ? 'done' : ''}${task.objective ? ' is-objective' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `task-${task.id}`;
    checkbox.dataset.taskId = task.id;
    checkbox.checked = task.done;
    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    const title = document.createElement('strong');
    title.textContent = task.title;
    const detail = document.createElement('small');
    const overdue = task.dueAt && !task.done && new Date(task.dueAt) < new Date();
    const due = task.dueAt ? `${overdue ? 'Overdue' : 'Due'} ${new Date(task.dueAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : task.detail;
    detail.textContent = due;
    if (overdue) detail.className = 'overdue';
    const badge = document.createElement('em');
    badge.className = `priority ${task.priority || 'medium'}`;
    badge.textContent = task.priority || 'medium';
    label.append(title, detail, badge);
    item.append(checkbox, label);
    return item;
  }));
  if (hidden > 0) {
    const note = document.createElement('p');
    note.className = 'muted queue-hidden';
    note.textContent = `${hidden} completed before today ${hidden === 1 ? 'is' : 'are'} kept in your history.`;
    taskList.append(note);
  }
  focusCount.textContent = String(tasks.filter((task) => !task.done).length).padStart(2, '0');
  document.querySelector('#completed-count').textContent = String(tasks.filter((task) => task.done).length).padStart(2, '0');
  if (objective) renderObjective();
  renderLifeGrid();
  renderMomentum();
}

/**
 * Filter the queue to one domain.
 *
 * This is what the life cards do now. Pressing the card that just told you
 * university work is slipping shows you that work, which is the next thing you
 * wanted; pressing it again clears the filter.
 */
function setAreaFilter(area) {
  areaFilter = areaFilter === area ? '' : area;
  document.querySelectorAll('[data-area]').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.area === areaFilter)));
  document.querySelector('#queue-eyebrow').textContent = areaFilter ? `COMMAND QUEUE • ${(AREA_LABELS[areaFilter] || areaFilter).toUpperCase()}` : 'COMMAND QUEUE';
  document.querySelector('#clear-filter').hidden = !areaFilter;
  renderTasks();
}

/** YYYY-MM-DD in the viewer's own timezone. Not toISOString(), which is UTC and
 *  files a late-evening completion under tomorrow anywhere east of Greenwich. */
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function setTaskDone(task, done) {
  task.done = done;
  // Stamped locally as well as in the sheet. Without it the only record of when
  // anything happened lived server-side, and the momentum panel had no real
  // numbers to draw — which is why it used to be a fixed 7.4 out of 10.
  task.completedAt = done ? new Date().toISOString() : '';
  persistTasks();
}

function persistTasks() {
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
}

/** Completions per day for the last `days` days, oldest first. */
function completionsByDay(days) {
  const buckets = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const key = localDate(day);
    buckets.push({ date: key, count: tasks.filter((task) => task.done && task.completedAt && localDate(new Date(task.completedAt)) === key).length });
  }
  return buckets;
}

const STATUS_WORDS = { slipping: 'SLIPPING', stalled: 'STALLED', moving: 'MOVING', quiet: 'QUIET', clear: 'CLEAR' };

function setCard(prefix, { value, note, status }) {
  document.querySelector(`#life-${prefix}-value`).textContent = value;
  document.querySelector(`#life-${prefix}-note`).textContent = note;
  const chip = document.querySelector(`#life-${prefix}-status`);
  chip.textContent = STATUS_WORDS[status] || '';
  chip.className = `life-status is-${status}`;
}

/**
 * The four life cards.
 *
 * They used to show a count of open work, which is the one number that cannot
 * tell you how an area is going: a long list can mean momentum or abandonment
 * and it looks identical either way. Each card now leads with a judgement —
 * slipping, stalled, moving, quiet, clear — computed in src/insights.js, and
 * the big figure is whatever is actually decision-relevant for that domain.
 *
 * They are also filters now rather than tab links. Pressing one shows only that
 * area's work in the queue, which is the thing you actually want after reading
 * that an area is slipping.
 */
function renderLifeGrid() {
  const now = new Date();
  const state = { tasks, now };

  // University runs on deadlines, so the number is time remaining, not volume.
  const study = domainStatus('study', state);
  const deadline = nextDeadline('study', state);
  const days = deadline ? daysUntil(deadline.dueAt, now) : null;
  setCard('study', {
    status: study.status,
    value: days === null ? (study.open ? String(study.open).padStart(2, '0') : '—') : days < 0 ? 'LATE' : days === 0 ? 'TODAY' : `${days}d`,
    note: deadline ? deadline.title : study.open ? `${study.open} open, no deadlines set` : 'Nothing open'
  });

  // Build runs on shipping rate: what left the queue, not what sits in it.
  const build = domainStatus('coding', state);
  setCard('build', {
    status: build.status,
    value: String(build.completedThisWeek).padStart(2, '0'),
    note: build.completedThisWeek
      ? `shipped this week • ${build.open} open`
      : build.open ? `nothing shipped in 7 days • ${build.open} open` : 'Nothing open'
  });

  // Business runs on the number you logged, with its movement.
  const business = domainStatus('business', state);
  const figures = metrics.filter((metric) => metric.area === 'business');
  const latest = figures[figures.length - 1];
  const previous = figures[figures.length - 2];
  const change = latest && previous ? Number(latest.value) - Number(previous.value) : null;
  setCard('business', {
    status: business.status,
    value: latest ? String(latest.value) : business.open ? String(business.open).padStart(2, '0') : '—',
    note: latest
      ? `${latest.name}${change === null ? '' : change > 0 ? ` • up ${Math.abs(change)}` : change < 0 ? ` • down ${Math.abs(change)}` : ' • unchanged'}`
      : business.open ? `${business.open} open, no numbers logged` : 'Nothing open'
  });

  renderTrainingCard();
}

/**
 * Training, from the feed when there is one.
 *
 * Its status comes from the programme rather than from the task list: a missed
 * session is the thing that matters here, and it never appears as a task.
 */
function renderTrainingCard() {
  const title = document.querySelector('#life-training-title');
  const week = training.configured ? weekSessions() : [];
  if (week.length) {
    const done = week.filter((session) => session.done).length;
    const missed = week.filter((session) => !session.done && session.date < localDate()).length;
    title.textContent = 'This week';
    setCard('training', {
      status: missed ? 'slipping' : done === week.length ? 'clear' : done ? 'moving' : 'quiet',
      value: `${String(done).padStart(2, '0')} / ${String(week.length).padStart(2, '0')}`,
      note: missed ? `${missed} session${missed === 1 ? '' : 's'} missed` : nextSession() ? `Next: ${nextSession().title}` : 'Week complete'
    });
    return;
  }
  const own = domainStatus('training', { tasks, now: new Date() });
  title.textContent = 'Training';
  setCard('training', {
    status: training.configured ? 'clear' : own.status,
    value: own.open ? String(own.open).padStart(2, '0') : '—',
    note: training.configured ? 'No sessions in your programme yet' : canReadTraining() ? 'Connect Google sync to read the feed' : 'Connect PocketAthlete'
  });
}

function withinDays(timestamp, days) {
  if (!timestamp) return false;
  const when = new Date(timestamp);
  return !Number.isNaN(when.getTime()) && when >= new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}


/** Monday-to-Sunday around today, matching how the programme is planned. */
function weekSessions() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const start = localDate(monday);
  const endDate = new Date(monday);
  endDate.setDate(monday.getDate() + 6);
  const end = localDate(endDate);
  return training.sessions.filter((session) => session.date >= start && session.date <= end);
}

function nextSession() {
  const today = localDate();
  return training.sessions.find((session) => !session.done && session.date >= today) || null;
}

const AREA_LABELS = { study: 'University', training: 'Training', coding: 'Build', business: 'Business', personal: 'Personal', other: 'Other' };

/**
 * Momentum.
 *
 * It counted completions this week. That is a real number and a useless one:
 * it goes up when you are busy and says nothing about whether the system
 * producing it is working, or which parts of your life are quietly getting
 * none of you.
 *
 * So it now leads with the STREAK — consecutive days with something finished,
 * the one figure here that changes behaviour — and shows WHERE THE EFFORT WENT
 * over a fortnight as a proportional bar. An area receiving nothing shows up as
 * an absent band, which is the thing a list of tasks structurally cannot tell
 * you. The line underneath is one observation, and only when the data actually
 * supports one.
 */
function renderMomentum() {
  const now = new Date();
  const run = streak(tasks, now);
  const days = completionsFor(tasks, 14, now);
  const thisWeek = days.slice(7).reduce((total, day) => total + day.count, 0);
  const lastWeek = days.slice(0, 7).reduce((total, day) => total + day.count, 0);

  document.querySelector('#momentum-value').textContent = String(run);
  document.querySelector('#momentum-unit').textContent = ' day streak';

  const trend = document.querySelector('#momentum-trend');
  const change = thisWeek - lastWeek;
  trend.classList.remove('is-down', 'is-flat');
  if (!thisWeek && !lastWeek) trend.textContent = '';
  else if (change > 0) trend.textContent = `+${change} vs last week`;
  else if (change < 0) { trend.textContent = `${change} vs last week`; trend.classList.add('is-down'); }
  else { trend.textContent = 'Level with last week'; trend.classList.add('is-flat'); }

  const peak = Math.max(1, ...days.map((day) => day.count));
  document.querySelector('#momentum-sparkline').replaceChildren(...days.map((day) => {
    const bar = document.createElement('i');
    bar.style.height = `${Math.round((day.count / peak) * 100)}%`;
    if (!day.count) bar.classList.add('is-empty');
    bar.title = `${new Date(`${day.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${day.count}`;
    return bar;
  }));
  document.querySelector('#momentum-week').textContent = thisWeek || lastWeek ? `${thisWeek + lastWeek} in 14 days` : '';

  const split = areaSplit(tasks, 14, now);
  const balance = document.querySelector('#momentum-balance');
  const total = split.reduce((sum, entry) => sum + entry.count, 0);
  balance.replaceChildren(...split.map((entry) => {
    const band = document.createElement('i');
    band.className = `area-${AREA_LABELS[entry.area] ? entry.area : 'other'}`;
    band.style.flex = String(entry.count);
    band.title = `${AREA_LABELS[entry.area] || entry.area}: ${entry.count} of ${total}`;
    return band;
  }));

  const key = document.querySelector('#momentum-key') || Object.assign(document.createElement('p'), { className: 'balance-key', id: 'momentum-key' });
  key.replaceChildren(...split.map((entry) => {
    const item = document.createElement('span');
    const swatch = document.createElement('b');
    swatch.className = `area-${AREA_LABELS[entry.area] ? entry.area : 'other'}`;
    const label = document.createElement('span');
    label.textContent = `${AREA_LABELS[entry.area] || entry.area} ${entry.count}`;
    item.append(swatch, label);
    return item;
  }));
  if (!key.isConnected) balance.after(key);
  key.hidden = !split.length;

  const insight = momentumInsight({ tasks, focusLog, now });
  const fortnight = thisWeek + lastWeek;
  document.querySelector('#momentum-note').textContent = insight
    || (fortnight ? `${fortnight} move${fortnight === 1 ? '' : 's'} completed in the last fortnight.` : 'Complete a move and this starts tracking.');
}

/**
 * The performance strip. "04h 20m deep work target" and "82% energy average"
 * were fixed text; both are now the logs, or a dash when the log is empty.
 */
function renderPerformance() {
  const minutes = focusLog.filter((entry) => withinDays(entry.completedAt, 7)).reduce((total, entry) => total + entry.minutes, 0);
  document.querySelector('#focus-total').textContent = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;

  const score = { low: 1, steady: 2, sharp: 3 };
  const week = pulseLog.filter((entry) => withinDays(entry.savedAt, 7));
  const average = document.querySelector('#energy-average');
  if (!week.length) { average.textContent = '—'; return; }
  const mean = week.reduce((total, entry) => total + (score[entry.pulse] || 2), 0) / week.length;
  average.textContent = mean >= 2.5 ? 'Sharp' : mean >= 1.5 ? 'Steady' : 'Low';
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * POCKETATHLETE
 *
 * Training comes IN through the Apps Script backend and readiness goes OUT
 * straight from this page, and that asymmetry is forced by the Worker rather
 * than chosen: /wearable-ingest sends CORS headers and /calendar does not.
 * src/pocketathlete.js has the long version.
 *
 * The practical consequence, and the one worth surfacing in the UI: pushing
 * readiness works with nothing else configured, while reading the programme
 * needs Google sync connected as well.
 * ───────────────────────────────────────────────────────────────────────────
 */
function renderTraining() {
  trainingList.replaceChildren();
  // The last three days as well as what is ahead: a session finished on Monday
  // is still the useful context for how Wednesday should be planned.
  const recent = new Date();
  recent.setDate(recent.getDate() - 3);
  const upcoming = training.sessions.filter((session) => session.date >= localDate(recent)).slice(0, 6);

  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = !canReadTraining()
      ? 'Add your PocketAthlete training feed token in Settings to see your programme here.'
      : training.configured
        ? 'No sessions in the feed yet. Start a programme in PocketAthlete.'
        : 'Connect Google sync, then refresh — the training feed is read by the backend.';
    trainingList.append(empty);
    renderPocketAthleteStatus();
    return;
  }

  upcoming.forEach((session) => {
    const item = document.createElement('div');
    item.className = `training-item${session.date === localDate() ? ' is-today' : ''}${session.done ? ' is-done' : ''}`;
    const when = document.createElement('time');
    const date = new Date(`${session.date}T00:00:00`);
    when.textContent = session.date === localDate() ? 'Today' : date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = session.title;
    const detail = document.createElement('small');
    // exerciseCount is exact; exerciseSummary is the feed's own sentence, shown
    // whole because its commas cannot be told apart from separators.
    detail.textContent = session.exerciseSummary || (session.exerciseCount ? `${session.exerciseCount} exercises` : 'Session');
    copy.append(title, detail);
    const tag = document.createElement('b');
    tag.className = `tag ${session.done ? 'green' : 'orange'}`;
    tag.textContent = session.done ? 'DONE' : 'PLANNED';
    item.append(when, copy, tag);
    trainingList.append(item);
  });
  renderPocketAthleteStatus();
}

function renderPocketAthleteStatus() {
  const parts = [];
  if (training.error) parts.push(training.error);
  else if (training.syncedAt) parts.push(`Training synced ${new Date(training.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
  parts.push(canPushBiometrics() ? 'Readiness pushes straight to PocketAthlete.' : 'Add a health push token to send sleep, HRV and resting heart rate.');
  paStatus.textContent = parts.join(' ');
  document.querySelector('#pa-push').disabled = !canPushBiometrics();
}

function applyTraining(payload) {
  if (!payload) return;
  training = { configured: Boolean(payload.configured), sessions: payload.sessions || [], syncedAt: payload.syncedAt || '', error: payload.error || '' };
  localStorage.setItem('jarvis-training', JSON.stringify(training));
  renderTraining();
  renderTrainingCard();
  renderAgenda();
  refreshBriefing();
}

/**
 * Mirror a metric into PocketAthlete when it has a home there.
 *
 * Sleep, HRV and resting heart rate are biometrics PocketAthlete builds
 * readiness from; study hours and revenue are not, and are not sent. Failure is
 * reported but never blocks the local save — the metric is already recorded.
 */
async function mirrorMetricToPocketAthlete(metric) {
  if (!canPushBiometrics()) return;
  const reading = biometricFromMetric(metric);
  if (!reading) return;
  try {
    await pushBiometrics({ ...reading, date: localDate(new Date(metric.createdAt)) });
    showToast('Metric logged and sent to PocketAthlete.');
  } catch (error) {
    showToast(`Metric logged. PocketAthlete: ${error.message}`);
  }
}

/**
 * Render the plan.
 *
 * A block is a BUTTON, not a row: the point of a planned block is that you can
 * start it. Clicking one begins a focus session of exactly that length against
 * exactly that task, which is what ties the timer to the work rather than
 * leaving it a stopwatch beside it.
 */
function renderPlan() {
  const panel = document.querySelector('#plan-panel');
  if (!plan || localDate(new Date(plan.builtAt)) !== localDate()) {
    // A plan from yesterday is not a plan. It is dropped rather than shown.
    if (plan) { plan = null; localStorage.removeItem('jarvis-plan'); }
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  document.querySelector('#plan-commitments').replaceChildren(...plan.commitments.map((item) => {
    const row = document.createElement('div');
    row.className = 'plan-commitment';
    const when = document.createElement('time');
    when.textContent = 'COMMITMENT';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = item.detail;
    copy.append(title, detail);
    row.append(when, copy);
    return row;
  }));

  document.querySelector('#plan-blocks').replaceChildren(...plan.blocks.map((block) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `plan-block${activeFocus && String(activeFocus.taskId) === String(block.taskId) ? ' is-active' : ''}`;
    const when = document.createElement('time');
    when.textContent = `${new Date(block.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(block.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const task = tasks.find((item) => String(item.id) === String(block.taskId));
    title.textContent = block.title;
    if (task && task.done) title.style.textDecoration = 'line-through';
    const detail = document.createElement('small');
    detail.textContent = `${block.minutes} min • ${block.detail}`;
    copy.append(title, detail);
    const go = document.createElement('span');
    go.className = 'plan-go';
    go.textContent = task && task.done ? 'DONE' : 'START';
    button.append(when, copy, go);
    button.addEventListener('click', () => startFocus(block.minutes, block.taskId, block.title));
    return button;
  }));

  const heading = document.querySelector('#plan-heading');
  heading.textContent = plan.blocks.length ? `${plan.blocks.length} block${plan.blocks.length === 1 ? '' : 's'}, ${plan.capacityMinutes} min still free` : 'Nothing scheduled';
  document.querySelector('#plan-note').textContent = plan.note;
}

/**
 * A focus session against a specific task.
 *
 * The timer used to be a bare 25-minute stopwatch that logged nothing about
 * what it was for, so "focus time logged" could never answer "on what". A
 * session now carries its task, and only a session that runs to zero is
 * recorded — an abandoned one is not focus time.
 */
function startFocus(minutes, taskId, title) {
  const button = document.querySelector('#focus-button');
  if (focusTimer) { window.clearInterval(focusTimer); focusTimer = null; }
  focusSeconds = Math.max(1, Math.round(minutes)) * 60;
  activeFocus = { taskId: taskId ?? null, title: title || 'Focus', minutes: Math.round(minutes), startedAt: new Date().toISOString() };
  localStorage.setItem('jarvis-active-focus', JSON.stringify(activeFocus));
  button.title = `Pause: ${activeFocus.title}`;
  // Painted immediately. setInterval's first tick is a second away, and a
  // button that still reads ◉ after you press it looks like it did nothing.
  button.textContent = `${String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:${String(focusSeconds % 60).padStart(2, '0')}`;
  focusTimer = window.setInterval(tickFocus, 1000);
  renderPlan();
  showToast(`${activeFocus.minutes} minutes on “${activeFocus.title}”.`);
}

function tickFocus() {
  const button = document.querySelector('#focus-button');
  focusSeconds -= 1;
  button.textContent = `${String(Math.floor(focusSeconds / 60)).padStart(2, '0')}:${String(focusSeconds % 60).padStart(2, '0')}`;
  if (focusSeconds > 0) return;
  window.clearInterval(focusTimer);
  focusTimer = null;
  button.textContent = '◉';
  button.title = 'Start a focus session';
  const finished = activeFocus || { minutes: 25, taskId: null, title: 'Focus' };
  focusLog = [...focusLog, { minutes: finished.minutes, taskId: finished.taskId, title: finished.title, completedAt: new Date().toISOString() }].slice(-200);
  localStorage.setItem('jarvis-focus-log', JSON.stringify(focusLog));
  activeFocus = null;
  localStorage.removeItem('jarvis-active-focus');
  renderPerformance();
  renderPlan();
  notify('Focus session complete', `${finished.minutes} minutes on ${finished.title}.`);
  showToast(`Logged ${finished.minutes} minutes on “${finished.title}”.`);
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * REMINDERS THAT ACTUALLY FIRE.
 *
 * The reminder button used to show one notification the moment it was pressed
 * and schedule nothing, so a posting reminder set for Thursday never arrived.
 * This checks every minute for anything now due — a posting reminder, a task
 * past its deadline, a training session still not done — and announces each
 * one once.
 *
 * ITS LIMIT IS STATED IN THE UI RATHER THAN HIDDEN. A page can only run its
 * timer while it is open. Firing reminders with the app closed needs Web Push
 * and a server holding a subscription, which a static GitHub Pages site cannot
 * be; promising it here would be the same trick in a new place. So anything
 * that came due while you were away is reported on the next open instead.
 * ───────────────────────────────────────────────────────────────────────────
 */
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try { new Notification(title, { body, tag: title, icon: 'manifest.webmanifest' }); return true; } catch (error) { return false; }
}

function dueItems(now = new Date()) {
  const due = [];
  socialReminders.filter((reminder) => !reminder.done && reminder.remindAt && new Date(reminder.remindAt) <= now)
    .forEach((reminder) => due.push({ id: `social-${reminder.id}`, title: `Post: ${reminder.topic}`, body: `${reminder.channel} • due ${new Date(reminder.remindAt).toLocaleString()}` }));
  tasks.filter((task) => !task.done && task.dueAt && new Date(task.dueAt) <= now)
    .forEach((task) => due.push({ id: `task-${task.id}-${task.dueAt}`, title: `Overdue: ${task.title}`, body: `Was due ${new Date(task.dueAt).toLocaleString()}` }));
  training.sessions.filter((session) => !session.done && session.date === localDate())
    .forEach((session) => due.push({ id: `training-${session.id}-${session.date}`, title: `Training today: ${session.title}`, body: session.exerciseCount ? `${session.exerciseCount} exercises` : 'PocketAthlete session' }));
  return due;
}

function runScheduler() {
  const fresh = dueItems().filter((item) => !announced.has(item.id));
  if (!fresh.length) return;
  fresh.forEach((item) => { notify(item.title, item.body); announced.add(item.id); });
  // Bounded, so a long-running install does not grow this forever.
  announced = new Set([...announced].slice(-300));
  localStorage.setItem('jarvis-announced', JSON.stringify([...announced]));
  renderReminderNote();
  if (Notification.permission !== 'granted') {
    showToast(`${fresh.length} thing${fresh.length === 1 ? '' : 's'} due. Turn on reminders to be told as it happens.`);
  }
}

function renderReminderNote() {
  const note = document.querySelector('#reminder-note');
  const pending = socialReminders.filter((reminder) => !reminder.done && reminder.remindAt && new Date(reminder.remindAt) > new Date()).length;
  document.querySelector('#social-badge').textContent = `${pending} SCHEDULED`;
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  note.textContent = permission === 'granted'
    ? 'Reminders fire while JARVIS is open in a tab. Anything that came due while it was closed is shown the next time you open it.'
    : permission === 'unsupported'
      ? 'This browser cannot show notifications, so reminders appear here rather than as alerts.'
      : 'Reminders are off. Turn them on with ♢ in the top bar to be told when something is due.';
}

/** What came due while the app was closed, said once on open. */
function reportMissed() {
  const missed = dueItems().filter((item) => !announced.has(item.id));
  if (!missed.length) return;
  addAssistantMessage(missed.length === 1
    ? `While you were away: ${missed[0].title}.`
    : `While you were away, ${missed.length} things came due: ${missed.slice(0, 4).map((item) => item.title).join('; ')}${missed.length > 4 ? '…' : ''}.`, 'assistant');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function briefingState() {
  return {
    now: new Date(),
    tasks,
    calendar: calendarEvents,
    training: training.sessions,
    plan,
    pulse: JSON.parse(localStorage.getItem('jarvis-pulse') || 'null'),
    emails: latestEmails,
    objective,
    focusLog
  };
}

/**
 * The briefing, and the hero line above it.
 *
 * Both come from one ranking in src/briefing.js, so the headline and the
 * paragraph under it cannot disagree about what today is about — which they
 * could when the hero was a fixed sentence in the markup and the briefing was
 * a separate three-branch template.
 */
function refreshBriefing() {
  const briefing = buildBriefing(briefingState());
  briefingCopy.textContent = briefing.note;
  document.querySelector('#hero-message').textContent = briefing.lead;
  const rest = briefing.signals.slice(1, 3).map((signal) => signal.lead);
  document.querySelector('#hero-note').textContent = rest.length
    ? `Then: ${rest.join(' ')}`
    : 'Nothing else is competing for your attention right now.';
}

function addAssistantMessage(text, role) {
  const message = document.createElement('div');
  message.className = `assistant-message ${role}`;
  const marker = document.createElement('span');
  marker.textContent = role === 'assistant' ? 'J' : 'YOU';
  const copy = document.createElement('p');
  copy.textContent = text;
  message.append(marker, copy);
  assistantLog.append(message);
  assistantLog.scrollTop = assistantLog.scrollHeight;
}

/**
 * Execute one offline instruction.
 *
 * The parse happens in src/commands.js and returns an intent; this does the
 * work and answers in words. Keeping those apart is what makes the offline
 * path testable — and it is why a misread instruction now shows up as the
 * wrong intent rather than as a plausible sentence about something that did
 * not happen.
 *
 * Every branch reports what it actually did, including when the answer is that
 * it could not find what you named.
 */
function handleAssistantCommand(command) {
  const parsed = parseCommand(command, { tasks, now: new Date() });

  if (parsed.intent === 'add') {
    const task = { id: Date.now(), title: parsed.title, detail: 'Added from the command line', type: parsed.area, priority: parsed.priority, dueAt: parsed.dueAt, objective: false, done: false, completedAt: '' };
    tasks.push(task);
    persistTasks();
    renderTasks();
    refreshBriefing();
    if (isConnected()) saveTask(task).catch(() => showToast('Added locally. Sync will retry later.'));
    const when = parsed.dueAt ? `, due ${new Date(parsed.dueAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    return `Added “${task.title}” as ${parsed.priority} priority ${parsed.area} work${when}.`;
  }

  if (parsed.intent === 'complete') {
    if (!parsed.task) return `I could not find an open move matching “${parsed.query}”. Try the exact words from the queue.`;
    setTaskDone(parsed.task, true);
    renderTasks();
    refreshBriefing();
    if (isConnected()) updateTask(parsed.task).catch(() => showToast('Completed locally. Sync will retry later.'));
    const left = tasks.filter((task) => !task.done).length;
    return `Marked “${parsed.task.title}” complete. ${left ? `${left} still open.` : 'That was the last one.'}`;
  }

  if (parsed.intent === 'due') {
    const dated = tasks.filter((task) => !task.done && task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    if (!dated.length) return 'Nothing in your queue has a deadline on it.';
    const now = new Date();
    return dated.slice(0, 5).map((task) => {
      const due = new Date(task.dueAt);
      return `${due < now ? 'OVERDUE' : due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} — ${task.title}`;
    }).join('\n');
  }

  if (parsed.intent === 'list') {
    const open = tasks.filter((task) => !task.done && (!parsed.area || task.type === parsed.area));
    if (!open.length) return parsed.area ? `Nothing open under ${parsed.area}.` : 'Your queue is clear.';
    return `${open.length} open${parsed.area ? ` in ${parsed.area}` : ''}:\n${open.slice(0, 8).map((task) => `${(task.priority || 'medium').toUpperCase()} — ${task.title}`).join('\n')}`;
  }

  if (parsed.intent === 'plan') { document.querySelector('#plan-day').click(); return plan?.blocks?.length ? `Planned ${plan.blocks.length} block${plan.blocks.length === 1 ? '' : 's'}. It is in Today's plan above.` : plan?.note || 'Nothing to schedule.'; }

  if (parsed.intent === 'focus') {
    if (parsed.query && !parsed.task) return `I could not find an open move matching “${parsed.query}”.`;
    const target = parsed.task || tasks.find((task) => !task.done);
    if (!target) return 'Nothing is open to focus on. Add a move first.';
    startFocus(parsed.minutes, target.id, target.title);
    return `${parsed.minutes} minutes on “${target.title}”. The timer is running in the top bar.`;
  }

  if (parsed.intent === 'pulse') { document.querySelector(`[data-pulse="${parsed.pulse}"]`)?.click(); return `Logged your energy as ${parsed.pulse}. Plan the day again and the blocks will resize around it.`; }

  if (parsed.intent === 'metric') {
    const metric = { id: Date.now(), name: parsed.name, value: parsed.value, area: parsed.area, unit: parsed.unit, createdAt: new Date().toISOString() };
    metrics.push(metric);
    localStorage.setItem('jarvis-metrics', JSON.stringify(metrics));
    renderMetrics();
    renderLifeGrid();
    if (isConnected()) saveMetric(metric).catch(() => null);
    mirrorMetricToPocketAthlete(metric);
    return `Logged ${parsed.name} ${parsed.value}${parsed.unit} under ${parsed.area}.`;
  }

  if (parsed.intent === 'objective') {
    objective = { text: parsed.text, savedAt: new Date().toISOString() };
    localStorage.setItem('jarvis-objective', JSON.stringify(objective));
    renderObjective();
    refreshBriefing();
    return `Weekly objective set: “${parsed.text}”. Tick “counts toward this week's objective” on the moves that serve it.`;
  }

  if (parsed.intent === 'training') {
    const today = training.sessions.filter((session) => session.date === localDate());
    if (!training.configured) return 'PocketAthlete is not connected. Add your training feed token in the PocketAthlete panel.';
    if (!today.length) return training.sessions.length ? `Nothing scheduled today. Next up: ${training.sessions.find((session) => !session.done)?.title || 'nothing planned'}.` : 'No sessions in your programme yet.';
    return today.map((session) => `${session.done ? 'Done' : 'Planned'} — ${session.title}${session.exerciseCount ? ` (${session.exerciseCount} exercises)` : ''}`).join('\n');
  }

  if (parsed.intent === 'briefing') {
    const briefing = buildBriefing(briefingState());
    return `${briefing.lead} ${briefing.note}`;
  }

  if (parsed.intent === 'help' || parsed.intent === 'unknown') {
    // The old fallback apologised and named a feature you might not have. This
    // lists what it can genuinely do right now, without a key or a network.
    const opener = parsed.intent === 'help'
      ? 'Offline I can do these, exactly as written:'
      : `I did not understand that.${parsed.reason ? ` ${parsed.reason}` : ''} Offline I understand these:`;
    return `${opener}\n${CAPABILITIES.map((line) => `• ${line}`).join('\n')}${isConnected() ? '' : '\nConnect Google sync, and add GROQ_API_KEY in Apps Script, for free-form language and screenshots.'}`;
  }

  return 'Say that again?';
}

function renderAssistantProposals(result) {
  proposalList.replaceChildren();
  const proposals = [...(result.tasks || []).map((task) => ({ kind: 'task', ...task })), ...(result.events || []).map((event) => ({ kind: 'event', ...event }))];
  proposals.forEach((proposal) => {
    const card = document.createElement('div');
    card.className = 'proposal-card';
    const copy = document.createElement('div');
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = proposal.kind === 'event' ? 'CALENDAR PROPOSAL' : 'TASK PROPOSAL';
    const title = document.createElement('strong');
    title.textContent = proposal.title;
    const detail = document.createElement('small');
    detail.textContent = proposal.kind === 'event' ? (proposal.start ? `${new Date(proposal.start).toLocaleString()}${proposal.end ? ` - ${new Date(proposal.end).toLocaleTimeString()}` : ''}` : 'Needs a date and time before it can be scheduled.') : (proposal.detail || proposal.type || 'JARVIS suggestion');
    copy.append(label, title, detail);
    const action = document.createElement('button');
    action.className = 'quiet-button proposal-action';
    action.textContent = proposal.kind === 'event' ? 'Add to calendar' : 'Add task';
    action.disabled = proposal.kind === 'event' && !proposal.start;
    action.addEventListener('click', async () => {
      action.disabled = true;
      if (proposal.kind === 'task') {
        const task = { id: Date.now(), title: proposal.title, detail: proposal.detail || 'Suggested by JARVIS', type: proposal.type || 'task', priority: proposal.priority || 'medium', dueAt: proposal.dueAt || '', done: false };
        tasks.push(task);
        localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
        renderTasks();
        if (isConnected()) await saveTask(task).catch(() => null);
        showToast('Task added to your queue.');
      } else if (isConnected()) {
        await createCalendarEvent(proposal).then(() => showToast('Added to Google Calendar.')).catch(() => { action.disabled = false; showToast('Calendar write failed.'); });
      } else {
        action.disabled = false;
        showToast('Connect Google sync before adding calendar events.');
      }
    });
    card.append(copy, action);
    proposalList.append(card);
  });
}

async function submitAssistantCommand(command) {
  if (!command.trim()) return;
  addAssistantMessage(`${command.trim()}${pendingImage ? ' [image attached]' : ''}`, 'user');
  assistantInput.value = '';
  const image = pendingImage;
  pendingImage = '';
  attachmentName.textContent = '';
  if (!isConnected()) {
    window.setTimeout(() => addAssistantMessage(image ? 'I have the image, but real image understanding starts after Google sync and Groq are connected.' : handleAssistantCommand(command), 'assistant'), 180);
    return;
  }
  addAssistantMessage('Reading that now...', 'assistant');
  try {
    const result = await askAssistant(command.trim(), image || undefined, profile);
    const response = result.reply || 'I found some useful context.';
    addAssistantMessage(response, 'assistant');
    if (result.questions?.length) addAssistantMessage(`Before I schedule anything: ${result.questions.join(' ')}`, 'assistant');
    renderAssistantProposals(result);
  } catch (error) {
    addAssistantMessage('I could not reach the AI service, so nothing was changed. Your local data is still safe.', 'assistant');
  }
}

taskList.addEventListener('change', (event) => {
  const id = String(event.target.dataset.taskId);
  const task = tasks.find((item) => String(item.id) === id);
  if (!task) return;
  setTaskDone(task, event.target.checked);
  renderTasks();
  if (isConnected()) updateTask(task).catch(() => showToast('Updated locally. Sync will retry later.'));
  refreshBriefing();
  showToast(task.done ? 'Move completed.' : 'Move restored.');
});

document.querySelector('#add-task').addEventListener('click', () => document.querySelector('#task-dialog').showModal());
document.querySelector('#task-cancel').addEventListener('click', () => document.querySelector('#task-dialog').close());
document.querySelector('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const task = createTaskFromForm();
  if (!task) return;
  tasks.push(task);
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  renderTasks();
  if (isConnected()) saveTask(task).catch(() => showToast('Added locally. Sync will retry later.'));
  document.querySelector('#task-form').reset();
  document.querySelector('#task-dialog').close();
  refreshBriefing();
  showToast('Added to your command queue.');
});

document.querySelector('#capture-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#capture-input');
  const type = document.querySelector('#capture-type').value;
  if (!input.value.trim()) return;
  tasks.push({ id: Date.now(), title: input.value.trim(), detail: `Quick capture • ${type}`, type, done: false });
  const capturedText = input.value.trim();
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  input.value = '';
  renderTasks();
  if (isConnected()) saveCapture(capturedText, type).catch(() => showToast('Captured locally. Sync will retry later.'));
  showToast('Captured. It is now in your queue.');
});
document.querySelector('#attach-button').addEventListener('click', () => document.querySelector('#assistant-file').click());
document.querySelector('#assistant-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) { showToast('Please keep screenshots under 6 MB.'); event.target.value = ''; return; }
  const reader = new FileReader();
  reader.addEventListener('load', () => { pendingImage = reader.result; attachmentName.textContent = `${file.name} attached`; });
  reader.readAsDataURL(file);
});
document.querySelector('#social-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const topic = document.querySelector('#social-topic').value.trim();
  const channel = document.querySelector('#social-channel').value;
  const remindAt = document.querySelector('#social-date').value;
  if (!topic || !remindAt) { showToast('Add a topic and reminder time.'); return; }
  const reminder = { id: Date.now(), topic, channel, remindAt, done: false };
  socialReminders.push(reminder);
  localStorage.setItem('jarvis-social', JSON.stringify(socialReminders));
  renderSocialReminders();
  if (isConnected()) saveSocialReminder(reminder).catch(() => showToast('Reminder saved locally. Sync will retry later.'));
  document.querySelector('#social-topic').value = '';
  renderReminderNote();
  showToast(new Date(remindAt) > new Date() ? `Reminder set for ${new Date(remindAt).toLocaleString()}.` : 'That time has already passed, so it is due now.');
});
document.querySelector('#refresh-signals').addEventListener('click', async () => {
  if (!isConnected()) { renderEmails(); showToast('Connect Google sync to read important mail.'); return; }
  try { applyDashboardSignals(await requestDashboard()); refreshBriefing(); showToast('Signals refreshed.'); } catch (error) { showToast('Could not refresh inbox signals.'); }
});
document.querySelector('#notify-button').addEventListener('click', notifyUpcoming);
document.querySelector('#metric-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.querySelector('#metric-name').value.trim();
  const value = document.querySelector('#metric-value').value;
  const area = document.querySelector('#metric-area').value;
  if (!name || value === '') { showToast('Add a metric name and value.'); return; }
  const metric = { id: Date.now(), name, value: Number(value), area, unit: '', createdAt: new Date().toISOString() };
  metrics.push(metric);
  localStorage.setItem('jarvis-metrics', JSON.stringify(metrics));
  renderMetrics();
  if (isConnected()) saveMetric(metric).catch(() => showToast('Metric saved locally. Sync will retry later.'));
  document.querySelector('#metric-name').value = '';
  document.querySelector('#metric-value').value = '';
  showToast('Metric logged.');
  mirrorMetricToPocketAthlete(metric);
  renderLifeGrid();
});
document.querySelector('#objective-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = document.querySelector('#objective-input').value.trim();
  if (!text) return;
  const lowerText = text.toLowerCase();
  const area = lowerText.includes('study') || lowerText.includes('assignment') ? 'study' : lowerText.includes('business') || lowerText.includes('revenue') ? 'business' : lowerText.includes('train') || lowerText.includes('gym') ? 'training' : 'coding';
  objective = { text, area, savedAt: new Date().toISOString() };
  localStorage.setItem('jarvis-objective', JSON.stringify(objective));
  renderObjective();
  refreshBriefing();
  document.querySelector('#objective-input').value = '';
  showToast('Weekly objective set.');
});

document.querySelector('#focus-button').addEventListener('click', () => {
  const button = document.querySelector('#focus-button');
  if (focusTimer) {
    window.clearInterval(focusTimer);
    focusTimer = null;
    button.textContent = '◉';
    button.title = 'Resume focus session';
    showToast('Focus session paused.');
    return;
  }
  if (activeFocus && focusSeconds > 0) { focusTimer = window.setInterval(tickFocus, 1000); button.title = `Pause: ${activeFocus.title}`; showToast('Focus session resumed.'); return; }
  // No block chosen, so it runs against the top of the queue rather than
  // against nothing — the timer should always know what it is for.
  const next = tasks.find((task) => !task.done);
  startFocus(25, next?.id ?? null, next?.title || 'Focus');
});
document.querySelector('#briefing-button').addEventListener('click', () => {
  refreshBriefing();
  const count = buildBriefing(briefingState()).signals.length;
  showToast(count ? `Re-read ${count} signal${count === 1 ? '' : 's'}.` : 'Nothing is competing for your attention.');
});
document.querySelector('#review-button').addEventListener('click', () => {
  document.querySelector('#review-dialog').showModal();
});
document.querySelector('#review-cancel').addEventListener('click', () => document.querySelector('#review-dialog').close());
document.querySelector('#review-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const note = document.querySelector('#review-note').value.trim();
  if (!note) return;
  const review = { note, savedAt: new Date().toISOString() };
  reviews.push(review);
  localStorage.setItem('jarvis-reviews', JSON.stringify(reviews.slice(-30)));
  localStorage.setItem('jarvis-last-review', JSON.stringify(review));
  if (isConnected()) saveReview(note).catch(() => showToast('Review saved locally. Sync will retry later.'));
  document.querySelector('#review-form').reset();
  document.querySelector('#review-dialog').close();
  showToast('Daily review saved locally.');
});
document.querySelectorAll('[data-pulse]').forEach((button) => button.addEventListener('click', () => {
  const pulse = button.dataset.pulse;
  const entry = { pulse, savedAt: new Date().toISOString() };
  localStorage.setItem('jarvis-pulse', JSON.stringify(entry));
  // Kept for 60 days: enough for a weekly average with room to look back, and
  // small enough that localStorage never becomes the reason the app is slow.
  pulseLog = [...pulseLog, entry].slice(-60);
  localStorage.setItem('jarvis-pulse-log', JSON.stringify(pulseLog));
  pulseStatus.textContent = pulse.toUpperCase();
  renderPerformance();
  refreshBriefing();
  if (isConnected()) savePulse(pulse).catch(() => showToast('Saved locally. Sync will retry when the backend returns.'));
  showToast(`Pulse logged: ${pulse}. Your plan can adapt around it.`);
}));
document.querySelector('#plan-day').addEventListener('click', () => {
  const pulse = JSON.parse(localStorage.getItem('jarvis-pulse') || 'null');
  // Yesterday's energy is not today's. An old check-in is ignored rather than
  // used to shape a day it knows nothing about.
  const energy = pulse && localDate(new Date(pulse.savedAt)) === localDate() ? pulse.pulse : 'steady';
  plan = { ...buildPlan({ now: new Date(), events: calendarEvents, training: training.sessions.filter((session) => session.date === localDate()), tasks, energy }), builtAt: new Date().toISOString(), energy };
  localStorage.setItem('jarvis-plan', JSON.stringify(plan));
  renderPlan();
  refreshBriefing();
  document.querySelector('#plan-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast(plan.blocks.length ? `Planned ${plan.blocks.length} block${plan.blocks.length === 1 ? '' : 's'} around your commitments.` : 'Nothing to schedule right now.');
});
document.querySelector('#plan-clear').addEventListener('click', () => {
  plan = null;
  localStorage.removeItem('jarvis-plan');
  renderPlan();
  refreshBriefing();
});
document.querySelector('#sync-control').addEventListener('click', async () => {
  const syncDialog = document.querySelector('#sync-dialog');
  const syncUrl = document.querySelector('#sync-url');
  syncUrl.value = localStorage.getItem('jarvis-api-url') || '';
  syncDialog.showModal();
});
document.querySelector('#profile-button').addEventListener('click', () => { loadProfileFields(); document.querySelector('#profile-dialog').showModal(); });
document.querySelector('#profile-cancel').addEventListener('click', () => document.querySelector('#profile-dialog').close());
document.querySelector('#profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  profile = { name: document.querySelector('#profile-name').value.trim(), university: document.querySelector('#profile-university').value.trim(), business: document.querySelector('#profile-business').value.trim(), training: document.querySelector('#profile-training').value.trim() };
  localStorage.setItem('jarvis-profile', JSON.stringify(profile));
  updateDate();
  document.querySelector('#profile-dialog').close();
  showToast('Your operating context is saved.');
});
document.querySelector('#export-data').addEventListener('click', () => {
  const file = new Blob([JSON.stringify(collectLocalBackup(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Backup exported.');
});
document.querySelector('#import-data').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try { restoreLocalBackup(JSON.parse(reader.result)); showToast('Backup restored.'); } catch (error) { showToast('That backup could not be restored.'); }
    event.target.value = '';
  });
  reader.readAsText(file);
});
document.querySelector('#sync-cancel').addEventListener('click', () => document.querySelector('#sync-dialog').close());
document.querySelector('#sync-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = document.querySelector('#sync-url').value;
  const cleanUrl = url.trim().replace(/\/$/, '');
  if (cleanUrl && !cleanUrl.includes('/exec')) {
    showToast('That does not look like an Apps Script /exec URL.');
    return;
  }
  if (cleanUrl) localStorage.setItem('jarvis-api-url', cleanUrl);
  else localStorage.removeItem('jarvis-api-url');
  updateSyncLabel();
  document.querySelector('#sync-dialog').close();
  if (!cleanUrl) { showToast('Local mode restored.'); return; }
  showToast('Testing Google sync...');
  try {
    const dashboard = await requestDashboard();
    if (dashboard?.tasks) {
      tasks = dashboard.tasks;
      localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
      renderTasks();
      refreshBriefing();
      renderCalendar(dashboard.calendar || []);
      applyTraining(dashboard.training);
    }
    showToast('Google sync connected.');
  } catch (error) {
    localStorage.removeItem('jarvis-api-url');
    updateSyncLabel();
    showToast('Could not connect. Local mode is still safe.');
  }
});
document.querySelector('#assistant-form').addEventListener('submit', (event) => { event.preventDefault(); submitAssistantCommand(assistantInput.value); });
// Enter sends; Shift+Enter starts a new line. The input is a textarea so that a
// pasted timetable can be several lines, but that also meant Enter typed a
// newline into a command line and nothing was ever sent by pressing it.
assistantInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submitAssistantCommand(assistantInput.value);
});
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => submitAssistantCommand(button.dataset.command)));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  const view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-section]').forEach((panel) => { panel.hidden = !panel.dataset.section.split(' ').includes(view); });
  document.querySelector('#page-title').textContent = view === 'overview' ? greeting() : `${view[0].toUpperCase()}${view.slice(1)} mode`;
}));
document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => document.querySelector(`[data-view="${button.dataset.viewTarget}"]`).click()));

document.querySelector('#pa-settings').addEventListener('click', () => {
  const config = readPocketAthleteConfig();
  document.querySelector('#pa-base').value = config.base;
  document.querySelector('#pa-calendar-token').value = config.calendarToken;
  document.querySelector('#pa-ingest-token').value = config.ingestToken;
  document.querySelector('#pa-dialog').showModal();
});
document.querySelector('#pa-cancel').addEventListener('click', () => document.querySelector('#pa-dialog').close());
document.querySelector('#pa-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  let config;
  try {
    // Accepts a whole subscription URL as well as a bare token. Pasting the
    // link is the obvious thing to do, and refusing it teaches nothing.
    config = savePocketAthleteTokens({
      base: document.querySelector('#pa-base').value,
      calendarToken: tokenFrom(document.querySelector('#pa-calendar-token').value, 'token'),
      ingestToken: tokenFrom(document.querySelector('#pa-ingest-token').value, 't')
    });
  } catch (error) {
    showToast(error.message);
    return;
  }
  document.querySelector('#pa-dialog').close();
  renderPocketAthleteStatus();
  renderTrainingCard();
  if (!config.calendarToken) { renderTraining(); showToast('PocketAthlete settings saved.'); return; }
  if (!isConnected()) { renderTraining(); showToast('Saved. Connect Google sync to read your training feed.'); return; }
  showToast('Saved. Reading your training feed...');
  try {
    await savePocketAthleteConfig(config);
    applyTraining((await pullPocketAthleteTraining())?.training);
    showToast(training.error || 'PocketAthlete connected.');
  } catch (error) {
    showToast('Saved, but the backend could not read the feed.');
  }
});

/**
 * A bare token, or the token out of a pasted URL.
 *
 * The two links use different parameter names — the calendar feed carries
 * ?token= and the health upload link carries ?t= — so the caller says which.
 */
function tokenFrom(value, parameter) {
  const raw = String(value || '').trim();
  if (!raw.includes('://')) return raw;
  try { return new URL(raw).searchParams.get(parameter) || raw; } catch (error) { return raw; }
}

document.querySelector('#pa-refresh').addEventListener('click', async () => {
  if (!canReadTraining()) { showToast('Add your training feed token in Settings first.'); return; }
  if (!isConnected()) { showToast("PocketAthlete's feed is read by the backend. Connect Google sync first."); return; }
  showToast('Refreshing training...');
  try {
    applyTraining((await pullPocketAthleteTraining())?.training);
    showToast(training.error || 'Training refreshed.');
  } catch (error) {
    showToast('Could not reach the backend.');
  }
});

document.querySelector('#pa-push').addEventListener('click', () => {
  if (!canPushBiometrics()) { showToast('Add your health push token in Settings first.'); return; }
  document.querySelector('#readiness-date').value = localDate();
  document.querySelector('#readiness-dialog').showModal();
});
document.querySelector('#readiness-cancel').addEventListener('click', () => document.querySelector('#readiness-dialog').close());
document.querySelector('#readiness-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const number = (selector) => {
    const value = document.querySelector(selector).value;
    return value === '' ? undefined : Number(value);
  };
  const reading = { date: document.querySelector('#readiness-date').value || localDate(), sleepHours: number('#readiness-sleep'), hrv: number('#readiness-hrv'), restingHR: number('#readiness-rhr') };
  try {
    const result = await pushBiometrics(reading);
    document.querySelector('#readiness-dialog').close();
    document.querySelector('#readiness-form').reset();
    // days: 0 is a success that changed nothing, because PocketAthlete refuses
    // to overwrite a value entered there by hand. Reported as what it is.
    showToast(result.days ? 'Sent to PocketAthlete.' : 'PocketAthlete kept the values you entered there by hand.');
    // Sleep is the one JARVIS also tracks, so it is worth keeping on both sides.
    if (Number.isFinite(reading.sleepHours)) {
      const metric = { id: Date.now(), name: 'Sleep', value: reading.sleepHours, area: 'wellbeing', unit: 'h', createdAt: new Date(`${reading.date}T08:00:00`).toISOString() };
      metrics.push(metric);
      localStorage.setItem('jarvis-metrics', JSON.stringify(metrics));
      renderMetrics();
      if (isConnected()) saveMetric(metric).catch(() => null);
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll('[data-area]').forEach((card) => card.addEventListener('click', () => setAreaFilter(card.dataset.area)));
document.querySelector('#clear-filter').addEventListener('click', () => setAreaFilter(''));

renderTasks();
renderPlan();
renderEmails();
renderSocialReminders();
renderMetrics();
renderObjective();
renderTraining();
renderAgenda();
renderLifeGrid();
renderMomentum();
renderPerformance();
refreshBriefing();
updateDate();
loadProfileFields();
updateSyncLabel();
renderReminderNote();
reportMissed();
runScheduler();
// Every minute: often enough that a reminder lands when it is due, rare enough
// to cost nothing. Also on focus, so a tab left open overnight catches up the
// moment you come back to it rather than on the next tick.
window.setInterval(runScheduler, 60000);
window.addEventListener('focus', runScheduler);
// A focus session interrupted by a reload should not silently vanish.
if (activeFocus) { document.querySelector('#focus-button').title = `Resume: ${activeFocus.title}`; }

// The manifest promised an installable app with nothing to serve it offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
const savedPulse = JSON.parse(localStorage.getItem('jarvis-pulse') || 'null');
if (savedPulse) pulseStatus.textContent = savedPulse.pulse.toUpperCase();

if (isConnected()) {
  requestDashboard().then((dashboard) => {
    if (!dashboard?.tasks) return;
    tasks = dashboard.tasks;
    localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
    renderTasks();
    refreshBriefing();
    applyDashboardSignals(dashboard);
    renderCalendar(dashboard.calendar || []);
    applyTraining(dashboard.training);
  }).catch(() => showToast('Offline mode active. Local data is safe.'));
}

function renderObjective() {
  const copy = document.querySelector('#objective-copy');
  const progress = document.querySelector('#objective-progress');
  if (!objective) { copy.textContent = 'Choose the outcome that would make this week feel meaningful.'; progress.textContent = '0%'; return; }
  const linked = tasks.filter((task) => task.objective);
  const completed = linked.filter((task) => task.done).length;
  copy.textContent = linked.length
    ? `${objective.text} — ${completed} of ${linked.length} linked moves done.`
    : `${objective.text} — tick “counts toward this week's objective” when adding a move to track it here.`;
  progress.textContent = `${linked.length ? Math.round((completed / linked.length) * 100) : 0}%`;
}