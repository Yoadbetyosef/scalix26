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
  let callSid = null; // Twilio Call SID — needed to redirect the live call
  let callStartTime = null; // for call-duration analytics
  let systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || 'You are a professional AI receptionist. Keep responses under 2 sentences. Be warm and fast.';
  let greeting = 'Hello! How can I help you today?';
  let voiceId = process.env.DEFAULT_VOICE || 'aura-2-asteria-en';
  let ownerPhone = null;
  let fromNumber = null;
  let leadToken = null;    // tenant's secret intake token — to save the lead
  let callerNumber = null; // caller's real phone (From) — reliable fallback
  let voiceLanguage = 'en-US'; // from the app: 'en-US' | 'es' | 'multi' (default English)

  // Lead capture state
  let collectedName = null;
  let collectedPhone = null;
  let collectedIssue = null;
  let conversationHistory = []; // full transcript: { role, content }
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

    // Per-call voice language → Deepgram Voice Agent config. Default = English
    // (unchanged). nova-3 handles en / es / multi (EN<->ES code-switch).
    let agentLanguage = 'en';
    if (voiceLanguage === 'es') agentLanguage = 'es';
    else if (voiceLanguage === 'multi') agentLanguage = 'multi';
    const sttModel = 'nova-3';
    console.log('[stt]', sttModel, '[lang]', voiceLanguage, '[tts]', voiceId);

    const settings = {
      type: 'Settings',
      audio: {
        input: { encoding: 'mulaw', sample_rate: 8000 },
        output: { encoding: 'mulaw', sample_rate: 8000, container: 'none' },
      },
      agent: {
        language: agentLanguage,
        listen: { provider: { type: 'deepgram', model: sttModel } },
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
            {
              name: 'check_availability',
              description: 'Check available appointment slots for a specific date',
              parameters: {
                type: 'object',
                properties: {
                  date: { type: 'string', description: 'Date like tomorrow, Monday, June 15' },
                },
                required: ['date'],
              },
            },
            {
              name: 'book_appointment',
              description: 'Book an appointment for the customer',
              parameters: {
                type: 'object',
                properties: {
                  date: { type: 'string' },
                  time: { type: 'string' },
                  customer_name: { type: 'string' },
                  customer_phone: { type: 'string' },
                  service_type: { type: 'string' },
                },
                required: ['date', 'time', 'customer_name', 'customer_phone'],
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

  dgWs.on('message', async (data, isBinary) => {
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
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      for (const fn of msg.functions || []) {
        let args = {};
        try { args = JSON.parse(fn.arguments || '{}'); } catch { /* arguments not JSON */ }

        if (fn.name === 'transfer_to_human') {
          const reason = args.reason || '';
          console.log('[handoff] transfer_to_human:', reason);
          dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: 'Transferring you now. Please hold.' }));
          // Redirect the LIVE call to the owner (see transferCall). Don't close
          // the Twilio socket — the redirect keeps the call alive.
          setTimeout(() => {
            transferCall(callSid, ownerPhone, fromNumber, callerNumber, reason);
            try { dgWs.close(); } catch {}
          }, 3000);
          continue;
        }

        if (fn.name === 'check_availability') {
          let content = 'No availability on that date.';
          try {
            const r = await fetch(`${appUrl}/api/appointments/available?lead_token=${encodeURIComponent(leadToken || '')}&date=${encodeURIComponent(args.date || '')}`);
            const j = await r.json();
            content = (j.slots && j.slots.length) ? `Available times: ${j.slots.join(', ')}` : 'No availability on that date.';
          } catch (e) { console.error('[check_availability] error:', e.message); }
          console.log('[booking] check_availability:', args.date, '->', content);
          dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content }));
          continue;
        }

        if (fn.name === 'book_appointment') {
          let content = 'Booking failed, please try again.';
          try {
            const r = await fetch(`${appUrl}/api/appointments/book`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...args, lead_token: leadToken, customer_phone: args.customer_phone || callerNumber }),
            });
            const j = await r.json();
            content = j.success ? 'Appointment booked successfully.' : `Could not book: ${j.error || 'please try again'}`;
          } catch (e) { console.error('[book_appointment] error:', e.message); }
          console.log('[booking] book_appointment ->', content);
          dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content }));
          continue;
        }
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

      // Collect the full transcript for the Inbox conversation record.
      if (content.trim()) conversationHistory.push({ role: role === 'assistant' ? 'assistant' : 'user', content: content.trim() });

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
          saveLeadToDatabase(collectedName, leadPhone, collectedIssue, leadToken);
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
      callSid = msg.start.callSid || null;
      callStartTime = Date.now();
      const p = msg.start.customParameters || {};
      if (p.systemPrompt) systemPrompt = p.systemPrompt;
      if (p.greeting) greeting = p.greeting;
      if (p.voiceId) voiceId = p.voiceId;
      if (p.ownerPhone) ownerPhone = p.ownerPhone;
      if (p.fromNumber) fromNumber = p.fromNumber;
      if (p.leadToken) leadToken = p.leadToken;
      if (p.callerNumber) callerNumber = p.callerNumber;
      if (p.language) voiceLanguage = p.language;
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
    const durationSeconds = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0;
    if (callStartTime) logCallAnalytics(leadToken, durationSeconds);
    // Save the call as an Inbox conversation with the full transcript.
    saveConversation(leadToken, callerNumber, collectedName, conversationHistory, durationSeconds);
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

