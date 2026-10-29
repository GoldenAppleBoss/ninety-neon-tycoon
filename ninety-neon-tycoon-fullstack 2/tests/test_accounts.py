import io
import uuid
from PIL import Image
from fastapi.testclient import TestClient
from app import app
from api.db import initialize_local_db

initialize_local_db()


def unique_email():
    return f"tester-{uuid.uuid4().hex}@example.com"


def photo_bytes():
    picture = Image.new("RGB", (80, 60), (78, 134, 160))
    content = io.BytesIO()
    picture.save(content, format="PNG")
    return content.getvalue()


def test_account_lifecycle_and_photo():
    with TestClient(app) as client:
        email = unique_email()
        weak = client.post("/api/auth/signup", json={"email": email, "display_name": "Vihaan", "password": "weakpass!"})
        assert weak.status_code == 422
        signup = client.post("/api/auth/signup", json={"email": email, "display_name": "Vihaan", "password": "StrongPass!9"})
        assert signup.status_code == 201, signup.text
        account = signup.json()["account"]
        assert account["display_name"] == "Vihaan"
        assert account["avatar_url"] is None
        assert "httponly" in signup.headers["set-cookie"].lower()
        assert client.get("/api/auth/me").json()["account"]["email"] == email

        edited = client.patch("/api/account", json={"display_name": "City Tycoon"})
        assert edited.status_code == 200
        assert edited.json()["account"]["display_name"] == "City Tycoon"

        uploaded = client.post("/api/account/avatar", files={"image": ("me.png", photo_bytes(), "image/png")})
        assert uploaded.status_code == 200, uploaded.text
        avatar_url = uploaded.json()["account"]["avatar_url"]
        assert avatar_url.startswith("/api/account/avatar/")
        photo = client.get(avatar_url)
        assert photo.status_code == 200
        assert photo.headers["content-type"].startswith("image/webp")
        assert Image.open(io.BytesIO(photo.content)).format == "WEBP"

        not_image = client.post("/api/account/avatar", files={"image": ("fake.png", b"not-an-image", "image/png")})
        assert not_image.status_code == 415

        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        signed_in = client.post("/api/auth/login", json={"email": email, "password": "StrongPass!9"})
        assert signed_in.status_code == 200
        assert signed_in.json()["account"]["avatar_url"] is not None


def test_duplicate_email_and_origin_protection():
    with TestClient(app) as client:
        email = unique_email()
        payload = {"email": email, "display_name": "Neon Player", "password": "ValidPass!1"}
        assert client.post("/api/auth/signup", json=payload).status_code == 201
        assert client.post("/api/auth/signup", json=payload).status_code == 409
        cross = client.patch("/api/account", json={"display_name": "Changed"}, headers={"Origin": "https://evil.example"})
        assert cross.status_code == 403


def test_login_lockout():
    with TestClient(app) as client:
        email = unique_email()
        client.post("/api/auth/signup", json={"email": email, "display_name": "Lockout", "password": "ValidPass!1"})
        client.post("/api/auth/logout")
        for _ in range(5):
            result = client.post("/api/auth/login", json={"email": email, "password": "WrongPass!1"})
            assert result.status_code == 401
        assert client.post("/api/auth/login", json={"email": email, "password": "ValidPass!1"}).status_code == 429
