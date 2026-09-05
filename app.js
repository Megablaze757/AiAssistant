import { askAssistant, createCalendarEvent, isConnected, pullPocketAthleteTraining, requestDashboard, saveCapture, saveMetric, savePocketAthleteConfig, savePulse, saveReview, saveSocialReminder, saveTask, updateTask } from './src/api.js';
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
  return { id: Date.now(), title, detail: 'Added from command queue', type: document.querySelector('#task-type').value, priority: document.querySelector('#task-priority').value, dueAt: document.querySelector('#task-due').value, done: false };
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
  if (!('Notification' in window)) { showToast('This browser does not support reminders.'); return; }
  if (Notification.permission === 'default') { Notification.requestPermission().then((permission) => { if (permission === 'granted') notifyUpcoming(); }); return; }
  if (Notification.permission !== 'granted') { showToast('Reminders are blocked in browser settings.'); return; }
  const upcoming = socialReminders.find((reminder) => !reminder.done && new Date(reminder.remindAt) > new Date() && new Date(reminder.remindAt) < new Date(Date.now() + 24 * 60 * 60 * 1000));
  new Notification('JARVIS reminders enabled', { body: upcoming ? `${upcoming.channel}: ${upcoming.topic}` : 'I will keep an eye on your upcoming posting reminders.' });
  showToast('Browser reminders are enabled.');
}

