const initialTasks = [
  { id: 1, title: 'Ship the first JARVIS slice', detail: 'Build the daily command center', type: 'task', done: false },
  { id: 2, title: 'Review this week\'s numbers', detail: 'Revenue, energy, and learning', type: 'business', done: false },
  { id: 3, title: 'Protect one hour for learning', detail: 'Keep the long game moving', type: 'personal', done: false }
];

const taskList = document.querySelector('#task-list');
const focusCount = document.querySelector('#focus-count');
const toast = document.querySelector('#toast');
const briefingCopy = document.querySelector('#briefing-copy');
let tasks = JSON.parse(localStorage.getItem('jarvis-tasks') || 'null') || initialTasks;
let focusTimer;
let focusSeconds = 0;

function renderTasks() {
  taskList.innerHTML = tasks.map((task) => `
    <div class="task ${task.done ? 'done' : ''}">
      <input type="checkbox" id="task-${task.id}" data-task-id="${task.id}" ${task.done ? 'checked' : ''}>
      <label for="task-${task.id}"><strong>${task.title}</strong><small>${task.detail}</small></label>
    </div>`).join('');
  focusCount.textContent = String(tasks.filter((task) => !task.done).length).padStart(2, '0');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function refreshBriefing() {
  const openTasks = tasks.filter((task) => !task.done);
  const businessTasks = openTasks.filter((task) => task.type === 'business');
  if (!openTasks.length) {
    briefingCopy.textContent = 'Your queue is clear. Use the space to plan tomorrow or record what worked today.';
  } else if (businessTasks.length) {
    briefingCopy.textContent = `Start with “${businessTasks[0].title}”. It keeps your business signal visible before the day gets noisy.`;
  } else {
    briefingCopy.textContent = `Start with “${openTasks[0].title}”, then protect the first deep-work block before opening new work.`;
  }
}

taskList.addEventListener('change', (event) => {
  const id = Number(event.target.dataset.taskId);
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = event.target.checked;
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  renderTasks();
  showToast(task.done ? 'Move completed.' : 'Move restored.');
});

document.querySelector('#add-task').addEventListener('click', () => {
  const title = window.prompt('What needs your attention?');
  if (!title?.trim()) return;
  tasks.push({ id: Date.now(), title: title.trim(), detail: 'Captured from your command center', type: 'task', done: false });
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  renderTasks();
  showToast('Added to your command queue.');
});

document.querySelector('#capture-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#capture-input');
  const type = document.querySelector('#capture-type').value;
  if (!input.value.trim()) return;
  tasks.push({ id: Date.now(), title: input.value.trim(), detail: `Quick capture • ${type}`, type, done: false });
  localStorage.setItem('jarvis-tasks', JSON.stringify(tasks));
  input.value = '';
  renderTasks();
  showToast('Captured. It is now in your queue.');
});

document.querySelector('#focus-button').addEventListener('click', () => {
  const button = document.querySelector('#focus-button');
  if (focusTimer) {
    window.clearInterval(focusTimer);
    focusTimer = null;
    button.textContent = '◉';
    button.title = 'Resume focus session';
    showToast('Focus session paused.');
    return;
  }
  focusSeconds = focusSeconds || 25 * 60;
  button.title = 'Pause focus session';
  focusTimer = window.setInterval(() => {
    focusSeconds -= 1;
    const minutes = String(Math.floor(focusSeconds / 60)).padStart(2, '0');
    const seconds = String(focusSeconds % 60).padStart(2, '0');
    button.textContent = `${minutes}:${seconds}`;
    if (focusSeconds <= 0) {
      window.clearInterval(focusTimer);
      focusTimer = null;
      button.textContent = '◉';
      button.title = 'Start another focus session';
      showToast('Focus session complete. Log the win before moving on.');
    }
  }, 1000);
  showToast('25-minute focus session started.');
});
document.querySelector('#briefing-button').addEventListener('click', () => { refreshBriefing(); showToast('Briefing refreshed from your local queue.'); });
document.querySelector('#review-button').addEventListener('click', () => {
  const note = window.prompt('Daily shutdown: what moved forward, what mattered, and what is next?');
  if (!note?.trim()) return;
  localStorage.setItem('jarvis-last-review', JSON.stringify({ note: note.trim(), savedAt: new Date().toISOString() }));
  showToast('Daily review saved locally.');
});
document.querySelectorAll('[data-view], [data-view-target]').forEach((button) => button.addEventListener('click', () => showToast(`${button.dataset.view || button.dataset.viewTarget} view is coming next.`)));

renderTasks();
refreshBriefing();