// Record a handled voice call for dashboard metrics. Tenant is resolved from
// the lead token server-side (no tenant_id sent from here).
async function logCallAnalytics(leadToken, durationSeconds) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!leadToken || !appUrl) return;
  try {
    await fetch(`${appUrl}/api/analytics/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_token: leadToken, duration_seconds: durationSeconds }),
    });
    console.log('[analytics] call logged, duration:', durationSeconds);
  } catch (err) {
    console.error('[analytics] error:', err.message);
  }
}

// Save the call as an Inbox conversation with its full transcript. Tenant is
// resolved server-side from the lead token (no tenant_id sent from here).
async function saveConversation(leadToken, phone, name, transcript, durationSeconds) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!leadToken || !appUrl) { console.log('[conversation] skipped — no leadToken/appUrl'); return; }
  if (!transcript || transcript.length === 0) { console.log('[conversation] skipped — empty transcript'); return; }
  try {
    const res = await fetch(`${appUrl}/api/conversations/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_token: leadToken,
        contact_phone: phone,
        contact_name: name,
        transcript,
        duration_seconds: durationSeconds,
      }),
    });
    console.log('[conversation] saved, status:', res.status, '| turns:', transcript.length);
  } catch (err) {
    console.error('[conversation] error:', err.message);
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// True live transfer: redirect the in-progress Twilio call to <Dial> the owner.
// If callSid/creds are missing, fall back to just SMS-ing the owner. The <Dial>
// action callback (handoff-fallback) sends the SMS only if the owner misses it.
async function transferCall(callSid, ownerPhone, fromNumber, callerNumber, reason) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!callSid || !ownerPhone || !process.env.TWILIO_ACCOUNT_SID || !appUrl) {
    console.log('[handoff] cannot redirect (missing callSid/ownerPhone/creds/appUrl) — SMS fallback');
    return sendHandoffAlert(ownerPhone, callerNumber, fromNumber, reason);
  }
  const q = new URLSearchParams({
    owner: ownerPhone,
    from: fromNumber || '',
    caller: callerNumber || '',
    reason: reason || '',
  }).toString();
  const action = `${appUrl}/api/webhooks/twilio/voice/handoff-fallback?${q}`;
  // callerId must be a Twilio number on the account — use the tenant's number.
  const twiml = `<Response><Dial timeout="20" callerId="${escapeXml(fromNumber || '')}" action="${escapeXml(action)}" method="POST"><Number>${escapeXml(ownerPhone)}</Number></Dial></Response>`;
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.calls(callSid).update({ twiml });
    console.log('[handoff] live call redirected to owner:', ownerPhone);
  } catch (err) {
    console.error('[handoff] redirect error:', err.message, '— SMS fallback');
    sendHandoffAlert(ownerPhone, callerNumber, fromNumber, reason);
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
async function saveLeadToDatabase(name, phone, issue, leadToken) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!leadToken) { console.log('[lead-db] skipped — no leadToken'); return; }
  if (!appUrl) { console.log('[lead-db] skipped — NEXT_PUBLIC_APP_URL not set in env'); return; }
  if (!phone) { console.log('[lead-db] skipped — no phone'); return; }

  console.log(`[lead-db] saving lead name=${name || '-'} phone=${phone}`);
  try {
    const res = await fetch(`${appUrl}/api/leads/inbound/${leadToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: name || null, issue: issue || null, source: 'voice_call' }),
    });
    console.log('[lead-db] saved, status:', res.status);
  } catch (err) {
    console.error('[lead-db] error:', err.message);
  }
}

server.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
