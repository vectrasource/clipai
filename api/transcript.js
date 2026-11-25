import { YoutubeTranscript } from 'youtube-transcript';

function getId(u) {
  const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  const id = getId(String(req.query.url || ''));
  if (!id) return res.status(400).json({ error: 'Invalid YouTube link' });
  try {
    const raw = await YoutubeTranscript.fetchTranscript(id);
    if (!raw.length) throw new Error('empty');
    const durs = raw.map(r => r.duration || 0).sort((a, b) => a - b);
    const ms = durs[Math.floor(durs.length / 2)] > 100; // median caption length >100 means milliseconds
    const k = ms ? 1000 : 1;
    const segments = raw.map(r => ({
      start: r.offset / k,
      end: (r.offset + (r.duration || 0)) / k,
      text: String(r.text).replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    }));
    res.status(200).json({ id, segments, duration: segments[segments.length - 1].end });
  } catch (e) {
    const reason = String(e && e.message ? e.message : e).slice(0, 200);
    res.status(404).json({ error: 'Could not get captions. Reason: ' + reason + ' (If this keeps happening on videos that have captions, YouTube is blocking Vercel. Use the Upload tab instead.)' });
  }
}
