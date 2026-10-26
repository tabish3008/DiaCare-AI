/* DIACARE AI - Server-powered Education and Patient Record Assistant */
(function () {
  'use strict';

  var G = window.GT;
  if (!G) return;

  // Helper for HTML escaping
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Safe Markdown renderer for Ask Direct AI responses
  function renderMarkdown(text) {
    if (!text) return '';
    var escaped = esc(text);

    // Headers
    escaped = escaped.replace(/^### (.*$)/gim, '<h4 class="dc-md-h">$1</h4>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h3 class="dc-md-h">$1</h3>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h3 class="dc-md-h">$1</h3>');

    // Bold and Italics
    escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.+?)__/g, '<strong>$1</strong>');
    escaped = escaped.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_([^_\n]+)_/g, '<em>$1</em>');

    // Links: [text](https://...)
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Bullet Lists & Paragraphs
    var lines = escaped.split('\n');
    var inList = false;
    var out = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^[•\-\*]\s+(.*)/.test(line)) {
        if (!inList) {
          out.push('<ul class="dc-md-ul">');
          inList = true;
        }
        out.push('<li>' + line.replace(/^[•\-\*]\s+/, '') + '</li>');
      } else {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
        if (line.length > 0) {
          out.push('<p class="dc-md-p">' + line + '</p>');
        }
      }
    }
    if (inList) out.push('</ul>');

    return out.join('');
  }

  // Create Launcher button
  var launcher = document.createElement('button');
  launcher.className = 'dc-assistant-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open DiaCare Ask Direct AI Assistant');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'dc-assistant-panel');
  launcher.innerHTML = '<span class="dc-assistant-launcher__icon" aria-hidden="true">✦</span><span>Ask Direct AI</span>';

  // Create Assistant Panel
  var panel = document.createElement('section');
  panel.className = 'dc-assistant-panel';
  panel.id = 'dc-assistant-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'dc-assistant-title');
  panel.hidden = true;
  panel.innerHTML = [
    '<header class="dc-assistant-header">',
      '<div class="dc-assistant-avatar" aria-hidden="true">✦</div>',
      '<div class="dc-assistant-heading">',
        '<h2 id="dc-assistant-title">DIACARE AI</h2>',
        '<p id="dc-assistant-status-desc">Server-powered educational answers</p>',
      '</div>',
      '<button class="dc-assistant-clear" type="button" title="Clear conversation">Clear</button>',
      '<button class="dc-assistant-close" type="button" aria-label="Close assistant">×</button>',
    '</header>',
    '<div class="dc-assistant-safety">',
      'Ask general health questions and get educational answers with source links. Not medical advice.',
    '</div>',
    '<div class="dc-assistant-modebar" role="tablist" aria-label="Assistant mode">',
      '<button type="button" role="tab" aria-selected="true" data-mode="direct">✦ Ask Direct AI</button>',
      '<button type="button" role="tab" aria-selected="false" data-mode="history">📋 Local History Only</button>',
    '</div>',
    '<div class="dc-assistant-messages" id="dc-assistant-messages" aria-live="polite" aria-relevant="additions"></div>',
    '<div class="dc-assistant-suggestions" aria-label="Suggested questions"></div>',
    '<form class="dc-assistant-form" id="dc-assistant-form">',
      '<label class="sr-only" for="dc-assistant-input">Ask a general question</label>',
      '<input id="dc-assistant-input" maxlength="400" autocomplete="off" placeholder="Ask a general health question…" required>',
      '<button type="submit" aria-label="Send question">↑</button>',
    '</form>',
    '<div class="dc-assistant-entry-actions" hidden></div>',
    '<p class="dc-assistant-privacy">General questions are sent securely to the server for an educational answer. Do not include personal health details.</p>'
  ].join('');

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var log = panel.querySelector('#dc-assistant-messages');
  var input = panel.querySelector('#dc-assistant-input');
  var suggestionBox = panel.querySelector('.dc-assistant-suggestions');
  var entryActions = panel.querySelector('.dc-assistant-entry-actions');

  var entryDraft = null;
  var mode = 'direct';

  var directExamples = [
    'What is HbA1c and how is it tested?',
    'What are normal fasting glucose levels?',
    'Can yoga help manage blood sugar?',
    'What foods cause blood sugar spikes?'
  ];

  var historyExamples = [
    'Summarize my history',
    'What are my latest readings?',
    'Show my patient notes',
    'What is my highest glucose reading?',
    'Add a glucose reading'
  ];

  function freshRecord() {
    var saved = G.store.load();
    var readings = Array.isArray(saved.readings) ? saved.readings.filter(function (r) {
      return r && r.status === 'reviewed' && Number.isFinite(Number(r.value));
    }) : [];
    return { patient: saved.patient || null, readings: readings };
  }

  function summarizePatientContext(record) {
    if (!record || !record.readings || !record.readings.length) {
      var p = record && record.patient;
      if (p && (p.name || p.notes)) {
        return 'Patient Label: ' + (p.name || 'Anonymous') + (p.notes ? ' | Notes: ' + p.notes : '') + ' | No readings saved yet.';
      }
      return 'No confirmed readings saved in this browser yet.';
    }

    var lines = [];
    if (record.patient && record.patient.name) {
      lines.push('Patient Label: ' + record.patient.name);
    }
    if (record.patient && record.patient.notes) {
      lines.push('Patient Notes: ' + record.patient.notes);
    }

    var glucose = byTest(record.readings, 'glucose');
    var a1c = byTest(record.readings, 'hba1c');
    lines.push('Total confirmed readings: ' + record.readings.length + ' (' + glucose.length + ' Glucose, ' + a1c.length + ' HbA1c)');

    if (glucose.length) {
      var latestG = glucose[glucose.length - 1];
      lines.push('Latest Glucose: ' + readingLabel(latestG));
    }
    if (a1c.length) {
      var latestA = a1c[a1c.length - 1];
      lines.push('Latest HbA1c: ' + readingLabel(latestA));
    }

    // List up to 10 most recent readings
    var recent = record.readings.slice(-10);
    lines.push('Recent readings list:');
    recent.forEach(function (r) {
      lines.push('- ' + readingLabel(r));
    });

    return lines.join('\n');
  }

  function addMessage(content, role, isHtml) {
    var item = document.createElement('div');
    item.className = 'dc-assistant-message dc-assistant-message--' + role;
    if (isHtml) {
      item.innerHTML = content;
    } else {
      item.textContent = content;
    }
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function addSources(messageElement, sources) {
    var clean = (sources || []).filter(function (s) {
      return s && /^https?:\/\//i.test(s.url || '');
    }).slice(0, 5);

    if (!clean.length) return;

    var wrap = document.createElement('div');
    wrap.className = 'dc-assistant-sources';
    wrap.innerHTML = '<strong><span aria-hidden="true">🌐</span> Sources:</strong>';

    var list = document.createElement('ul');
    clean.forEach(function (source) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title || source.url;
      li.appendChild(link);
      list.appendChild(li);
    });

    wrap.appendChild(list);
    messageElement.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function switchMode(next) {
    mode = next === 'history' ? 'history' : 'direct';
    panel.querySelectorAll('.dc-assistant-modebar [data-mode]').forEach(function (button) {
      button.setAttribute('aria-selected', button.dataset.mode === mode ? 'true' : 'false');
    });

    if (mode === 'direct') {
      input.placeholder = 'Ask a general health question…';
      addMessage('Switched to <strong>Ask Direct AI</strong> mode. Ask general educational questions using web search.', 'assistant', true);
    } else {
      input.placeholder = 'Ask about this browser’s saved patient records…';
      addMessage('Switched to <strong>Local History</strong> mode. Answers use only the records saved in this browser without network calls.', 'assistant', true);
    }

    suggestionBox.textContent = '';
    showSuggestions();
  }

  function byTest(readings, test) {
    return readings.filter(function (r) { return r.test === test && G.toCommon(r) !== null; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  function readingLabel(r) {
    var kind = r.test === 'hba1c' ? 'HbA1c' : 'Glucose';
    var fasting = r.fasting === 'yes' ? ' (fasting)' : r.fasting === 'no' ? ' (non-fasting)' : '';
    return r.date + ': ' + kind + ' ' + r.value + ' ' + r.unit + fasting;
  }

  // --- Manual Reading Draft Flow (Add reading by voice/chat) ---
  function clearEntryDraft() {
    entryDraft = null;
    entryActions.textContent = '';
    entryActions.hidden = true;
  }

  function showEntryReview(draft) {
    clearEntryDraft();
    entryDraft = draft;
    addMessage('Please check this reading before saving: ' + readingLabel(draft) + '. Confirm to add it to your patient history.', 'assistant', false);
    entryActions.hidden = false;

    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'dc-assistant-confirm';
    confirm.textContent = 'Confirm and Save Reading';
    confirm.addEventListener('click', function () {
      if (!entryDraft) return;
      var toSave = Object.assign({}, entryDraft, { source: 'patient assistant entry', origin: 'user-entered', status: 'reviewed' });
      var error = G.validate(toSave);
      if (error) {
        addMessage('Could not save reading: ' + error, 'assistant', false);
        clearEntryDraft();
        return;
      }
      var data = G.store.load();
      var result = G.addUnique(data, [toSave]);
      if (!result.added) {
        addMessage('That reading is already in your record, so duplicate was skipped.', 'assistant', false);
        clearEntryDraft();
        return;
      }
      if (!G.store.save(data)) {
        addMessage('Could not write to browser storage. Please try again.', 'assistant', false);
        clearEntryDraft();
        return;
      }
      addMessage('✓ Reading saved! It is now in your patient record and charts.', 'assistant', false);
      clearEntryDraft();
      document.dispatchEvent(new CustomEvent('diacare:record-updated'));
    });

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dc-assistant-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      clearEntryDraft();
      addMessage('Reading cancelled; nothing was saved.', 'assistant', false);
    });

    entryActions.append(confirm, cancel);
  }

  function continueEntry(question) {
    var q = question.toLowerCase();
    if (!entryDraft.test) {
      if (/a1c|hba1c/.test(q)) entryDraft.test = 'hba1c';
      else if (/glucose|sugar/.test(q)) entryDraft.test = 'glucose';
      else return 'Which test should I add: blood glucose or HbA1c?';
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
    if (!entryDraft.value) return 'What number is shown on the test? (e.g. 126 mg/dL or 6.5%)';
    if (!entryDraft.unit) return 'What unit is printed beside ' + entryDraft.value + '? (mg/dL or mmol/L for glucose; % for HbA1c)';
    if (!entryDraft.date) return 'What was the date of this test? (YYYY-MM-DD, e.g. ' + new Date().toISOString().slice(0, 10) + ')';
    if (!entryDraft.fasting && entryDraft.test === 'glucose') return 'Was this fasting, non-fasting, or unknown?';

    var draft = {
      date: entryDraft.date,
      test: entryDraft.test,
      value: entryDraft.value,
      unit: entryDraft.unit,
      fasting: entryDraft.fasting || 'unknown'
    };
    var error = G.validate(draft);
    if (error) {
      clearEntryDraft();
      return 'Could not prepare that entry: ' + error + '. Say "Add a glucose reading" to try again.';
    }
    showEntryReview(draft);
    return null;
  }

  function beginEntry(question) {
    var askedA1c = /a1c|hba1c|haemoglobin|hemoglobin/.test(question);
    var askedGlucose = /glucose|sugar|blood.?sugar/.test(question);
    if (askedA1c && askedGlucose) return 'Which test should I add? Say "Add glucose" or "Add HbA1c."';
    entryDraft = { stage: 'collecting', test: askedA1c ? 'hba1c' : askedGlucose ? 'glucose' : null, fasting: null };
    return continueEntry(question);
  }

  // --- Local Rule Based Answer (Fallback or Offline Mode) ---
  function summarize(record) {
    var glucose = byTest(record.readings, 'glucose');
    var a1c = byTest(record.readings, 'hba1c');
    if (!record.readings.length) return 'There are no confirmed readings saved in this browser yet. You can add one or upload a lab report.';

    var parts = [];
    parts.push('Saved record for: ' + (record.patient && record.patient.name ? record.patient.name : 'Demo Patient') + '.');
    parts.push(record.readings.length + ' confirmed reading(s): ' + glucose.length + ' glucose and ' + a1c.length + ' HbA1c.');
    var dates = record.readings.map(function (r) { return r.date; }).filter(Boolean).sort();
    if (dates.length) parts.push('Dates span from ' + dates[0] + ' to ' + dates[dates.length - 1] + '.');
    if (glucose.length) parts.push('Latest glucose: ' + readingLabel(glucose[glucose.length - 1]) + '.');
    if (a1c.length) parts.push('Latest HbA1c: ' + readingLabel(a1c[a1c.length - 1]) + '.');
    return parts.join(' ');
  }

  function localAnswer(question) {
    var q = question.toLowerCase();
    var record = freshRecord();
    var glucose = byTest(record.readings, 'glucose');
    var a1c = byTest(record.readings, 'hba1c');
    var askedA1c = /a1c|hba1c|haemoglobin|hemoglobin/.test(q);
    var askedGlucose = /glucose|sugar|blood.?sugar/.test(q);
    var selected = askedA1c ? a1c : askedGlucose ? glucose : [];

    if (/^(\s*)(hi|hello|hey|namaste)\b/.test(q) || /what can you do|help/.test(q)) {
      return 'I can help summarize saved readings and add reviewed entries in Local History mode. Ask Direct AI answers general educational questions without needing sign-in.';
    }
    if (/note|medication list|patient detail|profile|record details|name/.test(q) && !askedGlucose && !askedA1c) {
      var p = record.patient;
      if (!p) return 'No patient record details saved yet.';
      var details = ['Patient: ' + (p.name || 'Not set') + '.'];
      if (p.notes) details.push('Notes: ' + p.notes);
      return details.join(' ');
    }
    if (/how many|count|number of|summari[sz]e|overview|history|all readings|patient history/.test(q)) {
      return summarize(record);
    }
    if (/latest|recent|last reading|most recent/.test(q)) {
      if (!askedA1c && !askedGlucose) {
        var latestParts = [];
        if (glucose.length) latestParts.push('Latest glucose: ' + readingLabel(glucose[glucose.length - 1]));
        if (a1c.length) latestParts.push('Latest HbA1c: ' + readingLabel(a1c[a1c.length - 1]));
        return latestParts.length ? latestParts.join('. ') : 'No confirmed readings saved yet.';
      }
      if (!selected.length) return 'No confirmed ' + (askedA1c ? 'HbA1c' : 'glucose') + ' readings saved.';
      return 'Latest ' + (askedA1c ? 'HbA1c' : 'glucose') + ': ' + readingLabel(selected[selected.length - 1]) + '.';
    }
    if (/highest|maximum|peak|lowest|minimum/.test(q)) {
      if (!askedA1c && !askedGlucose) return 'Please specify glucose or HbA1c to find the extreme value.';
      if (!selected.length) return 'No readings saved for that test.';
      var wantLow = /lowest|minimum/.test(q);
      var extreme = selected.reduce(function (best, r) {
        return (wantLow ? G.toCommon(r) < G.toCommon(best) : G.toCommon(r) > G.toCommon(best)) ? r : best;
      });
      return (wantLow ? 'Lowest' : 'Highest') + ' ' + (askedA1c ? 'HbA1c' : 'glucose') + ': ' + readingLabel(extreme) + '.';
    }

    return null;
  }

  function showSuggestions() {
    suggestionBox.textContent = '';
    var list = mode === 'direct' ? directExamples : historyExamples;
    list.forEach(function (example) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = example;
      btn.addEventListener('click', function () {
        ask(example);
      });
      suggestionBox.appendChild(btn);
    });
  }

  // --- Server-side Direct AI request ---
  async function executeDirectAsk(question) {
    var loadingItem = document.createElement('div');
    loadingItem.className = 'dc-assistant-message dc-assistant-message--assistant dc-assistant-loading';
    loadingItem.innerHTML = [
      '<span class="dc-assistant-loading-text">Preparing your answer</span>',
      '<span class="dc-assistant-loading-dots"><span></span><span></span><span></span></span>'
    ].join(' ');
    log.appendChild(loadingItem);
    log.scrollTop = log.scrollHeight;

    try {
      var service = window.DiaCareCloud;
      if (!service || typeof service.askEducation !== 'function') {
        throw new Error('Ask Direct AI is not configured yet.');
      }
      var result = await service.askEducation(question);
      loadingItem.remove();
      var reply = addMessage(renderMarkdown(result.answer), 'assistant', true);
      if (result.sources && result.sources.length) addSources(reply, result.sources);
    } catch (err) {
      loadingItem.remove();
      addMessage(esc(err.message || 'Ask Direct AI could not answer right now. Please try again.'), 'assistant', false);
    }
  }

  async function ask(text) {
    var question = text.trim();
    if (!question) return;

    // Display user question bubble
    addMessage(question, 'user', false);
    input.value = '';

    // Check conversational "Add reading" draft flow
    if (entryDraft && entryDraft.stage === 'collecting') {
      var nextPrompt = continueEntry(question);
      if (nextPrompt) addMessage(nextPrompt, 'assistant', false);
      return;
    }

    var qLower = question.toLowerCase();
    if (/\b(add|enter|record|save|log)\b/.test(qLower) && /\b(glucose|sugar|blood.?sugar|a1c|hba1c)\b/.test(qLower)) {
      var startPrompt = beginEntry(qLower);
      if (startPrompt) addMessage(startPrompt, 'assistant', false);
      return;
    }

    // If History Mode is selected
    if (mode === 'history') {
      var local = localAnswer(question);
      if (local) {
        addMessage(local, 'assistant', false);
      } else {
        addMessage('In Local History mode, I can summarize your saved records, show latest or extreme values, or add readings. Switch to "Ask Direct AI" mode above to ask any general or medical question.', 'assistant', false);
      }
      return;
    }

    // Direct AI mode uses only the server-side education function.
    executeDirectAsk(question);
  }

  // --- Drawer Open & Close ---
  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');

    if (!log.children.length) {
      addMessage('Welcome to <strong>Ask Direct AI</strong>. Ask general educational questions without signing in. Do not include personal health details.', 'assistant', true);
      showSuggestions();
    }
    input.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  // --- Event Listeners ---
  launcher.addEventListener('click', open);
  panel.querySelector('.dc-assistant-close').addEventListener('click', close);

  // External open triggers (e.g. from nav or hero button)
  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest && e.target.closest('.js-open-assistant');
    if (target) {
      e.preventDefault();
      open();
    }
  });

  // Mode Switch
  panel.querySelectorAll('.dc-assistant-modebar [data-mode]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.dataset.mode !== mode) {
        switchMode(button.dataset.mode);
      }
    });
  });

  // Clear Chat
  panel.querySelector('.dc-assistant-clear').addEventListener('click', function () {
    clearEntryDraft();
    log.textContent = '';
    suggestionBox.textContent = '';
    addMessage('Chat cleared. Ask a general question below.', 'assistant', false);
    showSuggestions();
  });

  // Chat Form Submit
  panel.querySelector('#dc-assistant-form').addEventListener('submit', function (event) {
    event.preventDefault();
    ask(input.value);
  });

  // Escape key closes panel
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

}());
