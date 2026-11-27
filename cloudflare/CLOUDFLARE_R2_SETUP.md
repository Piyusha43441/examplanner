# Cloudflare R2 + Worker Setup Guide (Exam Planner)

Exam Planner uses a **private Cloudflare R2 bucket** paired with a **Cloudflare Worker** (`cloudflare/r2-worker/`) to store and preview ₹1 UPI payment proof screenshots and PDFs securely while keeping Firebase Authentication and Firestore unchanged.

---

## 1. Create a Private Cloudflare R2 Bucket
1. Log in to **Cloudflare Dashboard** → **R2 Object Storage** → **Create bucket**.
2. Bucket name: `exam-planner-payment-proofs` (or update `R2_BUCKET_NAME` in `wrangler.toml`).
3. Leave **Public access / Custom Domains / R2.dev subdomain disabled**. The bucket must remain **100% private**.

### Configure R2 Bucket CORS Policy (Required for Direct Browser Uploads)
In **R2 Bucket → Settings → CORS Policy**, add:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://ais-dev-aewbzri6lknsxvnf6a3cii-697000586977.asia-east1.run.app",
      "https://ais-pre-aewbzri6lknsxvnf6a3cii-697000586977.asia-east1.run.app",
      "https://YOUR-NETLIFY-SITE.netlify.app"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
Replace `YOUR-NETLIFY-SITE.netlify.app` with your actual Netlify or custom production domain.

---

## 2. Create Minimum-Privilege R2 API Credentials
1. Go to **Cloudflare Dashboard → R2 Object Storage → Manage R2 API Tokens → Create API token**.
2. Permissions: **Object Read & Write** scoped **only** to the `exam-planner-payment-proofs` bucket.
3. Copy:
   - **Account ID** (`R2_ACCOUNT_ID`)
   - **Access Key ID** (`R2_ACCESS_KEY_ID`)
   - **Secret Access Key** (`R2_SECRET_ACCESS_KEY`)

> **Never** place `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` into `VITE_*` variables or frontend code.

---

## 3. Configure and Deploy the Cloudflare Worker
From `cloudflare/r2-worker/`:

```bash
cd cloudflare/r2-worker
npm install
npx wrangler login
```

Verify `cloudflare/r2-worker/wrangler.toml`:
- `FIREBASE_PROJECT_ID = "abstract-freehold-6cf5x"`
- `FIREBASE_FIRESTORE_DATABASE_ID = "ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb"`
- `R2_BUCKET_NAME = "exam-planner-payment-proofs"`
- `ADMIN_EMAIL = "agarwalpiyush263@gmail.com"`
- `ALLOWED_ORIGINS` includes your AI Studio URLs, `http://localhost:3000`, and your production Netlify URL.

Set the private Worker secrets:
```bash
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Deploy the Worker:
```bash
npm run deploy
```

Note the deployed Worker URL, e.g.:
`https://exam-planner-r2-worker.<your-subdomain>.workers.dev`

Verify Worker health:
```bash
curl https://exam-planner-r2-worker.<your-subdomain>.workers.dev/api/health
```
Confirm `"ok": true`, `"storageProvider": "cloudflare-r2"`, and `"r2Configured": true`.

---

## 4. Connect Exam Planner Frontend to the Worker
Set the **public** Worker URL in your frontend environment:
- **Netlify:** Site configuration → Environment variables → `VITE_R2_WORKER_URL=https://exam-planner-r2-worker.<your-subdomain>.workers.dev`, then trigger a fresh deploy.
- **Local / AI Studio Server fallback (optional):** If not using the external Worker during local dev, you may set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` in server-side `.env` (never `VITE_*`).

---

## 5. End-to-End Verification Checklist
1. Open `/diagnostics` in Exam Planner and confirm **Private Payment Proof Storage (Cloudflare R2)** reports `PASS`.
2. Sign in as an institution coordinator, go to `/subscribe`, and upload:
   - a JPG screenshot (< 5 MB)
   - a PNG screenshot (< 5 MB)
   - a PDF receipt (< 5 MB)
3. Verify invalid formats and files `> 5 MB` are rejected before upload and server-side.
4. Confirm objects exist inside the private `exam-planner-payment-proofs` bucket under `payment_proofs/<institutionId>/<uid>/` and records appear as `pending` in Firestore `payment_requests`.
5. Sign in as `agarwalpiyush263@gmail.com` (verified email + `admin: true` claim), open **Admin Panel**, preview each JPG/PNG/PDF securely via the short-lived signed R2 URL, and approve/reject.
