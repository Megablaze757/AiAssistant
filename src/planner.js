/**
 * The day planner.
 *
 * "Plan my day" used to print one of three fixed sentences chosen by the energy
 * button — it read as planning and did nothing. This builds an actual schedule:
 * real clock times, in the hours you have left, around the things you have
 * already committed to.
 *
 * It is a pure function on purpose. Everything it needs is passed in and it
 * touches no storage and no DOM, so the scheduling rules below can be tested
 * against fixed inputs rather than by clicking the button and reading the copy.
 *
 * WHAT IT WILL NOT DO is invent a commitment. A training session from
 * PocketAthlete has no clock time — the programme is ordered, not scheduled —
 * so it is never given one here. It is listed as a commitment for the day and
 * its expected cost is subtracted from the capacity, which changes how much
 * work gets scheduled without pretending to know when you will train.
 */

/** Deep-work shape by energy. Low energy gets shorter blocks and more recovery,
 *  which is the entire practical difference an energy check-in should make. */
const SHAPES = {
  low: { block: 25, break: 10, maxBlocks: 3 },
  steady: { block: 40, break: 10, maxBlocks: 5 },
  sharp: { block: 50, break: 10, maxBlocks: 6 }
};

const TRAINING_COST_MINUTES = 75;
const MIN_USEFUL_BLOCK = 15;

const at = (day, minutes) => {
  const result = new Date(day);
  result.setHours(0, minutes, 0, 0);
  return result;
};

const addDays = (date, count) => { const result = new Date(date); result.setDate(result.getDate() + count); return result; };
const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Round up to the next quarter hour: a plan that starts at 14:07 is a plan
 *  nobody follows. */
function nextQuarter(date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15);
  return rounded;
}

/**
 * The gaps left in the day once fixed commitments are removed.
 *
 * Overlapping calendar events are merged first. Without that, two overlapping
 * meetings produce a negative-length gap between them and the planner schedules
 * work inside a meeting.
 */
export function freeGaps(now, dayEnd, events) {
  const busy = events
    .map((event) => ({ start: new Date(event.start), end: new Date(event.end || event.start) }))
    .filter((slot) => !Number.isNaN(slot.start.getTime()) && slot.end > now)
    .sort((a, b) => a.start - b.start)
    .reduce((merged, slot) => {
      const last = merged[merged.length - 1];
      if (last && slot.start <= last.end) { last.end = new Date(Math.max(last.end, slot.end)); return merged; }
      merged.push({ start: new Date(slot.start), end: new Date(slot.end) });
      return merged;
    }, []);

  const gaps = [];
  let cursor = new Date(now);
  busy.forEach((slot) => {
    if (slot.start > cursor) gaps.push({ start: new Date(cursor), end: new Date(Math.min(slot.start, dayEnd)) });
    if (slot.end > cursor) cursor = new Date(slot.end);
  });
  if (cursor < dayEnd) gaps.push({ start: new Date(cursor), end: new Date(dayEnd) });
  return gaps.filter((gap) => gap.end - gap.start >= MIN_USEFUL_BLOCK * 60000);
}

/**
 * Order the work.
 *
 * Overdue first, then due today, then by priority, then by how soon it is due.
 * This is the same intent as the task list's own sort, applied to what is left
 * of the day: on a day with three free hours the order decides what actually
 * gets done, so it is the one place worth being explicit.
 */
export function orderWork(tasks, now) {
  const rank = { high: 0, medium: 1, low: 2 };
  const endOfToday = at(now, 24 * 60);
  const score = (task) => {
    if (!task.dueAt) return 2;
    const due = new Date(task.dueAt);
    if (Number.isNaN(due.getTime())) return 2;
    if (due < now) return 0;
    return due <= endOfToday ? 1 : 2;
  };
  return tasks
    .filter((task) => !task.done)
    .slice()
    .sort((a, b) => {
      const urgency = score(a) - score(b);
      if (urgency) return urgency;
      const priority = (rank[a.priority || 'medium'] ?? 1) - (rank[b.priority || 'medium'] ?? 1);
      if (priority) return priority;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt);
      return a.dueAt ? -1 : b.dueAt ? 1 : 0;
    });
}

/**
 * Build the plan.
 *
 * Returns blocks with real start and end times, plus the commitments that have
 * no time and the reasons anything was left out. The caller renders it; nothing
 * here knows about the page.
 */
