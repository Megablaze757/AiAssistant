/**
 * JARVIS Google Apps Script backend.
 *
 * Setup:
 * 1. Create a Google Sheet for JARVIS.
 * 2. Extensions -> Apps Script and paste this entire file.
 * 3. Run setupJarvis once and approve the permissions.
 * 4. Deploy -> New deployment -> Web app.
 *    Execute as: Me
 *    Who has access: Anyone with the link
 * 5. In Project Settings -> Script properties, add GROQ_API_KEY.
 *    Optional: add GROQ_MODEL (default: meta-llama/llama-4-scout-17b-16e-instruct).
 * 6. Copy the /exec URL into the frontend API configuration.
 *
 * Browser requests should use text/plain for POST bodies. This avoids a
 * browser preflight request, which Apps Script web apps do not handle well.
 */

const SHEETS = {
  tasks: 'Tasks',
  captures: 'Captures',
  reviews: 'Reviews',
  pulses: 'Pulses',
  workouts: 'Workouts',
  metrics: 'Metrics',
  social: 'Social',
  objectives: 'Objectives',
  focus: 'Focus'
};

function setupJarvis() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  createSheet_(spreadsheet, SHEETS.tasks, ['id', 'title', 'detail', 'type', 'priority', 'dueAt', 'done', 'createdAt', 'completedAt', 'objective']);
  createSheet_(spreadsheet, SHEETS.captures, ['id', 'text', 'type', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.reviews, ['id', 'note', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.pulses, ['id', 'energy', 'note', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.workouts, ['id', 'name', 'durationMinutes', 'intensity', 'notes', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.metrics, ['id', 'area', 'name', 'value', 'unit', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.social, ['id', 'topic', 'channel', 'remindAt', 'done', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.objectives, ['id', 'text', 'weekStart', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.focus, ['id', 'title', 'taskId', 'minutes', 'completedAt']);
  PropertiesService.getScriptProperties().setProperty('JARVIS_SHEET_ID', spreadsheet.getId());
  return json_({ ok: true, message: 'JARVIS is ready.' });
}

function doGet(event) {
  try {
    const action = event && event.parameter && event.parameter.action;
    if (action === 'health') return json_({ ok: true, service: 'jarvis' });
    return json_(getDashboard_());
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function doPost(event) {
  try {
    const request = parseRequest_(event);
    const action = request.action;
    if (action === 'addTask') return json_({ ok: true, task: addTask_(request) });
    if (action === 'completeTask') return json_({ ok: true, task: completeTask_(request) });
    if (action === 'capture') return json_({ ok: true, capture: addCapture_(request) });
    if (action === 'saveReview') return json_({ ok: true, review: saveReview_(request) });
    if (action === 'savePulse') return json_({ ok: true, pulse: savePulse_(request) });
    if (action === 'logWorkout') return json_({ ok: true, workout: logWorkout_(request) });
    if (action === 'syncPocketAthleteWorkout') return json_({ ok: true, workout: syncPocketAthleteWorkout_(request) });
    if (action === 'savePocketAthleteConfig') return json_({ ok: true, config: savePocketAthleteConfig_(request) });
    if (action === 'pullPocketAthleteTraining') return json_({ ok: true, training: pullPocketAthleteTraining_() });
    if (action === 'saveMetric') return json_({ ok: true, metric: saveMetric_(request) });
    if (action === 'saveObjective') return json_({ ok: true, objective: saveObjective_(request) });
    if (action === 'saveFocusSession') return json_({ ok: true, focus: saveFocusSession_(request) });
    if (action === 'assistant') return json_({ ok: true, ...askAssistant_(request) });
    if (action === 'saveSocialReminder') return json_({ ok: true, reminder: saveSocialReminder_(request) });
    if (action === 'createCalendarEvent') return json_({ ok: true, event: createCalendarEvent_(request) });
    throw new Error('Unknown action.');
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function getDashboard_() {
  const tasks = readRows_(SHEETS.tasks).map((row) => ({
    id: row.id,
    title: row.title,
    detail: row.detail,
    type: row.type,
    priority: row.priority || 'medium',
    dueAt: row.dueAt || '',
    done: row.done === true || row.done === 'TRUE',
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    objective: row.objective === true || row.objective === 'TRUE'
  }));
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const calendar = CalendarApp.getDefaultCalendar().getEvents(now, tomorrow).map((item) => ({
    id: item.getId(),
    title: item.getTitle(),
    start: item.getStartTime().toISOString(),
    end: item.getEndTime().toISOString(),
    location: item.getLocation()
  }));
  return { ok: true, tasks: tasks, calendar: calendar, importantEmails: getImportantEmails_(), socialReminders: readRows_(SHEETS.social), lastReview: latestRow_(SHEETS.reviews), lastPulse: latestRow_(SHEETS.pulses), workouts: readRows_(SHEETS.workouts), metrics: readRows_(SHEETS.metrics), objective: latestRow_(SHEETS.objectives), focusLog: readRows_(SHEETS.focus), training: pullPocketAthleteTraining_() };
}

function addTask_(request) {
  const task = {
    id: Utilities.getUuid(),
    title: required_(request.title, 'title'),
    detail: request.detail || '',
    type: request.type || 'task',
    priority: request.priority || 'medium',
    dueAt: request.dueAt || '',
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: '',
    objective: request.objective === true || request.objective === 'true'
  };
  appendRow_(SHEETS.tasks, task);
  return task;
}

function completeTask_(request) {
  const id = required_(request.id, 'id');
  const sheet = getSheet_(SHEETS.tasks);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((header) => String(header));
  const doneColumn = headers.indexOf('done');
  const createdColumn = headers.indexOf('createdAt');
  const completedColumn = headers.indexOf('completedAt');
  if (doneColumn < 0 || completedColumn < 0) throw new Error('Tasks sheet is missing completion columns. Run setupJarvis again.');
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][0]) !== String(id)) continue;
    const done = request.done === true || request.done === 'true';
    sheet.getRange(rowIndex + 1, doneColumn + 1).setValue(done);
    if (createdColumn >= 0) sheet.getRange(rowIndex + 1, createdColumn + 1).setValue(values[rowIndex][createdColumn]);
    sheet.getRange(rowIndex + 1, completedColumn + 1).setValue(done ? new Date().toISOString() : '');
    return { id: id, done: done };
  }
  throw new Error('Task not found.');
}

function addCapture_(request) {
  const capture = { id: Utilities.getUuid(), text: required_(request.text, 'text'), type: request.type || 'task', createdAt: new Date().toISOString() };
  appendRow_(SHEETS.captures, capture);
  if (capture.type !== 'idea') addTask_({ title: capture.text, detail: 'Captured from JARVIS', type: capture.type });
  return capture;
}

function saveReview_(request) {
  const review = { id: Utilities.getUuid(), note: required_(request.note, 'note'), createdAt: new Date().toISOString() };
  appendRow_(SHEETS.reviews, review);
  return review;
}

function createCalendarEvent_(request) {
  const title = required_(request.title, 'title');
  const start = new Date(required_(request.start, 'start'));
  const end = new Date(required_(request.end, 'end'));
  if (end <= start) throw new Error('Event end must be after its start.');
  const event = CalendarApp.getDefaultCalendar().createEvent(title, start, end, { description: request.description || '' });
  return { id: event.getId(), title: event.getTitle(), start: start.toISOString(), end: end.toISOString() };
}

function createSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) { sheet.appendRow(headers); return; }
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((header) => String(header));
  headers.filter((header) => !currentHeaders.includes(header)).forEach((header) => sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header));
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('JARVIS_SHEET_ID');
  if (!id) throw new Error('Run setupJarvis first.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}. Run setupJarvis again.`);
  return sheet;
}

function appendRow_(sheetName, record) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map((header) => record[header] ?? ''));
}

function readRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).map((row) => values[0].reduce((record, header, index) => { record[header] = row[index]; return record; }, {}));
}

