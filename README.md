# JARVIS Personal Command Center

A dependency-free personal assistant designed for GitHub Pages and iPhone Safari. It runs locally out of the box, storing your data in browser `localStorage`, and connects to Google (Calendar, Gmail, Sheets) and PocketAthlete when you give it the details. It ships with no demo data — every figure on screen is something you logged.

## Launch without an AI token

Yes. The app launches and remains useful without any token. Local mode supports tasks, priorities, due dates, focus sessions, weekly objectives, metrics, reviews, social reminders, and offline storage. Apps Script can also provide Calendar/Gmail/Sheets access after its Google permissions are approved. `GROQ_API_KEY` is optional: it enables screenshot understanding, timetable extraction, homework parsing, and deeper reasoning. Without it, Apps Script returns a small token-free text fallback instead of failing.

## V2 operating model

V2 treats JARVIS as a personal operating system rather than a task list. Your local operating context includes university/course, business focus, and training focus. The assistant receives that context when connected so a timetable, deadline, workout, or business message can be interpreted against the rest of your life. The daily agenda uses Google Calendar events when sync is connected and falls back to a usable local plan otherwise.

The V2 loop is:

1. Capture text, a screenshot, an email signal, or a social idea.
2. Let JARVIS extract tasks, questions, and calendar proposals.
3. Review the proposal and approve the specific action.
4. Execute the day with focus time and energy-aware planning.
5. Review outcomes, training load, business signals, and what needs to change.

## V3 operating layer

V3 adds browser notifications for upcoming social reminders and a metric log for study hours, business revenue, training load, and sleep. These work locally immediately and sync to the `Metrics` and `Social` sheets when Google is connected.

The planning layer now orders open work by completion state, priority, and due date, marks overdue work explicitly, and lets you set one weekly objective. The objective is intentionally singular: JARVIS should help you make a meaningful week happen, not encourage an endless queue.

Daily shutdown notes now use an in-app dialog rather than browser prompts and retain the latest 30 local reviews, giving future AI summaries a grounded record of what actually happened.

The current identity state is intentionally explicit: local mode means this browser is the identity, while Google sync means the Apps Script account is the data owner. A true sign-in screen requires a Google OAuth web client ID and authorized GitHub Pages origin; do not put a client secret in this static repository. That is the next security configuration step, not something the frontend should fake.

When updating an existing Apps Script deployment, run `setupJarvis` again once. It now adds missing V3 columns to existing sheets instead of requiring a new spreadsheet.

## Run it

Open `index.html` in a browser, or serve this folder with any static file server. GitHub Pages can publish the folder directly after it is pushed to a repository.

## Next integration step

The paste-ready backend is in `appscript/Code.gs`. Follow its setup comments to connect a Google Sheet and Google Calendar. Keep the frontend work behind a small API adapter; do not put credentials in this repository. The first backend contract covers:

- `GET` dashboard data: tasks, events, metrics, and recent captures
- `POST` task/capture changes
- `POST` pulse, workout, review, and performance metric entries
- `POST` AI assistant requests with optional timetable/homework images
- `GET` a limited important-email signal feed (unread, recent, important/starred, excluding promotions/social)
- `POST` social posting reminders
- A clear authentication strategy for a private personal app

Important: a public GitHub Pages site cannot keep a secret API key. For a truly private deployment, use Google login/OAuth or host the frontend behind an authenticated platform. The Apps Script web-app setting `Anyone with the link` is convenient for testing but should not be treated as strong privacy protection.

The local path should remain available so the app is usable during development and when the backend is unavailable.

## Frontend integration boundary

`src/api.js` is the only frontend module that should know the Apps Script URL. Add the deployed `/exec` URL to `API_URL` when the backend is ready. Keep it blank for local mode. The UI is intentionally usable without the network, and the adapter uses a `text/plain` POST body to avoid Apps Script browser preflight issues.

You can also connect without editing code: open the app, select the sync status at the bottom of the sidebar, paste the Apps Script `/exec` URL, and choose **Connect**. The URL is stored only in that browser's local storage. Clear the field to return to local mode.

