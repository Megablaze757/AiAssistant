// Add the Apps Script /exec URL here when the deployment is ready.
const API_URL = '';

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