function latestRow_(sheetName) {
  const rows = readRows_(sheetName);
  return rows.length ? rows[rows.length - 1] : null;
}

function parseRequest_(event) {
  if (!event || !event.postData || !event.postData.contents) throw new Error('Request body is required.');
  return JSON.parse(event.postData.contents);
}

function required_(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${name} is required.`);
  return value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function savePulse_(request) {
  const pulse = { id: Utilities.getUuid(), energy: required_(request.energy, 'energy'), note: request.note || '', createdAt: new Date().toISOString() };
  appendRow_(SHEETS.pulses, pulse);
  return pulse;
}

function logWorkout_(request) {
  const workout = { id: Utilities.getUuid(), name: required_(request.name, 'name'), durationMinutes: request.durationMinutes || '', intensity: request.intensity || '', notes: request.notes || '', createdAt: new Date().toISOString() };
  appendRow_(SHEETS.workouts, workout);
  return workout;
}

function saveMetric_(request) {
  const metric = { id: Utilities.getUuid(), area: required_(request.area, 'area'), name: required_(request.name, 'name'), value: required_(request.value, 'value'), unit: request.unit || '', createdAt: new Date().toISOString() };
  appendRow_(SHEETS.metrics, metric);
  return metric;
}

function syncPocketAthleteWorkout_(request) {
  const workout = {
    id: request.sourceId || Utilities.getUuid(),
    name: required_(request.name, 'name'),
    durationMinutes: request.durationMinutes || '',
    intensity: request.intensity || '',
    notes: request.notes ? `PocketAthlete: ${request.notes}` : 'Imported from PocketAthlete',
    createdAt: request.createdAt || new Date().toISOString()
  };
  const existing = readRows_(SHEETS.workouts).some((row) => String(row.id) === String(workout.id));
  if (!existing) appendRow_(SHEETS.workouts, workout);
  return workout;
}

function askAssistant_(request) {
  const properties = PropertiesService.getScriptProperties();
  const key = properties.getProperty('GROQ_API_KEY');
  const message = required_(request.message, 'message');
  if (!key) return localAssistantFallback_(message, request.image);
  const context = request.context || {};
  const prompt = `You are JARVIS, a private assistant for a university student who codes, trains, and runs a business. User context: ${JSON.stringify(context)}. Read the user's message and optional image. Extract only useful, actionable items. Never invent missing dates or times. If a date or time is ambiguous, put it in questions. Return JSON only in this exact shape: {"reply":"short helpful response","questions":["..."],"tasks":[{"title":"...","detail":"...","type":"study|training|coding|business|personal","priority":"high|medium|low","dueAt":"ISO 8601 or empty"}],"events":[{"title":"...","start":"ISO 8601 or empty","end":"ISO 8601 or empty","description":"...","needsConfirmation":true}]}. User message: ${message}`;
  const userContent = [{ type: 'text', text: prompt }];
  if (request.image) {
    const imageParts = request.image.split(',');
    if (imageParts.length !== 2) throw new Error('Image attachment format is invalid.');
    if (!imageParts[0].match(/^data:image\/[a-zA-Z0-9.+-]+;base64$/)) throw new Error('Only image attachments are supported.');
    userContent.push({ type: 'image_url', image_url: { url: request.image } });
  }
  const model = properties.getProperty('GROQ_MODEL') || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'post', contentType: 'application/json', headers: { Authorization: `Bearer ${key}` }, payload: JSON.stringify({ model: model, messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: userContent }], temperature: 0.2, response_format: { type: 'json_object' } }), muteHttpExceptions: true });
  if (response.getResponseCode() >= 300) throw new Error(`Groq request failed (${response.getResponseCode()}).`);
  const body = JSON.parse(response.getContentText());
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned no assistant response.');
  return JSON.parse(text.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
}

