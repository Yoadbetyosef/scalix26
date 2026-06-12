require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const PORT = process.env.PORT || 8080;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('voice-server ok');
});

const wss = new WebSocket.Server({ server });

// Block duplicate Twilio connections for the same call (streamSid -> true)
const activeCalls = new Map();

wss.on('connection', (ws) => {
  console.log('[connection] new WebSocket, total active:', wss.clients.size);

  // State לשיחה זו בלבד
  let streamSid = null;
  let systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || 'You are a professional AI receptionist. Keep responses under 2 sentences. Be warm and fast.';
  let greeting = 'Hello! How can I help you today?';
  let history = [];
  let busy = false; // true while the AI is talking or thinking
  let claudeStreaming = false;
  let turnId = 0;           // bumps each user turn; stale streams check against it
  let currentStream = null; // the in-flight Claude stream (for barge-in abort)
  let greetingSent = false;
  let registered = false; // did THIS connection register its streamSid?

  // Audio queue — play TTS clips one at a time so Twilio never overlaps them
  let audioQueue = [];
  let playingAudio = false;

  async function playNext(ws, streamSid) {
    if (playingAudio) return;
    if (audioQueue.length === 0) {
      if (!claudeStreaming) busy = false; // AI finished talking — ready to listen
      return;
    }
    playingAudio = true;
    const text = audioQueue.shift();
    await sendAudio(text, ws, streamSid);
    playingAudio = false;
    playNext(ws, streamSid);
  }

  function queueAudio(text, ws, streamSid) {
    busy = true;
    audioQueue.push(text);
    playNext(ws, streamSid);
  }

  // Barge-in: stop the AI immediately so it can listen to the caller.
  function stopSpeaking() {
    audioQueue = [];
    playingAudio = false;
    claudeStreaming = false;
    if (currentStream) { try { currentStream.abort(); } catch {} currentStream = null; }
    if (ws.readyState === WebSocket.OPEN && streamSid) {
      ws.send(JSON.stringify({ event: 'clear', streamSid })); // drop Twilio's buffered audio
    }
  }

  // Deepgram STT
  const dg = deepgramClient.listen.live({
    model: 'nova-2',
    language: 'en-US',
    smart_format: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    interim_results: true,
    endpointing: 250,
    utterance_end_ms: 1000,
    vad_events: true,
  });

  dg.on(LiveTranscriptionEvents.Open, () => console.log('[dg] connected'));
  dg.on(LiveTranscriptionEvents.Error, (e) => console.error('[dg] error', e));

  dg.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
    const isFinal = data.speech_final || data.is_final;
    if (!transcript || !isFinal) return;

    // Barge-in: the caller spoke while the AI was talking — stop and listen.
    if (busy) {
      console.log('[barge-in]', transcript);
      stopSpeaking();
    }

    console.log('[user]', transcript);
    busy = true;
    claudeStreaming = true;
    const myTurn = ++turnId; // this turn's id; stale stream handlers no-op below

    try {
      history.push({ role: 'user', content: transcript });

      let fullText = '';
      let buffer = '';
      const stream = anthropic.messages.stream({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        system: systemPrompt,
        messages: history.slice(-6),
      });
      currentStream = stream;

      // Stream each clause to TTS as it completes — click-free raw mulaw.
      stream.on('text', (t) => {
        if (myTurn !== turnId) return; // superseded by a barge-in
        fullText += t;
        buffer += t;
        if (buffer.match(/[.!?,]/) && buffer.trim().length > 15) {
          const toSend = buffer.trim();
          buffer = '';
          queueAudio(toSend, ws, streamSid);
        }
      });

      stream.on('finalMessage', async () => {
        if (myTurn !== turnId) return;
        console.log('[ai]', fullText);
        if (buffer.trim().length > 0) {
          queueAudio(buffer.trim(), ws, streamSid);
        }
        history.push({ role: 'assistant', content: fullText });
        claudeStreaming = false;
        currentStream = null;
        if (!playingAudio && audioQueue.length === 0) busy = false;

        // Hang up shortly after a closing line so the goodbye finishes playing
        const endPhrases = ['have a great day', 'goodbye', 'take care', 'bye'];
        if (endPhrases.some(p => fullText.toLowerCase().includes(p))) {
          setTimeout(() => endCall(ws, streamSid), 2000);
        }
      });

      stream.on('error', (e) => {
        if (myTurn !== turnId) return;
        console.error('[claude error]', e.message);
        claudeStreaming = false;
        currentStream = null;
        busy = false;
      });

    } catch (e) {
      if (myTurn === turnId) { claudeStreaming = false; busy = false; }
      console.error('[error]', e.message);
    }
  });

  // Twilio messages
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        if (activeCalls.has(streamSid)) {
          console.log('[DUPLICATE] duplicate connection for streamSid:', streamSid, '— closing');
          ws.close();
          return;
        }
        activeCalls.set(streamSid, true);
        registered = true;
        console.log('[start] registered streamSid:', streamSid);
        const p = msg.start.customParameters || {};
        if (p.systemPrompt) systemPrompt = p.systemPrompt;
        if (p.greeting) greeting = p.greeting;
        console.log('[start]', streamSid);

        // Send greeting once per call
        console.log('[greeting] sending, greetingSent was:', greetingSent);
        if (!greetingSent) {
          greetingSent = true;
          queueAudio(greeting, ws, streamSid);
        }
      }

      if (msg.event === 'media') {
        const audio = Buffer.from(msg.media.payload, 'base64');
        if (dg.getReadyState() === 1) dg.send(audio);
      }

      if (msg.event === 'stop') {
        console.log('[stop]');
        dg.finish();
      }
    } catch (e) {
      console.error('[ws error]', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[call] disconnected');
    if (registered && streamSid) activeCalls.delete(streamSid);
    console.log('[close] removed streamSid, active calls:', activeCalls.size);
    try { dg.finish(); } catch {}
  });
});

async function sendAudio(text, ws, streamSid) {
  if (!text || !streamSid || ws.readyState !== WebSocket.OPEN) return;
  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/speak?model=aura-2-asteria-en&encoding=mulaw&sample_rate=8000&container=none',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      }
    );
    if (!res.ok) { console.error('[tts]', res.status); return; }
    const buf = Buffer.from(await res.arrayBuffer()).toString('base64');
    ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: buf } }));
    console.log('[tts] sent', text.length, 'chars');
  } catch (e) {
    console.error('[tts error]', e.message);
  }
}

// End the call: stop any buffered audio, then close the WS so Twilio's
// <Connect><Stream> ends and the call hangs up. (Twilio doesn't accept a
// server-sent 'stop' event, so ws.close() is the correct way to end it.)
function endCall(ws, streamSid) {
  console.log('[end-call] hanging up');
  try {
    if (ws.readyState === WebSocket.OPEN && streamSid) {
      ws.send(JSON.stringify({ event: 'clear', streamSid }));
    }
  } catch {}
  setTimeout(() => { try { ws.close(); } catch {} }, 500);
}

server.listen(PORT, () => console.log('[server] listening on port', PORT));
