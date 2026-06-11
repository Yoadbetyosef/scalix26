require('dotenv').config();
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const PORT = process.env.PORT || 8080;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (twilioWs) => {
  console.log('[call] new connection');

  let streamSid = null;
  let callSid = null;
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
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    const isFinal = data.is_final;

    if (!transcript || !isFinal) return;
    console.log('[transcript]', transcript);

    // Add to history
    conversationHistory.push({ role: 'user', content: transcript });

    // Get Claude response with streaming
    try {
      let fullResponse = '';

      const stream = await anthropic.messages.stream({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        system: systemPrompt,
        messages: conversationHistory.slice(-6),
      });

      // Buffer text and send to TTS in chunks
      let buffer = '';

      stream.on('text', async (text) => {
        buffer += text;
        fullResponse += text;

        // Send to TTS when we hit sentence boundary
        if (buffer.match(/[.!?]\s/) && buffer.length > 20) {
          await sendToTTS(buffer.trim(), twilioWs, streamSid);
          buffer = '';
        }
      });

      stream.on('finalMessage', async () => {
        if (buffer.trim()) {
          await sendToTTS(buffer.trim(), twilioWs, streamSid);
        }
        conversationHistory.push({ role: 'assistant', content: fullResponse });
      });

    } catch (err) {
      console.error('[claude]', err);
    }
  });

  dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[deepgram error]', err);
  });

  // Handle Twilio messages
  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'start':
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;

          // Get custom parameters if passed from Twilio
          const params = msg.start.customParameters || {};
          if (params.systemPrompt) systemPrompt = params.systemPrompt;

          console.log('[call] started', streamSid);
          break;

        case 'media':
          // Forward audio to Deepgram
          const audioBuffer = Buffer.from(msg.media.payload, 'base64');
          if (dgConnection.getReadyState() === 1) {
            dgConnection.send(audioBuffer);
          }
          break;

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
    const response = await deepgram.speak.request(
      { text },
      { model: 'aura-2-asteria-en', encoding: 'mulaw', sample_rate: 8000 }
    );

    const audioBuffer = await response.getBody();
    const chunks = [];

    for await (const chunk of audioBuffer) {
      chunks.push(chunk);
    }

    const audio = Buffer.concat(chunks).toString('base64');

    twilioWs.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: audio }
    }));

  } catch (err) {
    console.error('[tts error]', err);
  }
}

console.log(`[server] listening on port ${PORT}`);
