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
 * 5. Copy the /exec URL into the frontend API configuration.
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
  social: 'Social'
};

function setupJarvis() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  createSheet_(spreadsheet, SHEETS.tasks, ['id', 'title', 'detail', 'type', 'priority', 'dueAt', 'done', 'createdAt', 'completedAt']);
  createSheet_(spreadsheet, SHEETS.captures, ['id', 'text', 'type', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.reviews, ['id', 'note', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.pulses, ['id', 'energy', 'note', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.workouts, ['id', 'name', 'durationMinutes', 'intensity', 'notes', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.metrics, ['id', 'area', 'name', 'value', 'unit', 'createdAt']);
  createSheet_(spreadsheet, SHEETS.social, ['id', 'topic', 'channel', 'remindAt', 'done', 'createdAt']);
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
    if (action === 'saveMetric') return json_({ ok: true, metric: saveMetric_(request) });
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
    completedAt: row.completedAt
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
  return { ok: true, tasks: tasks, calendar: calendar, importantEmails: getImportantEmails_(), socialReminders: readRows_(SHEETS.social), lastReview: latestRow_(SHEETS.reviews), lastPulse: latestRow_(SHEETS.pulses), workouts: readRows_(SHEETS.workouts), metrics: readRows_(SHEETS.metrics) };
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
    completedAt: ''
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
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const message = required_(request.message, 'message');
  if (!key) return localAssistantFallback_(message, request.image);
  const context = request.context || {};
  const parts = [{ text: `You are JARVIS, a private assistant for a university student who codes, trains, and runs a business. User context: ${JSON.stringify(context)}. Read the user's message and optional image. Extract only useful, actionable items. Never invent missing dates or times. If a date or time is ambiguous, put it in questions. Return JSON only in this exact shape: {"reply":"short helpful response","questions":["..."],"tasks":[{"title":"...","detail":"...","type":"study|training|coding|business|personal","priority":"high|medium|low","dueAt":"ISO 8601 or empty"}],"events":[{"title":"...","start":"ISO 8601 or empty","end":"ISO 8601 or empty","description":"...","needsConfirmation":true}]}. User message: ${message}` }];
  if (request.image) {
    const imageParts = request.image.split(',');
    if (imageParts.length !== 2) throw new Error('Image attachment format is invalid.');
    const mimeType = imageParts[0].match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)?.[1];
    if (!mimeType) throw new Error('Only image attachments are supported.');
    parts.push({ inlineData: { mimeType: mimeType, data: imageParts[1] } });
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const response = UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }), muteHttpExceptions: true });
  if (response.getResponseCode() >= 300) throw new Error(`Gemini request failed (${response.getResponseCode()}).`);
  const body = JSON.parse(response.getContentText());
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no assistant response.');
  return JSON.parse(text.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
}

function localAssistantFallback_(message, image) {
  if (image) return { reply: 'This deployment is running without an AI token, so I cannot read images yet. Text commands, tasks, Calendar, Gmail signals, and reviews still work.', questions: ['Add GEMINI_API_KEY later to enable timetable and homework screenshot understanding.'], tasks: [], events: [], mode: 'local' };
  const lowerMessage = message.toLowerCase();
  const isTaskRequest = lowerMessage.indexOf('add') >= 0 || lowerMessage.indexOf('create') >= 0;
  if (isTaskRequest) {
    const title = message.replace(/^(add|create)(\s+a)?(\s+task)?(\s+to)?\s*/i, '').trim() || 'New JARVIS task';
    return { reply: `I prepared a local task from: ${title}`, questions: [], tasks: [{ title: title, detail: 'Prepared by token-free JARVIS mode', type: 'personal', priority: 'medium', dueAt: '' }], events: [], mode: 'local' };
  }
  return { reply: 'Token-free mode is active. I can still save tasks, reviews, metrics, reminders, and Calendar data. Add GEMINI_API_KEY when you want screenshot understanding and deeper reasoning.', questions: [], tasks: [], events: [], mode: 'local' };
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