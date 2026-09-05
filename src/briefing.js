/**
 * The briefing.
 *
 * It used to be a three-branch template: empty queue, else the first business
 * task, else the first task — with a fixed second clause bolted on. It ignored
 * deadlines, the calendar, training, energy, the objective and the inbox, and
 * it preferred anything tagged "business" over work that was actually overdue.
 *
 * This reads every source JARVIS has and ranks what it finds. The ranking is
 * the whole point: a briefing is only useful if the thing it leads with is
 * genuinely the most pressing thing, so severity is computed from the data —
 * how overdue, how soon, how many — rather than fixed per branch.
 *
 * Pure, like the planner: everything comes in as arguments and nothing here
 * touches storage or the DOM, so the ranking can be tested against fixed
 * inputs instead of by pressing refresh and reading the copy.
 */

import { domainStatus } from './insights.js';

const HOUR = 3600000;
const AREAS = ['study', 'training', 'coding', 'business'];
const AREA_LABELS = { study: 'university', training: 'training', coding: 'build', business: 'business' };

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const time = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const quote = (text) => `“${text}”`;

/**
 * How far through the week we are, 0 at Monday midnight to 1 at Sunday
 * midnight. Used to judge whether the objective is behind rather than merely
 * unfinished.
 *
 * SEVEN DAYS, NOT FIVE. A weekly objective runs to the end of the week, so
 * measuring against Friday reported the week as 100% gone from Saturday
 * morning — which is both wrong and needlessly bleak on a day there is still
 * time to use.
 */