function renderTasks() {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const orderedTasks = tasks.slice().sort((a, b) => {
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
    empty.textContent = 'Nothing queued. Add the one move that would make today count.';
    taskList.replaceChildren(empty);
    focusCount.textContent = '00';
    document.querySelector('#completed-count').textContent = '00';
    if (objective) renderObjective();
    renderLifeGrid();
    renderMomentum();
    return;
  }
  taskList.replaceChildren(...orderedTasks.map((task) => {
    const item = document.createElement('div');
    item.className = `task ${task.done ? 'done' : ''}`;
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
  focusCount.textContent = String(tasks.filter((task) => !task.done).length).padStart(2, '0');
  document.querySelector('#completed-count').textContent = String(tasks.filter((task) => task.done).length).padStart(2, '0');
  if (objective) renderObjective();
  renderLifeGrid();
  renderMomentum();
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

function openTasksIn(...types) {
  return tasks.filter((task) => !task.done && types.includes(task.type));
}

function latestMetric(area) {
  return metrics.filter((metric) => metric.area === area).slice(-1)[0] || null;
}

function setCard(prefix, value, note) {
  document.querySelector(`#life-${prefix}-value`).textContent = value;
  document.querySelector(`#life-${prefix}-note`).textContent = note;
}

/**
 * The four life cards, from data that exists.
 *
 * Each of these was a hardcoded string — "03h 20m", "04 / 05", "72%", "On
 * track" — that never changed whatever you did. A card with nothing behind it
 * now says so rather than inventing a number.
 */
function renderLifeGrid() {
  const study = openTasksIn('study');
  const nextStudy = study.filter((task) => task.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  setCard('study', study.length ? String(study.length).padStart(2, '0') : '—',
    nextStudy ? `Next due ${new Date(nextStudy.dueAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : study.length ? 'No deadlines set' : 'Nothing open');

  const build = openTasksIn('coding');
  const shipped = tasks.filter((task) => task.type === 'coding' && task.done && withinDays(task.completedAt, 7)).length;
  setCard('build', build.length ? String(build.length).padStart(2, '0') : '—',
    shipped ? `${shipped} shipped this week` : build.length ? 'Nothing shipped yet this week' : 'Nothing open');

  const business = openTasksIn('business');
  const revenue = latestMetric('business');
  setCard('business', business.length ? String(business.length).padStart(2, '0') : '—',
    revenue ? `${revenue.name}: ${revenue.value}` : business.length ? 'No numbers logged' : 'Nothing open');

  renderTrainingCard();
}

function withinDays(timestamp, days) {
  if (!timestamp) return false;
  const when = new Date(timestamp);
  return !Number.isNaN(when.getTime()) && when >= new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * The training card, from the PocketAthlete feed when there is one.
 *
 * Falls back to JARVIS's own training tasks rather than to an invented "04 /
 * 05" — the honest answer to "no feed connected" is what you typed in yourself.
 */
function renderTrainingCard() {
  const title = document.querySelector('#life-training-title');
  if (training.configured && training.sessions.length) {
    const week = weekSessions();
    title.textContent = 'This week';
    setCard('training', `${String(week.filter((session) => session.done).length).padStart(2, '0')} / ${String(week.length).padStart(2, '0')}`,
      nextSession() ? `Next: ${nextSession().title}` : 'Week complete');
    return;
  }
  const open = openTasksIn('training');
  title.textContent = 'Training';
  setCard('training', open.length ? String(open.length).padStart(2, '0') : '—',
    training.configured ? 'No sessions in your programme yet' : canReadTraining() ? 'Connect Google sync to read the feed' : 'Connect PocketAthlete');
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

/**
 * Momentum, from completions rather than from CSS.
 *
 * The old panel drew twelve bars whose heights were nth-child rules in the
 * stylesheet, under a 7.4/10 and a +12% that were typed into the markup. All
 * three now come from completedAt stamps, and read zero when nothing was done.
 */
function renderMomentum() {
  const days = completionsByDay(14);
  const thisWeek = days.slice(7).reduce((total, day) => total + day.count, 0);
  const lastWeek = days.slice(0, 7).reduce((total, day) => total + day.count, 0);
  document.querySelector('#momentum-value').textContent = String(thisWeek);

  const trend = document.querySelector('#momentum-trend');
  const change = thisWeek - lastWeek;
  trend.classList.remove('is-down', 'is-flat');
  if (!thisWeek && !lastWeek) { trend.textContent = ''; }
  else if (change > 0) { trend.textContent = `+${change} vs last week`; }
  else if (change < 0) { trend.textContent = `${change} vs last week`; trend.classList.add('is-down'); }
  else { trend.textContent = 'Level with last week'; trend.classList.add('is-flat'); }

  const peak = Math.max(1, ...days.map((day) => day.count));
  document.querySelector('#momentum-sparkline').replaceChildren(...days.map((day) => {
    const bar = document.createElement('i');
    bar.style.height = `${Math.round((day.count / peak) * 100)}%`;
    if (!day.count) bar.classList.add('is-empty');
    bar.title = `${new Date(`${day.date}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}: ${day.count}`;
    return bar;
  }));

  document.querySelector('#momentum-note').textContent = thisWeek || lastWeek
    ? `${thisWeek + lastWeek} moves completed in the last fortnight.`
    : 'Complete a move and this starts tracking.';
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function refreshBriefing() {
  const openTasks = tasks.filter((task) => !task.done);
  const businessTasks = openTasks.filter((task) => task.type === 'business');
  if (!openTasks.length) {
    briefingCopy.textContent = 'Your queue is clear. Use the space to plan tomorrow or record what worked today.';
  } else if (businessTasks.length) {
    briefingCopy.textContent = `Start with “${businessTasks[0].title}”. It keeps your business signal visible before the day gets noisy.`;
  } else {
    briefingCopy.textContent = `Start with “${openTasks[0].title}”, then protect the first deep-work block before opening new work.`;
  }
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

function handleAssistantCommand(command) {
  const normalized = command.toLowerCase();
  if (normalized.includes('add') || normalized.includes('create')) {
    const title = command.replace(/^(add|create)(\s+a)?(\s+task)?(\s+to)?\s*/i, '').trim() || 'New JARVIS task';
    const task = { id: Date.now(), title, detail: 'Added through command line', type: normalized.includes('business') ? 'business' : 'task', priority: 'medium', dueAt: '', done: false };
    tasks.push(task);
    localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
    renderTasks();
    refreshBriefing();
    if (isConnected()) saveTask(task).catch(() => showToast('Added locally. Sync will retry later.'));
    return `Added “${title}” to your queue.`;
  }
  if (normalized.includes('open') || normalized.includes('next') || normalized.includes('should')) {
    const next = tasks.find((task) => !task.done);
    return next ? `Your next move is “${next.title}”. ${next.detail}.` : 'Your queue is clear. This is a good moment to plan the next meaningful outcome.';
  }
  if (normalized.includes('complete') || normalized.includes('done')) {
    const next = tasks.find((task) => !task.done);
    if (!next) return 'There are no open tasks to complete.';
    setTaskDone(next, true);
    renderTasks();
    refreshBriefing();
    if (isConnected()) updateTask(next).catch(() => showToast('Completed locally. Sync will retry later.'));
    return `Marked “${next.title}” complete. Keep the momentum intentional.`;
  }
  return 'I can help with your next move, open work, or adding a task. Connect the Apps Script backend for richer AI reasoning.';
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
  showToast('Posting reminder added.');
});
document.querySelector('#refresh-signals').addEventListener('click', async () => {
  if (!isConnected()) { renderEmails(); showToast('Connect Google sync to read important mail.'); return; }
  try { applyDashboardSignals(await requestDashboard()); showToast('Signals refreshed.'); } catch (error) { showToast('Could not refresh inbox signals.'); }
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
  focusSeconds = focusSeconds || 25 * 60;
  button.title = 'Pause focus session';
  focusTimer = window.setInterval(() => {
    focusSeconds -= 1;
    const minutes = String(Math.floor(focusSeconds / 60)).padStart(2, '0');
    const seconds = String(focusSeconds % 60).padStart(2, '0');
    button.textContent = `${minutes}:${seconds}`;
    if (focusSeconds <= 0) {
      window.clearInterval(focusTimer);
      focusTimer = null;
      button.textContent = '◉';
      button.title = 'Start another focus session';
      // Only a session that RAN TO ZERO is logged. Counting a paused one would
      // make "focus time logged" the same kind of decoration it replaced.
      focusLog = [...focusLog, { minutes: 25, completedAt: new Date().toISOString() }].slice(-200);
      localStorage.setItem('jarvis-focus-log', JSON.stringify(focusLog));
      renderPerformance();
      showToast('Focus session complete. Log the win before moving on.');
    }
  }, 1000);
  showToast('25-minute focus session started.');
});
document.querySelector('#briefing-button').addEventListener('click', () => { refreshBriefing(); showToast('Briefing refreshed from your local queue.'); });
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
  if (isConnected()) savePulse(pulse).catch(() => showToast('Saved locally. Sync will retry when the backend returns.'));
  showToast(`Pulse logged: ${pulse}. Your plan can adapt around it.`);
}));
document.querySelector('#plan-day').addEventListener('click', () => {
  const pulse = JSON.parse(localStorage.getItem('jarvis-pulse') || 'null')?.pulse;
  const message = pulse === 'low' ? 'Low-energy plan: one essential study block, a lighter training session, and an early shutdown.' : pulse === 'sharp' ? 'High-energy plan: protect deep code work first, then use the afternoon for business decisions.' : 'Balanced plan: study first, train later, and leave one clean block for the business.';
  document.querySelector('#hero-message').textContent = message;
  showToast('Your day has been shaped around your current energy.');
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

renderTasks();
refreshBriefing();
renderEmails();
renderSocialReminders();
renderMetrics();
renderObjective();
renderTraining();
renderAgenda();
renderLifeGrid();
renderMomentum();
renderPerformance();
updateDate();
loadProfileFields();
updateSyncLabel();
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
  copy.textContent = objective.text;
  const matching = tasks.filter((task) => task.type === objective.area || objective.text.toLowerCase().includes(task.type));
  const completed = matching.filter((task) => task.done).length;
  progress.textContent = `${matching.length ? Math.min(100, Math.round((completed / matching.length) * 100)) : 0}%`;
}