export function buildPlan({ now = new Date(), events = [], training = [], tasks = [], energy = 'steady', dayEndHour = 21, dayStartHour = 9 } = {}) {
  const shape = SHAPES[energy] || SHAPES.steady;

  /**
   * WHEN TODAY IS OVER, PLAN TOMORROW.
   *
   * This used to answer "the day is done, plan tomorrow in the morning" and
   * schedule nothing — so the app's main button did nothing at all after nine
   * in the evening, which is exactly when someone finishing up is most likely
   * to want tomorrow settled. Planning the next morning is the useful answer,
   * and saying which day it is for keeps it honest.
   */
  const todayEnd = at(now, dayEndHour * 60);
  const forTomorrow = todayEnd.getTime() - nextQuarter(now).getTime() < MIN_USEFUL_BLOCK * 60000;
  const start = forTomorrow ? at(addDays(now, 1), dayStartHour * 60) : nextQuarter(now);
  const dayEnd = forTomorrow ? at(addDays(now, 1), dayEndHour * 60) : todayEnd;
  const targetDate = isoDate(start);

  // Sessions are matched to the day being planned rather than assumed to be
  // today's, or a plan made at 10pm would carry today's training into tomorrow.
  const commitments = training
    .filter((session) => !session.done && (!session.date || session.date === targetDate))
    .map((session) => ({
      kind: 'training',
      title: session.title,
      detail: session.exerciseCount ? `${session.exerciseCount} exercises • you choose the time` : 'You choose the time',
      minutes: TRAINING_COST_MINUTES
    }));

  const gaps = freeGaps(start, dayEnd, events);
  // Training is not placed, but it does cost time, so it comes out of capacity
  // before anything is scheduled. This is what makes a training day plan lighter.
  let capacity = gaps.reduce((total, gap) => total + (gap.end - gap.start) / 60000, 0) - commitments.reduce((total, item) => total + item.minutes, 0);
  // Ordered against the planning day, so "overdue" and "due today" mean what
  // they should on the day the blocks actually fall.
  const queue = orderWork(tasks, forTomorrow ? start : now);
  const blocks = [];
  let scheduled = 0;
  let index = 0;

  for (const gap of gaps) {
    let cursor = new Date(gap.start);
    while (index < queue.length && scheduled < shape.maxBlocks && capacity >= MIN_USEFUL_BLOCK) {
      const remaining = (gap.end - cursor) / 60000;
      if (remaining < MIN_USEFUL_BLOCK) break;
      const length = Math.min(shape.block, remaining, capacity);
      const task = queue[index];
      const end = new Date(cursor.getTime() + length * 60000);
      blocks.push({
        kind: 'work',
        start: cursor.toISOString(),
        end: end.toISOString(),
        minutes: Math.round(length),
        title: task.title,
        detail: describeTask(task, now),
        taskId: task.id,
        area: task.type || 'task'
      });
      cursor = new Date(end.getTime() + shape.break * 60000);
      capacity -= length + shape.break;
      scheduled += 1;
      index += 1;
    }
    if (scheduled >= shape.maxBlocks || capacity < MIN_USEFUL_BLOCK) break;
  }

  return {
    blocks,
    commitments,
    capacityMinutes: Math.max(0, Math.round(capacity)),
    unscheduled: Math.max(0, queue.length - blocks.length),
    forTomorrow,
    forDate: targetDate,
    note: planNote({ blocks, queue, commitments, energy, shape, forTomorrow })
  };
}

function describeTask(task, now) {
  if (!task.dueAt) return task.type || 'Task';
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return task.type || 'Task';
  if (due < now) return `Overdue since ${due.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
  return `Due ${due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** One sentence about the plan that is true of this plan, not of plans. */
function planNote({ blocks, queue, commitments, energy, shape, forTomorrow }) {
  const day = forTomorrow ? 'tomorrow' : 'today';
  if (!queue.length) return `Nothing is queued, so there is nothing to schedule. Add the one move that would make ${day} count.`;
  if (!blocks.length) return forTomorrow
    ? 'Tomorrow is already full in your calendar. Protect one block by moving something, rather than forcing work into the gaps.'
    : 'Your calendar is full for the rest of today. Protect tomorrow morning instead of forcing work into the gaps.';
  const opener = forTomorrow ? 'Today is done, so this is tomorrow. ' : '';
  const training = commitments.length ? ` Training is set aside separately, so ${day} is ${shape.block}-minute blocks rather than a full load.` : '';
  const left = queue.length - blocks.length;
  const energyNote = energy === 'low' ? 'Short blocks and real breaks, because you logged low energy.' : energy === 'sharp' ? 'Long blocks first, while the energy is there.' : 'Steady blocks with breaks between them.';
  return `${opener}${energyNote}${training}${left ? ` ${left} more item${left === 1 ? ' stays' : 's stay'} in the queue for tomorrow.` : ''}`;
}
