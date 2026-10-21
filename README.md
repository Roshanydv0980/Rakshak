# Rakshak

A women safety platform with emergency SOS and real-time live tracking.

**Stack:** Node.js, Express, Socket.IO, SQLite (better-sqlite3), JWT auth, bcrypt, Leaflet, optional Twilio SMS.

## Features
- Sign up and log in (bcrypt password hashing, JWT sessions)
- Trusted contacts (up to five per user)
- Hold-to-activate SOS button: creates an alert and a secret tracking link
- Live location sharing for normal trips
- Public tracking page (`/track/<token>`) that updates live over WebSockets
- SMS to contacts through Twilio. Without Twilio keys, messages print in the server console.

## Run it
```bash
npm install
cp .env.example .env      # then set JWT_SECRET to a long random string
npm start
```
Open http://localhost:3000. Geolocation needs HTTPS on real phones, so use a tunnel
(`npx localtunnel --port 3000`) or deploy, and set `BASE_URL` to that address.

## API
| Method | Route | Purpose |
|---|---|---|
| POST | /api/register, /api/login | Create account, get JWT |
| GET/POST/DELETE | /api/contacts | Manage trusted contacts |
| POST | /api/sos | Start an alert and notify contacts |
| POST | /api/trips/start | Start live sharing and notify contacts |
| POST | /api/trips/:token/location | Send a location update (owner only) |
| POST | /api/trips/:token/end | Stop sharing |
| GET | /api/track/:token | Public: session info and path |

## Next steps to level this up
1. Move SQLite to PostgreSQL with PostGIS and add migrations (Prisma or Knex).
2. Replace the in-memory rate limiter with Redis, and add Helmet and input validation (zod).
3. Add tests (Vitest or Jest with Supertest) and a GitHub Actions workflow.
4. Add a Dockerfile and deploy to Render or Railway.
5. Build a React or React Native front end, plus a safe-walk timer that triggers alerts server-side.
6. Expire tracking links automatically after a set time.
