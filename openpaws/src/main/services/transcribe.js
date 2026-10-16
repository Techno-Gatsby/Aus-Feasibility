'use strict';
/*
 * Speech-to-text for push-to-talk. Any OpenAI-compatible /audio/transcriptions endpoint:
 * OpenAI (whisper-1, gpt-4o-mini-transcribe), Groq (whisper-large-v3), or a local server
 * such as faster-whisper-server / whisper.cpp server / LocalAI on your own machine.
 */
async function transcribe({ audio, mime, baseUrl, model, apiKey, language, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  if (!baseUrl) throw new Error('Set a speech-to-text server in Settings > Voice');
  const ext = /webm/.test(mime || '') ? 'webm' : /ogg/.test(mime || '') ? 'ogg' : /mp4|m4a/.test(mime || '') ? 'm4a' : 'wav';
  // Multipart body built by hand so it works with any fetch implementation (Electron net.fetch included).
  const boundary = '----openpaws' + Math.random().toString(16).slice(2);
  const parts = [];
  const field = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  field('model', model || 'whisper-1');
  if (language) field('language', language);
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.${ext}"\r\nContent-Type: ${mime || 'audio/webm'}\r\n\r\n`));
  parts.push(Buffer.from(audio));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  const res = await f(baseUrl.replace(/\/+$/, '') + '/audio/transcriptions', { method: 'POST', headers, body: Buffer.concat(parts) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && (j.error.message || j.error)) || `Transcription failed (HTTP ${res.status})`);
  return (j.text || '').trim();
}

module.exports = { transcribe };
