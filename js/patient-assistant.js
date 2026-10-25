/* DIACARE AI patient-history companion. Browser-local rules; no model or network calls. */
(function () {
  'use strict';

  var G = window.GT;
  if (!G) return;

  var launcher = document.createElement('button');
  launcher.className = 'dc-assistant-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open patient history assistant');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'dc-assistant-panel');
  launcher.innerHTML = '<span class="dc-assistant-launcher__icon" aria-hidden="true">✦</span><span>Patient assistant</span>';

  var panel = document.createElement('section');
  panel.className = 'dc-assistant-panel';
  panel.id = 'dc-assistant-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'dc-assistant-title');
  panel.hidden = true;
  panel.innerHTML = [
    '<header class="dc-assistant-header">',
      '<div class="dc-assistant-avatar" aria-hidden="true">D</div>',
      '<div class="dc-assistant-heading"><h2 id="dc-assistant-title">DIACARE AI</h2><p>Patient history assistant</p></div>',
      '<button class="dc-assistant-clear" type="button">Clear</button>',
      '<button class="dc-assistant-close" type="button" aria-label="Close assistant">×</button>',
    '</header>',
    '<p class="dc-assistant-safety">Uses confirmed records saved in this browser. Educational only—not a diagnosis or treatment plan.</p>',
    '<div class="dc-assistant-messages" id="dc-assistant-messages" aria-live="polite" aria-relevant="additions"></div>',
    '<div class="dc-assistant-suggestions" aria-label="Suggested questions"></div>',
    '<form class="dc-assistant-form" id="dc-assistant-form">',
      '<label class="sr-only" for="dc-assistant-input">Ask about the patient record</label>',
      '<input id="dc-assistant-input" maxlength="240" autocomplete="off" placeholder="Ask about this record…" required>',
      '<button type="submit" aria-label="Send question">↑</button>',
    '</form>',
    '<div class="dc-assistant-entry-actions" hidden></div>',
    '<p class="dc-assistant-privacy">Messages stay on this page and are cleared when you close or refresh it.</p>'
  ].join('');

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var log = panel.querySelector('#dc-assistant-messages');
  var input = panel.querySelector('#dc-assistant-input');
  var suggestionBox = panel.querySelector('.dc-assistant-suggestions');
  var entryActions = panel.querySelector('.dc-assistant-entry-actions');
  var entryDraft = null;
  var examples = [
    'Summarize my history',
    'What are my latest readings?',
    'How many readings are saved?',
    'Show my patient notes',
    'Add a glucose reading'
  ];

  function freshRecord() {
    var saved = G.store.load();
    var readings = Array.isArray(saved.readings) ? saved.readings.filter(function (r) {
      return r && r.status === 'reviewed' && Number.isFinite(Number(r.value));
    }) : [];
    return { patient: saved.patient || null, readings: readings };
  }

  function addMessage(text, role) {
    var item = document.createElement('div');
    item.className = 'dc-assistant-message dc-assistant-message--' + role;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  function byTest(readings, test) {
    return readings.filter(function (r) { return r.test === test && G.toCommon(r) !== null; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  function readingLabel(r) {
    var kind = r.test === 'hba1c' ? 'HbA1c' : 'Glucose';
    var fasting = r.fasting === 'yes' ? ' · fasting' : r.fasting === 'no' ? ' · non-fasting' : '';
    var source = r.origin === 'demo' ? ' · synthetic demo' : '';
    return r.date + ': ' + kind + ' ' + r.value + ' ' + r.unit + fasting + source;
  }

  function clearEntryDraft() {
    entryDraft = null;
    entryActions.textContent = '';
    entryActions.hidden = true;
  }

  function showEntryReview(draft) {
    clearEntryDraft();
    entryDraft = draft;
    addMessage('Please check this entry before it is added: ' + readingLabel(draft) + (draft.fasting === 'unknown' ? '' : (draft.fasting === 'yes' ? ' · fasting' : ' · non-fasting')) + '. Confirm to save it to the patient history and charts.', 'assistant');
    entryActions.hidden = false;
    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'dc-assistant-confirm';
    confirm.textContent = 'Confirm and add reading';
    confirm.addEventListener('click', function () {
      if (!entryDraft) return;
      var toSave = Object.assign({}, entryDraft, { source: 'patient assistant entry', origin: 'user-entered', status: 'reviewed' });
      var error = G.validate(toSave);
      if (error) {
        addMessage('I could not save that entry: ' + error + ' Please start again with “Add a glucose reading.”', 'assistant');
        clearEntryDraft();
        return;
      }
      var data = G.store.load();
      var result = G.addUnique(data, [toSave]);
      if (!result.added) {
        addMessage('That same reading is already in the patient history, so I did not add a duplicate.', 'assistant');
        clearEntryDraft();
        return;
      }
      if (!G.store.save(data)) {
        addMessage('The browser could not save this reading. Check browser storage and try again.', 'assistant');
        clearEntryDraft();
        return;
      }
      addMessage('Reading added to this browser’s patient history. The charts and report will include it when refreshed.', 'assistant');
      clearEntryDraft();
      document.dispatchEvent(new CustomEvent('diacare:record-updated'));
    });
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dc-assistant-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      clearEntryDraft();
      addMessage('Entry cancelled; nothing was saved.', 'assistant');
    });
    entryActions.append(confirm, cancel);
  }

  function continueEntry(question) {
    var q = question.toLowerCase();
    if (!entryDraft.test) {
      if (/a1c|hba1c/.test(q)) entryDraft.test = 'hba1c';
      else if (/glucose|sugar/.test(q)) entryDraft.test = 'glucose';
      else return 'Which test should I add: glucose or HbA1c?';
    }
    var dateMatch = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) entryDraft.date = dateMatch[1];
    if (/non[- ]?fasting|after (a )?meal|\brbs\b|\bppbs\b/.test(q)) entryDraft.fasting = 'no';
    else if (/\bfasting\b|\bfbs\b/.test(q)) entryDraft.fasting = 'yes';
    else if (/\bunknown\b|\bskip\b|not sure/.test(q)) entryDraft.fasting = 'unknown';

    var clean = question.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    var valueMatch = clean.match(/\b(\d+(?:\.\d+)?)\s*(mg\s*\/\s*dl|mmol\s*\/\s*l|mmol\s*\/\s*mol|%)?/i);
    var unitMap = { 'mg/dl': 'mg/dL', 'mmol/l': 'mmol/L', '%': '%', 'mmol/mol': 'mmol/mol' };
    if (valueMatch) {
      entryDraft.value = valueMatch[1];
      var unitText = valueMatch[2] ? valueMatch[2].toLowerCase().replace(/\s/g, '') : '';
      if (unitText) entryDraft.unit = unitMap[unitText] || '';
    }
    if (!entryDraft.value) return 'What number is shown on the report? Include the unit if you know it, for example “126 mg/dL.”';
    if (!entryDraft.unit) return 'What unit is printed beside ' + entryDraft.value + '? For glucose use mg/dL or mmol/L; for HbA1c use % or mmol/mol.';
    if (!entryDraft.date) return 'What date was this test taken? Please use YYYY-MM-DD, for example 2026-10-24.';
    if (!entryDraft.fasting) return 'Was this fasting, non-fasting, or unknown?';
    var draft = { date: entryDraft.date, test: entryDraft.test, value: entryDraft.value, unit: entryDraft.unit, fasting: entryDraft.fasting };
    var error = G.validate(draft);
    if (error) {
      clearEntryDraft();
      return 'I can’t prepare that entry: ' + error + ' Please start again with “Add a glucose reading” or “Add an HbA1c reading.”';
    }
    showEntryReview(draft);
    return null;
  }

  function beginEntry(question) {
    var askedA1c = /a1c|hba1c|haemoglobin|hemoglobin/.test(question);
    var askedGlucose = /glucose|sugar|blood.?sugar/.test(question);
    if (askedA1c && askedGlucose) return 'I see both glucose and HbA1c mentioned. Which single test should I add? Say “Add glucose” or “Add HbA1c.”';
    entryDraft = { stage: 'collecting', test: askedA1c ? 'hba1c' : askedGlucose ? 'glucose' : null, fasting: null };
    return continueEntry(question);
  }

  function summarize(record) {
    var glucose = byTest(record.readings, 'glucose');
    var a1c = byTest(record.readings, 'hba1c');
    if (!record.readings.length) return 'There are no confirmed readings saved in this browser yet. Add a reading, or upload a report and confirm the extracted values first.';

    var parts = [];
    parts.push('Saved record: ' + (record.patient && record.patient.name ? record.patient.name : 'no patient name set') + '.');
    parts.push(record.readings.length + ' confirmed reading(s): ' + glucose.length + ' glucose and ' + a1c.length + ' HbA1c.');
    var dates = record.readings.map(function (r) { return r.date; }).filter(Boolean).sort();
    if (dates.length) parts.push('Recorded dates run from ' + dates[0] + ' to ' + dates[dates.length - 1] + '.');
    var unknown = record.readings.length - glucose.length - a1c.length;
    if (unknown > 0) parts.push(unknown + ' reading(s) have a unit or type that cannot be charted.');
    if (glucose.length) parts.push('Latest glucose: ' + readingLabel(glucose[glucose.length - 1]) + '.');
    if (a1c.length) parts.push('Latest HbA1c: ' + readingLabel(a1c[a1c.length - 1]) + '.');
    parts.push('This is a record summary, not a diagnosis or prediction.');
    return parts.join(' ');
  }

  function answer(question) {
    var q = question.toLowerCase();
    var record = freshRecord();
    var glucose = byTest(record.readings, 'glucose');
    var a1c = byTest(record.readings, 'hba1c');
    var askedA1c = /a1c|hba1c|haemoglobin|hemoglobin/.test(q);
    var askedGlucose = /glucose|sugar|blood.?sugar/.test(q);
    var selected = askedA1c ? a1c : askedGlucose ? glucose : [];

    if (entryDraft && entryDraft.stage === 'collecting') return continueEntry(question);
    if (/\b(add|enter|record|save|log)\b/.test(q) && /\b(glucose|sugar|blood.?sugar|a1c|hba1c)\b/.test(q)) return beginEntry(q);

    if (/^(\s*)(hi|hello|hey|namaste)\b/.test(q) || /what can you do|help/.test(q)) {
      return 'I can summarize confirmed readings saved in this browser, show recent values, compare the earliest and latest values, and repeat the patient notes. I cannot diagnose or recommend medicines, supplements, kadha, or exercise plans.';
    }
    if (/note|medication list|patient detail|profile|record details|name/.test(q) && !askedGlucose && !askedA1c) {
      var p = record.patient;
      if (!p) return 'No patient record is saved in this browser yet.';
      var details = ['Patient label: ' + (p.name || 'not set') + '.'];
      if (p.from || p.to) details.push('Record period entered: ' + (p.from || 'not set') + ' to ' + (p.to || 'not set') + '.');
      if (p.notes) details.push('Saved notes: ' + p.notes);
      else details.push('There are no optional patient notes saved.');
      return details.join(' ');
    }
    if (/\b(what is|explain|tell me about)\b/.test(q) && /ayurved|yoga/.test(q)) {
      if (/yoga/.test(q)) return 'Yoga is a form of physical activity. What is safe depends on a person’s health, fitness, complications, and medicines; DIACARE AI does not prescribe poses or a schedule based on glucose. Discuss a suitable activity plan with the care team. See the Movement & yoga section below.';
      return 'Ayurveda is a traditional system of medicine. Evidence for Ayurvedic treatments for diabetes is limited, and some products may contain harmful contaminants or interact with medicines. DIACARE AI can’t recommend a product or dose. See the Ayurveda section below and discuss any product with a clinician or pharmacist.';
    }
    if (/medicine|medication|drug|dose|treatment|cure|diagnos|prescrib|supplement|kadha|ayurved|yoga|should i take/.test(q)) {
      return 'I can’t diagnose or recommend a medicine, supplement, kadha, dose, or yoga routine. Please discuss treatment and activity choices with the patient’s healthcare professional. I can summarize the saved record or show its notes.';
    }
    if (/what is|explain|meaning/.test(q) && /a1c|hba1c/.test(q)) return 'HbA1c is a blood test that reflects average blood glucose over roughly the previous 2–3 months. This site shows it separately from single glucose readings. A clinician interprets results in context.';
    if (/privacy|where.*data|store|saved|send|upload/.test(q)) return 'Patient details and confirmed readings are stored in this browser’s local storage. Uploaded files are read locally and discarded after parsing. The assistant uses those saved records in this browser; it does not send health data to an AI service. Avoid real identifiers in this prototype.';
    if (/how many|count|number of|summari[sz]e|overview|history|all readings|patient history/.test(q)) return summarize(record);
    if (/latest|recent|last reading|most recent/.test(q)) {
      if (!askedA1c && !askedGlucose) {
        var latestParts = [];
        if (glucose.length) latestParts.push('Latest glucose: ' + readingLabel(glucose[glucose.length - 1]));
        if (a1c.length) latestParts.push('Latest HbA1c: ' + readingLabel(a1c[a1c.length - 1]));
        return latestParts.length ? latestParts.join('. ') + '. These are record values, not a medical interpretation.' : 'No confirmed, chartable glucose or HbA1c readings are saved.';
      }
      if (!selected.length) return 'No confirmed ' + (askedA1c ? 'HbA1c' : 'glucose') + ' readings are saved.';
      var last = selected[selected.length - 1];
      if (askedA1c || askedGlucose) return 'Latest ' + (askedA1c ? 'HbA1c' : 'glucose') + ': ' + readingLabel(last) + '. Values are shown as recorded; this is not a medical interpretation.';
      return 'Most recent confirmed reading: ' + readingLabel(last) + '.';
    }
    if (/highest|maximum|peak|lowest|minimum/.test(q)) {
      if (!askedA1c && !askedGlucose) return 'Please specify glucose or HbA1c. I keep these test types separate and don’t compare them with each other.';
      if (!selected.length) return 'There are no chartable confirmed readings for that test in this browser.';
      var wantLow = /lowest|minimum/.test(q);
      var valueFn = function (r) { return G.toCommon(r); };
      var extreme = selected.reduce(function (best, r) { return (wantLow ? valueFn(r) < valueFn(best) : valueFn(r) > valueFn(best)) ? r : best; });
      return (wantLow ? 'Lowest' : 'Highest') + ' saved ' + (askedA1c ? 'HbA1c' : 'glucose') + ' value: ' + readingLabel(extreme) + '. This is a descriptive comparison only.';
    }
    if (/average|mean/.test(q)) {
      if (!askedA1c && !askedGlucose) return 'Please specify glucose or HbA1c. I calculate summaries separately for each test type.';
      if (!selected.length) return 'There are no chartable confirmed readings for that test in this browser.';
      var avg = selected.reduce(function (sum, r) { return sum + G.toCommon(r); }, 0) / selected.length;
      return 'The descriptive average of ' + selected.length + ' confirmed ' + (askedA1c ? 'HbA1c' : 'glucose') + ' reading(s) is ' + avg.toFixed(1) + ' ' + G.commonUnit(askedA1c ? 'hba1c' : 'glucose') + '. Individual readings and test conditions matter; this is not a target or diagnosis.';
    }
    if (/trend|change|increas|decreas|going up|going down/.test(q)) {
      if (!askedA1c && !askedGlucose) return 'Please specify glucose or HbA1c so I can compare like with like.';
      if (selected.length < 2) return 'There are not enough confirmed readings for that test to compare over time.';
      var first = selected[0], latest = selected[selected.length - 1];
      var delta = G.toCommon(latest) - G.toCommon(first);
      var unit = G.commonUnit(askedA1c ? 'hba1c' : 'glucose');
      var direction = delta > 0 ? 'higher' : delta < 0 ? 'lower' : 'the same';
      return 'Comparing the earliest and latest confirmed ' + (askedA1c ? 'HbA1c' : 'glucose') + ' values: ' + readingLabel(first) + ' and ' + readingLabel(latest) + '. The latest is ' + direction + ' by ' + Math.abs(delta).toFixed(1) + ' ' + unit + '. This simple comparison does not predict future results or explain why values changed.';
    }
    if (/low|below 70/.test(q)) {
      var lows = glucose.filter(function (r) { return G.toCommon(r) < 70; });
      return lows.length ? 'The saved record has ' + lows.length + ' glucose reading(s) below 70 mg/dL: ' + lows.slice(-5).map(readingLabel).join('; ') + '. This threshold is considered low for many people with diabetes, but personal targets differ. Follow the clinician’s plan or contact the care team; this assistant cannot provide treatment.' : 'No confirmed glucose reading below 70 mg/dL was found in the saved record. This does not establish that readings are safe or replace your care team’s advice.';
    }
    if (/source|upload|import/.test(q)) return 'Only readings confirmed on the review screen are included in this summary. The original uploaded PDF or PNG is not saved by the site; a source filename may be attached to each confirmed reading.';
    return 'I can answer questions about the confirmed patient history saved in this browser. Try “Summarize my history,” “What are my latest glucose readings?”, “Show my patient notes,” or “What is the highest HbA1c?”';
  }

  function showSuggestions() {
    examples.forEach(function (example) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = example;
      button.addEventListener('click', function () { ask(example); });
      suggestionBox.appendChild(button);
    });
  }

  function ask(text) {
    var question = text.trim();
    if (!question) return;
    addMessage(question, 'user');
    input.value = '';
    var response = answer(question);
    if (response) addMessage(response, 'assistant');
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (!log.children.length) {
      addMessage('Ask about confirmed readings and notes saved in this browser. I’ll summarize the record without diagnosing or recommending treatment.', 'assistant');
      showSuggestions();
    }
    input.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    log.textContent = '';
    suggestionBox.textContent = '';
    clearEntryDraft();
    launcher.focus();
  }

  launcher.addEventListener('click', open);
  panel.querySelector('.dc-assistant-close').addEventListener('click', close);
  panel.querySelector('.dc-assistant-clear').addEventListener('click', function () {
    clearEntryDraft();
    log.textContent = '';
    suggestionBox.textContent = '';
    addMessage('Chat cleared. Ask about confirmed readings and notes saved in this browser.', 'assistant');
    showSuggestions();
  });
  panel.querySelector('#dc-assistant-form').addEventListener('submit', function (event) {
    event.preventDefault();
    ask(input.value);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
}());
