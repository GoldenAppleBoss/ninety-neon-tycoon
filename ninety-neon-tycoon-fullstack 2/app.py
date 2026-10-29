"""Ninety Neon Tycoon API. Vercel discovers this FastAPI `app` automatically."""
import io
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Request, Response, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from PIL import Image, ImageOps, UnidentifiedImageError

from api.db import Account, LoginSession, SessionLocal, initialize_local_db, ROOT, IS_VERCEL
from api.security import (
    COOKIE_NAME, SESSION_SECONDS, hash_password, new_session_token,
    protect_mutation, secure_cookie, token_digest, validate_password,
    verify_password,
)

MAX_PHOTO_BYTES = 3 * 1024 * 1024
UPLOAD_DIR = ROOT / "data" / "avatars"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_local_db()
    if not IS_VERCEL:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Ninety Neon Tycoon Accounts", docs_url=None, redoc_url=None, lifespan=lifespan)


def db_session():
    if SessionLocal is None:
        raise HTTPException(503, "Set DATABASE_URL to Supabase Postgres in Vercel settings.")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SignupInput(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=32)
    password: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ProfileInput(BaseModel):
    display_name: str = Field(min_length=2, max_length=32)


def clean_name(name: str) -> str:
    value = " ".join(name.strip().split())
    if not 2 <= len(value) <= 32:
        raise HTTPException(422, "Player name must have 2–32 characters.")
    return value


def find_account(request: Request, db: Session) -> Account | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 150:
        return None
    existing = db.get(LoginSession, token_digest(token))
    if not existing or existing.expires_at <= int(time.time()):
        return None
    return db.get(Account, existing.account_id)


def require_account(request: Request, db: Session = Depends(db_session)) -> Account:
    account = find_account(request, db)
    if account is None:
        raise HTTPException(401, "Sign in to continue.")
    return account


def avatar_url(account: Account) -> str | None:
    if account.avatar_ref is None:
        return None
    if account.avatar_ref == "local":
        return f"/api/account/avatar/{account.id}?v={account.avatar_version}"
    if account.avatar_ref.startswith("supabase:"):
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        bucket = quote(os.environ.get("SUPABASE_AVATAR_BUCKET", "avatars"), safe="")
        key = quote(account.avatar_ref[9:], safe="/")
        return f"{base}/storage/v1/object/public/{bucket}/{key}?v={account.avatar_version}"
    return None


def profile(account: Account) -> dict:
    return {
        "id": account.id,
        "email": account.email,
        "display_name": account.display_name,
        "avatar_url": avatar_url(account),
    }


def attach_session(request: Request, response: Response, db: Session, account: Account):
    token = new_session_token()
    now = int(time.time())
    db.add(LoginSession(id=token_digest(token), account_id=account.id, created_at=now, expires_at=now + SESSION_SECONDS))
    db.commit()
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure_cookie(request), samesite="lax", max_age=SESSION_SECONDS, path="/")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(ROOT / "public" / "index.html", headers={"Cache-Control": "no-store"})