function localAssistantFallback_(message, image) {
  if (image) return { reply: 'This deployment is running without an AI token, so I cannot read images yet. Text commands, tasks, Calendar, Gmail signals, and reviews still work.', questions: ['Add GROQ_API_KEY later to enable timetable and homework screenshot understanding.'], tasks: [], events: [], mode: 'local' };
  const lowerMessage = message.toLowerCase();
  const isTaskRequest = lowerMessage.indexOf('add') >= 0 || lowerMessage.indexOf('create') >= 0;
  if (isTaskRequest) {
    const title = message.replace(/^(add|create)(\s+a)?(\s+task)?(\s+to)?\s*/i, '').trim() || 'New JARVIS task';
    return { reply: `I prepared a local task from: ${title}`, questions: [], tasks: [{ title: title, detail: 'Prepared by token-free JARVIS mode', type: 'personal', priority: 'medium', dueAt: '' }], events: [], mode: 'local' };
  }
  return { reply: 'Token-free mode is active. I can still save tasks, reviews, metrics, reminders, and Calendar data. Add GROQ_API_KEY when you want screenshot understanding and deeper reasoning.', questions: [], tasks: [], events: [], mode: 'local' };
}

function saveSocialReminder_(request) {
  const reminder = { id: Utilities.getUuid(), topic: required_(request.topic, 'topic'), channel: request.channel || 'Social', remindAt: required_(request.remindAt, 'remindAt'), done: false, createdAt: new Date().toISOString() };
  appendRow_(SHEETS.social, reminder);
  return reminder;
}