## AI inbox setup with Groq

The AI inbox accepts text and image attachments. To enable Groq responses, open Apps Script **Project Settings -> Script properties** and add `GROQ_API_KEY`. Optionally add `GROQ_MODEL`; the default is `meta-llama/llama-4-scout-17b-16e-instruct`. Keep the key in Apps Script properties only. Never place it in this GitHub repository, GitHub Actions, or frontend code. JARVIS returns proposals first; calendar events are not created until you approve them.

Because the key was pasted into chat, rotate it in the Groq console and use the replacement value in Apps Script.

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`. In GitHub, open **Settings -> Pages**, choose **GitHub Actions** as the source, and push to `main`. GitHub will publish the static app at `https://<your-username>.github.io/AiAssistant/`. The Apps Script URL is configured from inside the app and is not committed to the repository.

The current command line uses a small local intent parser so the workflow can be tested immediately. Once the backend is connected, the same command surface can send structured requests to Groq through Apps Script and return approved actions such as task creation, calendar proposals, and daily summaries.

## Email and social signals

When Google sync is connected, Apps Script reads only a narrow Gmail query: unread messages from the last three days that are marked important or starred, excluding promotions and social mail. JARVIS receives sender, subject, date, and a short snippet. It does not forward the whole inbox to Groq. Social reminders are stored in the `Social` sheet and can later create approved Calendar events.

## PocketAthlete sync

PocketAthlete (`pocketathlete.com`, built from the `FOOTBALLFITNESSGURU`
repository) is the source of truth for training and readiness, and JARVIS is now
wired to it in both directions. It does not scrape anything: PocketAthlete
already publishes two token-addressed endpoints on its Cloudflare Worker, and
the integration uses those.

| Direction | Endpoint | Carries |
| --- | --- | --- |
| PocketAthlete → JARVIS | `GET /calendar?token=<uuid>` | The training programme as an ICS subscription: session titles, dates, exercise counts, and which sessions are done. |
| JARVIS → PocketAthlete | `POST /wearable-ingest` | Sleep hours, HRV, and resting heart rate, which feed PocketAthlete's readiness score. |

### The two directions do not travel the same way

This is a property of the Worker rather than a design choice here, and it
explains the one piece of setup that is otherwise surprising.

`/wearable-ingest` answers through the Worker's `json()` helper, which sends
`Access-Control-Allow-Origin: *` and allows `POST` and the `authorization`
header. The browser can therefore call it directly, so **pushing readiness works
in local mode with nothing else connected.**

`/calendar` answers with a bare `text/calendar` response and no CORS headers at
all, because it is built for calendar clients, which are not browsers and do not
enforce the same-origin policy. A `fetch()` from the page is refused before it
can read a byte, however the request is shaped. So **reading your training
programme needs Google sync connected too** — Apps Script fetches the feed
server-side with `UrlFetchApp`, parses it, and returns normalised sessions in the
dashboard payload.

### Setting it up

1. In PocketAthlete, get your calendar subscription link (Admin → the calendar
   token) and your Apple Health upload link (the one the Shortcut uses).
2. In JARVIS, open the **PocketAthlete** panel → **Settings**.
3. Paste either the whole link or just the token — the field accepts both, and
   pulls `?token=` out of the calendar link and `?t=` out of the health link.
4. Connect Google sync if you want the training feed as well as the push.

Both values are per-athlete feed credentials that PocketAthlete is designed to
have pasted into clients; an Apple Shortcut holds the same ingest token. They are
stored in this browser, and the calendar token is additionally copied into Apps
Script properties so the backend can read the feed. Re-minting either token
inside PocketAthlete revokes the old value immediately.

### What it does with them

- Today's session appears in **Today's agenda** as an all-day entry. The feed
  carries no clock times — the programme is ordered rather than scheduled — so
  none are invented.
- The **Training** life card shows completed-versus-planned sessions for the
  current week and names the next one.
- Completed sessions are mirrored into the `Workouts` sheet, deduplicated on the
  feed's own stable UID. Planned sessions are not: writing a plan as a workout
  would report training that has not happened.
