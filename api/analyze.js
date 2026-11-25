const DEFAULT_MODELS = [
  'openai/gpt-oss-120b:free',
  'meta-llama/llama-3.3-70b-instruct:free'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY is not set in Vercel environment variables' });

  const { segments, count = 5, minLen = 30, maxLen = 60, duration } = req.body || {};
  if (!Array.isArray(segments) || !segments.length) return res.status(400).json({ error: 'No transcript' });

  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let transcript = segments.map(s => `[${Math.floor(s.start)}s ${mmss(s.start)}] ${s.text}`).join('\n');
  if (transcript.length > 60000) transcript = transcript.slice(0, 60000); // free models have smaller context

  const prompt = `You are a short-form video editor. From the timestamped transcript below, pick the ${count} best moments to cut as standalone clips for YouTube Shorts / Reels / TikTok.

Rules:
- Each clip is ${minLen}-${maxLen} seconds long.
- Start on a strong hook, end on a natural finish (never mid-sentence).
- Prefer: surprising claims, stories, strong opinions, useful tips, emotional or funny moments.
- Clips must not overlap.
- Use the second values shown in brackets for start and end.
${duration ? `- The video is ${Math.round(duration)} seconds long.` : ''}

Return ONLY a JSON array, no other text. Each item: {"start": number, "end": number, "title": "catchy title under 70 chars", "reason": "one sentence on why this works", "score": 1-100}

Transcript:
${transcript}`;

  const models = process.env.OPENROUTER_MODEL
    ? process.env.OPENROUTER_MODEL.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_MODELS;

  let lastErr = 'AI request failed';
  for (const model of models) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vectrasource.com',
          'X-Title': 'ClipAI'
        },
        body: JSON.stringify({ model, max_tokens: 2000, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
      });
      const j = await r.json();
      if (!r.ok) { lastErr = j.error?.message || `HTTP ${r.status}`; continue; }
      const text = j.choices?.[0]?.message?.content || '';
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) { lastErr = 'AI returned no clips'; continue; }
      const clips = JSON.parse(m[0])
        .filter(c => typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start)
        .map(c => ({ ...c, end: duration ? Math.min(c.end, duration) : c.end }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      if (!clips.length) { lastErr = 'AI returned no valid clips'; continue; }
      return res.status(200).json({ clips, model });
    } catch (e) {
      lastErr = e.message;
    }
  }
  res.status(502).json({ error: lastErr + ' (free models can be rate limited, try again in a minute)' });
}
