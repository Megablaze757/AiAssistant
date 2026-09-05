/**
 * Domain health and momentum.
 *
 * The life cards counted open tasks and the momentum panel counted completions.
 * Both were true and neither was useful: a count of open work says nothing
 * about whether a part of your life is moving, and a weekly total says nothing
 * about whether the system producing it is working.
 *
 * What a life dashboard should surface is NEGLECT and STALL — the areas
 * quietly receiving nothing — because those are invisible in a task list. A
 * count cannot show that. "Nothing finished here in twelve days" can.
 *
 * Pure, like the planner and the briefing: fixed inputs, no storage, no DOM,
 * so the thresholds below are tested rather than eyeballed.
 */

const DAY = 86400000;
const STALE_DAYS = 14;

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parse = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * How one area of life is actually going.
 *
 * The order matters and is the whole judgement: something overdue is slipping
 * whatever else is true of the area, and an area with open work and no finish
 * for a fortnight is stalled even if it looks busy. Only then does recent
 * completion count as moving.
 */
export function domainStatus(area, { tasks = [], now = new Date() } = {}) {
  const mine = tasks.filter((task) => task.type === area);
  const open = mine.filter((task) => !task.done);
  const overdue = open.filter((task) => { const due = parse(task.dueAt); return due && due < now; });
  const finished = mine
    .filter((task) => task.done && parse(task.completedAt))
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const lastDone = finished[0] ? new Date(finished[0].completedAt) : null;
  const daysSince = lastDone ? Math.floor((now - lastDone) / DAY) : null;
  const week = finished.filter((task) => new Date(task.completedAt) >= new Date(now - 7 * DAY)).length;

  let status = 'clear';
  if (overdue.length) status = 'slipping';
  else if (open.length && (daysSince === null || daysSince >= STALE_DAYS)) status = 'stalled';
  else if (week) status = 'moving';
  else if (open.length) status = 'quiet';

  return { area, status, open: open.length, overdue: overdue.length, completedThisWeek: week, daysSinceLastDone: daysSince, lastDone };
}

/** The soonest open deadline in an area, or null. */
export function nextDeadline(area, { tasks = [], now = new Date() } = {}) {
  return tasks
    .filter((task) => !task.done && task.type === area && parse(task.dueAt))
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0] || null;
}

/** Whole days until a deadline: negative when it has passed, 0 for today. */
export function daysUntil(value, now = new Date()) {
  const due = parse(value);
  if (!due) return null;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const target = new Date(due); target.setHours(0, 0, 0, 0);
  return Math.round((target - start) / DAY);
}

/**
 * Consecutive days ending today or yesterday with at least one completion.
 *
 * YESTERDAY COUNTS as an unbroken streak, because at nine in the morning you
 * have not failed today yet. Ending the streak at midnight would show a zero
 * every morning and make the number worth ignoring.
 */
export function streak(tasks = [], now = new Date()) {
  const done = new Set(tasks
    .filter((task) => task.done && parse(task.completedAt))
    .map((task) => localDate(new Date(task.completedAt))));
  if (!done.size) return 0;
  const cursor = new Date(now);
  if (!done.has(localDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!done.has(localDate(cursor))) return 0;
  }
  let count = 0;
  while (done.has(localDate(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

/** Completions per day, oldest first. */
export function completionsByDay(tasks = [], days = 14, now = new Date()) {
  const counts = new Map();
  tasks.filter((task) => task.done && parse(task.completedAt))
    .forEach((task) => { const key = localDate(new Date(task.completedAt)); counts.set(key, (counts.get(key) || 0) + 1); });
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now); day.setDate(day.getDate() - offset);
    const key = localDate(day);
    out.push({ date: key, count: counts.get(key) || 0 });
  }
  return out;
}

/** Where the effort actually went, largest first. */
export function areaSplit(tasks = [], days = 14, now = new Date()) {
  const since = new Date(now - days * DAY);
  const counts = new Map();
  tasks.filter((task) => task.done && parse(task.completedAt) && new Date(task.completedAt) >= since)
    .forEach((task) => { const area = task.type || 'other'; counts.set(area, (counts.get(area) || 0) + 1); });
  return [...counts.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count);
}

/**
 * One observation that is true of this fortnight.
 *
 * Every branch has a threshold, and returning nothing is a valid answer. An
 * "insight" drawn from three data points is a horoscope, and the panel already
 * has a truthful fallback to fall back to.
 */
export function momentumInsight({ tasks = [], focusLog = [], now = new Date(), areas = ['study', 'training', 'coding', 'business'] } = {}) {
  const days = completionsByDay(tasks, 14, now);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const run = streak(tasks, now);

  // Neglect first: it is the thing a dashboard can tell you that a list cannot.
  const neglected = areas
    .map((area) => domainStatus(area, { tasks, now }))
    .filter((domain) => domain.open && (domain.daysSinceLastDone === null || domain.daysSinceLastDone >= 10))
    .sort((a, b) => (b.daysSinceLastDone ?? 999) - (a.daysSinceLastDone ?? 999))[0];
  if (neglected) {
    return neglected.daysSinceLastDone === null
      ? `Nothing has ever been finished under ${neglected.area}, and ${plural(neglected.open, 'move')} ${neglected.open === 1 ? 'is' : 'are'} open there.`
      : `Nothing finished under ${neglected.area} for ${plural(neglected.daysSinceLastDone, 'day')}, with ${plural(neglected.open, 'move')} still open.`;
  }

  if (run >= 3) return `${plural(run, 'day')} in a row with something finished.`;

  // A weekday pattern needs a fortnight of both samples to mean anything.
  if (total >= 8) {
    const byWeekday = new Map();
    days.forEach((day) => {
      const weekday = new Date(`${day.date}T12:00:00`).getDay();
      const entry = byWeekday.get(weekday) || { total: 0, samples: 0 };
      byWeekday.set(weekday, { total: entry.total + day.count, samples: entry.samples + 1 });
    });
    const averages = [...byWeekday.entries()].map(([weekday, entry]) => ({ weekday, mean: entry.total / entry.samples }));
    const best = averages.slice().sort((a, b) => b.mean - a.mean)[0];
    const overall = total / days.length;
    if (best && best.mean >= overall * 2 && best.mean >= 1.5) {
      const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][best.weekday];
      return `${name}s are your strongest day by some way.`;
    }
  }

  // Focus's effect on output, once there is enough of both to compare.
  const focusDays = new Set(focusLog.filter((entry) => parse(entry.completedAt)).map((entry) => localDate(new Date(entry.completedAt))));
  const withFocus = days.filter((day) => focusDays.has(day.date));
  const withoutFocus = days.filter((day) => !focusDays.has(day.date));
  if (withFocus.length >= 3 && withoutFocus.length >= 3 && total >= 6) {
    const mean = (list) => list.reduce((sum, day) => sum + day.count, 0) / list.length;
    if (mean(withFocus) >= mean(withoutFocus) * 1.5) {
      return `Days with a focus session average ${mean(withFocus).toFixed(1)} moves against ${mean(withoutFocus).toFixed(1)} without.`;
    }
  }

  return '';
}
