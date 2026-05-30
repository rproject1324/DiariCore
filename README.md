# DiariCore

**DiariCore** is a Progressive Web App (PWA) for mindful journaling. Users write private journal entries, tag their thoughts, and receive **machine learning–based emotion and sentiment analysis** to help them reflect on patterns in their wellbeing over time. The system combines secure account management, PostgreSQL storage, interactive insights charts, and personalized suggestions—without treating ML output as medical diagnosis.

---

## Key Features

- **Journal Entry Management:** Create, view, edit, and delete entries with title, body text, custom tags, photos, and entry date/time.
- **Custom Tags:** Build personalized tags with icons from a searchable library to categorize entries beyond defaults.
- **Emotion & Sentiment Analysis:** Fine-tuned **XLM-RoBERTa** classifier (5 classes: angry, anxious, happy, neutral, sad) with confidence scores, valence, and energy summaries.
- **Dashboard & Insights:** Weekly mood trends, emotion breakdown charts, tag-based correlations, and journaling consistency metrics.
- **Smart Suggestions:** Supportive messages and activity recommendations based on recent emotional patterns.
- **Secure Authentication:** Registration with privacy consent, email OTP (Brevo), password reset, optional TOTP two-factor authentication, and session-based login.
- **Progressive Web App (PWA):** Installable on desktop and mobile with offline draft support and optional push reminders (installed PWA).
- **Admin Tools:** System settings and operational controls for authorized administrators.

---

## Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), Bootstrap 5, Chart.js, Lottie animations
- **Backend:** Python 3, Flask, Gunicorn
- **Database:** PostgreSQL (Railway / AWS EC2 production), SQLite (local development)
- **Machine Learning:** Fine-tuned XLM-RoBERTa (ONNX), served via **Hugging Face Space** (see below)
- **Email:** Brevo API (OTP verification, password reset, 2FA recovery)
- **Deployment:** [Railway](https://diaricore.up.railway.app/) (managed), [AWS EC2](http://16.176.11.240/login.html) (self-managed)
- **Version Control:** GitHub

---

## How It Works

1. **Write & Save:** The user composes a journal entry in the web app. Tags and optional images are stored with the entry in PostgreSQL.
2. **Mood Inference:** On **Save & Analyze**, the Flask backend (`space_nlp.py`) sends the entry text to the **Hugging Face Space** inference API—not to a model loaded on Railway or EC2.
3. **ML Processing:** The Space loads the exported **ONNX** model from [sseia/diari-core-mood](https://huggingface.co/sseia/diari-core-mood) and returns emotion labels, sentiment, scores, and probability distributions.
4. **Storage & Analytics:** Results are saved in the `journal_entries` table and power the Entries list, Dashboard, Insights, and Smart Suggestions modules.
5. **Fallback:** If the Space is cold-starting or unreachable, a lightweight keyword fallback in `space_nlp.py` keeps the app responsive (less accurate than the trained model).

### Why Hugging Face (not on the web server)?

Railway and EC2 **free tiers** have limited RAM and CPU. Loading a ~1 GB PyTorch/ONNX model on the same instance as Gunicorn + PostgreSQL would cause slow deploys, out-of-memory crashes, and poor response times. The group therefore:

- **Trained** the model in **Google Colab** (`FinalProject_Resources/DiariCore_Model_Final_Cleaned.ipynb`)
- **Published** weights to [Hugging Face Hub — diari-core-mood](https://huggingface.co/sseia/diari-core-mood/tree/main) (`model.onnx`, `pytorch_model.bin`, tokenizer files)
- **Deployed** inference as a separate [HF Space — diaricore-inference](https://huggingface.co/spaces/sseia/diaricore-inference/tree/main) (FastAPI + ONNX Runtime)

The live web app stays lightweight; only HTTP calls to the Space are needed for ML at runtime.

| Resource | Link |
|----------|------|
| **Model (Hub)** | https://huggingface.co/sseia/diari-core-mood/tree/main |
| **Inference Space** | https://huggingface.co/spaces/sseia/diaricore-inference/tree/main |

---

## Installation Instructions

### Prerequisites

- Python 3.10+ (3.12 recommended)
- Git
- Optional: PostgreSQL if not using SQLite locally

### 1. Clone the repository

```bash
git clone https://github.com/0323-3621-cell/diaricore.git
cd diaricore
```

### 2. Create a virtual environment and install dependencies

**Windows (PowerShell):**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Linux / macOS:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure environment (optional for local dev)

For local development, SQLite is used automatically when `DATABASE_URL` is not set.

| Variable | Purpose |
|----------|---------|
| `DATABASE_PATH` | SQLite file path (default: `diaricore.local.db`) |
| `DATABASE_URL` | PostgreSQL connection string (production) |
| `SECRET_KEY` | Flask session secret (required in production) |
| `SPACE_URL` | HF Space URL (default: `https://sseia-diaricore-inference.hf.space`) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Email OTP (optional locally) |
| `HF_API_TOKEN` or `HF_TOKEN` | Voice transcription only (optional) |

See `LOCAL_DEV.md` and `ML_SETUP.md` for more detail.

### 4. Run locally

**One-command start (Windows):**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

**Or run directly:**

```powershell
$env:DATABASE_PATH = "diaricore.local.db"
python app.py
```

Open **http://127.0.0.1:5000** and verify **http://127.0.0.1:5000/api/health**.

Mood analysis uses the same hosted Hugging Face Space as production (internet required).

### Production deploy (summary)

- **Railway:** Connect repo, add PostgreSQL plugin, set env vars, start via `Procfile` (`gunicorn app:app -c gunicorn.conf.py`).
- **AWS EC2:** Install Python, PostgreSQL, Nginx; set `DATABASE_URL`, `SECRET_KEY`, `UPLOADS_DIR`, and Brevo keys; run under systemd.

---

## Project Members

- Tolentino, Lawrence Dave P.
- Tolentino, Cathlene A.
- Valenzuela, John Oliver R.

---

## Project Links

- **Live Deployment (Railway):** https://diaricore.up.railway.app/
- **Live Deployment (AWS EC2):** http://16.176.11.240/login.html
- **Project Presentation (Google Slides):** https://docs.google.com/presentation/d/1jjBY2dVFIcDi_pvSQWGnR9x67_0Z5t7hMupsNOQbkPk/edit?usp=sharing
- **ML Model (Hugging Face Hub):** https://huggingface.co/sseia/diari-core-mood/tree/main
- **ML Inference Space:** https://huggingface.co/spaces/sseia/diaricore-inference/tree/main
- **GitHub Repository:** https://github.com/0323-3621-cell/diaricore

---

## Project Structure (overview)

| Path | Description |
|------|-------------|
| `app.py` | Main Flask application and API routes |
| `db.py` | Database schema and queries (PostgreSQL / SQLite) |
| `space_nlp.py` | Mood analysis via Hugging Face Space |
| `hf_space/` | Source for the inference Space deployment |
| `FinalProject_Resources/` | Training notebook and dataset |
| `static/`, `templates/` | Frontend assets and HTML |
| `docs/` | Project documentation (ITST 303 / 304) |

---

*Created to help users journal mindfully and understand their emotional patterns through secure, data-driven reflection.*
