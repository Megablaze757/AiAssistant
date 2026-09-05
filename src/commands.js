/**
 * The offline command parser.
 *
 * What was here matched three substrings anywhere in the input and returned a
 * sentence. "add" won on "I finished adding the report", so that completed a
 * task by creating one; "done" and "complete" both acted on whichever task
 * happened to be first, never the one named; and everything carried a fixed
 * medium priority with no due date, because nothing was read out of the text.
 *
 * This parses instead of matching. It returns a structured intent for the app
 * to execute — never prose, never a side effect — so the same parse can be
 * tested directly, and so a misread instruction is visible as the wrong intent
 * rather than as a wrong sentence.
 *
 * It is deliberately a COMMAND parser and not an imitation of a model. It
 * covers a bounded set of things you can ask for offline and answers anything
 * else with what it can actually do, rather than guessing and acting anyway.
 * With GROQ_API_KEY set in Apps Script the backend handles free-form language;
 * this is what remains true with no key and no network.
 */

const AREAS = {
  study: ['study', 'studying', 'uni', 'university', 'course', 'coursework', 'assignment', 'revision', 'lecture', 'exam', 'essay'],
  training: ['training', 'train', 'gym', 'workout', 'football', 'run', 'running', 'lift', 'session'],
  coding: ['code', 'coding', 'build', 'ship', 'refactor', 'bug', 'deploy', 'api', 'app'],
  business: ['business', 'client', 'invoice', 'revenue', 'sales', 'proposal', 'pitch', 'money'],
  personal: ['personal', 'home', 'family', 'admin', 'errand', 'life']
};
const PRIORITIES = { high: ['urgent', 'asap', 'critical', 'important', 'high priority', 'top priority'], low: ['low priority', 'whenever', 'someday', 'eventually', 'no rush'] };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PULSES = { low: ['low', 'tired', 'exhausted', 'drained', 'rough', 'flat'], sharp: ['sharp', 'great', 'good', 'strong', 'energised', 'energized', 'fresh'], steady: ['steady', 'ok', 'okay', 'fine', 'normal', 'alright'] };

const has = (text, words) => words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));

/**
 * Read a date out of the text, and report what was consumed.
 *
 * The consumed span matters as much as the date: leaving "by friday" in the
 * title produces tasks called "Send the invoice by friday" that then also have
 * a due date, which is the sort of duplication that makes a parser feel broken.
 */
