import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
# Tests use a throwaway local SQLite database, never a developer's real account data.
os.environ["DATABASE_URL"] = "sqlite:////tmp/ninety_neon_test_auth.db"
os.environ.pop("VERCEL", None)
