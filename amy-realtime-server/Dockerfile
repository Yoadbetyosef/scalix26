# Universal container for the Ask Amy realtime proxy (works on Railway, Fly, Render, etc.).
# This is the dashboard-only voice relay — separate from voice-server / the phone pipeline.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./
# The platform injects $PORT; the server binds to it. Health check: GET / -> 200 "ok".
EXPOSE 8081
CMD ["node", "server.js"]
