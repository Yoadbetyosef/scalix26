// ── Ask Amy realtime proxy (dashboard-only) ─────────────────────────────────────
// A SEPARATE service from voice-server. The browser streams mic audio here; we relay
// it to the SAME Deepgram Voice Agent the phone uses (STT + VAD endpointing + LLM +
// streaming TTS), holding the Deepgram key server-side. Audio + events stream back to
// the browser. This does NOT touch voice-server, Twilio, booking, or any phone-call
// behaviour — it is an independent process for the dashboard "Talk to Amy live".
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const http = require('http');
const WebSocket = require('ws');

// Hosting platforms (Render/Railway/Fly) inject the port to bind via $PORT — honour it so
// the public deploy's health check + WebSocket upgrade actually reach us. Falls back to the
// local dev port otherwise.
const PORT = process.env.PORT || process.env.AMY_REALTIME_PORT || 8081;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

const server = http.createServer((req, res) => { res.writeHead(200); res.end('amy-realtime-server ok'); });
const wss = new WebSocket.Server({ server });

wss.on('connection', (browser) => {
  console.log('[amy] browser connected');
  let config = null;
  let dgOpen = false;
  let settingsSent = false;

  const dg = new WebSocket(DEEPGRAM_AGENT_URL, { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });

  function trySendSettings() {
    if (settingsSent || !dgOpen || !config) return;
    settingsSent = true;
    const voice = /^aura-2?-[a-z]+-(en|es)$/.test(config.voice || '') ? config.voice : 'aura-2-asteria-en';
    const eot = typeof config.eot === 'number' ? config.eot : 0.7; // match the phone's endpointing
    // BYO Anthropic, EXACTLY like the phone — direct to Anthropic for fast, consistent
    // TTFT (Deepgram-hosted Claude was slower/variable). Key stays server-side (this
    // proxy is trusted, like voice-server). Do NOT add an anthropic-version header here.
    const think = { provider: { type: 'anthropic', model: 'claude-haiku-4-5', temperature: 0.6 }, prompt: String(config.prompt || 'You are a helpful AI employee.') };
    if (process.env.ANTHROPIC_API_KEY) {
      think.endpoint = { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY } };
    }
    const settings = {
      type: 'Settings',
      audio: {
        input: { encoding: 'linear16', sample_rate: config.inputSampleRate || 48000 },
        output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
      },
      agent: {
        listen: { provider: { type: 'deepgram', model: 'flux-general-multi', version: 'v2', eot_threshold: eot } },
        think,
        speak: { provider: { type: 'deepgram', model: voice } },
        // Only greet if the client explicitly sends a non-empty greeting. An empty string ''
        // means NO greeting — the agent stays silent (Listening) and answers only after the
        // user speaks first, so it never talks over them. (Previously `|| 'Hi.'` forced a
        // greeting on the empty string, which is why she still said "Hi".)
        ...(config.greeting ? { greeting: String(config.greeting) } : {}),
      },
    };
    dg.send(JSON.stringify(settings));
    console.log('[amy] settings sent (voice', voice, 'eot', eot, 'byo-anthropic', !!think.endpoint, ')');
  }

  dg.on('open', () => { dgOpen = true; trySendSettings(); });
  dg.on('message', (data, isBinary) => {
    if (browser.readyState !== WebSocket.OPEN) return;
    browser.send(data, { binary: isBinary }); // agent audio (binary) + events (text) → browser
  });
  dg.on('error', (e) => { try { browser.send(JSON.stringify({ type: 'Error', description: 'agent: ' + e.message })); } catch {} });
  dg.on('unexpected-response', (_r, res) => {
    let b = ''; res.on('data', (c) => (b += c));
    res.on('end', () => { console.error('[amy] dg handshake', res.statusCode, b.slice(0, 200)); try { browser.send(JSON.stringify({ type: 'Error', description: 'agent handshake ' + res.statusCode })); } catch {} });
  });
  dg.on('close', () => { try { browser.close(); } catch {} });

  browser.on('message', (data, isBinary) => {
    if (isBinary) { if (dg.readyState === WebSocket.OPEN) dg.send(data); return } // mic audio → agent
    let msg; try { msg = JSON.parse(data.toString()); } catch { return }
    if (msg.type === 'config') { config = msg; trySendSettings(); }
  });
  browser.on('close', () => { console.log('[amy] browser disconnected'); try { dg.close(); } catch {} });
  browser.on('error', () => { try { dg.close(); } catch {} });
});

server.listen(PORT, () => console.log(`[amy-realtime] listening on ${PORT} (proxy → Deepgram Voice Agent)`));
