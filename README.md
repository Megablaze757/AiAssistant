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
