# Quizly — Online Quiz Management System

A responsive full-stack assessment platform built with React, TypeScript, Express, Node.js and MongoDB. It includes role-specific administrator, teacher and student workspaces, server-graded quiz attempts, a reusable question bank, reporting and production deployment configuration.

Quizly can be installed from a supported mobile or desktop browser as a Progressive Web App (PWA). On Android/Chrome, use the Install button in the app or the browser menu; on iPhone/iPad, open the site in Safari and choose Share → Add to Home Screen. The app shell and previously loaded static assets can be available offline, but signing in, quizzes, battles, assignments and other data features require an internet connection.

## Features

### Administrator

- Create admin, teacher and student accounts; activate or deactivate accounts.
- Assign subjects, departments and semesters to student accounts.
- Manage the academic subject catalog.
- Monitor all quizzes and review/export student results.

### Assignments

- Teachers create subject assignments with instructions, due dates and a maximum mark.
- Students submit PDF or JPG files up to 5 MB before the deadline and can replace them until a teacher reviews them.
- Teachers download submissions, grade them and leave feedback; students see the grade and feedback after review.
- Submission files are stored in the private MongoDB database and can only be downloaded by the student who submitted them or the assignment's teacher.

### Quiz battles and weekly leaderboard

- Teachers or students can create a quiz battle using a published quiz, selecting two individual students or two teams of 2–5 students.
- All selected students must mark themselves ready before the shared quiz timer begins. Each side gets one answer per question; the first correct answer earns a point. The highest score wins.
- Battle questions are snapshotted when the battle is created, and correct answers are never sent to clients.
- Students can view the weekly leaderboard for all active student accounts. It uses each student's best percentage per quiz during the current Asia/Karachi week, then averages those percentages. Ties share a rank; students without completed quizzes appear without a rank. Individual quiz marks are not shown.
- The weekly ranking resets at Monday 12:00 AM Asia/Karachi time.

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

The app can also be deployed to Vercel's free Hobby plan for a class or personal project. The Vite frontend is served as static output and `api/index.js` routes API requests to the Express application. Import the GitHub repository into Vercel; `vercel.json` supplies the build, output and routing configuration. Configure `MONGODB_URI`, `JWT_SECRET`, `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the Vercel project environment settings. Use a MongoDB Atlas database user created for this app, and allow database access from the deployed service's outbound IP ranges where possible.

Teachers can optionally generate question-bank drafts with Gemini. Configure `GEMINI_API_KEY` as a server-side environment variable in Vercel (and locally in `.env`) to enable it. Keep the key private; generated questions must be reviewed by the teacher before they are saved. The generation endpoint limits requests and creates drafts only.

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
