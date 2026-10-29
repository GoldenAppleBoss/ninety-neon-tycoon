"""Explicitly initialize account tables for local development or an empty Postgres DB."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.db import Base, engine

if engine is None:
    raise SystemExit("Set DATABASE_URL before initializing the Vercel database.")
Base.metadata.create_all(engine)
print("Account tables initialized.")
