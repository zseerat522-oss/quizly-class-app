# Quizly — Online Quiz Management System

A responsive full-stack assessment platform built with React, TypeScript, Express, Node.js and MongoDB. It includes role-specific administrator, teacher and student workspaces, server-graded quiz attempts, a reusable question bank, reporting and production deployment configuration.

## Features

### Administrator

- Create admin, teacher and student accounts; activate or deactivate accounts.
- Assign subjects, departments and semesters to student accounts.
- Manage the academic subject catalog.
- Monitor all quizzes and review/export student results.

### Teacher

- Create, edit and publish quizzes; keep work as drafts.
- Add multiple-choice and true/false questions, set marks, topics and difficulty.
- Reuse questions from a subject/topic/difficulty-aware question bank.
- Set a duration, passing marks, open/close schedule, attempt limit and student assignments.
- Shuffle question and option order per attempt.
- Review individual submissions and question-level/class performance analytics.
- Export results as CSV.

### Student

- Register with a student account or sign in to an institution-created account.
- Browse quizzes assigned to the student or their subjects.
- Take timed quizzes with previous/next navigation, answer status and server-backed autosave.
- Resume an unfinished attempt after a refresh or connection loss.
- Submit manually or be submitted when the server-enforced timer expires.
- View scores, percentages and attempt history.

Answers are scored on the server. Correct answers are not returned to student quiz or history APIs. Randomization is per attempt; it is an assessment aid, not a guarantee against cheating.

## Run locally

Requirements: Node.js 20.19+ (Node 24 recommended), npm, and Docker Desktop or a local MongoDB server.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`. Set a long random `JWT_SECRET`, and a private administrator email/password.

3. Start MongoDB. With Docker Desktop installed, you can run the complete app and MongoDB using:

   ```bash
   docker compose up --build
   ```

   The app will be available at `http://localhost:4000`. MongoDB data persists in the `quizly-mongo` Docker volume.

   Alternatively, start a local MongoDB instance and set `MONGODB_URI=mongodb://127.0.0.1:27017/quizapp` in `.env`, then run:

   ```bash
   npm run dev
   ```

   Vite serves the React app at `http://localhost:5173` and proxies `/api` requests to the Express API at port 4000. The API creates the initial admin account on first startup when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are configured. Change/remove the seed password after first use.

4. Sign in with the admin credentials from `.env`. Create subjects, then teacher/student accounts. Students may also self-register; public registration can only create student accounts.

The API health endpoint is `http://localhost:4000/api/health`.

## Production hosting

`render.yaml` is a Render Blueprint for a single web service that builds the React application and serves it from Express. `Dockerfile` and `docker-compose.yml` are provided for container-based hosting and local development.

To deploy:

1. Create a MongoDB Atlas cluster and database user. Allow network access only from your hosting provider where possible; use TLS and a least-privilege database user.
2. Push this project to a Git provider and create a Render Blueprint from the repository.
3. In Render, set the generated `MONGODB_URI` to the Atlas connection URI, and provide a unique `ADMIN_EMAIL` and strong `ADMIN_PASSWORD`. Render generates `JWT_SECRET`.
4. Deploy and open the Render service URL. The same-origin frontend/API setup requires no separate CORS configuration.
5. Configure Atlas backups, usage alerts, and an appropriate paid hosting plan before real institutional/high-stakes use.

Hosting providers and MongoDB Atlas require user-owned accounts and credentials; this repository includes deployment configuration but does not create or deploy external services by itself. Never commit `.env`, database credentials or production secrets.

## Useful commands

```bash
npm run dev       # Vite and API in watch mode
npm run build     # Type-check and production frontend build
npm run lint      # Oxlint
npm start         # Production API and built frontend
```
