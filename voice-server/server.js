require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
// Deepgram Voice Agent API (GA v1) — single WebSocket does STT + LLM + TTS.
const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('voice-server ok');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('[call] new connection');

  // Per-call config (filled from the Twilio <Stream> custom parameters)
  let streamSid = null;
  let systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || 'You are a professional AI receptionist. Keep responses under 2 sentences. Be warm and fast.';
  let greeting = 'Hello! How can I help you today?';
  let voiceId = process.env.DEFAULT_VOICE || 'aura-2-asteria-en';
  let ownerPhone = null;
  let fromNumber = null;
  let leadToken = null;    // tenant's secret intake token — to save the lead
  let callerNumber = null; // caller's real phone (From) — reliable fallback

  // Lead capture state
  let collectedName = null;
  let collectedPhone = null;
  let collectedIssue = null;
  let askedName = false;     // did the AI just ask for the caller's name?
  let leadAlertSent = false;

  // Settings can only be sent once we have BOTH the Deepgram socket open AND
  // Twilio's start event (which carries the real prompt/greeting). Otherwise the
  // agent would start with the default prompt/greeting.
  let dgOpen = false;
  let startReceived = false;
  let settingsSent = false;

  const dgWs = new WebSocket(DEEPGRAM_AGENT_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  function sendSettings() {
    if (settingsSent || !dgOpen || !startReceived) return;
    settingsSent = true;
    const settings = {
      type: 'Settings',
      audio: {
        input: { encoding: 'mulaw', sample_rate: 8000 },
        output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
      },
      agent: {
        language: 'en',
        listen: { provider: { type: 'deepgram', model: 'nova-3' } },
        think: {
          provider: { type: 'anthropic', model: 'claude-haiku-4-5', temperature: 0.7 },
          // Bring-your-own Anthropic key via a custom endpoint.
          endpoint: {
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY,
            },
          },
          prompt: systemPrompt,
          // Client-side function (no endpoint) — we handle it here on the socket.
          functions: [
            {
              name: 'transfer_to_human',
              description: 'Transfer the call to a human specialist when the customer requests it, has a complex issue, is angry, or needs immediate emergency help.',
              parameters: {
                type: 'object',
                properties: {
                  reason: { type: 'string', description: 'Why the call is being transferred' },
                },
                required: ['reason'],
              },
            },
          ],
        },
        speak: { provider: { type: 'deepgram', model: voiceId } },
        greeting,
      },
    };
    dgWs.send(JSON.stringify(settings));
    console.log('[deepgram] settings sent (prompt + greeting)');
  }

  dgWs.on('open', () => {
    console.log('[deepgram] connected');
    dgOpen = true;
    sendSettings();
  });

  dgWs.on('message', (data, isBinary) => {
    // Binary frame = agent audio → forward to Twilio as a media event.
    if (isBinary) {
      if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: data.toString('base64') } }));
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // Surface the full payload of any problem event from Deepgram.
    if (msg.type === 'Error' || msg.type === 'Warning') {
      console.error(`[deepgram ${msg.type}]`, JSON.stringify(msg));
      return;
    }

    if (msg.type !== 'ConversationText') console.log('[dg event]', msg.type);

    // Human handoff: the agent decided to call transfer_to_human.
    if (msg.type === 'FunctionCallRequest') {
      for (const fn of msg.functions || []) {
        if (fn.name !== 'transfer_to_human') continue;
        let reason = '';
        try { reason = JSON.parse(fn.arguments || '{}').reason || ''; } catch { /* arguments not JSON */ }
        console.log('[handoff] transfer_to_human:', reason);

        // Let the agent speak the hold line.
        dgWs.send(JSON.stringify({
          type: 'FunctionCallResponse',
          id: fn.id,
          name: fn.name,
          content: 'Transferring you now. Please hold.',
        }));

        // After the line plays: alert the owner, then end the AI session.
        setTimeout(() => {
          sendHandoffAlert(ownerPhone, callerNumber, fromNumber, reason);
          try { dgWs.close(); } catch {}
          try { twilioWs.close(); } catch {}
        }, 3000);
      }
      return;
    }

    // Barge-in: caller started talking — drop buffered agent audio in Twilio.
    if (msg.type === 'UserStartedSpeaking') {
      if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
      }
      return;
    }

    if (msg.type === 'ConversationText') {
      const role = msg.role;
      const content = msg.content || '';
      console.log(`[${role}]`, content);

      if (role === 'user') {
        const phoneMatch = content.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
        if (phoneMatch) collectedPhone = phoneMatch[1];
        if (askedName && !collectedName && content.trim().length < 40 && !/\d/.test(content)) {
          collectedName = content.trim();
        }
        if (!collectedIssue && content.trim().length > 5) collectedIssue = content.trim();
      }

      if (role === 'assistant') {
        const c = content.toLowerCase();
        askedName = c.includes('your name') || c.includes('name please') || c.includes('may i have your name') || c.includes('who am i speaking');

        const leadPhone = collectedPhone || callerNumber;
        const isLeadConfirmed = c.includes('technician will call') || c.includes('call you') || c.includes('reach out') || c.includes('get back to you');
        if (isLeadConfirmed && !leadAlertSent && leadPhone) {
          leadAlertSent = true;
          sendLeadAlert(collectedName, leadPhone, collectedIssue, ownerPhone, fromNumber);
          saveLeadToDatabase(collectedName, leadPhone, leadToken);
        }

        // Hang up shortly after a closing line so the goodbye finishes playing.
        if (['have a great day', 'goodbye', 'take care', 'bye'].some((p) => c.includes(p))) {
          setTimeout(() => { try { dgWs.close(); } catch {} try { twilioWs.close(); } catch {} }, 3000);
        }
      }
    }
  });

  dgWs.on('error', (err) => console.error('[deepgram error]', err.message));
  // Non-101 handshake (e.g. 401 bad DEEPGRAM_API_KEY) surfaces here.
  dgWs.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => console.error(`[deepgram handshake] HTTP ${res.statusCode} ${body.slice(0, 300)}`));
  });
  dgWs.on('close', (code, reason) => console.log('[deepgram] disconnected', code, reason ? reason.toString() : ''));

  // ── Twilio Media Stream ────────────────────────────────────────────────
  twilioWs.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      const p = msg.start.customParameters || {};
      if (p.systemPrompt) systemPrompt = p.systemPrompt;
      if (p.greeting) greeting = p.greeting;
      if (p.voiceId) voiceId = p.voiceId;
      if (p.ownerPhone) ownerPhone = p.ownerPhone;
      if (p.fromNumber) fromNumber = p.fromNumber;
      if (p.leadToken) leadToken = p.leadToken;
      if (p.callerNumber) callerNumber = p.callerNumber;
      console.log('[start]', streamSid);
      startReceived = true;
      sendSettings();
    }

    if (msg.event === 'media') {
      // Caller audio → Deepgram (raw mulaw bytes).
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }
    }

    if (msg.event === 'stop') {
      console.log('[stop]');
      try { dgWs.close(); } catch {}
    }
  });

  twilioWs.on('close', () => {
    console.log('[call] disconnected');
    try { dgWs.close(); } catch {}
  });
});

