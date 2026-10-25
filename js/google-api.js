/* DiaCare AI - Direct Google Gemini API with Google Search Grounding */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'diacare.google_api_key';
  var MODEL_STORAGE_KEY = 'diacare.google_model';

  var FALLBACK_MODELS = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest'
  ];

  var DEFAULT_SYSTEM_INSTRUCTION = [
    'You are DiaCare AI\'s medical and diabetes education assistant, directly grounded with live Google Search.',
    'Your goal is to answer ANY question directly, clearly, helpfully, and accurately using Google Search.',
    '',
    'Key Guidelines:',
    '1. Grounding: Use Google Search to provide up-to-date, authoritative facts from clinical organizations (e.g., ADA, CDC, WHO, NIDDK, NHS, Mayo Clinic, PubMed, peer-reviewed journals).',
    '2. Direct Answers: Answer the user\'s question directly without dodging or refusal. Explain terms, physiological mechanisms, tests (HbA1c, fasting/postprandial glucose), and symptoms clearly.',
    '3. Patient Data & Metrics: When the user shares or asks about their blood glucose or HbA1c values, compare them against standard clinical targets (e.g., ADA: normal fasting <100 mg/dL, prediabetes 100-125 mg/dL, diabetes >=126 mg/dL; normal HbA1c <5.7%, prediabetes 5.7-6.4%, diabetes >=6.5%). Provide clear educational interpretation of what the numbers indicate, while reminding them that individual treatment/medication changes should be confirmed with their care team.',
    '4. Lifestyle & Complementary Therapies: Discuss evidence-based diet, exercise, yoga, and traditional Ayurveda, clearly stating where evidence is strong or preliminary, and noting potential interactions or safety cautions.',
    '5. General Topics: If asked general health, science, or lifestyle questions, answer directly with reliable Google Search information.',
    '6. Presentation: Format answers cleanly with markdown (headings, bold text, bullet points) so they are easy to read.'
  ].join('\n');

  function getApiKey() {
    var stored = '';
    try {
      stored = localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {}
    if (stored && stored.trim()) return stored.trim();

    var configKey = global.DIACARE_GOOGLE_CONFIG && global.DIACARE_GOOGLE_CONFIG.apiKey;
    if (configKey && typeof configKey === 'string' && configKey.trim()) {
      return configKey.trim();
    }
    return '';
  }

  function setApiKey(key) {
    var clean = (key || '').trim();
    try {
      if (clean) {
        localStorage.setItem(STORAGE_KEY, clean);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
    if (global.DIACARE_GOOGLE_CONFIG) {
      global.DIACARE_GOOGLE_CONFIG.apiKey = clean;
    }
    try {
      document.dispatchEvent(new CustomEvent('diacare:google-key-changed', {
        detail: { hasKey: Boolean(clean) }
      }));
    } catch (e) {}
    return Boolean(clean);
  }

  function hasApiKey() {
    return Boolean(getApiKey());
  }

  function getPreferredModel() {
    var stored = '';
    try {
      stored = localStorage.getItem(MODEL_STORAGE_KEY) || '';
    } catch (e) {}
    if (stored && stored.trim()) return stored.trim();

    var configModel = global.DIACARE_GOOGLE_CONFIG && global.DIACARE_GOOGLE_CONFIG.model;
    if (configModel && typeof configModel === 'string' && configModel.trim()) {
      return configModel.trim();
    }
    return 'gemini-2.5-flash';
  }

  function setPreferredModel(model) {
    if (!model) return;
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, String(model).trim());
    } catch (e) {}
  }

  async function callGemini(model, apiKey, promptText, systemInstruction, enableSearch) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

    var body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1200
      }
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    if (enableSearch) {
      body.tools = [{ google_search: {} }];
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 30000);

    var response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    var data = await response.json().catch(function () { return null; });

    if (!response.ok) {
      var err = new Error(
        (data && data.error && data.error.message) ||
        ('Google API request failed with status ' + response.status)
      );
      err.status = response.status;
      err.errorDetails = data && data.error;
      throw err;
    }

    return data;
  }

  async function askGoogle(question, options) {
    options = options || {};
    var apiKey = getApiKey();
    if (!apiKey) {
      var noKeyError = new Error('Please enter your Google Gemini API key to enable direct Google-powered answers.');
      noKeyError.code = 'NO_API_KEY';
      throw noKeyError;
    }

    var q = (question || '').trim();
    if (!q) {
      throw new Error('Please enter a question to ask Google.');
    }

    // Prepare full prompt, including patient context if provided
    var fullPrompt = q;
    if (options.patientContext && options.patientContext.trim()) {
      fullPrompt = [
        '=== LOCAL PATIENT RECORD CONTEXT (Saved on user\'s browser) ===',
        options.patientContext.trim(),
        '=== END OF PATIENT CONTEXT ===\n',
        'User Question: ' + q
      ].join('\n');
    }

    var systemInst = options.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    var primaryModel = getPreferredModel();

    // Prepare model fallback list
    var modelsToTry = [primaryModel];
    FALLBACK_MODELS.forEach(function (m) {
      if (modelsToTry.indexOf(m) === -1) modelsToTry.push(m);
    });

    var lastError = null;
    var data = null;
    var successfulModel = primaryModel;
    var searchEnabled = true;

    for (var i = 0; i < modelsToTry.length; i++) {
      var currentModel = modelsToTry[i];
      // 1. Try with Google Search grounding first
      try {
        data = await callGemini(currentModel, apiKey, fullPrompt, systemInst, true);
        successfulModel = currentModel;
        setPreferredModel(currentModel);
        searchEnabled = true;
        break;
      } catch (err) {
        lastError = err;
        // If auth error (invalid key), do not keep retrying
        if ((err.status === 400 || err.status === 403) && err.errorDetails && /API_KEY_INVALID|key not valid|invalid api key/i.test(err.errorDetails.message || '')) {
          break;
        }
        // If 404 (model not found), continue to next model
        if (err.status === 404) {
          continue;
        }
        // If Search Grounding is rate-limited (429) or tool not supported, retry directly with Gemini
        try {
          data = await callGemini(currentModel, apiKey, fullPrompt, systemInst, false);
          successfulModel = currentModel;
          setPreferredModel(currentModel);
          searchEnabled = false;
          break;
        } catch (retryErr) {
          lastError = retryErr;
          if (retryErr.status === 404) {
            continue;
          }
        }
      }
    }

    if (!data) {
      if (lastError && (lastError.status === 400 || lastError.status === 403)) {
        var msg = (lastError.errorDetails && lastError.errorDetails.message) || lastError.message;
        if (/API_KEY_INVALID|key not valid|invalid api key|api key not found/i.test(msg)) {
          var keyErr = new Error('Invalid Google API key. Please check or enter a valid key from Google AI Studio.');
          keyErr.code = 'INVALID_API_KEY';
          throw keyErr;
        }
      }
      if (lastError && lastError.status === 429) {
        var quotaErr = new Error('Google API rate limit reached for this key. Please wait a moment and try again.');
        quotaErr.code = 'RATE_LIMIT';
        throw quotaErr;
      }
      throw lastError || new Error('Could not retrieve an answer from Google. Please try again.');
    }

    var candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      throw new Error('Google did not return an answer. Please try rephrasing your question.');
    }

    var textParts = (candidate.content && candidate.content.parts) || [];
    var answerText = textParts.map(function (p) { return p.text || ''; }).join('\n').trim();

    if (!answerText) {
      throw new Error('Google returned an empty answer. Please try asking again.');
    }

    // Extract grounding sources
    var gMeta = candidate.groundingMetadata || {};
    var rawChunks = gMeta.groundingChunks || [];
    var seenUrls = {};
    var sources = [];

    rawChunks.forEach(function (chunk) {
      if (chunk && chunk.web && chunk.web.uri) {
        var url = chunk.web.uri.trim();
        if (/^https?:\/\//i.test(url) && !seenUrls[url]) {
          seenUrls[url] = true;
          var title = (chunk.web.title || '').trim();
          if (!title) {
            try {
              title = new URL(url).hostname.replace(/^www\./, '');
            } catch (e) {
              title = url;
            }
          }
          sources.push({ url: url, title: title });
        }
      }
    });

    var searchQueries = gMeta.webSearchQueries || [];

    return {
      answer: answerText,
      sources: sources.slice(0, 6),
      searchQueries: searchQueries,
      model: successfulModel,
      searchGrounded: searchEnabled && sources.length > 0
    };
  }

  var DiaCareGoogle = {
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    hasApiKey: hasApiKey,
    getPreferredModel: getPreferredModel,
    setPreferredModel: setPreferredModel,
    askGoogle: askGoogle
  };

  global.DiaCareGoogle = DiaCareGoogle;

})(typeof window !== 'undefined' ? window : this);