@app.post("/api/auth/signup", status_code=201)
def signup(body: SignupInput, request: Request, response: Response, db: Session = Depends(db_session)):
    protect_mutation(request)
    validate_password(body.password)
    email = str(body.email).lower()
    if db.scalar(select(Account.id).where(Account.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    account = Account(id=str(uuid.uuid4()), email=email, display_name=clean_name(body.display_name),
                      password_hash=hash_password(body.password), created_at=int(time.time()),
                      avatar_version=0, failed_attempts=0, locked_until=0)
    try:
        db.add(account)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists.")
    attach_session(request, response, db, account)
    return {"account": profile(account)}


@app.post("/api/auth/login")
def login(body: LoginInput, request: Request, response: Response, db: Session = Depends(db_session)):
    protect_mutation(request)
    account = db.scalar(select(Account).where(Account.email == str(body.email).lower()))
    now = int(time.time())
    if not account:
        # Spend time on the same algorithm even for unknown accounts.
        verify_password(DUMMY_HASH, body.password)
        raise HTTPException(401, "Incorrect email or password.")
    if account.locked_until and account.locked_until > now:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    if not verify_password(account.password_hash, body.password):
        account.failed_attempts += 1
        if account.failed_attempts >= 5:
            account.locked_until = now + 15 * 60
            account.failed_attempts = 0
        db.commit()
        raise HTTPException(401, "Incorrect email or password.")
    account.failed_attempts = 0
    account.locked_until = 0
    db.commit()
    attach_session(request, response, db, account)
    return {"account": profile(account)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(db_session)):
    protect_mutation(request)
    token = request.cookies.get(COOKIE_NAME)
    if token:
        db.execute(delete(LoginSession).where(LoginSession.id == token_digest(token)))
        db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def whoami(request: Request, db: Session = Depends(db_session)):
    account = require_account(request, db)
    return {"account": profile(account)}


@app.patch("/api/account")
def update_account(body: ProfileInput, request: Request, db: Session = Depends(db_session)):
    protect_mutation(request)
    account = require_account(request, db)
    account.display_name = clean_name(body.display_name)
    db.commit()
    return {"account": profile(account)}


def process_image(data: bytes) -> bytes:
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Image must be 3 MB or smaller.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise HTTPException(415, "Use a PNG, JPG, or WebP image.")
            image = ImageOps.exif_transpose(image)
            if image.width * image.height > 16_000_000:
                raise HTTPException(413, "Image dimensions are too large.")
            image.thumbnail((320, 320))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="WEBP", quality=82, method=6)
            return output.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise HTTPException(415, "This file is not a supported image.")


def save_avatar(account_id: str, image_bytes: bytes) -> str:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if base and key:
        bucket = os.environ.get("SUPABASE_AVATAR_BUCKET", "avatars")
        object_name = f"profile/{account_id}.webp"
        endpoint = f"{base}/storage/v1/object/{quote(bucket, safe='')}/{object_name}"
        with httpx.Client(timeout=20) as client:
            try:
                r = client.post(endpoint, headers={"apikey": key, "Authorization": f"Bearer {key}",
                    "Content-Type": "image/webp", "x-upsert": "true", "Cache-Control": "no-cache"}, content=image_bytes)
                r.raise_for_status()
            except httpx.HTTPError:
                raise HTTPException(502, "Photo storage failed. Please try again.")
        return "supabase:" + object_name
    if IS_VERCEL:
        raise HTTPException(503, "Configure Supabase Storage for profile pictures.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOAD_DIR / f"{account_id}.webp"
    temp = UPLOAD_DIR / f"{account_id}.{uuid.uuid4().hex}.tmp"
    temp.write_bytes(image_bytes)
    temp.replace(destination)
    return "local"


@app.post("/api/account/avatar")
async def upload_avatar(request: Request, image: UploadFile = File(...), db: Session = Depends(db_session)):
    protect_mutation(request)
    account = require_account(request, db)
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Use a PNG, JPG, or WebP image.")
    data = await image.read(MAX_PHOTO_BYTES + 1)
    converted = process_image(data)
    account.avatar_ref = save_avatar(account.id, converted)
    account.avatar_version += 1
    db.commit()
    return {"account": profile(account)}


@app.get("/api/account/avatar/{account_id}")
def get_local_avatar(account_id: str, request: Request, db: Session = Depends(db_session)):
    account = require_account(request, db)
    if account_id != account.id:
        raise HTTPException(403, "Not your avatar.")
    path = UPLOAD_DIR / f"{account_id}.webp"
    if not path.is_file():
        raise HTTPException(404, "Photo not found.")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


# Equalize login processing time for unknown users; built once per warm instance.
DUMMY_HASH = hash_password("NotARealAccount!123")

if not IS_VERCEL:
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=ROOT / "public", html=True), name="frontend")