function getImportantEmails_() {
  return GmailApp.search('is:unread newer_than:3d (is:important OR has:starred) -category:promotions -category:social', 0, 10).map((thread) => {
    const message = thread.getMessages().pop();
    return { id: thread.getId(), from: message.getFrom(), subject: message.getSubject(), receivedAt: message.getDate().toISOString(), snippet: message.getPlainBody().slice(0, 220) };
  });
}
/**
 * ───────────────────────────────────────────────────────────────────────────
 * POCKETATHLETE
 *
 * PocketAthlete publishes the training programme as an ICS subscription at
 * GET /calendar?token=<uuid>, and that response carries no CORS headers — it
 * is built for calendar clients, which are not browsers. The frontend is
 * therefore refused before it can read a byte, and this is the side that can
 * do it: UrlFetchApp is a server and the same-origin policy does not apply.
 *
 * So the split is: the browser PUSHES biometrics straight to the Worker (that
 * endpoint does send CORS headers), and the backend PULLS training from here.
 *
 * The token is a read-only feed credential scoped to one athlete's programme,
 * revocable by re-minting it in PocketAthlete. It lives in script properties
 * rather than in the sheet so it is not one accidental share away from being
 * public.
 * ───────────────────────────────────────────────────────────────────────────
 */

function savePocketAthleteConfig_(request) {
  const properties = PropertiesService.getScriptProperties();
  const calendarToken = String(request.calendarToken || '').trim();
  const base = String(request.base || '').trim().replace(/\/$/, '');
  if (calendarToken && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(calendarToken)) {
    throw new Error('That does not look like a PocketAthlete calendar token.');
  }
  if (base && base.indexOf('https://') !== 0) throw new Error('The PocketAthlete API address must start with https://.');
  if (calendarToken) properties.setProperty('POCKETATHLETE_CALENDAR_TOKEN', calendarToken);
  else properties.deleteProperty('POCKETATHLETE_CALENDAR_TOKEN');
  if (base) properties.setProperty('POCKETATHLETE_BASE', base);
  return { configured: Boolean(calendarToken), base: base };
}

/**
 * Read the training feed and normalise it.
 *
 * NEVER THROWS. This runs inside the dashboard response, and a training feed
 * that is down, unconfigured or slow must not take tasks, calendar and mail
 * down with it — the panel says it could not read, and everything else works.
 */
function pullPocketAthleteTraining_() {
  var properties = PropertiesService.getScriptProperties();
  var token = properties.getProperty('POCKETATHLETE_CALENDAR_TOKEN');
  var base = properties.getProperty('POCKETATHLETE_BASE') || 'https://apex-api.fitnessguru.workers.dev';
  if (!token) return { configured: false, sessions: [] };
  try {
    var response = UrlFetchApp.fetch(base + '/calendar?token=' + encodeURIComponent(token), { muteHttpExceptions: true, followRedirects: true });
    var code = response.getResponseCode();
    // A token matching no athlete is a 404 by design, so it can be reported as
    // the specific thing it is instead of an empty programme.
    if (code === 404) return { configured: true, sessions: [], error: 'PocketAthlete did not recognise that calendar token. Re-mint it in the app.' };
    if (code >= 300) return { configured: true, sessions: [], error: 'PocketAthlete returned ' + code + '.' };
    var sessions = parseIcsSessions_(response.getContentText());
    recordTrainingSessions_(sessions);
    return { configured: true, sessions: sessions, syncedAt: new Date().toISOString() };
  } catch (error) {
    return { configured: true, sessions: [], error: 'Could not reach PocketAthlete: ' + error.message };
  }
}

/**
 * A minimal RFC 5545 reader for the one feed this app consumes.
 *
 * UNFOLDING COMES FIRST and is not optional. buildIcs folds at 75 octets with
 * continuation lines that begin with a space, so a session title long enough to
 * wrap arrives split across lines — parse before unfolding and it silently
 * becomes a truncated title plus a line that matches no property.
 */
