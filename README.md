# JARVIS Personal Command Center

A dependency-free first slice of a personal assistant designed for GitHub Pages and iPhone Safari. It currently runs in local demo mode and stores the command queue in browser `localStorage`.

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

The local demo path should remain available so the app is usable during development and when the backend is unavailable.

## Frontend integration boundary

`src/api.js` is the only frontend module that should know the Apps Script URL. Add the deployed `/exec` URL to `API_URL` when the backend is ready. Keep it blank for local demo mode. The UI is intentionally usable without the network, and the adapter uses a `text/plain` POST body to avoid Apps Script browser preflight issues.

You can also connect without editing code: open the app, select the sync status at the bottom of the sidebar, paste the Apps Script `/exec` URL, and choose **Connect**. The URL is stored only in that browser's local storage. Clear the field to return to local demo mode.

## AI inbox setup with Groq

The AI inbox accepts text and image attachments. To enable Groq responses, open Apps Script **Project Settings -> Script properties** and add `GROQ_API_KEY`. Optionally add `GROQ_MODEL`; the default is `meta-llama/llama-4-scout-17b-16e-instruct`. Keep the key in Apps Script properties only. Never place it in this GitHub repository, GitHub Actions, or frontend code. JARVIS returns proposals first; calendar events are not created until you approve them.

Because the key was pasted into chat, rotate it in the Groq console and use the replacement value in Apps Script.

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`. In GitHub, open **Settings -> Pages**, choose **GitHub Actions** as the source, and push to `main`. GitHub will publish the static app at `https://<your-username>.github.io/AiAssistant/`. The Apps Script URL is configured from inside the app and is not committed to the repository.

The current command line uses a small local intent parser so the workflow can be tested immediately. Once the backend is connected, the same command surface can send structured requests to Groq through Apps Script and return approved actions such as task creation, calendar proposals, and daily summaries.

## Email and social signals

When Google sync is connected, Apps Script reads only a narrow Gmail query: unread messages from the last three days that are marked important or starred, excluding promotions and social mail. JARVIS receives sender, subject, date, and a short snippet. It does not forward the whole inbox to Groq. Social reminders are stored in the `Social` sheet and can later create approved Calendar events.

## PocketAthlete sync

PocketAthlete is the source of truth for training readiness, load, soreness, sleep, workouts, and form analysis. JARVIS should consume a normalized summary and use it to plan study, coding, and business work around training and recovery. PocketAthlete's public site does not advertise a public API or export contract, so the integration currently exposes `syncPocketAthleteWorkout` as a backend boundary rather than scraping private pages. Use an official API/export from PocketAthlete when available, or import a user-owned CSV/JSON export through a future settings tool.

Recommended normalized payload:

```json
{
	"sourceId": "pocketathlete-workout-id",
	"name": "Upper body strength",
	"durationMinutes": 62,
	"intensity": "moderate",
	"notes": "Readiness 82; sleep 7.8h; no pain",
	"createdAt": "2026-09-04T17:00:00.000Z"
}
```