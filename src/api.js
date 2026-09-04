// Add the Apps Script /exec URL here when the deployment is ready.
const API_URL = '';

export function isConnected() {
  return Boolean(API_URL);
}

export async function requestDashboard() {
  if (!API_URL) return null;
  const response = await fetch(`${API_URL}?action=dashboard`);
  if (!response.ok) throw new Error('JARVIS backend unavailable.');
  return response.json();
}

export async function sendCommand(payload) {
  if (!API_URL) return null;
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error('JARVIS backend unavailable.');
  return response.json();
}

export async function savePulse(energy) {
  return sendCommand({ action: 'savePulse', energy });
}

export async function saveTask(task) {
  return sendCommand({ action: 'addTask', title: task.title, detail: task.detail, type: task.type });
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