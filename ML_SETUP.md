# ML Setup — DiariCore

Production mood analysis does **not** run on Railway or EC2. The web app calls a **HuggingFace Space** over HTTP.

## Architecture

```
User saves entry
      │
      ▼
Railway / EC2 (app.py)
      │  space_nlp.analyze()
      ▼
HF Space (sseia/diaricore-inference)  ← ONNX on HF free CPU tier
      │
      ▼
emotionLabel, emotionScore, sentimentLabel, all_probs
```

If the Space is down or cold-starting, `space_nlp.py` uses a small keyword **fallback** (same API shape).

## Environment variables (web service)

| Variable     | Default / example                              | Required |
|-------------|-------------------------------------------------|----------|
| `SPACE_URL` | `https://sseia-diaricore-inference.hf.space`   | Optional |
| `DATABASE_URL` | Postgres on Railway / EC2                  | Yes (prod) |
| `SECRET_KEY`   | Flask session secret                         | Yes (prod) |

No `HF_API_TOKEN` is required on the web app for mood (the Space serves the model).

## HuggingFace Space (separate deploy)

Code lives in `hf_space/`. Upload or update:

```powershell
py scripts/upload_space.py
```

Space env (on HuggingFace): `HF_MODEL_ID`, optional `HF_TOKEN` if the Hub repo is private.

## Voice transcription (optional)

`hf_speech.py` uses the HuggingFace Inference API (`HF_SPEECH_MODEL`, `HF_API_TOKEN` / `HF_TOKEN`) from `app.py` voice routes — unrelated to the mood Space.

## Local development

Run only the web app (uses the same HF Space as production):

```powershell
.venv\Scripts\python.exe app.py
```

Or: `powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`

Set `DATABASE_PATH=diaricore.local.db` for SQLite, or `DATABASE_URL` for Postgres.

## Removed from repo (size)

Legacy local paths were removed: `model/pytorch_model.bin`, `model/onnx_export/`, `ml-service/`, `hf_nlp.py`, `onnx_nlp.py`, `ml_client.py`. They were not used by `app.py` at deploy time.
