# DIACARE AI — private glucose history companion
**Not medical advice, not a medical device.** It does not diagnose, predict, or recommend treatment, herbs, supplements, kadha, or yoga routines.

## Run
Static site (Bootstrap + jQuery + GSAP from the Unslate template). PDF reading uses ES modules, so serve the folder:
`python3 -m http.server 8000` then open http://localhost:8000. (Opening index.html directly works for everything except PDF reading.)

## Data & privacy
- Everything is stored in your browser's localStorage (key `diacare.v1`). "Delete all data" removes it.
- Uploaded files are read in the browser, never sent anywhere, and not saved after parsing. No camera, analytics, or external requests.
- The patient-history assistant reads only confirmed records from this browser. Its chat messages are not saved and no health data is sent to an AI service. It provides descriptive summaries only, not diagnosis or treatment advice.
- All demo data is synthetic. Use pseudonyms.

## Upload limits
- PDF/PNG only, max 10 MB, first 30 PDF pages. Text PDFs: parsed locally with PDF.js (`js/vendor/pdfjs`).
- Scanned PDFs and PNGs: **no OCR engine is bundled.** To add one, place Tesseract.js (worker, wasm core, eng.traineddata) under `js/vendor/tesseract/` and call it from `pdfText()` in `js/gt-ui.js`. Until then, add rows by hand on the review screen.
- Extraction is heuristic. Every row is reviewed by you before saving; uncertain rows are marked "Needs review". Lines with a value but no unit are skipped, not guessed.

## Files
`index.html` page · `css/custom.css` theme · `js/gt-core.js` storage, units, validation, parsing · `js/gt-ui.js` upload/review, charts, history, report · `js/motion.js` template animations · `images/` template dividers (hero art is inline SVG; replace as needed).

## Needs clinician review before any real use
Reference ranges, the 70 mg/dL low flag, unit conversions, validation limits, wording of the Ayurveda/yoga sections, and the report text.
