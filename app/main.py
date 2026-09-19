"""
Oikos AI backend — FastAPI + SQLAlchemy + SQLite.

Run locally:
    uvicorn app.main:app --reload

Interactive API docs then live at http://127.0.0.1:8000/docs
"""
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import Base, engine
from .routers import leads, messages, insights, dashboard, funnel, chat
from .seed import seed

# Load ANTHROPIC_API_KEY (and any other secrets) from a local .env file.
# No-op if the file doesn't exist — on Render/Vercel you set real
# environment variables instead, so this line has nothing to do there.
load_dotenv()

# Resolve relative to this file, not the process's working directory —
# relative paths like "templates/" break depending on where the server
# was launched from, which is unpredictable on serverless platforms.
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

app = FastAPI(
    title="Oikos AI API",
    description="Backend for the Oikos AI real-estate sales & marketing dashboard.",
    version="1.0.0",
)

Base.metadata.create_all(bind=engine)

# Allow the deployed frontend (and local dev servers) to call this API.
# Tighten this list to your real frontend origin(s) before going to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://real-estate-ares-258f.vercel.app",
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(leads.router)
app.include_router(messages.router)
app.include_router(insights.router)
app.include_router(funnel.router)
app.include_router(chat.router)
app.mount("/static", StaticFiles(directory=str(TEMPLATES_DIR)), name="static")

@app.on_event("startup")
def on_startup():
    # Seed with sample data matching the frontend's demo content, but only
    # if the DB is empty — safe to leave in for local/dev use.
    seed()


@app.get("/")
def root():
    return FileResponse(str(TEMPLATES_DIR / "index.html"))


@app.get("/api/health")
def health_check():
    return {"status": "ok"}