/**
 * PocketAthlete integration.
 *
 * PocketAthlete (pocketathlete.com, the FOOTBALLFITNESSGURU repository) exposes
 * exactly two token-addressed endpoints on its Cloudflare Worker, and this
 * module is built around what they actually allow rather than an API we wish
 * existed:
 *
 *   GET  /calendar?token=<uuid>   the training programme as an ICS feed.
 *   POST /wearable-ingest         biometrics, Authorization: Bearer <uuid>.
 *
 * THE TWO DIRECTIONS DO NOT TRAVEL THE SAME WAY, and that asymmetry is a
 * property of the Worker, not a choice made here:
 *
 *   · /wearable-ingest answers through the Worker's json() helper, which
 *     carries Access-Control-Allow-Origin *, allows POST, and allows the
 *     authorization header. So the browser can push to it directly, and the
 *     push works in local mode with no backend at all.
 *
 *   · /calendar answers with a bare text/calendar Response and NO CORS
 *     headers, because it is built for calendar clients, which are not
 *     browsers and do not enforce the same-origin policy. A fetch() from this
 *     page is therefore blocked before it is read, however the request is
 *     shaped. Reading training data has to happen server-side, so it goes
 *     through the Apps Script backend — pullPocketAthleteTraining_ in
 *     appscript/Code.gs.
 *
 * Both tokens are per-athlete feed credentials that PocketAthlete is designed
 * to have pasted into clients — an Apple Shortcut holds the ingest token the
 * same way. They are stored in this browser only, alongside the Apps Script
 * URL, and either can be revoked by re-minting it inside PocketAthlete.
 */

const CONFIG_KEY = 'jarvis-pocketathlete';
const DEFAULT_BASE = 'https://apex-api.fitnessguru.workers.dev';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readConfig() {
  const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') || {};
  return { base: stored.base || DEFAULT_BASE, calendarToken: stored.calendarToken || '', ingestToken: stored.ingestToken || '' };
}

export function saveConfig(config) {
  const base = (config.base || DEFAULT_BASE).trim().replace(/\/$/, '');
  const calendarToken = (config.calendarToken || '').trim();
  const ingestToken = (config.ingestToken || '').trim();
  // Format-checked here rather than only at the Worker. A mistyped token is a
  // 401 or a 404 that reads exactly like "the integration is broken", and the
  // person pasting it has no way to tell those apart.
  if (calendarToken && !UUID.test(calendarToken)) throw new Error('The calendar token should look like 8f1c2d3e-....');
  if (ingestToken && !UUID.test(ingestToken)) throw new Error('The health token should look like 8f1c2d3e-....');
  if (!/^https:\/\//.test(base)) throw new Error('The PocketAthlete API address must start with https://.');
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ base, calendarToken, ingestToken }));
  return { base, calendarToken, ingestToken };
}

export function canPushBiometrics() {
  return Boolean(readConfig().ingestToken);
}

export function canReadTraining() {
  return Boolean(readConfig().calendarToken);
}

/**
 * Push a day of biometrics to PocketAthlete.
 *
 * Key names match parseIngestPayload in the Worker's lib/biometrics.ts, which
 * normalises them case- and punctuation-insensitively. `sleepHours` is HOURS —
 * the Worker reads a bare number under 20 as hours and anything larger as
 * minutes, so sending 450 for a 7.5-hour night silently records something else.
 */
export async function pushBiometrics(reading) {
  const { base, ingestToken } = readConfig();
  if (!ingestToken) throw new Error('Add your PocketAthlete health token first.');
  const body = { date: reading.date || new Date().toISOString().slice(0, 10) };
  if (Number.isFinite(reading.sleepHours)) body.sleepHours = reading.sleepHours;
  if (Number.isFinite(reading.hrv)) body.hrv = reading.hrv;
  if (Number.isFinite(reading.restingHR)) body.restingHR = reading.restingHR;
  if (body.sleepHours === undefined && body.hrv === undefined && body.restingHR === undefined) {
    throw new Error('Nothing to send. PocketAthlete accepts sleep hours, HRV, or resting heart rate.');
  }
  const response = await fetch(`${base}/wearable-ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ingestToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `PocketAthlete rejected that (${response.status}).`);
  return result;
}

/**
 * Map a JARVIS metric onto a PocketAthlete biometric, or return null.
 *
 * Only three of them have a home over there, and a metric that does not map is
 * not an error — most of what JARVIS logs is study hours and revenue, which
 * PocketAthlete has no column for and no business storing.
 */
export function biometricFromMetric(metric) {
  const name = String(metric.name || '').toLowerCase();
  const value = Number(metric.value);
  if (!Number.isFinite(value)) return null;
  if (metric.area === 'wellbeing' || name.includes('sleep')) return { sleepHours: value };
  if (name.includes('hrv')) return { hrv: value };
  if (name.includes('resting') || name === 'rhr') return { restingHR: value };
  return null;
}
