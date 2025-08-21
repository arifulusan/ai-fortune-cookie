# AI Fortune Cookie (EN/TR)

A tiny website that shows **one AI-generated fortune every 24h**, in **English** and **Turkish**.

- Pseudo-3D **mascot cookie** that cracks and disappears
- **24h countdown** until next fortune
- **Language switch** (top-left) — client-side only
- Backend: Node + Express + OpenAI Responses API. Optional Redis persistence
- Single write endpoint: `POST /api/fortune` (generate-or-return). Optional peek: `GET /api/fortune`

## Quick start

```bash
npm install
cp .env.example .env
# put your OpenAI API key in .env
npm start
# open http://localhost:3000
