# Local Development (Web + DB)

Run the Flask app locally to save Railway credits. Mood analysis still uses the **hosted HF Space** (same as production).

## What runs locally

- **Web app:** `app.py` on `http://127.0.0.1:5000`
- **Database:** SQLite (`diaricore.local.db`) unless you set `DATABASE_URL`

## One-command start (Windows PowerShell)

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

## Optional arguments

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -WebPort 5000 -DatabasePath diaricore.local.db
```

## Environment notes

- `DATABASE_PATH=diaricore.local.db` when `DATABASE_URL` is unset (SQLite).
- `SPACE_URL` — override HF Space URL if needed (default in `space_nlp.py`).
- Voice: set `HF_API_TOKEN` or `HF_TOKEN` if you test speech-to-text.

## Quick verification

1. Open `http://127.0.0.1:5000/api/health`
2. Register / log in, save an entry, confirm mood labels appear (may take up to ~60s on Space cold start).

## Deployed behavior

- Railway / EC2: `gunicorn app:app`, Postgres via `DATABASE_URL`, no local model files in the repo.
