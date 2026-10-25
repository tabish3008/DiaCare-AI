# DIACARE AI — private glucose history companion
**Not medical advice, not a medical device.** It does not diagnose, predict, or recommend treatment, herbs, supplements, kadha, or yoga routines.

## Run
Static site (Bootstrap + jQuery + GSAP from the Unslate template). PDF reading uses ES modules, so serve the folder:
`python3 -m http.server 8000` then open http://localhost:8000. (Opening index.html directly works for everything except PDF reading.)

## Data & privacy
- The browser keeps a local copy in localStorage (key `diacare.v1`). When signed in, confirmed profile labels/readings can also sync to Supabase. "Delete all data" removes records from the linked Supabase account and this browser when sync is active.
- Uploaded files are read in the browser, never sent anywhere, and not saved after parsing. No camera or analytics.
- The assistant has two modes. **My history** reads only confirmed records in this browser and stays local. **General education** sends only the typed question through the Supabase Edge Function to Gemini with Google Search grounding; it does not attach history or saved patient fields. Do not enter personal health details. Answers include source links and are educational, not diagnosis or treatment advice.
- The app starts without preloaded readings. Existing synthetic demo readings from older versions are removed when the record is loaded; user-entered and imported records are preserved until you choose "Delete all data".
- History charts and reports default to the six months ending today. Use the date fields to select another period. Summaries are descriptive comparisons, not a prediction, diagnosis, or treatment recommendation.
- The Sources & safety section links to NIDDK and NCCIH patient education. Ayurveda and yoga information is general and is not personalized from readings.

## Supabase cloud saving
- `supabase/migrations/20261025_patient_records.sql` defines the patient and reading tables, grants, and per-account row-level security policies. Run it once in the Supabase SQL Editor.
- Add the Supabase **publishable** key from the project's Connect/API Keys screen to `js/supabase-config.js`. The project URL is already filled in there. This public key is intended for browser use; never put a secret/service-role key in this public GitHub Pages site.
- The Dashboard now includes email sign-up/sign-in. After confirmation (if Supabase requests it), sign in and save a pseudonymous patient record. Confirm before uploading any existing browser records. Confirmed readings sync to Supabase; PDF/PNG files and optional notes remain in the browser.
- In Supabase Authentication → URL Configuration, set the Site URL and allowed redirect URL to `https://tabish3008.github.io/DiaCare-AI/` so confirmation links return to the Pages site.
- Supabase Auth sessions are stored by the browser client. Access is governed by the migration's RLS policies. Treat this as a synthetic-data demo only, not a secure clinical records system; do not enter real patient information.

## Google API Direct Search & Education Assistant
DiaCare AI can call the Google Gemini API from the browser using Google Search Grounding. It tries Gemini 3.8 Flash first and falls back to supported model variants when needed.

### Features
- **Direct Answers to Any Question**: Ask general diabetes questions, health guidelines, foods, exercise, yoga, symptoms, or ask about your own saved glucose readings. Answers are grounded in real-time Google Search results with clickable source links.
- **Two Easy Setup Options**:
  1. Open the assistant by clicking **✦ Ask Google AI** in the navbar, hero, or bottom-right launcher. Click **🔑 Key** and paste your API key. It is saved in this browser's `localStorage` (`diacare.google_api_key`).
  2. The key is sent from the browser to Google and is visible to the site and its scripts. For a public deployment, use a server-side API proxy and restrict the key; do not commit a key into this repository.
- **Free Google API Key**: Get a free API key in seconds at [Google AI Studio](https://aistudio.google.com/app/apikey).
- **Patient Record Context**: When asking about your readings or test history, the assistant provides educational context comparing your metrics against clinical standards (ADA / WHO) while maintaining medical safety disclaimers.
- **Offline History Mode**: Switch to "Local History Only" anytime if you want 100% offline rule-based summaries without contacting Google.
- **Optional Supabase Edge Function**: The Supabase function in `supabase/functions/diacare-education/` is preserved for server-side deployments if needed.

## Upload limits
- PDF/PNG only, max 10 MB, first 30 PDF pages. Text PDFs: extracted locally with PDF.js (`js/vendor/pdfjs`); the text and proposed values are shown for review before saving.
- Scanned/image-only PDFs and PNGs: **no OCR engine is bundled**, so automatic text recognition is unavailable for these files. Add values manually in the review screen.
- Extraction is heuristic. Every row is reviewed by you before saving; uncertain rows are marked "Needs review". Lines with a value but no unit are skipped, not guessed.

## Files
`index.html` page · `css/custom.css` theme · `js/gt-core.js` storage, units, validation, parsing · `js/gt-ui.js` upload/review, six-month summaries, charts, history, report · `js/motion.js` template animations · `images/` medical background and template dividers.

## Needs clinician review before any real use
Reference ranges, the 70 mg/dL low flag, unit conversions, validation limits, wording of the Ayurveda/yoga sections, and the report text.