- Logging a sleep, HRV, or resting-heart-rate metric in JARVIS pushes it to
  PocketAthlete automatically. Study hours and revenue are not sent — they have
  no home there. PocketAthlete keeps a value you typed in by hand over one
  pushed from here, and reports when it has done so.

One limitation worth knowing: the feed joins exercise names with a comma and
then escapes the whole description, so a joining comma and a comma inside a name
("Row, single-arm") are indistinguishable by the time they arrive. The exercise
*count* is exact; the names are shown as the sentence the feed sent rather than
split into a list that would sometimes be wrong.

## Planning late

"Plan my day" used to answer *"the day is done, plan tomorrow in the morning"*
and schedule nothing after your shutdown hour — so the app's main button did
nothing at all after nine in the evening, which is exactly when someone
finishing up wants tomorrow settled.

When today no longer has a usable block left, it plans **tomorrow** instead,
starting at your morning hour, and the panel says `TOMORROW'S PLAN` so it is
never mistaken for tonight. Tomorrow's training session is the one it sets
capacity aside for, not today's leftover.

A plan is now considered stale by the day it is **for**, not the day it was
built — so one made last night for today survives until today is over.

## Finding things

The four tabs used to be decorative: twelve of the thirteen panels were tagged
`overview`, so Overview was the whole app and switching tabs only ever removed a
few things. On a phone that was a 13,000-pixel scroll.

Each tab now answers one question, and Overview is a summary again:

| Tab | Question | Panels |
| --- | --- | --- |
| **Overview** | What do I do now? | Plan, queue, briefing, command line, energy |
| **Agenda** | When? | Plan, calendar, training, energy |
| **Workbench** | Doing | Queue, capture, posting reminders, important mail |
| **Performance** | How is it going? | Streak, effort split, objective, your numbers |
| **Setup** | What is connected? | Every integration, and where each feature lives |

The same page on a phone went from 13,443px to 2,210px.

**Setup** is the answer to "where is that thing". It lists every connection with
its live state — Google sync, PocketAthlete (and whether it has one token or
both), reminders, your context, backup — and each row is also the way to change
it. Under that is a short index of what the app does and which tab it is on.

The top-bar glyphs `◎ ♢ ◉` now carry labels (Profile, Alerts, Focus) on a wide
screen. A title attribute is invisible on a touch screen, where there is no
hover.

## On a phone

The app is used from an iPhone home-screen shortcut, and two controls were
unreachable there. The mobile breakpoint hid `.hero-stat` and `.sidebar-foot` to
save room, and between them those hold **Plan my day** and the **sync control** —
so on a phone the planner could not be run and Google sync could not be
connected at all. Both are back, laid out for the narrow column.

The life cards also collapsed to one per row at `max-width: 390px`, which is
exactly the iPhone 13/14/15 width — so the most common phone got four
full-width cards before anything else. That breakpoint is now 340px.

Tap targets on the plan blocks, training rows, tasks and icon buttons are at
least 44px.

## What is saved where

With Google sync connected, everything lands in your spreadsheet: `Tasks`
(including the weekly-objective link), `Captures`, `Reviews`, `Pulses`,
`Workouts`, `Metrics`, `Social`, and two new sheets — `Objectives`, one row per
week so the history of what each week was for survives, and `Focus`, one row per
completed session, deduplicated on the id the browser generated so a session
logged offline is not counted twice when sync returns.

The weekly objective and your focus sessions used to live only in the browser
that created them. They now come back on any device that opens the app.

**Run `setupJarvis` once more** after updating the Apps Script deployment. It
adds the new sheets and the `objective` column to existing ones rather than
needing a new spreadsheet.

## What each control actually does

Several features looked like features and did nothing. They now do the thing
their label promises, or say plainly what they cannot do.

### Plan my day

It used to print one of three fixed sentences chosen by the energy button. It
now builds a real schedule: it takes the hours left before your shutdown hour,
removes your Google Calendar events (merging overlapping ones, so nothing is
scheduled inside a meeting), orders your open work — overdue first, then due
today, then by priority — and lays it into the gaps in blocks.

