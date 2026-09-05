// Add the Apps Script /exec URL here when the deployment is ready.
function getApiUrl() {
  return localStorage.getItem('jarvis-api-url') || '';
}

export function isConnected() {
  return Boolean(getApiUrl());
}

export async function requestDashboard() {
  const apiUrl = getApiUrl();
  if (!apiUrl) return null;
  const response = await fetch(`${apiUrl}?action=dashboard`);
  if (!response.ok) throw new Error('JARVIS backend unavailable.');
  return response.json();
}

export async function sendCommand(payload) {
  const apiUrl = getApiUrl();
  if (!apiUrl) return null;
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error('JARVIS backend unavailable.');
  return response.json();
}

export async function savePulse(energy) {
  return sendCommand({ action: 'savePulse', energy });
}

export async function saveTask(task) {
  return sendCommand({ action: 'addTask', title: task.title, detail: task.detail, type: task.type, priority: task.priority, dueAt: task.dueAt });
}

export async function updateTask(task) {
  return sendCommand({ action: 'completeTask', id: task.id, done: task.done });
}

export async function saveCapture(text, type) {
  return sendCommand({ action: 'capture', text, type });
}

export async function saveReview(note) {
  return sendCommand({ action: 'saveReview', note });
}

export async function syncPocketAthleteWorkout(workout) {
  return sendCommand({ action: 'syncPocketAthleteWorkout', ...workout });
}

/**
 * Store the PocketAthlete feed address in Apps Script properties.
 *
 * The backend needs its own copy because it is the side that can actually read
 * the feed: /calendar sends no CORS headers, so the browser is refused and
 * UrlFetchApp is not. Sent once when the integration is configured rather than
 * on every dashboard request.
 */
export async function savePocketAthleteConfig(config) {
  return sendCommand({ action: 'savePocketAthleteConfig', base: config.base, calendarToken: config.calendarToken });
}

export async function pullPocketAthleteTraining() {
  return sendCommand({ action: 'pullPocketAthleteTraining' });
}

export async function askAssistant(message, image, context) {
  return sendCommand({ action: 'assistant', message, image, context });
}

export async function createCalendarEvent(event) {
  return sendCommand({ action: 'createCalendarEvent', ...event });
}

export async function saveSocialReminder(reminder) {
  return sendCommand({ action: 'saveSocialReminder', ...reminder });
}

export async function saveMetric(metric) {
  return sendCommand({ action: 'saveMetric', ...metric });
}