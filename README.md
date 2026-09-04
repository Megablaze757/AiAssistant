# JARVIS Personal Command Center

A dependency-free first slice of a personal assistant designed for GitHub Pages and iPhone Safari. It currently runs in local demo mode and stores the command queue in browser `localStorage`.

## Run it

Open `index.html` in a browser, or serve this folder with any static file server. GitHub Pages can publish the folder directly after it is pushed to a repository.

## Next integration step

The paste-ready backend is in `appscript/Code.gs`. Follow its setup comments to connect a Google Sheet and Google Calendar. Keep the frontend work behind a small API adapter; do not put credentials in this repository. The first backend contract covers:

- `GET` dashboard data: tasks, events, metrics, and recent captures
- `POST` task/capture changes
- `POST` pulse, workout, review, and performance metric entries
- A clear authentication strategy for a private personal app

Important: a public GitHub Pages site cannot keep a secret API key. For a truly private deployment, use Google login/OAuth or host the frontend behind an authenticated platform. The Apps Script web-app setting `Anyone with the link` is convenient for testing but should not be treated as strong privacy protection.

The local demo path should remain available so the app is usable during development and when the backend is unavailable.

## Frontend integration boundary

`src/api.js` is the only frontend module that should know the Apps Script URL. Add the deployed `/exec` URL to `API_URL` when the backend is ready. Keep it blank for local demo mode. The UI is intentionally usable without the network, and the adapter uses a `text/plain` POST body to avoid Apps Script browser preflight issues.

The current command line uses a small local intent parser so the workflow can be tested immediately. Once the backend is connected, the same command surface can send structured requests to Gemini through Apps Script and return approved actions such as task creation, calendar proposals, and daily summaries.

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