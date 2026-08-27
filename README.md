# AI Data Analyst Agent

A working slice of an "Enterprise Decision Intelligence Platform": upload a
dataset, get automatic ETL profiling, auto-generated charts, an AI agent you
can ask plain-English questions, one-click executive insights, and a simple
trend/forecast agent.

Built as a resume/portfolio project — small enough to fully understand and
defend in an interview, large enough to demonstrate real data engineering +
AI agent design skills.

## What's implemented

| Module | Status |
|---|---|
| Data upload (CSV) | ✅ client-side parsing (PapaParse) |
| Data profiling / ETL | ✅ type inference, missing-value detection, stats per column |
| Visualization agent | ✅ auto bar / line / pie charts based on detected column types |
| NL question-answering agent | ✅ AI reasons over a computed data summary (schema + stats + sample rows) |
| Executive insight agent | ✅ AI generates a bullet-point analyst summary from the same data summary |
| Trend / forecast agent | ✅ real linear regression computed in-browser, narrated by the AI |
| Backend | ✅ minimal Express proxy — keeps the Anthropic API key server-side |

## What's intentionally out of scope (v1)

This does **not** include: a real SQL engine / database, multi-agent
orchestration (LangGraph/CrewAI), a vector DB / RAG knowledge base, document
OCR, auth & RBAC, report export (PDF/DOCX/PPTX), notifications, or
monitoring. Those are natural "what I'd build next" talking points:

- **Real NL→SQL**: swap the "data summary" approach for a FastAPI backend
  with PostgreSQL, where the agent generates and executes actual SQL against
  the uploaded data instead of reasoning over a summary.
- **RAG knowledge base**: add a vector DB (e.g. Qdrant) to let the agent
  answer questions across many uploaded documents, not just one dataset.
- **Auth & multi-user**: add JWT-based login and role-based access
  (Admin / Analyst / Viewer).

## Why it's built this way

The AI calls go through `server/index.js` rather than straight from the
browser to Anthropic's API. This is deliberate: calling a model API directly
from client-side code means shipping your API key to every visitor's
browser, which is a real security mistake worth knowing to avoid. The small
Express server here is the minimum shape of "backend that holds the secret
and the frontend never sees it."

## Project structure

```
ai-data-analyst/
├── index.html
├── vite.config.js          # proxies /api → the Express server in dev
├── package.json
├── src/
│   ├── main.jsx             # React entry point
│   └── App.jsx               # the whole app: upload, profiling, charts, agents
└── server/
    ├── index.js               # Express proxy to the Anthropic API
    └── .env.example
```

## Running it locally

Requires Node.js 18+.

1. Install dependencies:
   ```
   npm install
   ```
2. Set up your API key:
   ```
   cp server/.env.example server/.env
   # then edit server/.env and paste your key from https://console.anthropic.com/
   ```
3. Run both the frontend and backend together:
   ```
   npm run dev:full
   ```
   Or run them in two terminals:
   ```
   npm run server   # http://localhost:8787
   npm run dev      # http://localhost:5173
   ```
4. Open http://localhost:5173, click **Load sample data**, and try the
   "Ask the data" and "Executive insights" tabs.

Charts, upload, and profiling all work with **no API key** — only the three
AI-powered features (Ask, Insights, Trend narrative) need one.

## Tech stack

React 18 + Vite · Recharts · PapaParse · Express (thin API proxy) ·
Anthropic API (Claude)
