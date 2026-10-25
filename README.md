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

## Ask Direct AI
The assistant sends general education questions to the Supabase Edge Function. The Gemini API key is stored as the server-side `GEMINI_API_KEY` secret and is never included in the website files or sent to the browser. Users must sign in from the Dashboard before using Ask Direct AI. The server accepts general educational questions only; do not send personal health details.

Configure and deploy the function once for this Supabase project:

```sh
supabase secrets set GEMINI_API_KEY=your-gemini-api-key
supabase functions deploy diacare-education
```

Set the secret in Supabase project settings instead if you do not use the CLI. Never add the key to a frontend file or commit it to GitHub. The site has no API-key entry field.

## Upload limits
- PDF/PNG only, max 10 MB, first 30 PDF pages. Text PDFs: extracted locally with PDF.js (`js/vendor/pdfjs`); the text and proposed values are shown for review before saving.
- Scanned/image-only PDFs and PNGs: **no OCR engine is bundled**, so automatic text recognition is unavailable for these files. Add values manually in the review screen.
- Extraction is heuristic. Every row is reviewed by you before saving; uncertain rows are marked "Needs review". Lines with a value but no unit are skipped, not guessed.

## Files
`index.html` page · `css/custom.css` theme · `js/gt-core.js` storage, units, validation, parsing · `js/gt-ui.js` upload/review, six-month summaries, charts, history, report · `js/motion.js` template animations · `images/` medical background and template dividers.

## Needs clinician review before any real use
Reference ranges, the 70 mg/dL low flag, unit conversions, validation limits, wording of the Ayurveda/yoga sections, and the report text.
