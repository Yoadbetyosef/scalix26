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

wss.on('connection', (ws) => {
  console.log('[call] new connection');

  // State לשיחה זו בלבד
  let streamSid = null;
  let systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || 'You are a professional AI receptionist. Keep responses under 2 sentences. Be warm and fast.';
  let greeting = 'Hello! How can I help you today?';
  let history = [];
  let busy = false; // true כשהAI מעבד או מדבר
  let greetingSent = false;

  // Audio queue — play TTS clips one at a time so Twilio never overlaps them
  let audioQueue = [];
  let playingAudio = false;

  async function playNext(ws, streamSid) {
    if (playingAudio || audioQueue.length === 0) return;
    playingAudio = true;
    const text = audioQueue.shift();
    await sendAudio(text, ws, streamSid);
    playingAudio = false;
    playNext(ws, streamSid);
  }

  function queueAudio(text, ws, streamSid) {
    audioQueue.push(text);
    playNext(ws, streamSid);
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
    endpointing: 500,
    utterance_end_ms: 1000,
    vad_events: true,
  });

  dg.on(LiveTranscriptionEvents.Open, () => console.log('[dg] connected'));
  dg.on(LiveTranscriptionEvents.Error, (e) => console.error('[dg] error', e));

  dg.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
    const isFinal = data.speech_final || data.is_final;
    if (!transcript || !isFinal) return;
    if (busy) {
      console.log('[skip] busy');
      return;
    }

    console.log('[user]', transcript);
    busy = true;

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

      // Stream to TTS sentence-by-sentence so the caller hears the start
      // of the reply immediately instead of after the whole response.
      stream.on('text', async (t) => {
        fullText += t;
        buffer += t;
        if (buffer.match(/[.!?]/) && buffer.trim().length > 15) {
          const toSend = buffer.trim();
          buffer = '';
          queueAudio(toSend, ws, streamSid);
        }
      });

      stream.on('finalMessage', async () => {
        console.log('[ai]', fullText);
        if (buffer.trim().length > 0) {
          queueAudio(buffer.trim(), ws, streamSid);
        }
        history.push({ role: 'assistant', content: fullText });
        busy = false;
      });

      stream.on('error', (e) => {
        console.error('[claude error]', e.message);
        busy = false;
      });

    } catch (e) {
      console.error('[error]', e.message);
      busy = false;
    }
  });

  // Twilio messages
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
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
    try { dg.finish(); } catch {}
  });
});

async function sendAudio(text, ws, streamSid) {
  if (!text || !streamSid || ws.readyState !== WebSocket.OPEN) return;
  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/speak?model=aura-2-asteria-en&encoding=mulaw&sample_rate=8000',
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

server.listen(PORT, () => console.log('[server] listening on port', PORT));
