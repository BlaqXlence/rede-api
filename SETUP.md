# REDE — Complete Setup Guide

## Architecture
```
iPhone / Android / Browser
        ↓
   Netlify (frontend)
        ↓
  Railway (backend API)
        ↓
  Supabase (PostgreSQL database)
```

---

## Step 1 — Set up the Database (Supabase — FREE)

1. Go to https://supabase.com and sign up (free)
2. Click **"New Project"**
   - Name: `rede`
   - Password: make a strong one (save it!)
   - Region: pick the closest to Uganda
3. Wait ~2 minutes for it to set up
4. Go to **SQL Editor** (left sidebar)
5. Copy the entire contents of `rede-api/src/db/schema.sql`
6. Paste it in the SQL editor and click **Run**
7. Go to **Settings → Database** and copy the **Connection string (URI)**
   - It looks like: `postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres`
   - Save this — it's your `DATABASE_URL`

---

## Step 2 — Deploy the Backend (Railway — FREE)

1. Go to https://railway.app and sign up with GitHub
2. Click **"New Project" → "Deploy from GitHub repo"**
   - Push the `rede-api` folder to a GitHub repo first:
     ```bash
     cd rede-api
     git init
     git add .
     git commit -m "REDE API"
     # Create a repo on github.com called rede-api, then:
     git remote add origin https://github.com/YOUR_USERNAME/rede-api.git
     git push -u origin main
     ```
3. In Railway, select your `rede-api` repo
4. Go to **Variables** tab and add these:
   ```
   DATABASE_URL    = (paste your Supabase connection string)
   JWT_SECRET      = (any long random string, e.g. rede_secret_uganda_2025_xyz)
   NODE_ENV        = production
   FRONTEND_URL    = https://your-app.netlify.app
   PORT            = 4000
   ```
5. Railway will auto-deploy. Copy your Railway URL (e.g. `https://rede-api.railway.app`)

---

## Step 3 — Deploy the Frontend (Netlify — FREE)

1. Push the `rede-app` (meetug) folder to GitHub:
   ```bash
   cd meetug
   git init
   git add .
   git commit -m "REDE App"
   # Create repo called rede-app on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/rede-app.git
   git push -u origin main
   ```

2. Go to https://netlify.com and sign up
3. Click **"Add new site" → "Import from Git"**
4. Select your `rede-app` repo
5. Build settings (auto-detected from netlify.toml):
   - Build command: `npx expo export --platform web`
   - Publish directory: `dist`
6. Go to **Site settings → Environment variables** and add:
   ```
   EXPO_PUBLIC_API_URL = https://your-rede-api.railway.app/api/v1
   ```
7. Trigger a new deploy. Your app will be live at `https://random-name.netlify.app`
8. (Optional) Go to **Domain settings** to set a custom domain like `rede.ug`

---

## Step 4 — Update CORS on Backend

Once you have your Netlify URL, update Railway:
```
FRONTEND_URL = https://your-actual-name.netlify.app
```

---

## Local Development

**Run backend:**
```bash
cd rede-api
cp .env.example .env
# Fill in DATABASE_URL and JWT_SECRET in .env
npm install
npm run dev
```

**Run frontend:**
```bash
cd meetug
cp .env.example .env.local
# Set EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1
npm install
npm start
```

The frontend falls back to mock data if the backend is not running.

---

## Adding Real SMS (Africa's Talking)

1. Sign up at https://africastalking.com
2. Get your API key
3. Add to Railway variables:
   ```
   AT_API_KEY   = your_key
   AT_USERNAME  = your_username
   AT_SENDER_ID = REDE
   ```
4. Install the package:
   ```bash
   cd rede-api
   npm install africastalking
   ```
5. The code in `routes/auth.js` already handles it — it auto-switches when `AT_API_KEY` is present.

---

## Adding Payments (Pesapal)

When ready, set `PAYMENT.enabled = true` in `src/constants/config.js` and follow the Pesapal integration docs at https://developer.pesapal.com
