# EXAM PLANNER — Smart Examination Seating & Management System

**Tagline:** Smart Examination Seating. Zero Manual Allocation.

Official production hosting target: **Netlify** + **Cloudflare R2 & Worker** + **Firebase**

---

## Production Architecture
- **Frontend:** React 19 + TypeScript + Vite SPA + Tailwind CSS
- **Hosting:** Netlify (Static publish directory: `dist`) + Netlify Serverless Functions (`netlify/functions/`)
- **Authentication:** Firebase Email & Password Authentication
- **Database:** Firebase Cloud Firestore (Tenant-isolated per institution)
- **Payment Proof File Storage:** Private **Cloudflare R2** bucket (`exam-planner-payment-proofs`) accessed strictly via short-lived S3 presigned URLs issued by the **Cloudflare Worker** (`cloudflare/r2-worker/`)
- **AI Engine:** Google Gemini (`gemini-2.5-flash`) executed exclusively server-side

---

## Netlify Production Build & Deploy Configuration
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`
- **Node version:** 20+ or 22+

### Required Environment Variables in Netlify
Configure these in **Netlify Dashboard > Site configuration > Environment variables**:

| Variable Name | Required | Scope | Description |
| :--- | :---: | :--- | :--- |
| `VITE_FIREBASE_API_KEY` | **Yes** | All scopes | Firebase project Web API Key |
| `VITE_FIREBASE_PROJECT_ID` | **Yes** | All scopes | Firebase project identifier |
| `VITE_FIREBASE_AUTH_DOMAIN` | Recommended | All scopes | `<project-id>.firebaseapp.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Optional | All scopes | Firebase sender ID |
| `VITE_FIREBASE_APP_ID` | Optional | All scopes | Firebase Web App ID |
| `VITE_R2_WORKER_URL` | **Yes** | All scopes | Deployed Cloudflare Worker URL (`https://exam-planner-r2-worker.<subdomain>.workers.dev`) |
| `GEMINI_API_KEY` | Optional | Functions only | Google Gemini API key (Server-side only) |

> **Important:** Never put Cloudflare R2 secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) in `VITE_*` variables. Store them exclusively as Cloudflare Worker secrets (`npx wrangler secret put ...`). Anytime you update `VITE_*` variables in Netlify, trigger a new deploy (**Deploys > Trigger deploy > Deploy site**).

---

## Cloudflare R2 Setup
See [`cloudflare/CLOUDFLARE_R2_SETUP.md`](./cloudflare/CLOUDFLARE_R2_SETUP.md) for the complete step-by-step guide to creating the private R2 bucket, configuring bucket CORS, setting Worker secrets, and deploying `cloudflare/r2-worker/`.

---

## Firebase Production Setup Checklist
1. **Authentication:**
   - Open Firebase Console > Authentication > Sign-in method.
   - Enable **Email/Password**.
   - Under Settings > **Authorized domains**, add your Netlify domain (e.g. `your-app-name.netlify.app`).
2. **Cloud Firestore:**
   - Ensure Firestore is created and publish the security rules from `firestore.rules`.

---

## Live System Diagnostics
Navigate to `/diagnostics` on your deployed site to verify:
- Frontend application shell
- Firebase environment variable presence, Auth connectivity, and Firestore roundtrip ping
- Cloudflare R2 Worker & private bucket readiness (`/api/health`)
- Netlify Functions `/api/health` and `/api/server-time`
- Gemini AI configuration status

---

## Local Development & Testing Scripts
- `npm run dev` — Starts local development server on port 3000
- `npm run build` — Builds the production Vite bundle to `dist/`
- `npm run lint` — Runs TypeScript type check (`tsc --noEmit`)
- `npm test` — Runs automated test suite (`vitest run`)