function parseIcsSessions_(text) {
  var unfolded = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  var sessions = [];
  var current = null;
  unfolded.split('\n').forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { current = {}; return; }
    if (line === 'END:VEVENT') { if (current && current.date) sessions.push(finishSession_(current)); current = null; return; }
    if (!current) return;
    var separator = line.search(/[;:]/);
    if (separator < 0) return;
    var name = line.slice(0, separator).toUpperCase();
    var value = line.slice(line.indexOf(':') + 1);
    if (name === 'UID') current.uid = value;
    if (name === 'SUMMARY') current.summary = unescapeIcsText_(value);
    if (name === 'DESCRIPTION') current.description = unescapeIcsText_(value);
    if (name === 'URL') current.url = unescapeIcsText_(value);
    // DTSTART;VALUE=DATE:20260907 — all-day, because PocketAthlete plans a
    // programme in order rather than at clock times.
    if (name === 'DTSTART') current.date = value.slice(0, 8);
  });
  return sessions.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function finishSession_(event) {
  var summary = event.summary || 'Training session';
  // A leading tick is how the feed marks a completed session; it is a display
  // convention, so it becomes a boolean here rather than staying in the title.
  var done = summary.indexOf('✓') === 0;
  /**
   * The COUNT is taken from the feed and the names are NOT split into a list.
   *
   * PocketAthlete joins drill names with ", " and then escapes the whole
   * description, so a joining comma and a comma inside a name ("Row, single-arm")
   * both arrive as "\,". They are genuinely indistinguishable, and splitting on
   * the comma turns one drill into two — an exercise list that is quietly wrong
   * is worse than one shown as the sentence the feed actually sent. The leading
   * number comes straight from drills.length, so it stays exact either way.
   */
  var exercises = (event.description || '').match(/^(\d+) exercises: (.*)$/m);
  return {
    id: event.uid || summary + event.date,
    title: done ? summary.replace(/^✓\s*/, '') : summary,
    date: event.date.slice(0, 4) + '-' + event.date.slice(4, 6) + '-' + event.date.slice(6, 8),
    done: done,
    exerciseCount: exercises ? Number(exercises[1]) : 0,
    exerciseSummary: exercises ? exercises[2] : '',
    url: event.url || 'https://pocketathlete.com/train'
  };
}

/**
 * Undo the escaping buildIcs applies.
 *
 * Two things here are easy to get wrong and silent when you do. The BACKSLASH
 * COMES LAST, or an escaped backslash unescapes into "\n" and then that is read
 * as a newline. And the semicolon pattern is /\\;/ — the natural-looking /\;/
 * is just a semicolon in a JavaScript regex, so it would replace ";" with ";"
 * and leave every real "\;" in the text. PocketAthlete's own escapeText carries
 * a comment about making exactly that mistake in the other direction.
 */
function unescapeIcsText_(value) {
  return String(value).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * Mirror completed sessions into the Workouts sheet.
 *
 * COMPLETED ONLY, and deduplicated on the feed's own stable UID. A planned
 * session is a plan; writing it as a workout would report training that has not
 * happened, and every metric downstream of that sheet would inherit the lie.
 */
function recordTrainingSessions_(sessions) {
  var done = sessions.filter(function (session) { return session.done; });
  if (!done.length) return;
  var existing = {};
  readRows_(SHEETS.workouts).forEach(function (row) { existing[String(row.id)] = true; });
  done.forEach(function (session) {
    if (existing[String(session.id)]) return;
    appendRow_(SHEETS.workouts, {
      id: session.id,
      name: session.title,
      durationMinutes: '',
      intensity: '',
      notes: 'PocketAthlete session' + (session.exerciseCount ? ' - ' + session.exerciseCount + ' exercises' : ''),
      createdAt: session.date
    });
  });
}

/**
 * The weekly objective, kept as a row per week rather than one overwritten cell.
 *
 * Re-stating the objective inside the same week replaces that week's row; a new
 * week appends. That keeps a real history of what each week was for, which a
 * single overwritten value throws away — and it is the record a later review or
 * summary actually needs.
 */
function saveObjective_(request) {
  var text = required_(request.text, 'text');
  var weekStart = request.weekStart || mondayOf_(new Date());
  var sheet = getSheet_(SHEETS.objectives);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) { return String(header); });
  var weekColumn = headers.indexOf('weekStart');
  var textColumn = headers.indexOf('text');
  for (var row = 1; row < values.length; row += 1) {
    if (weekColumn < 0 || String(values[row][weekColumn]) !== String(weekStart)) continue;
    sheet.getRange(row + 1, textColumn + 1).setValue(text);
    return { id: values[row][0], text: text, weekStart: weekStart };
  }
  var objective = { id: Utilities.getUuid(), text: text, weekStart: weekStart, createdAt: new Date().toISOString() };
  appendRow_(SHEETS.objectives, objective);
  return objective;
}

/** The Monday of a date's week, as YYYY-MM-DD. */
function mondayOf_(date) {
  var monday = new Date(date.getTime());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Utilities.formatDate(monday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * One completed focus session.
 *
 * Deduplicated on the id the browser generated, because a session logged
 * offline is re-sent when sync returns and would otherwise be counted twice.
 */
function saveFocusSession_(request) {
  var session = {
    id: request.id || Utilities.getUuid(),
    title: request.title || 'Focus',
    taskId: request.taskId || '',
    minutes: required_(request.minutes, 'minutes'),
    completedAt: request.completedAt || new Date().toISOString()
  };
  var exists = readRows_(SHEETS.focus).some(function (row) { return String(row.id) === String(session.id); });
  if (!exists) appendRow_(SHEETS.focus, session);
  return session;
}
