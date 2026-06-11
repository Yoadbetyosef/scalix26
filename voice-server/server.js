require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const PORT = process.env.PORT || 8080;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Minimal HTTP server so Railway's health check gets a 200. The WebSocket
// server shares the same port — Twilio connects via the WSS upgrade.
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('voice-server ok');
});
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (twilioWs) => {
  console.log('[call] new connection');

  let streamSid = null;
  let callSid = null;
  let mediaFrames = 0;
  let conversationHistory = [];
  let systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT ||
    'You are a professional AI receptionist. Keep responses under 2 sentences. Be warm and fast.';

  // Deepgram STT connection
  const dgConnection = deepgram.listen.live({
    model: 'nova-3',
    language: 'en-US',
    smart_format: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    interim_results: true,
    utterance_end_ms: 1000,
    vad_events: true,
  });

  dgConnection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[deepgram] connected');
  });

  dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    console.log('[transcript raw]', JSON.stringify(data).substring(0, 200));
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    const isFinal = data.is_final;
    console.log('[transcript]', { transcript, isFinal });

    if (!transcript || !isFinal) return;

    console.log('[claude] sending to claude:', transcript);
    conversationHistory.push({ role: 'user', content: transcript });

    // Get Claude response with streaming
    try {
      let fullResponse = '';

      console.log('[claude] starting stream...');
      const stream = await anthropic.messages.stream({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        system: systemPrompt,
        messages: conversationHistory.slice(-6),
      });

      // Buffer text and send to TTS in chunks
      let buffer = '';

      stream.on('text', async (text) => {
        console.log('[claude text]', text);
        buffer += text;
        fullResponse += text;

        // Send to TTS when we hit sentence boundary
        if (buffer.match(/[.!?]\s/) && buffer.length > 20) {
          await sendToTTS(buffer.trim(), twilioWs, streamSid);
          buffer = '';
        }
      });

      stream.on('finalMessage', async () => {
        console.log('[claude] final message done');
        if (buffer.trim()) {
          await sendToTTS(buffer.trim(), twilioWs, streamSid);
        }
        conversationHistory.push({ role: 'assistant', content: fullResponse });
      });

      stream.on('error', (err) => {
        console.error('[claude stream error]', err);
      });

    } catch (err) {
      console.error('[claude error]', err.message);
    }
  });

  dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[deepgram stt error]', err);
  });

  dgConnection.on(LiveTranscriptionEvents.Warning, (warning) => {
    console.warn('[deepgram warning]', warning);
  });

  // Handle Twilio messages
  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'start': {
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;

          // Get custom parameters if passed from Twilio
          const params = msg.start.customParameters || {};
          if (params.systemPrompt) systemPrompt = params.systemPrompt;

          console.log('[call] started', streamSid);

          // Speak the greeting immediately so the caller hears the AI first
          // (otherwise both sides wait in silence — ring, then nothing).
          // Speak the greeting, but do NOT add it to conversationHistory —
          // Anthropic requires the messages array to start with a 'user' turn.
          const greeting = params.greeting || 'Hi! Thanks for calling. How can I help you today?';
          sendToTTS(greeting, twilioWs, streamSid);
          break;
        }

        case 'media': {
          // Forward audio to Deepgram
          const audioBuffer = Buffer.from(msg.media.payload, 'base64');
          mediaFrames++;
          // Throttled so it doesn't bury the [transcript] logs (Twilio sends ~50/s)
          if (mediaFrames === 1 || mediaFrames % 50 === 0) {
            console.log('[audio] received bytes:', audioBuffer.length, '| frame', mediaFrames, '| dg readyState', dgConnection.getReadyState());
          }
          if (dgConnection.getReadyState() === 1) {
            dgConnection.send(audioBuffer);
          }
          break;
        }

        case 'stop':
          console.log('[call] stopped');
          dgConnection.finish();
          break;
      }
    } catch (err) {
      console.error('[twilio msg error]', err);
    }
  });

  twilioWs.on('close', () => {
    console.log('[call] disconnected');
    dgConnection.finish();
  });
});

async function sendToTTS(text, twilioWs, streamSid) {
  if (!text || !streamSid || twilioWs.readyState !== WebSocket.OPEN) return;

  try {
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-asteria-en&encoding=mulaw&sample_rate=8000', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      console.error('[tts error] HTTP', response.status, await response.text());
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer).toString('base64');

    twilioWs.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: audio }
    }));

  } catch (err) {
    console.error('[tts error]', err.message);
  }
}

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
