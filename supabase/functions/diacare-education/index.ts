const allowedOrigins = new Set([
  'https://tabish3008.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

const systemInstruction = `You are DiaCare AI's general diabetes education assistant. The user question is the only user content you receive; you do not have access to patient records. Use Google Search grounding and prefer authoritative public health and research sources such as NIDDK, CDC, WHO, NHS, NCCIH, and peer-reviewed journals. Explain general concepts in plain language and distinguish traditional Ayurvedic claims from clinical evidence. State when evidence is limited or uncertain and mention known safety concerns such as interactions or product contamination when relevant. Do not diagnose, interpret an individual's glucose/A1c, give patient-specific advice, recommend an Ayurvedic medicine, herb, kadha, supplement, product, recipe, dose, or treatment, or tell anyone to change prescribed care. Do not prescribe yoga poses, intensity, or schedules based on glucose. If asked for personal treatment or a dose, politely decline and suggest asking a qualified clinician or pharmacist. Keep answers concise and educational. Use source links returned by Google Search; do not invent citations.`;

function json(body: unknown, status: number, origin: string) {
  const allowedOrigin = allowedOrigins.has(origin) ? origin : 'https://tabish3008.github.io';
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin is not allowed.' }, 403, origin);
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) {
    return json({ error: 'Sign in to use this educational search.' }, 401, origin);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'The education search is not configured yet.' }, 503, origin);

  let question = '';
  try {
    const body = await request.json();
    question = typeof body?.question === 'string' ? body.question.trim() : '';
  } catch {
    return json({ error: 'Send a valid question.' }, 400, origin);
  }
  if (!question || question.length > 400) return json({ error: 'Question must be between 1 and 400 characters.' }, 400, origin);
  if (/\b(dose|dosage|how much (?:should|do) (?:i|you|they)|how many (?:tablets|pills)|medicine for (?:my|this) patient)\b/i.test(question) || /\b(?:my|mine|patient's|patient’s|his|her|their)\b.{0,80}\b(?:glucose|blood sugar|sugar level|reading|hba1c|a1c|symptom|treatment|medicine|medication)\b/i.test(question)) {
    return json({ answer: 'I can only provide general education here, not interpret a person’s results or recommend treatment or a dose. Please ask a qualified clinician or pharmacist about personal care.', sources: [] }, 200, origin);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 550 },
      }),
    });
    clearTimeout(timeout);
    const payload = await response.json();
    if (!response.ok) {
      console.error('Gemini request failed:', response.status, payload?.error?.status || 'upstream error');
      return json({ error: response.status === 429 ? 'The free Google request limit has been reached for now. Try again later.' : 'Google could not answer right now. Try again shortly.' }, response.status === 429 ? 429 : 502, origin);
    }
    const candidate = payload?.candidates?.[0];
    const answer = (candidate?.content?.parts || []).map((part: { text?: string }) => part.text || '').join('\n').trim();
    if (!answer) return json({ error: 'No answer was returned. Please rephrase the question.' }, 502, origin);
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const seen = new Set<string>();
    const sources = chunks.map((chunk: { web?: { uri?: string; title?: string } }) => ({
      url: chunk.web?.uri || '', title: chunk.web?.title || '',
    })).filter((item: { url: string; title: string }) => {
      if (!/^https:\/\//i.test(item.url) || seen.has(item.url)) return false;
      seen.add(item.url); return true;
    }).slice(0, 5);
    return json({ answer, sources }, 200, origin);
  } catch (error) {
    console.error('Education search error:', error instanceof Error ? error.name : 'unknown error');
    return json({ error: 'The education search timed out or could not connect. Try again.' }, 502, origin);
  }
});
