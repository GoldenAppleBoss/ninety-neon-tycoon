"""Account-only relational storage: SQLite locally or Supabase Postgres on Vercel."""
import os
from pathlib import Path
from sqlalchemy import create_engine, String, Integer, BigInteger, ForeignKey, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parent.parent
LOCAL_DB = ROOT / "data" / "accounts.db"
DB_URL = os.environ.get("DATABASE_URL", f"sqlite:///{LOCAL_DB}")
IS_VERCEL = bool(os.environ.get("VERCEL"))
if IS_VERCEL and not os.environ.get("DATABASE_URL"):
    engine = None
    SessionLocal = None
else:
    options = {"pool_pre_ping": True}
    if DB_URL.startswith("sqlite"):
        LOCAL_DB.parent.mkdir(parents=True, exist_ok=True)
        options["connect_args"] = {"check_same_thread": False}
    elif DB_URL.startswith("postgresql"):
        options["poolclass"] = NullPool
        options["connect_args"] = {"prepare_threshold": None}
    engine = create_engine(DB_URL, **options)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)


def initialize_local_db():
    if engine is not None and not IS_VERCEL and DB_URL.startswith("sqlite"):
        Base.metadata.create_all(engine)