export function parseWhen(text, now = new Date()) {
  const at = (base, hours = 9, minutes = 0) => { const date = new Date(base); date.setHours(hours, minutes, 0, 0); return date; };
  const addDays = (count) => { const date = new Date(now); date.setDate(date.getDate() + count); return date; };

  let clock = null;
  // Times first, so "tomorrow at 5pm" keeps the 5pm rather than defaulting to 9.
  const clockMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (clockMatch) {
    let hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2] || 0);
    const meridiem = (clockMatch[3] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) clock = { hour, minute, text: clockMatch[0] };
  }

  const patterns = [
    { re: /\btoday\b/i, date: () => at(now, clock ? clock.hour : 18, clock ? clock.minute : 0) },
    { re: /\btonight\b/i, date: () => at(now, clock ? clock.hour : 20, clock ? clock.minute : 0) },
    { re: /\btomorrow\b/i, date: () => at(addDays(1), clock ? clock.hour : 9, clock ? clock.minute : 0) },
    { re: /\bin\s+(\d+)\s+hours?\b/i, date: (m) => new Date(now.getTime() + Number(m[1]) * 3600000) },
    { re: /\bin\s+(\d+)\s+days?\b/i, date: (m) => at(addDays(Number(m[1])), clock ? clock.hour : 9, clock ? clock.minute : 0) },
    { re: /\bin\s+(\d+)\s+weeks?\b/i, date: (m) => at(addDays(Number(m[1]) * 7), clock ? clock.hour : 9, clock ? clock.minute : 0) },
    { re: /\bnext\s+week\b/i, date: () => at(addDays(7), clock ? clock.hour : 9, clock ? clock.minute : 0) },
    {
      re: /\b(?:(next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
      date: (m) => {
        const target = DAYS.indexOf(m[2].toLowerCase());
        // Always forward. "Friday" on a Friday means the next one, not a
        // deadline that has already passed.
        let ahead = (target - now.getDay() + 7) % 7;
        if (ahead === 0) ahead = 7;
        if (m[1]) ahead += ahead <= 6 && target > now.getDay() ? 7 : 0;
        return at(addDays(ahead), clock ? clock.hour : 9, clock ? clock.minute : 0);
      }
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const date = pattern.date(match);
    if (Number.isNaN(date.getTime())) continue;
    const consumed = [match[0], clock ? clock.text : ''].filter(Boolean);
    return { date, consumed, matched: true };
  }

  // A bare time with no day means today, or tomorrow if it has already gone.
  if (clock) {
    let date = at(now, clock.hour, clock.minute);
    if (date <= now) date = at(addDays(1), clock.hour, clock.minute);
    return { date, consumed: [clock.text], matched: true };
  }
  return { date: null, consumed: [], matched: false };
}

function stripAll(text, fragments) {
  return fragments.reduce((result, fragment) => result.replace(fragment, ' '), text)
    .replace(/\s*\b(by|on|at|due|before)\b\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function areaOf(text) {
  return Object.keys(AREAS).find((area) => has(text, AREAS[area])) || '';
}

function priorityOf(text) {
  if (has(text, PRIORITIES.high)) return 'high';
  if (has(text, PRIORITIES.low)) return 'low';
  return 'medium';
}

/** Best matching open task by title, or null. Word overlap rather than
 *  substring, so "finish the report" finds "Finish the quarterly report". */
export function matchTask(query, tasks) {
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  if (!words.length) return null;
  const scored = tasks
    .filter((task) => !task.done)
    .map((task) => {
      const title = String(task.title || '').toLowerCase();
      const hits = words.filter((word) => title.includes(word)).length;
      return { task, score: hits / words.length };
    })
    .filter((entry) => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].task : null;
}

/**
 * Parse one instruction into an intent.
 *
 * VERBS ARE ANCHORED TO THE START of the instruction. That is the fix for the
 * original bug: "I finished adding the report" begins with neither "add" nor a
 * completion verb applied to a name, so it is not silently treated as either.
 */
export function parseCommand(input, { tasks = [], now = new Date() } = {}) {
  const text = String(input || '').trim();
  if (!text) return { intent: 'none' };
  const lower = text.toLowerCase();

  if (/^(help|what can you do|commands)\b/i.test(text)) return { intent: 'help' };
  if (/^(plan|schedule)\b.*\b(day|today)\b/i.test(text) || /^plan my day$/i.test(text)) return { intent: 'plan' };
  if (/\b(what('| i)?s|show|list)\b.*\b(due|deadline|overdue)\b/i.test(text)) return { intent: 'due' };
  if (/\b(training|workout|gym|session)\b/i.test(text) && /\b(what|show|when|list|today)\b/i.test(text)) return { intent: 'training' };
  if (/^(brief|briefing|status|how am i doing|what should i (do|focus on)|what('| i)?s next|next move)\b/i.test(text)) return { intent: 'briefing' };
  if (/\b(show|list|what)\b.*\b(open|queue|tasks?|work|moves?)\b/i.test(text)) return { intent: 'list', area: areaOf(lower) };

  const focus = text.match(/^(?:start\s+)?(?:a\s+)?focus(?:\s+session)?(?:\s+for)?\s*(\d+)?\s*(?:min|mins|minutes)?\s*(?:on\s+(.+))?$/i);
  if (focus) {
    const target = focus[2] ? matchTask(focus[2], tasks) : null;
    return { intent: 'focus', minutes: focus[1] ? Number(focus[1]) : 25, task: target, query: focus[2] || '' };
  }

  const pulse = text.match(/^(?:i(?:'m| am)?\s+)?(?:feeling\s+)?(?:log\s+)?(?:energy|pulse)?\s*(.+)$/i);
  if (/^(i('m| am)|feeling|energy|pulse|log (my )?(energy|pulse))\b/i.test(text) && pulse) {
    const word = Object.keys(PULSES).find((key) => has(lower, PULSES[key]));
    if (word) return { intent: 'pulse', pulse: word };
  }

  const metric = text.match(/^(?:log|record|track)\s+(?:my\s+)?(.+?)\s+(?:as|=|at|:)?\s*(-?\d+(?:\.\d+)?)\s*(h|hrs?|hours?|min|mins?|kg|km|ms|bpm|£|\$)?$/i);
  if (metric) {
    const name = metric[1].trim();
    const area = areaOf(name.toLowerCase()) || (/sleep|hrv|resting|weight/i.test(name) ? 'wellbeing' : 'study');
    return { intent: 'metric', name: name.replace(/^\w/, (c) => c.toUpperCase()), value: Number(metric[2]), unit: metric[3] || '', area };
  }

  const objective = text.match(/^(?:set\s+)?(?:my\s+)?(?:weekly\s+)?objective(?:\s+(?:to|is|:))?\s+(.+)$/i);
  if (objective) return { intent: 'objective', text: objective[1].trim() };

  const complete = text.match(/^(?:mark\s+)?(?:complete|completed|finish|finished|done|tick|close)\s+(?:off\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete))?$/i);
  if (complete) {
    const target = matchTask(complete[1], tasks);
    return { intent: 'complete', task: target, query: complete[1].trim() };
  }

  const add = text.match(/^(?:add|create|new|remind me to|i need to|note)\s+(?:a\s+|an\s+)?(?:task\s+|move\s+|reminder\s+)?(?:to\s+|that\s+)?(.+)$/i);
  if (add) {
    const body = add[1];
    const when = parseWhen(body, now);
    const title = stripAll(body, [...when.consumed, ...PRIORITIES.high, ...PRIORITIES.low].filter(Boolean).map((f) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')));
    if (!title) return { intent: 'unknown', reason: 'I did not catch what the task should be called.' };
    return {
      intent: 'add',
      title: title.replace(/^\w/, (c) => c.toUpperCase()),
      area: areaOf(body.toLowerCase()) || 'personal',
      priority: priorityOf(body.toLowerCase()),
      dueAt: when.date ? toLocalInput(when.date) : ''
    };
  }

  return { intent: 'unknown' };
}

/** The value shape a datetime-local input and the task record both use. */
export function toLocalInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What it can genuinely do, listed because "unknown" should teach rather than
 *  apologise. */
export const CAPABILITIES = [
  'add finish the essay by friday 5pm',
  'complete the client proposal',
  'what is due',
  'show my open study work',
  'plan my day',
  'focus 40 on the coursework',
  'log sleep 7.5h',
  'objective ship the landing page',
  "i'm feeling low"
];
