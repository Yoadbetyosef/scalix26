# amy-realtime-server

Dashboard‑only realtime proxy for **"Talk to Amy live"**. The browser streams mic audio
here; this relays it to the **same Deepgram Voice Agent** the phone uses (streaming STT +
VAD endpointing + LLM + streaming TTS), holding the Deepgram key server‑side.

**Separate from `voice-server` / the customer phone pipeline — it changes nothing about
Twilio, booking, or call handling.**

## Run locally
```bash
cd amy-realtime-server
npm install
npm start            # listens on ws://localhost:8081
```
It reads `DEEPGRAM_API_KEY` from the repo root `../.env.local`.

Then run the Next app (`npm run dev` in the repo root) and open `/dashboard` →
**"Talk to Amy live"**.

## Config
- `AMY_REALTIME_PORT` (default `8081`)
- `DEEPGRAM_API_KEY` (from `../.env.local`)
- Browser side: `NEXT_PUBLIC_AMY_REALTIME_URL` (default `ws://localhost:8081`) — set to the
  deployed `wss://…` URL in production.

## Deploy (production)
Any host that runs a long‑lived Node WebSocket process (Render / Fly / Railway). Set
`DEEPGRAM_API_KEY` in that host's env, expose it over `wss://`, and point
`NEXT_PUBLIC_AMY_REALTIME_URL` at it. (Vercel serverless can't hold a WebSocket.)

> Note: add an auth check before exposing publicly (e.g. verify a short signed token from
> the authed dashboard) so it isn't an open relay to Deepgram.
