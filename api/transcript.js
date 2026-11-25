import { YoutubeTranscript } from 'youtube-transcript';

function getId(u) {
  const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function viaInnertube(id) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '20.10.38'
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' } },
      videoId: id, contentCheckOk: true, racyCheckOk: true
    })
  });
  const j = await r.json();
  const tracks = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) {
    throw new Error('no caption tracks (' + (j?.playabilityStatus?.status || '?') + ' ' + (j?.playabilityStatus?.reason || '') + ')');
  }
  const t = tracks.find(x => x.languageCode === 'en' && x.kind !== 'asr') || tracks.find(x => x.languageCode === 'en') || tracks[0];
  const url = t.baseUrl.replace(/&fmt=\w+/, '') + '&fmt=json3';
  const cr = await fetch(url, { headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' } });
  const txt = await cr.text();
  let cj;
  try { cj = JSON.parse(txt); } catch { throw new Error('caption file not JSON'); }
  const segments = (cj.events || [])
    .filter(e => e.segs && e.tStartMs != null)
    .map(e => ({
      start: e.tStartMs / 1000,
      end: (e.tStartMs + (e.dDurationMs || 2000)) / 1000,
      text: e.segs.map(s => s.utf8).join('').replace(/\n/g, ' ').trim()
    }))
    .filter(s => s.text);
  if (!segments.length) throw new Error('empty captions');
  return segments;
}

async function viaLibrary(id) {
  const raw = await YoutubeTranscript.fetchTranscript(id);
  if (!raw.length) throw new Error('empty');
  const durs = raw.map(r => r.duration || 0).sort((a, b) => a - b);
  const ms = durs[Math.floor(durs.length / 2)] > 100;
  const k = ms ? 1000 : 1;
  return raw.map(r => ({
    start: r.offset / k,
    end: (r.offset + (r.duration || 0)) / k,
    text: String(r.text).replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  }));
}

export default async function handler(req, res) {
  const id = getId(String(req.query.url || ''));
  if (!id) return res.status(400).json({ error: 'Invalid YouTube link' });

  const reasons = [];
  for (const [name, fn] of [['app-api', viaInnertube], ['library', viaLibrary]]) {
    try {
      const segments = await fn(id);
      return res.status(200).json({ id, segments, duration: segments[segments.length - 1].end });
    } catch (e) {
      reasons.push(name + ': ' + String(e && e.message ? e.message : e).slice(0, 150));
    }
  }
  res.status(404).json({
    error: 'Could not get captions automatically (' + reasons.join(' | ') + '). YouTube may be blocking Vercel. Paste the transcript manually below, or use the Upload tab.'
  });
}
