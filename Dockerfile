FROM node:20-bookworm-slim

# node-canvas için sistem bağımlılıkları
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev \
    build-essential python3 pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# prod bağımlılıklar
COPY package*.json ./
RUN npm ci --omit=dev

# uygulama kodu
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "server.js"]