Your energy check-in changes the shape rather than the wording: 50-minute blocks
when you log **sharp**, 40 when **steady**, 25 with more recovery and fewer of
them when **low**. A check-in from yesterday is ignored rather than used to
shape a day it knows nothing about.

A PocketAthlete session is listed as a **commitment without a time**, because
the feed has none — the programme is ordered, not scheduled. It still costs
capacity, so a training day plans lighter. That is the difference between using
what the feed knows and inventing an 18:00 it does not.

Each block is a button. Clicking one starts a focus session of exactly that
length against exactly that task.

The planner is a pure function in `src/planner.js` with no storage or DOM
access, so its rules are tested against fixed inputs rather than by clicking the
button and reading the copy.

### Focus sessions

The timer was a 25-minute stopwatch that recorded nothing about what it was for.
A session now carries its task, and only a session that runs to zero is logged —
an abandoned one is not focus time. Pressing the timer with no block chosen runs
it against the top of your queue rather than against nothing.

### Reminders

The reminder button used to show one notification the moment you pressed it and
schedule nothing, so a posting reminder set for Thursday never arrived. A
scheduler now checks every minute for anything due — a posting reminder, a task
past its deadline, a training session still not done — and announces each one
once.

**Its limit is stated in the app rather than hidden.** A page can only run its
timer while it is open. Firing reminders with the app closed needs Web Push and
a server holding a subscription, which a static GitHub Pages site cannot be, so
anything that came due while you were away is reported on your next visit
instead of being silently lost.

### The life cards

They showed a count of open tasks, which is the one number that cannot tell you
how an area of your life is going — a long list means momentum or abandonment
and looks identical either way.

Each card now leads with a judgement computed in `src/insights.js`:

| Status | Meaning |
| --- | --- |
| `SLIPPING` | Something in this area is past its deadline. |
| `STALLED` | Open work here, and nothing finished in it for a fortnight. |
| `MOVING` | Something was finished here in the last seven days. |
| `QUIET` | Open work, nothing recent, but not yet stale. |
| `CLEAR` | Nothing open. |

The order is the judgement: overdue work makes an area slipping whatever else is
true of it, and an area with open work and no finish for a fortnight is stalled
even when it looks busy.

The headline figure is whatever is decision-relevant for that domain rather than
the same count four times — **University** shows time to the nearest deadline
(`3d`, `TODAY`, `LATE`), **Training** shows sessions done against planned for
this week from the PocketAthlete feed and flags a missed one, **Build** shows
what actually shipped in seven days, and **Business** shows your latest logged
figure with its movement.

**They are filters, not tab links.** Pressing the card that just told you
university work is slipping shows you that work. Pressing it again clears it.
The counters elsewhere keep describing the whole queue, so a filter can never
misreport the size of your day.

### Momentum

It counted completions this week — real, and useless: it rises when you are busy
and says nothing about whether the system producing it works, or which parts of
your life are quietly getting none of you.

It now leads with the **streak** — consecutive days with something finished,
the one figure here that changes behaviour. Yesterday still counts as unbroken,
because at nine in the morning you have not failed today yet; ending it at
midnight would show a zero every morning and make the number worth ignoring.

Under the sparkline is **where the effort actually went** over a fortnight, as a
proportional bar by area. A neglected area shows up as an absent band, which is
the thing a task list structurally cannot tell you.