/** "tomorrow", "on Friday", or a date — whichever reads naturally. */
function daysBetween(now, due) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const target = new Date(due); target.setHours(0, 0, 0, 0);
  const days = Math.round((target - start) / (24 * HOUR));
  if (days === 1) return 'tomorrow';
  if (days <= 6) return `on ${due.toLocaleDateString([], { weekday: 'long' })}`;
  return `on ${due.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function weekProgress(now) {
  const day = (now.getDay() + 6) % 7;
  return Math.min(1, Math.max(0, (day + now.getHours() / 24) / 7));
}

/**
 * Collect every signal that is true right now, each with a weight.
 *
 * A signal is only added when the data supports it. Nothing here has an "else"
 * that invents something to say — an empty list is answered by the caller with
 * the one honest fallback at the bottom.
 */
export function collectSignals({ now = new Date(), tasks = [], calendar = [], training = [], plan = null, pulse = null, emails = [], objective = null, focusLog = [] } = {}) {
  const signals = [];
  const open = tasks.filter((task) => !task.done);
  const today = localDate(now);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  const dated = open.filter((task) => task.dueAt && !Number.isNaN(new Date(task.dueAt).getTime()));
  const overdue = dated.filter((task) => new Date(task.dueAt) < now).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const dueToday = dated.filter((task) => new Date(task.dueAt) >= now && new Date(task.dueAt) <= endOfDay).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  if (overdue.length) {
    const worst = overdue[0];
    const days = Math.floor((now - new Date(worst.dueAt)) / (24 * HOUR));
    signals.push({
      id: 'overdue',
      // Scales with how many and how late, so two days overdue outranks one
      // item that slipped an hour ago.
      weight: 100 + Math.min(20, overdue.length * 4) + Math.min(15, days * 3),
      lead: overdue.length === 1 ? `${quote(worst.title)} is overdue.` : `${plural(overdue.length, 'thing')} are overdue.`,
      detail: overdue.length === 1
        ? `${quote(worst.title)} was due ${days >= 1 ? `${plural(days, 'day')} ago` : `at ${time(new Date(worst.dueAt))}`}. Clear it or move the deadline honestly.`
        : `${plural(overdue.length, 'item')} are past their deadline, the oldest being ${quote(worst.title)}. Clear or re-date them before adding anything new.`
    });
  }

  if (dueToday.length) {
    const next = dueToday[0];
    const hoursLeft = (new Date(next.dueAt) - now) / HOUR;
    signals.push({
      id: 'due-today',
      weight: (hoursLeft <= 3 ? 92 : 70) + Math.min(10, dueToday.length * 2),
      lead: `${quote(next.title)} is due at ${time(new Date(next.dueAt))}.`,
      detail: dueToday.length === 1
        ? `${quote(next.title)} is due at ${time(new Date(next.dueAt))}${hoursLeft <= 3 ? ' — under three hours away' : ''}.`
        : `${plural(dueToday.length, 'item')} are due today, starting with ${quote(next.title)} at ${time(new Date(next.dueAt))}.`
    });
  }

  // Deadlines past today. Without this a briefing could report "nothing is
  // pressing" on a day something is due tomorrow morning, which is exactly when
  // being told would have helped.
  const soon = dated
    .filter((task) => new Date(task.dueAt) > endOfDay && new Date(task.dueAt) <= new Date(now.getTime() + 72 * HOUR))
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  if (soon) {
    const when = daysBetween(now, new Date(soon.dueAt));
    signals.push({
      id: 'due-soon',
      // Above a stalled area: a dated, specific deadline is more actionable
      // than a chronic condition, and "due tomorrow" is the one worth leading
      // with on the day you still have time to start it.
      weight: 62,
      lead: `${quote(soon.title)} is due ${when}.`,
      detail: `${quote(soon.title)} is due ${when}. Starting it today is what stops it becoming an overdue one.`
    });
  }

  const upcoming = calendar
    .map((event) => ({ ...event, at: new Date(event.start) }))
    .filter((event) => !Number.isNaN(event.at.getTime()) && event.at > now)
    .sort((a, b) => a.at - b.at)[0];
  if (upcoming) {
    const minutes = Math.round((upcoming.at - now) / 60000);
    signals.push({
      id: 'meeting',
      weight: minutes <= 60 ? 86 : 40,
      lead: minutes <= 60 ? `${upcoming.title} in ${plural(minutes, 'minute')}.` : `${upcoming.title} at ${time(upcoming.at)}.`,
      detail: minutes <= 60
        ? `${upcoming.title} starts in ${plural(minutes, 'minute')}, so this is a short block, not a deep one.`
        : `Your next fixed commitment is ${upcoming.title} at ${time(upcoming.at)}. The time before it is yours.`
    });
  }

  const session = training.find((item) => item.date === today && !item.done);
  if (session) {
    signals.push({
      id: 'training',
      weight: 60,
      lead: `${session.title} still to do.`,
      detail: `PocketAthlete has ${quote(session.title)} planned for today${session.exerciseCount ? ` (${plural(session.exerciseCount, 'exercise')})` : ''}. It has no set time, so put it where the energy is.`
    });
  }

  if (emails.length) {
    signals.push({
      id: 'mail',
      weight: 45,
      lead: `${plural(emails.length, 'important message')} waiting.`,
      detail: `${plural(emails.length, 'important message')} in the inbox, the latest from ${emails[0].from || 'an unread sender'}. Triage them in one pass rather than between blocks.`
    });
  }

  if (objective) {
    const linked = tasks.filter((task) => task.objective);
    const done = linked.filter((task) => task.done).length;
    const share = linked.length ? done / linked.length : 0;
    const expected = weekProgress(now);
    if (linked.length && share < expected - 0.2) {
      signals.push({
        id: 'objective-behind',
        weight: 55 + Math.round((expected - share) * 30),
        lead: `Your objective is behind: ${done} of ${linked.length}.`,
        detail: `${quote(objective.text)} is at ${done} of ${linked.length} with the week ${Math.round(expected * 100)}% gone. This is the one to protect.`
      });
    } else if (linked.length && share === 1) {
      signals.push({ id: 'objective-done', weight: 35, lead: 'Your weekly objective is complete.', detail: `${quote(objective.text)} is done — every linked move is closed. Set the next one when you are ready.` });
    }
  }

  if (open.length && (!plan || localDate(new Date(plan.builtAt)) !== today)) {
    signals.push({
      id: 'no-plan',
      weight: 50,
      lead: 'Nothing is scheduled yet today.',
      detail: `${plural(open.length, 'move')} are open and none are in the diary. Plan the day so the order is decided once rather than repeatedly.`
    });
  }

  if (!pulse || localDate(new Date(pulse.savedAt)) !== today) {
    if (now.getHours() < 14) signals.push({ id: 'no-pulse', weight: 30, lead: 'No energy check-in yet.', detail: 'Log how you are arriving — it changes how long the planned blocks are, not just the wording.' });
  } else if (pulse.pulse === 'low') {
    signals.push({ id: 'low-energy', weight: 58, lead: 'You logged low energy.', detail: 'Low energy today, so the plan is short blocks with real breaks. Pick the one thing that has to happen and let the rest wait.' });
  }

  /**
   * A stalled area, from the same judgement the life cards show.
   *
   * Without this the cards could read STALLED while the briefing said nothing
   * needed attention — the two halves of the page disagreeing about the same
   * data. Slipping is deliberately not repeated here: an overdue item already
   * produces the far stronger signal above.
   */
  const stalled = AREAS
    .map((area) => domainStatus(area, { tasks, now }))
    .filter((domain) => domain.status === 'stalled')
    .sort((a, b) => (b.daysSinceLastDone ?? 999) - (a.daysSinceLastDone ?? 999));
  if (stalled.length) {
    const worst = stalled[0];
    const label = AREA_LABELS[worst.area] || worst.area;
    signals.push({
      id: 'stalled',
      weight: 48 + Math.min(10, stalled.length * 4),
      lead: stalled.length === 1 ? `Your ${label} work has stalled.` : `${stalled.length} areas have stalled.`,
      detail: stalled.length === 1
        ? `${plural(worst.open, 'move')} open under ${label} and nothing finished there ${worst.daysSinceLastDone === null ? 'yet' : `in ${plural(worst.daysSinceLastDone, 'day')}`}. Move one of them today, however small.`
        : `${stalled.map((domain) => AREA_LABELS[domain.area] || domain.area).join(' and ')} both have open work and nothing finished recently. Pick one and move it today.`
    });
  }

  if (!open.length) {
    signals.push({ id: 'queue-empty', weight: 40, lead: 'Your queue is clear.', detail: 'Nothing is open. Use the space to plan tomorrow or write down what actually worked today.' });
  }

  const weekFocus = focusLog.filter((entry) => new Date(entry.completedAt) > new Date(now - 7 * 24 * HOUR));
  const minutes = weekFocus.reduce((total, entry) => total + (entry.minutes || 0), 0);
  if (minutes >= 60) {
    signals.push({ id: 'focus', weight: 18, lead: `${Math.round(minutes / 60)}h of focus this week.`, detail: `${Math.floor(minutes / 60)}h ${minutes % 60}m of logged focus in the last seven days, across ${plural(weekFocus.length, 'session')}.` });
  }

  /**
   * The floor. If work is open, the briefing always has something true to say,
   * even when nothing above it fired — "nothing is pressing" while three moves
   * sit in the queue is the kind of wrong that stops the panel being read.
   */
  if (open.length) {
    const top = open[0];
    signals.push({
      id: 'open-work',
      weight: 15,
      lead: `${plural(open.length, 'move')} open. Start with ${quote(top.title)}.`,
      detail: `Nothing is urgent. ${plural(open.length, 'move')} are open, and ${quote(top.title)} is the one to start with.`
    });
  }

  return signals.sort((a, b) => b.weight - a.weight);
}

/**
 * The briefing itself: a lead for the hero and up to three sentences below it.
 *
 * Three is a deliberate cap. A briefing that lists everything is a backlog, and
 * the reason to rank the signals is to be able to drop the tail.
 */
export function buildBriefing(state = {}) {
  const signals = collectSignals(state);
  if (!signals.length) {
    return {
      lead: 'Nothing is pressing.',
      note: 'Nothing needs your attention right now. Add what matters, or connect a source, and this fills itself in.',
      signals: []
    };
  }
  return {
    lead: signals[0].lead,
    note: signals.slice(0, 3).map((signal) => signal.detail).join(' '),
    signals
  };
}
