# รายงานอุบัติเหตุอุตสาหกรรมโลก

A production-ready single-page dashboard for tracking major global industrial accident events (explosions, fires, chemical leaks). Built for safety engineering teams. UI is fully in Thai language.

---

## Features

- **Interactive world map** (Leaflet.js + OpenStreetMap) with color-coded markers by severity
- **Monthly summary table** (Jan–Dec) with the current month highlighted
- **Accident event cards** sorted newest-first, color-coded by fatalities/injuries
- **AI summary** powered by Gemini 2.5 Flash — generates a Thai-language professional safety report on demand
- **Buddhist era (พ.ศ.)** dates throughout
- Fully responsive — desktop and mobile

## Marker colors

| Color | Meaning |
|-------|---------|
| 🔴 Red | Fatalities reported |
| 🟠 Orange | Injuries only |
| 🔵 Blue | No casualties |

---

## Project structure

```
├── index.html          # Single-page frontend (map, table, cards, AI summary)
├── api/
│   └── summarize.js    # Vercel serverless function — Gemini 2.5 Flash proxy
├── data/
│   └── accidents.json  # Accident data store (add new events here)
└── vercel.json         # Vercel routing config
```

---

## Deploy to Vercel (free)

1. Fork or clone this repository to your GitHub account
2. Go to [vercel.com](https://vercel.com) and sign up for free
3. Click **"Add New Project"** → import this repository from GitHub
4. In **Project Settings → Environment Variables**, add:

   | Variable | Value |
   |----------|-------|
   | `GEMINI_API_KEY` | Your Gemini API key from [aistudio.google.com](https://aistudio.google.com) |
   | `ALLOWED_ORIGIN` | `https://your-project.vercel.app` (your Vercel URL, restricts CORS) |

5. Click **Deploy** — the site is live at `https://your-project.vercel.app`

---

## Adding new accident events

Edit `data/accidents.json` and add a new object to the array:

```json
{
  "id": 13,
  "date": "2026-06-01",
  "location": "ชื่อสถานที่, ประเทศ",
  "country": "Country",
  "lat": 0.0000,
  "lng": 0.0000,
  "event": "คำอธิบายเหตุการณ์เป็นภาษาไทย",
  "fatalities": 0,
  "injuries": 0,
  "reference": "https://source-url.com"
}
```

Commit and push — Vercel redeploys automatically.

---

## Local development

No build step required. Serve the project root with any static file server:

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js npx
npx serve .
```

> **Note:** The AI summary button calls `/api/summarize` which only works on Vercel (serverless function). It will 404 locally unless you run `vercel dev` with the Vercel CLI.

To test the serverless function locally:

```bash
npm i -g vercel
vercel dev
```

---

## Data coverage

Pre-loaded with 12 real industrial accident events from January–May 2026:

| Month | Events |
|-------|--------|
| January 2026 | 5 events (Thailand, China, Greece, Turkey, USA) |
| February 2026 | 4 events (Iraq, India, South Africa, Vietnam) |
| April 2026 | 2 events (Russia, India) |
| May 2026 | 1 event (Kazakhstan) |

---

## Tech stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla HTML/CSS/JavaScript |
| Map | [Leaflet.js](https://leafletjs.com) 1.9.4 + OpenStreetMap |
| Font | [Sarabun](https://fonts.google.com/specimen/Sarabun) (Google Fonts) |
| AI | Gemini 2.5 Flash (Google AI Studio) |
| Hosting | Vercel (serverless functions + static) |

No npm install, no build step, no framework dependencies.
