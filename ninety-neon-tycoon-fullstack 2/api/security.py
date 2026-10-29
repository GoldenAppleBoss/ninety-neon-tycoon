"""Password validation, session secrets and browser request checks."""
import hashlib
import secrets
from urllib.parse import urlparse

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import HTTPException, Request

PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
COOKIE_NAME = "nn_session"
SESSION_SECONDS = 60 * 60 * 24 * 7


def validate_password(password: str) -> None:
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        raise HTTPException(422, "Password must contain 8–128 characters.")
    if not any(c.isupper() for c in password):
        raise HTTPException(422, "Password needs at least one uppercase letter.")
    if not any(not c.isalnum() and not c.isspace() for c in password):
        raise HTTPException(422, "Password needs at least one special character.")


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(stored: str, supplied: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(stored, supplied)
    except (VerifyMismatchError, VerificationError, ValueError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def protect_mutation(request: Request) -> None:
    """Reject cross-origin browser writes, including cookie-backed form posts."""
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(403, "Cross-site request blocked.")
    origin = request.headers.get("origin")
    if origin:
        url = urlparse(origin)
        if url.netloc.lower() != request.headers.get("host", "").lower() or url.scheme not in {"https", "http"}:
            raise HTTPException(403, "Request origin not allowed.")


def secure_cookie(request: Request) -> bool:
    return bool(request.headers.get("x-forwarded-proto", "").lower() == "https" or request.url.scheme == "https" or __import__("os").environ.get("VERCEL"))
