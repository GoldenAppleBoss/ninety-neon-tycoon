# Ninety Neon Tycoon — self-hosted edition

A complete 1990s city-life AP Macroeconomics game with Python accounts, private login sessions, and customizable profile photos. The original city decisions, map, 2–6 local pass-and-play gameplay, and light/dark mode are included.

## What's included

- `public/`: the browser game, login and account settings screens, styles, and character photo integration.
- `app.py`: the FastAPI server and account/photo endpoints.
- `api/`: SQLite/Postgres account models and Argon2 password/session security.
- `supabase_schema.sql`: a one-time Supabase Postgres setup script.
- `scripts/init_db.py`: optional Python database initializer.
- `tests/`: backend tests.
- `vercel.json`: security headers for deployment.

## Local setup (SQLite)

Install Python 3.11+ and run from this project folder:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

On Windows, activate with `.venv\Scripts\activate` instead. Open `http://127.0.0.1:8000`.

No `.env` is required for local testing. The server automatically creates `data/accounts.db` with SQLite. Photos are saved privately in `data/avatars/`. This folder is ignored by Git. Do not commit actual users' credentials or photos.

## Deploy on Vercel with Supabase

**Important:** Vercel serverless functions do not provide durable local SQLite storage. Use SQLite while developing locally, then use **Supabase Postgres**, which is PostgreSQL rather than SQLite, for accounts in production. The same SQLAlchemy models work with both databases. Profile photos go to a Supabase Storage bucket, not the account tables.

1. Create a new Supabase project. Open **SQL Editor** and run the contents of `supabase_schema.sql` once.
2. In **Storage**, create a bucket named `avatars` and make it **public**. Never use this bucket for passwords or private documents. The app writes only processed profile images.
3. In the Supabase database **Connect** panel, copy its **Transaction pooler** connection string. Use the form `postgresql+psycopg://...` and append `?sslmode=require`. URL-encode special characters in the database password. Don't guess the pooler hostname; copy it from Supabase.
4. Push this project folder to **your own GitHub repository** and import it into Vercel. Select the root of this folder as the project root. The `app.py` FastAPI entrypoint and `public/` assets are detected by Vercel.
5. In **Vercel → Project Settings → Environment Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction-pooler Postgres URL, with `postgresql+psycopg://` and `sslmode=require` |
   | `SUPABASE_URL` | Supabase project URL (such as `https://PROJECT.supabase.co`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **secret/service-role key** from API settings |
   | `SUPABASE_AVATAR_BUCKET` | `avatars` |

6. Deploy. The login screen is the main page. The account API runs at `/api/auth/...`.

**Keep the service-role key secret:** it belongs only in Vercel's backend environment variables. Never put it into HTML, browser JavaScript, Git, or a client-side environment variable. Keep the SQL tables outside of public anonymous Supabase access. The Python API uses the database and storage service key server-side.

## Account behavior

- New players must sign up before playing. Passwords must include **8 or more characters, one uppercase character, and one special character**. There is also a 128-character maximum.
- Passwords use salted **Argon2id** hashes, not plaintext or reversible encryption.
- The server sets a seven-day, HTTP-only, SameSite cookie. It uses `Secure` in HTTPS/Vercel environments. Only the SHA-256 hash of the random session token is stored in the database.
- Browser write requests are restricted to same-origin requests. Accounts temporarily lock for 15 minutes after five wrong passwords.
- The account settings button remains in the header on every game screen. It can update the display name, upload a photo, or sign out.
- Photos are checked and resized to WebP (up to 320×320). The uploaded photo replaces **Player 1's** map marker for the signed-in account. Players 2–6 remain pass-and-play guests with their normal icons. Game progress remains device-local, separated by account ID.
- The first page requires sign-in or sign-up. If the browser has a valid session, it opens the game automatically.

## Test

```bash
pip install pytest
pytest -q
```

## Notes before inviting players

- This is a **starter authentication system**, not a managed identity service. Before a large public launch, add verified-email sign-up, forgot-password/password reset, automated backups, logging/monitoring, and stronger IP-based rate limits or bot protection.
- The public avatar bucket means profile photos are publicly accessible to anyone who knows their URL. Don't upload sensitive images.
- The game itself is still local/pass-and-play, not real-time multiplayer across devices. Accounts let people independently sign in from their devices.
- HTTPS should be enabled in production. Vercel provides HTTPS for its deployments.

## Reference documentation

- [Deploy FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Supabase connection pooling](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Storage uploads](https://supabase.com/docs/reference/python/storage-from-upload)
