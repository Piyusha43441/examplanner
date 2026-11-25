# EXAM PLANNER — AI Exam Seating & Management System

**Tagline:** Smart Examination Seating. Zero Manual Allocation.

## Features Implemented
- **Authentication & Institution Isolation**: Email/Password registration & login, Password Reset email (`sendPasswordResetEmail`), Google Sign-In with Institution Onboarding, and strict per-institution Firestore tenant isolation (`firestore.rules`).
- **Deterministic Seating Allocation Engine**: Allocates across classrooms, rows, and benches in 1-student or 2-student-per-bench modes, supporting Sequential, Alternate, Course/Section Separation, and Custom Staggered strategies while preserving leading zeros and alphanumeric roll numbers verbatim.
- **15-Point Automated Seating Audit**: Verifies exact roll-number immutability, duplicate prevention, capacity sufficiency, disabled benches, and full student coverage before marking a plan `VERIFIED`.
- **AI Multi-Agent Validation System (Gemini `gemini-4-hydrogen` via `/api/ai/*`)**: Data Scanner (Agent 1), Data Validation & Capacity Advisors (Agents 2–3), Seating Audit & PDF Quality Checkers (Agents 4–5), and Orchestrator (Agent 6).
- **CSV / Excel Import & Mapping**: `.csv`, `.xlsx`, and `.xls` parsing with leading-zero preservation, paste-from-Excel TSV parsing, and downloadable templates.
- **Printer-Friendly PDF Generation**:
  - **Format A**: Multi-page Classroom-Wise Seating Plan PDF with institution logo, metadata, audit summary, and coordinator/invigilator signatures.
  - **Format B**: Individual Classroom Print Sheets (one room per page) plus CSV allocation and capacity exports.

## Firebase Setup Notes
Firebase project **`abstract-freehold-6cf5x`** and Cloud Firestore database **`ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb`** are provisioned in `firebase-applet-config.json`, and `firestore.rules` has been deployed.

To enable **Email & Password** sign-in/registration:
1. Open [Firebase Console → Authentication → Sign-in method](https://console.firebase.google.com/project/abstract-freehold-6cf5x/authentication/providers).
2. Click **Email/Password** and toggle **Enable** (leave "Email link (passwordless)" off unless desired), then click **Save**.
3. Google Sign-In is also available immediately.

## Scripts
- `npm run dev` — Starts the Express + Vite full-stack server on port `3000`
- `npm run build` — Builds the production frontend bundle
- `npm run lint` — Runs TypeScript type checking (`tsc --noEmit`)
- `npm test` — Runs the 10-case deterministic seating, audit, and PDF test suite (`vitest run`)