The line underneath is one observation, and only when the data supports one:
neglect first (*"Nothing finished under business for 21 days, with 1 move still
open"*), then a streak of three or more, then a weekday pattern, then whether
focus sessions correlate with output. Every branch has a threshold and returning
nothing is a valid answer — an insight drawn from three data points is a
horoscope.

### The queue

Completed tasks used to stay in it forever. Once completions started being kept
for the momentum panel that became a list which only grows, pushing the open
work off the bottom. The queue now shows open work plus what you finished today
— enough that ticking something still registers and a mis-tick can be undone —
and says how many older ones are kept in your history.

### The briefing and the hero line

The briefing was a three-branch template — empty queue, else the first task
tagged business, else the first task — with a fixed second clause bolted on. It
ignored deadlines, the calendar, training, energy, the objective and the inbox,
and it preferred anything tagged "business" over work that was actually overdue.
The hero line above it was a fixed sentence in the markup.

`src/briefing.js` now reads every source and ranks what it finds by severity
computed from the data: how overdue, how soon, how many. The hero shows the
top-ranked signal, the briefing shows the top three, and the two come from one
ranking so they cannot disagree about what today is about. If nothing is
pressing it says so rather than inventing something.

A signal is only produced when the data supports it — there is no branch that
invents a sentence to fill the space.

### The command line, offline

The old parser matched three substrings anywhere in the input. "add" won on
*"I finished adding the report"*, so that created a task; "done" and "complete"
both acted on whichever task happened to be first rather than the one you named;
and every task it made was medium priority with no due date, because nothing was
read out of the text.

`src/commands.js` parses instead, returning a structured intent that the app
executes. Verbs are anchored to the start of the instruction, so a sentence that
merely mentions "add" is not an add.

It reads the details out of what you typed:

```
add urgent finish the coursework by friday 5pm
  → title "Finish the coursework", high priority, study, due Friday 17:00
```

Dates it understands: `today`, `tonight`, `tomorrow`, a weekday name (always
forward — "friday" on a Friday means the next one), `next week`, `in 3 days`,
`in 2 hours`, and clock times like `5pm` or `at 14:30`. A bare time that has
already passed rolls to tomorrow. Whatever it consumes is removed from the
title, so you don't get a task called "Finish the coursework by friday" that
also has a due date.

Other commands: `complete <name>` (matched on word overlap against your open
work, and it says so when nothing matches rather than closing something else),
`what is due`, `show my open study work`, `plan my day`, `focus 40 on the
coursework`, `log sleep 7.5h`, `objective <text>`, `i'm feeling low`, and
`help`, which lists what it can actually do. Anything it does not understand
says so and shows the same list — it never guesses and acts anyway.

This is a command parser, not an imitation of a model. With `GROQ_API_KEY` set
in Apps Script the backend handles free-form language and screenshots; the above
is what remains true with no key and no network.

Enter sends; Shift+Enter starts a new line. The box is a textarea so a pasted
timetable can be several lines, which previously meant Enter typed a newline and
never sent anything.

### Weekly objective

Progress was a string-similarity guess: it matched tasks whose type appeared
somewhere in the objective's wording. You now tick **counts toward this week's
objective** when adding a move, and progress is those moves. Linked moves are
marked with a ◆ in the queue.

### Offline

The repository shipped a web manifest with no service worker behind it, so the
app advertised itself as installable and then needed the network to open. `sw.js`
caches the shell — cache-first for the static files, and never for the Apps
Script backend or the PocketAthlete Worker, because a stale copy of your
training programme or your inbox is worse than an honest failure.

### Status badges

`LOCAL AI`, `READY` and `CADENCE` were decoration that never changed. The first
two now report whether reasoning is running locally or on the backend; the third
counts the reminders actually scheduled.

## No demo data

The app previously shipped with seeded content: three example tasks, a name, a
three-item agenda, and fixed figures across the life cards, momentum panel, and
performance strip. All of it is gone. Every number on screen is now derived from
what you have actually logged, or reads `—` with a note saying what is missing.

Two things had to become real for that to work:

- **Completions are timestamped locally**, not only in the sheet. The momentum
  panel counts moves completed per day over a fortnight and compares this week
  with last; its bars are sized from that log rather than from CSS.
- **Focus sessions and daily pulses are kept as a log.** "Focus time logged"
  counts only sessions that ran to zero, and "energy this week" averages the
  pulses you actually recorded.

Exports are now version 2 and carry the focus log, pulse log, and PocketAthlete
connection alongside everything version 1 held; version 1 files still restore.
**A backup file contains your connection tokens, so treat it as private.**