// Text the business owner a summary when the AI captures a hot lead.
async function sendLeadAlert(name, phone, issue, ownerPhone, fromNumber) {
  if (!ownerPhone) {
    console.log('[lead-alert] skipped — no ownerPhone');
    return;
  }
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('[lead-alert] skipped — TWILIO_ACCOUNT_SID not set in env');
    return;
  }
  const from = fromNumber || process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    console.log('[lead-alert] skipped — no from number');
    return;
  }

  const message = `🔔 New lead from AI call!\nName: ${name || 'Unknown'}\nPhone: ${phone || 'Unknown'}\nIssue: ${issue || 'Not specified'}\n\nCall them back now — they're waiting.`;
  console.log(`[lead-alert] sending from=${from} to=${ownerPhone}`);
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const res = await twilio.messages.create({ body: message, from, to: ownerPhone });
    console.log(`[lead-alert] SMS sent to owner: ${ownerPhone} (sid=${res.sid} status=${res.status})`);
  } catch (err) {
    console.error(`[lead-alert] error: ${err.message}${err.code ? ` (code ${err.code})` : ''}`);
  }
}

// Text the owner when a live call is being handed off to a human.
async function sendHandoffAlert(ownerPhone, callerPhone, fromNumber, reason) {
  if (!ownerPhone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('[handoff] SMS skipped — no ownerPhone or TWILIO_ACCOUNT_SID');
    return;
  }
  const from = fromNumber || process.env.TWILIO_PHONE_NUMBER;
  if (!from) { console.log('[handoff] SMS skipped — no from number'); return; }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: `🚨 Live call transfer!\nCaller: ${callerPhone || 'Unknown'}\nReason: ${reason || 'Not specified'}\nCall them back NOW — they are waiting.`,
      from,
      to: ownerPhone,
    });
    console.log('[handoff] SMS sent to owner:', ownerPhone);
  } catch (err) {
    console.error('[handoff] error:', err.message);
  }
}

// Persist the lead via the tenant's secure intake URL so it shows in the
// dashboard (and fires the realtime notification). The open /api/leads/inbound
// endpoint is deprecated (410) — the token URL is the supported path.
async function saveLeadToDatabase(name, phone, leadToken) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!leadToken) { console.log('[lead-db] skipped — no leadToken'); return; }
  if (!appUrl) { console.log('[lead-db] skipped — NEXT_PUBLIC_APP_URL not set in env'); return; }
  if (!phone) { console.log('[lead-db] skipped — no phone'); return; }

  console.log(`[lead-db] saving lead name=${name || '-'} phone=${phone}`);
  try {
    const res = await fetch(`${appUrl}/api/leads/inbound/${leadToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: name || null, source: 'voice_call' }),
    });
    console.log('[lead-db] saved, status:', res.status);
  } catch (err) {
    console.error('[lead-db] error:', err.message);
  }
}

server.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
