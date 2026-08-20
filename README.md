# VCTM Foundly

A local, database-backed lost-and-found application for Vivekananda College of Technology and Management.

## Run it

1. Open a terminal in this folder.
2. Run `python3 server.py`.
3. Open `http://localhost:8000` in a browser.

Do not open `index.html` directly; the app needs the local server for authentication and shared data.

## Accounts

- Users may register only with a `@vctm.in` email address.
- Choose Student, Faculty, Staff member, or Campus worker during registration.
- Admin demo: `admin@foundly.test` / `admin123`.

Change the admin password in `server.py` before publishing or presenting the project.

## Included features

- SQLite database storage
- Hashed passwords and HTTP-only login sessions
- VCTM-only registration
- Lost/found reports, search, filters, and category selection
- Safe connection requests; the reporter approves or declines them
- Admin overview of reports
- Automatic refresh of reports every 10 seconds

## Before deploying publicly

Use HTTPS, a hosted database, email OTP verification, password reset, image storage, rate limiting, audit logs, and a production-grade web server. The bundled server is intended for local development and academic demonstration.
