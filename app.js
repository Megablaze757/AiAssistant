import { askAssistant, createCalendarEvent, isConnected, requestDashboard, saveCapture, savePulse, saveReview, saveSocialReminder, saveTask, updateTask } from './src/api.js';

const initialTasks = [
  { id: 1, title: 'Ship the first JARVIS slice', detail: 'Build the daily command center', type: 'task', done: false },
  { id: 2, title: 'Review this week\'s numbers', detail: 'Revenue, energy, and learning', type: 'business', done: false },
  { id: 3, title: 'Protect one hour for learning', detail: 'Keep the long game moving', type: 'personal', done: false }
];

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
const proposalList = document.querySelector('#proposal-list');
const attachmentName = document.querySelector('#attachment-name');
let tasks = JSON.parse(localStorage.getItem('jarvis-tasks') || 'null') || initialTasks;
let focusTimer;
let focusSeconds = 0;
let pendingImage = '';
let socialReminders = JSON.parse(localStorage.getItem('jarvis-social') || '[]');

function updateDate() {
  const now = new Date();
  document.querySelector('#current-date').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now).toUpperCase();
  const hour = now.getHours();
  document.querySelector('#page-title').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, Sasha.`;
}

function updateSyncLabel() {
  syncLabel.textContent = isConnected() ? 'Google sync connected' : 'Local demo mode';
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

function applyDashboardSignals(dashboard) {
  renderEmails(dashboard?.importantEmails || []);
  if (!dashboard?.socialReminders) return;
  socialReminders = dashboard.socialReminders;
  localStorage.setItem('jarvis-social', JSON.stringify(socialReminders));
  renderSocialReminders();
}

function renderTasks() {
  taskList.replaceChildren(...tasks.map((task) => {
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
    detail.textContent = task.detail;
    label.append(title, detail);
    item.append(checkbox, label);
    return item;
  }));
  focusCount.textContent = String(tasks.filter((task) => !task.done).length).padStart(2, '0');
  document.querySelector('#completed-count').textContent = String(tasks.filter((task) => task.done).length).padStart(2, '0');
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
    const task = { id: Date.now(), title, detail: 'Added through command line', type: normalized.includes('business') ? 'business' : 'task', done: false };
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
    next.done = true;
    localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
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
        const task = { id: Date.now(), title: proposal.title, detail: proposal.detail || 'Suggested by JARVIS', type: proposal.type || 'task', done: false };
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
    window.setTimeout(() => addAssistantMessage(image ? 'I have the image, but real image understanding starts after Google sync and Gemini are connected.' : handleAssistantCommand(command), 'assistant'), 180);
    return;
  }
  addAssistantMessage('Reading that now...', 'assistant');
  try {
    const result = await askAssistant(command.trim(), image || undefined);
    const response = result.reply || 'I found some useful context.';
    addAssistantMessage(response, 'assistant');
    if (result.questions?.length) addAssistantMessage(`Before I schedule anything: ${result.questions.join(' ')}`, 'assistant');
    renderAssistantProposals(result);
  } catch (error) {
    addAssistantMessage('I could not reach the AI service, so nothing was changed. Your local data is still safe.', 'assistant');
  }
}

taskList.addEventListener('change', (event) => {
  const id = Number(event.target.dataset.taskId);
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = event.target.checked;
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  renderTasks();
  if (isConnected()) updateTask(task).catch(() => showToast('Updated locally. Sync will retry later.'));
  showToast(task.done ? 'Move completed.' : 'Move restored.');
});

document.querySelector('#add-task').addEventListener('click', () => {
  const title = window.prompt('What needs your attention?');
  if (!title?.trim()) return;
  const task = { id: Date.now(), title: title.trim(), detail: 'Captured from your command center', type: 'task', done: false };
  tasks.push(task);
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  renderTasks();
  if (isConnected()) saveTask(task).catch(() => showToast('Added locally. Sync will retry later.'));
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
      showToast('Focus session complete. Log the win before moving on.');
    }
  }, 1000);
  showToast('25-minute focus session started.');
});
document.querySelector('#briefing-button').addEventListener('click', () => { refreshBriefing(); showToast('Briefing refreshed from your local queue.'); });
document.querySelector('#review-button').addEventListener('click', () => {
  const note = window.prompt('Daily shutdown: what moved forward, what mattered, and what is next?');
  if (!note?.trim()) return;
  localStorage.setItem('jarvis-last-review', JSON.stringify({ note: note.trim(), savedAt: new Date().toISOString() }));
  if (isConnected()) saveReview(note.trim()).catch(() => showToast('Review saved locally. Sync will retry later.'));
  showToast('Daily review saved locally.');
});
document.querySelectorAll('[data-pulse]').forEach((button) => button.addEventListener('click', () => {
  const pulse = button.dataset.pulse;
  localStorage.setItem('jarvis-pulse', JSON.stringify({ pulse, savedAt: new Date().toISOString() }));
  pulseStatus.textContent = pulse.toUpperCase();
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
  if (!cleanUrl) { showToast('Local demo mode restored.'); return; }
  showToast('Testing Google sync...');
  try {
    const dashboard = await requestDashboard();
    if (dashboard?.tasks) {
      tasks = dashboard.tasks;
      localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
      renderTasks();
      refreshBriefing();
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
  document.querySelector('#page-title').textContent = view === 'overview' ? 'Good morning, Sasha.' : `${view[0].toUpperCase()}${view.slice(1)} mode`;
}));
document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => document.querySelector(`[data-view="${button.dataset.viewTarget}"]`).click()));

renderTasks();
refreshBriefing();
renderEmails();
renderSocialReminders();
updateDate();
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
  }).catch(() => showToast('Offline mode active. Local data is safe.'));
}