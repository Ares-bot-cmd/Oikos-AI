# Oikos AI — Backend

FastAPI + SQLAlchemy + SQLite backend for the Oikos AI real-estate sales
& marketing dashboard (the frontend deployed at
`real-estate-ares-258f.vercel.app`).

It models everything the frontend needs: leads, lead scoring, the
WhatsApp agent's conversation thread, AI insights, and the monthly
metrics that drive the dashboard KPIs, trend chart, and the marketing →
revenue funnel.

**The frontend is included** (`templates/index.html`) and is now wired to
call this API with `fetch()` instead of using hardcoded data — the whole
app (backend + frontend) runs from a single process.

## 1. Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Run

```bash
uvicorn app.main:app --reload
```

Then open **`http://127.0.0.1:8000/`** in a browser — that's the actual
dashboard, live-loading from the API. No separate frontend server needed.

- Frontend: `http://127.0.0.1:8000/`
- API base URL: `http://127.0.0.1:8000/api/...`
- Interactive API docs (Swagger): `http://127.0.0.1:8000/docs`

On first startup, `oikos_ai.db` (SQLite file) is created automatically
and seeded with sample data equivalent to the frontend's original demo
content — so every screen shows real, non-empty data immediately.
Seeding only runs once; delete `oikos_ai.db` to reset and reseed.

## 3. Endpoints

| Method | Path                              | Powers                          |
|--------|-----------------------------------|----------------------------------|
| GET    | `/api/dashboard`                  | KPI row, trend chart, pipeline table |
| GET    | `/api/leads`                      | Lead Scoring table (sorted hottest first) |
| POST   | `/api/leads`                      | Create a lead |
| GET    | `/api/leads/{id}`                 | Single lead |
| PATCH  | `/api/leads/{id}`                 | Update stage/status/score/etc. |
| DELETE | `/api/leads/{id}`                 | Remove a lead |
| GET    | `/api/leads/{id}/messages`        | WhatsApp Agent chat thread |
| POST   | `/api/leads/{id}/messages`        | Append a message to the thread |
| GET    | `/api/insights`                   | AI Insights cards |
| POST   | `/api/insights`                   | Add a new insight |
| GET    | `/api/funnel`                     | Marketing → Revenue funnel |
| GET    | `/api/health`                     | Health check |

## 4. Frontend ↔ backend wiring

`templates/index.html` is served directly by FastAPI (mounted at `/`) and
calls the API with same-origin relative paths (`/api/dashboard`,
`/api/leads`, etc.) — no CORS needed for this setup since it's one origin.

If you ever split the frontend back out to deploy separately (e.g. back
on Vercel) instead of serving it from FastAPI, point its `fetch()` calls
at the full backend URL and rely on the CORS config already in
`app/main.py`, which allows:
- `https://real-estate-ares-258f.vercel.app`
- `http://localhost:3000`, `http://localhost:5500`, `127.0.0.1:5500`

Add any other origins you use to the `allow_origins` list in `app/main.py`.

## 5. Deploying the backend

SQLite is great for local dev but is a single file on disk — it won't
persist reliably on most serverless platforms (including Vercel's
functions). For production:

- Deploy this FastAPI app to a host with persistent disk/always-on
  process (Render, Railway, Fly.io, a small VPS, etc.), or
- Swap SQLite for a hosted Postgres (change `SQLALCHEMY_DATABASE_URL` in
  `app/database.py` — everything else, models/routes/schemas, stays the same
  since SQLAlchemy abstracts the DB engine).

## 6. Project structure

```
backend/
├── app/
│   ├── main.py          # FastAPI app, CORS, router + static-file wiring
│   ├── database.py       # SQLAlchemy engine/session
│   ├── models.py         # ORM tables: Lead, Message, Insight, MonthlyMetric
│   ├── schemas.py         # Pydantic request/response models
│   ├── crud.py             # DB access helpers
│   ├── seed.py               # Sample data matching the frontend demo
│   └── routers/
│       ├── leads.py
│       ├── messages.py
│       ├── insights.py
│       ├── dashboard.py
│       └── funnel.py
├── templates/
│   └── index.html        # Frontend — fetches live data from /api/*
├── requirements.txt
└── README.md
```
