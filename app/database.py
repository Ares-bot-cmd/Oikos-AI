"""
SQLAlchemy engine + session setup for SQLite.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Vercel's serverless functions have a read-only filesystem everywhere
# except /tmp (which is writable but ephemeral — wiped on cold start,
# redeploy, or when the instance recycles). Vercel sets the VERCEL env
# var automatically at build and runtime, so detect it and switch the
# DB location instead of trying to write into the read-only project dir.
if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/oikos_ai.db"
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "oikos_ai.db")

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False is needed only for SQLite, to allow FastAPI's
# threaded request handling to share the connection pool safely.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
