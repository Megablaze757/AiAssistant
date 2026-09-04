# JARVIS Personal Command Center

A dependency-free first slice of a personal assistant designed for GitHub Pages and iPhone Safari. It currently runs in local demo mode and stores the command queue in browser `localStorage`.

## Run it

Open `index.html` in a browser, or serve this folder with any static file server. GitHub Pages can publish the folder directly after it is pushed to a repository.

## Next integration step

The paste-ready backend is in `appscript/Code.gs`. Follow its setup comments to connect a Google Sheet and Google Calendar. Keep the frontend work behind a small API adapter; do not put credentials in this repository. The first backend contract covers:

- `GET` dashboard data: tasks, events, metrics, and recent captures
- `POST` task/capture changes
- A clear authentication strategy for a private personal app

Important: a public GitHub Pages site cannot keep a secret API key. For a truly private deployment, use Google login/OAuth or host the frontend behind an authenticated platform. The Apps Script web-app setting `Anyone with the link` is convenient for testing but should not be treated as strong privacy protection.

The local demo path should remain available so the app is usable during development and when the backend is unavailable.