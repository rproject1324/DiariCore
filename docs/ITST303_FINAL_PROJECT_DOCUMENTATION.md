# DiariCore — Intelligent Web-Based Journaling System with Emotion Analysis and PWA Support

**ITST 303 — Web and Database Integration**  
**Laguna State Polytechnic University — San Pablo City Campus**  
**2nd Semester, AY 2025–2026**

| | |
|---|---|
| **Project Title** | DiariCore: An Intelligent Web-Based Personal Journal with Emotion Classification, Insights Analytics, and Progressive Web Application Deployment |
| **Group Members** | *(Insert names — 3 members)* |
| **Year and Section** | 3WMAD-___ |
| **Date Submitted** | *(Insert date)* |
| **Live Deployment Links** | Railway: `https://diaricore.up.railway.app` *(verify current URL)* · EC2: `http://52.63.214.172` *(replace with current public IP if changed)* |
| **GitHub Repository** | https://github.com/0323-3621-cell/diaricore |

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Statement of the Problem](#2-statement-of-the-problem)
3. [Objectives of the Project](#3-objectives-of-the-project)
4. [Scope and Limitations](#4-scope-and-limitations)
5. [System Features and Functionalities](#5-system-features-and-functionalities)
6. [Database Design](#6-database-design)
7. [Machine Learning Methodology](#7-machine-learning-methodology)
8. [Dataset Description](#8-dataset-description)
9. [API or Library Integration](#9-api-or-library-integration)
10. [Deployment Process](#10-deployment-process)
11. [Technologies Used](#11-technologies-used)
12. [Conclusion and Recommendations](#12-conclusion-and-recommendations)
13. [Required Screenshots](#13-required-screenshots)

---

## 1. Project Overview

**DiariCore** is an intelligent, database-driven web application for **personal journaling** with **machine-learning-assisted emotion and sentiment analysis**, **analytics dashboards**, **secure authentication**, and **Progressive Web Application (PWA)** capabilities. Users create private accounts, write journal entries with optional tags and images, and receive automated mood labels (happy, sad, anxious, angry, neutral) plus reflection-oriented insights derived from their writing patterns.

The system was developed to address the need for a **dedicated journaling platform** that goes beyond generic note-taking apps by combining structured entry management, visual mood analytics, offline-tolerant mobile usage, and responsible handling of sensitive personal data—including **privacy consent at registration** aligned with the **Data Privacy Act of 2012 (RA 10173)**.

**Technical summary:** A **Python Flask** backend exposes JSON REST APIs; **PostgreSQL** stores users and journal data in production (**SQLite** for local development); mood inference is delivered through a **Hugging Face Space** (ONNX model) via HTTP; the frontend uses **HTML, CSS, and JavaScript** with **Chart.js** visualizations; deployment is demonstrated on **Railway** (PaaS) and **Amazon EC2** (self-managed Linux server with nginx and Gunicorn).

---

## 2. Statement of the Problem

Many individuals use informal tools—paper notebooks, generic notes apps, or social media—to record thoughts and feelings. These approaches often lack:

1. **Structured journaling** — titles, timestamps, tags, search, and month-based browsing in one place.
2. **Emotion-aware reflection** — automatic labeling and trends that help users see patterns without manual tagging every entry.
3. **Privacy-aware onboarding** — clear consent and secure account handling for highly personal content.
4. **Reliable mobile access** — installable, offline-tolerant behavior when connectivity is poor.
5. **Integrated analytics** — dashboards and insights that connect mood, keywords, and writing habits.

Without a unified system, users may struggle to maintain consistency, interpret their emotional patterns, or trust that their journal data is stored and protected appropriately. Healthcare or counseling use is **out of scope**; DiariCore supports **self-reflection and awareness**, not medical diagnosis.

---

## 3. Objectives of the Project

### General Objective

To design, develop, integrate, deploy, and document a fully functional **intelligent web-based journaling system** using **Python**, **database integration**, **machine learning**, **API integration**, and **cloud deployment**, demonstrating practical application of ITST 303 course outcomes.

### Specific Objectives

1. Develop a **web application** with registration, email OTP verification, login, logout, session management, and password hashing.
2. Implement **complete CRUD** for journal entries (create, read, update, delete) with tags, optional images, and datetime metadata.
3. Integrate a **machine learning emotion classifier** that labels journal text and stores predictions in the database.
4. Provide an **analytics dashboard** and **insights module** with charts and narrative summaries (stress/happiness triggers, keyword patterns).
5. Integrate **external APIs** (Hugging Face Space for mood, Brevo for email, Web Push/VAPID for notifications, optional Hugging Face speech API for voice entry).
6. Apply **data visualization** (line, pie, bar charts) for mood distribution and activity patterns.
7. Deploy the system **online** with a connected database and demonstrate accessibility via public URL (Railway and EC2).
8. Use **Git/GitHub** for version control and collaborative development.
9. Implement **role-based admin access** via configured admin email for system settings (e.g., Brevo configuration).
10. Support **PWA features** (manifest, service worker, offline drafts, installability) for mobile-class usage.

---

## 4. Scope and Limitations

### In Scope

| Area | Coverage |
|------|----------|
| **Users** | Students and individuals seeking private digital journaling |
| **Platform** | Web browser; installable PWA on supported devices |
| **Auth** | Register, OTP verify, login, logout, password reset, optional TOTP 2FA, admin panel |
| **Journal** | Text entries, titles, tags, images, mood/sentiment fields, list/filter/search |
| **ML** | Five-class emotion + sentiment; keyword fallback if API unavailable |
| **Analytics** | Dashboard charts, insights page, streak/reminder logic |
| **Database** | PostgreSQL (production), SQLite (local dev); multiple related tables |
| **Deployment** | Railway + AWS EC2 (nginx, Gunicorn, Postgres) |

### Limitations

1. **Not a medical or mental-health diagnostic tool** — mood labels are automated estimates for reflection only.
2. **Mood model dependency** — production inference relies on Hugging Face Space availability; cold starts may delay first prediction (fallback keywords used when needed).
3. **Email OTP** — requires valid Brevo API configuration; without it, OTP may appear only in server logs (development mode).
4. **Push notifications** — subject to browser/OS policies; most reliable in installed PWA over HTTPS.
5. **HTTPS on EC2 demo** — HTTP-by-IP deployment may limit secure cookies and some PWA features unless a domain and TLS are configured.
6. **Single-tenant journaling** — no social sharing or multi-user collaboration on entries.
7. **Dataset** — training data is project-specific; model performance may vary on informal or mixed-language text.

---

## 5. System Features and Functionalities

### 5.1 Authentication and Account Management

| Feature | Description |
|---------|-------------|
| **Registration** | Collects profile fields, password policy validation, privacy consent timestamp |
| **Email OTP** | 6-digit code via Brevo SMTP API; pending row in `pending_registrations` until verified |
| **Login / Logout** | Session-based auth; optional TOTP challenge after password |
| **Password reset** | Email code flow via `password_resets` table |
| **Profile** | Update name, avatar, UI theme/palette, email change challenges |
| **Admin** | Users with `DIARI_ADMIN_EMAIL` access `/admin` for system settings (e.g., Brevo keys) |

### 5.2 Journal Entry Module (CRUD)

| Operation | Implementation |
|-----------|----------------|
| **Create** | `POST /api/entries` — saves text, runs mood analysis, stores scores and `all_probs_json` |
| **Read** | `GET /api/entries`, `GET /api/entries/<id>`, sync endpoints for cross-device |
| **Update** | `PATCH /api/entries/<id>` — optional re-analyze on edit |
| **Delete** | `DELETE /api/entries/<id>` — removes row and cleans up upload files |
| **Extras** | Tags (`user_tags`), image upload (`POST /api/uploads/image`), word limit (`ENTRY_WORD_MAX`) |

### 5.3 Machine Learning and Analytics

| Feature | Description |
|---------|-------------|
| **Live analyze** | `POST /api/entries/analyze-text` — preview mood before save |
| **On save** | `space_nlp.analyze()` stores `emotion_label`, `sentiment_label`, scores, probability JSON |
| **Insights** | Template-based narratives for stress/happiness triggers from entry statistics |
| **Dashboard** | Mood charts, streaks, activity summaries (`dashboard.js`, Chart.js) |
| **Voice entry** | Optional speech-to-text via Hugging Face Inference API (`hf_speech.py`) |

### 5.4 PWA and Offline

| Feature | Description |
|---------|-------------|
| **Manifest** | `static/manifest.webmanifest` — icons, `start_url`, `scope` |
| **Service worker** | Caches app shell; coordinates with `diari-offline.js` |
| **Offline drafts** | IndexedDB queue; sync when online |
| **Web Push** | VAPID keys; subscription in `push_subscriptions`; scheduled reminders |

### 5.5 Security Controls

- Password hashing (Werkzeug / `db.py`)
- CSRF token on state-changing API calls (`auth_security.py`)
- Rate limiting on login, register, OTP, analyze, upload
- Input validation (`input_security.py`, `password_policy.py`)
- Content-Security-Policy headers (configurable)
- Parameterized SQL queries

---

## 6. Database Design

### 6.1 Database Management System

| Environment | DBMS | Connection |
|-------------|------|------------|
| **Production** (Railway, EC2) | **PostgreSQL** | `DATABASE_URL` environment variable |
| **Local development** | **SQLite** | `diaricore.db` / `diaricore.local.db` when `DATABASE_URL` unset |

**Python connectivity:** `psycopg2` (PostgreSQL), `sqlite3` (local), centralized in `db.py`.

### 6.2 Entity-Relationship Overview

```mermaid
erDiagram
    users ||--o{ journal_entries : writes
    users ||--o{ user_tags : defines
    users ||--o{ push_subscriptions : has
    users {
        int id PK
        string nickname UK
        string email UK
        string password_hash
        string first_name
        string last_name
        datetime created_at
        string privacy_agreed_at
        boolean totp_enabled
    }
    journal_entries {
        int id PK
        int user_id FK
        text title
        text text_content
        text tags_json
        string emotion_label
        float emotion_score
        string sentiment_label
        float sentiment_score
        text all_probs_json
        text image_urls_json
        datetime created_at
    }
    user_tags {
        int user_id PK_FK
        string tag PK
        string icon_name
    }
    pending_registrations {
        string email PK
        string otp_code
        datetime otp_expires_at
    }
    system_settings {
        string key PK
        string value
    }
```

### 6.3 Main Tables (Minimum ITST 303: 2+ related tables with CRUD)

| Table | Purpose |
|-------|---------|
| **users** | Registered accounts |
| **journal_entries** | Journal content + ML outputs (FK → `users.id`) |
| **user_tags** | Per-user tag dictionary (FK → `users.id`) |
| **pending_registrations** | Pre-verify signup + OTP |
| **password_resets** | Forgot-password codes |
| **push_subscriptions** | Web Push endpoints per user |
| **system_settings** | Admin-configurable keys (e.g., Brevo) |
| **login_totp_challenges** | 2FA login step |
| **Various challenge tables** | Password change, email change OTP |

### 6.4 Sample Queries (for screenshot / demo)

```sql
-- List users (admin demo — do not expose in production screenshots with real emails)
SELECT id, nickname, email, created_at FROM users ORDER BY id DESC LIMIT 10;

-- Recent journal entries with mood
SELECT id, user_id, LEFT(text_content, 60) AS preview,
       emotion_label, sentiment_label, created_at
FROM journal_entries ORDER BY id DESC LIMIT 10;

-- Entry count per emotion
SELECT emotion_label, COUNT(*) AS total
FROM journal_entries GROUP BY emotion_label ORDER BY total DESC;
```

**Screenshot placeholder:** Run the above in `psql`, pgAdmin, or Railway Postgres console — capture result grid.

---

## 7. Machine Learning Methodology

### 7.1 Problem Type

**Multi-class text classification** — map journal text to one of five emotion labels:

`angry`, `anxious`, `happy`, `neutral`, `sad`

Derived **sentiment** (positive / negative / neutral) is computed from the predicted emotion for dashboard display.

### 7.2 Model Architecture

| Component | Detail |
|-----------|--------|
| **Base model** | XLM-RoBERTa–style sequence classifier (fine-tuned for DiariCore) |
| **Export format** | ONNX (`model.onnx`) hosted on Hugging Face Hub: `sseia/diari-core-mood` |
| **Inference service** | Hugging Face Space: `sseia/diaricore-inference` (`hf_space/app.py`) |
| **Production call** | `space_nlp.py` → `POST {SPACE_URL}/predict` with JSON `{"text": "..."}` |
| **Timeout / fallback** | 90s HTTP timeout; keyword heuristic if Space errors or cold start fails |

### 7.3 Processing Pipeline

1. **User submits journal text** (write entry or analyze preview).
2. **Server validates** length and authentication (`app.py`, `input_security.py`).
3. **`space_nlp.analyze(text)`** sends text to HF Space.
4. **Space tokenizes** input, runs ONNX session, applies calibration/keyword overrides (see `hf_space/app.py`).
5. **JSON response** returns `emotionLabel`, `emotionScore`, `sentimentLabel`, `sentimentScore`, `all_probs`, `engine`.
6. **Server persists** fields in `journal_entries` and returns serialized entry to client.
7. **Dashboard/insights** aggregate stored labels for charts and template narratives.

### 7.4 Training Workflow (Offline)

1. Prepare labeled dataset (see Section 8).
2. Fine-tune classifier in `FinalProject_Resources/DiariCore_Model_Final_Cleaned.ipynb`.
3. Export checkpoint to `pytorch_model.bin` → ONNX via export scripts.
4. Upload artifacts to Hugging Face Hub.
5. Deploy/update inference Space with `scripts/upload_space.py`.

**Note:** The web server does **not** load PyTorch/ONNX locally in production; only the Space does, keeping Railway/EC2 deployments lightweight.

---

## 8. Dataset Description

### 8.1 Source and Format

| Item | Detail |
|------|--------|
| **File** | `FinalProject_Resources/1500_dataset_expanded.xlsx` |
| **Approximate size** | ~1,500 labeled samples (expanded set for training experiments) |
| **Content** | Journal-like or emotion-labeled text samples used to train/validate the mood classifier |
| **Labels** | Mapped to five emotion classes used by the application |

### 8.2 Preprocessing (Typical Steps)

1. Load spreadsheet (pandas / openpyxl in training notebook).
2. Clean text — trim whitespace, handle empty rows, normalize labels to allowed set.
3. Train/validation split for fine-tuning.
4. Tokenization via Hugging Face tokenizer aligned with XLM-RoBERTa.
5. Export label map (`label_map.json`) for inference consistency.

### 8.3 Submission Note (ITST 303)

Submit with final deliverables:

- `1500_dataset_expanded.xlsx` (or CSV export)
- Reference to Hugging Face model repo for deployed weights
- Optional: training notebook `DiariCore_Model_Final_Cleaned.ipynb`

---

## 9. API or Library Integration

| Integration | Library / Service | Role in DiariCore |
|-------------|-------------------|-------------------|
| **Hugging Face Space** | `httpx` in `space_nlp.py` | Emotion/sentiment prediction |
| **Hugging Face Hub** | `huggingface_hub` (Space deploy) | Model/tokenizer download on Space |
| **Brevo (Sendinblue)** | `urllib.request` → `api.brevo.com` | Registration OTP, password reset, notifications |
| **Web Push (VAPID)** | `pywebpush`, `py-vapid` | PWA push notifications |
| **TOTP 2FA** | `pyotp`, `segno` | Authenticator QR and verification |
| **Speech (optional)** | `hf_speech.py` + HF Inference API | Voice-to-text for journal entry |
| **Charts** | Chart.js (frontend) | Dashboard and insights visualizations |
| **Security** | Werkzeug, custom `auth_security.py` | Sessions, CSRF, rate limits |

### Example: Mood API Request Flow

```
Client → POST /api/entries/analyze-text
       → app.py → space_nlp.analyze()
       → POST https://sseia-diaricore-inference.hf.space/predict
       → JSON mood result → client UI (mood badges, scores)
```

---

## 10. Deployment Process

### 10.1 Railway (Primary PaaS)

| Step | Action |
|------|--------|
| 1 | Connect GitHub repo `0323-3621-cell/diaricore` |
| 2 | Add **PostgreSQL** plugin → `DATABASE_URL` injected |
| 3 | Set variables: `SECRET_KEY`, `BREVO_*`, `VAPID_*`, `DIARI_ADMIN_EMAIL`, `SPACE_URL`, `UPLOADS_DIR` (volume path) |
| 4 | Deploy via `Procfile`: `web: gunicorn app:app -c gunicorn.conf.py` |
| 5 | Verify `https://diaricore.up.railway.app` |

### 10.2 AWS EC2 (Course / Cloud Computing Demo)

| Step | Action |
|------|--------|
| 1 | Launch **Ubuntu 22.04/24.04** `t3.micro`, security group: **22, 80, 443** |
| 2 | Install Python, nginx, git, PostgreSQL |
| 3 | `git clone` → venv → `pip install -r requirements.txt` |
| 4 | Create Postgres DB/user; configure `/etc/diaricore.env` |
| 5 | `mkdir` + `chown` `/var/lib/diaricore/uploads` |
| 6 | `python -c "import db; db.init_db()"` |
| 7 | **systemd** unit for Gunicorn on port **8080** |
| 8 | **nginx** reverse proxy port **80** → `127.0.0.1:8080` |
| 9 | Public URL: `http://<EC2_PUBLIC_IP>/login.html` |

### 10.3 Hugging Face Space (ML Service)

Separate deploy from `hf_space/` using `scripts/upload_space.py` — hosts ONNX inference independent of Railway/EC2 web tier.

---

## 11. Technologies Used

| Layer | Technologies |
|-------|----------------|
| **Backend** | Python 3.12, Flask 3, Gunicorn |
| **Database** | PostgreSQL, SQLite, psycopg2 |
| **Frontend** | HTML5, CSS3, JavaScript (vanilla), Bootstrap Icons, Lottie |
| **ML** | Fine-tuned XLM-RoBERTa, ONNX Runtime (on HF Space), custom training notebook |
| **APIs** | Hugging Face Space, Brevo SMTP API, Web Push VAPID, HF Inference (speech) |
| **PWA** | Web App Manifest, Service Worker, IndexedDB offline queue |
| **DevOps** | Git, GitHub, Railway, AWS EC2, nginx, systemd |
| **Security** | Werkzeug password hashing, CSRF tokens, rate limiting, CSP |

---

## 12. Conclusion and Recommendations

### Conclusion

DiariCore successfully demonstrates an **intelligent web-based system** that satisfies ITST 303 requirements: **Python web development**, **relational database integration with CRUD**, **machine learning–driven emotion classification**, **API and library integration**, **data visualization**, **authentication**, and **online deployment**. The architecture separates concerns by hosting heavy ML inference on **Hugging Face Space** while the Flask application focuses on security, data persistence, and user experience—including **PWA** and **offline** support appropriate for mobile journaling.

### Recommendations

1. **Enable HTTPS** on EC2 (Let’s Encrypt + domain) for secure cookies, PWA install, and push reliability.
2. **Rotate and protect secrets** (never commit `BREVO_API_KEY`, `SECRET_KEY`, or VAPID keys to public repos).
3. **Monitor HF Space** cold starts; consider keeping the Space warm before demos.
4. **Expand dataset** with more Tagalog/English mixed journal samples to improve informal-text accuracy.
5. **Add automated tests** for API auth, CRUD, and `space_nlp` fallback paths.
6. **Document admin onboarding** on fresh deployments (env-based Brevo before first OTP).

---

## 13. Required Screenshots

For each item: **insert your screenshot**, then keep the caption text below it in the final PDF.

---

### 13.1 Login Page

**Insert screenshot:** `templates/login.html` — `http://<your-host>/login.html`

| | |
|---|---|
| **Functionality** | Authenticates registered users via email/username and password; supports optional TOTP step; redirects admins to `/admin` when email matches `DIARI_ADMIN_EMAIL`. |
| **Purpose** | Gate access to private journal data; establish secure server-side session. |
| **Expected output** | Valid credentials → success toast → redirect to `dashboard.html` (or `admin` for admin email). Invalid credentials → error message without revealing which field failed. |

---

### 13.2 Dashboard

**Insert screenshot:** `templates/dashboard.html` after login

| | |
|---|---|
| **Functionality** | Summary view: mood distribution charts, streak indicators, recent activity, quick navigation to write entry and entries list. |
| **Purpose** | Give users an at-a-glance view of journaling habits and emotional trends. |
| **Expected output** | Charts populate from `GET /api/entries` aggregated data; empty state if no entries yet. |

---

### 13.3 CRUD Modules

**Insert screenshots:** Write Entry, Entries list, Entry View/Edit, Delete confirmation

| Module | Functionality | Purpose | Expected output |
|--------|---------------|---------|-----------------|
| **Create** | `write-entry.html` + `POST /api/entries` | Add new journal with mood on save | Entry saved; mood label shown; appears in list |
| **Read** | `entries.html`, `entry-view.html` | Browse/filter/search entries | Cards/rows match DB records |
| **Update** | Edit on entry view + `PATCH /api/entries/<id>` | Modify text/tags/images | Updated content and optional re-analysis |
| **Delete** | Delete control + `DELETE /api/entries/<id>` | Remove entry | Entry removed from UI and database |

---

### 13.4 Database Records

**Insert screenshot:** PostgreSQL query result (Railway Data tab, pgAdmin, or EC2 `psql`)

Suggested query:

```sql
SELECT id, user_id, emotion_label, sentiment_label,
       LEFT(text_content, 50) AS preview, created_at
FROM journal_entries ORDER BY id DESC LIMIT 5;
```

| | |
|---|---|
| **Functionality** | Persistent storage of users, entries, and ML fields. |
| **Purpose** | Prove CRUD operations write to PostgreSQL, not only browser memory. |
| **Expected output** | Rows matching entries created in the UI demo. |

---

### 13.5 Prediction or Analytics Modules

**Insert screenshots:** Mood on write-entry (analyze preview); Insights page; analyze API/network tab optional

| | |
|---|---|
| **Functionality** | `space_nlp` / HF Space returns emotion probabilities; insights templates generate stress/happiness trigger text from entry stats. |
| **Purpose** | Satisfy ML integration requirement; support user self-reflection. |
| **Expected output** | Labels such as `happy`, `sad`, `anxious` with scores; insight cards reference frequent tags/keywords. |

---

### 13.6 API or Library Integration

**Insert screenshot:** Browser DevTools → Network → `analyze-text` or `predict`; OR Railway/HF Space settings; OR Brevo sent email

| Integration | What to show |
|-------------|--------------|
| **HF Space** | Request to `...hf.space/predict` with JSON response containing `emotionLabel` |
| **Brevo** | OTP email received OR server log `[OTP DEV MODE]` in controlled demo |
| **Web Push** | Browser permission prompt or test notification |

| | |
|---|---|
| **Functionality** | External services extend core Flask app without embedding ML weights on web server. |
| **Purpose** | Demonstrate API/library integration per course rubric. |
| **Expected output** | HTTP 200 responses; email delivered; push subscription stored in `push_subscriptions`. |

---

### 13.7 Data Visualization

**Insert screenshot:** Dashboard or Insights charts (pie/bar/line)

| | |
|---|---|
| **Functionality** | Chart.js renders mood distribution and related analytics (`chart-flow.js`, `dashboard.js`, `insights.js`). |
| **Purpose** | Visual interpretation of stored entry statistics. |
| **Expected output** | Charts update after new entries; axes/legends reflect emotion categories. |

---

### 13.8 Deployed System

**Insert screenshots:** (1) AWS EC2 Instances — Running; (2) Security group rules; (3) Browser on public IP/login; (4) Optional Railway dashboard

| | |
|---|---|
| **Functionality** | Production-like hosting accessible from the internet. |
| **Purpose** | Prove deployment requirement (online, DB connected, app functional). |
| **Expected output** | Instance **running**; ports **80/443** open; login page loads at public URL; CRUD works end-to-end. |

---

## Appendix A — Group Member Contributions *(optional)*

| Member | Contribution |
|--------|----------------|
| Member 1 | |
| Member 2 | |
| Member 3 | |

## Appendix B — Installation (Local)

```powershell
git clone https://github.com/0323-3621-cell/diaricore.git
cd diaricore
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
# Optional: set DATABASE_PATH=diaricore.local.db for SQLite
.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:5000/login.html`.

---

*End of ITST 303 Final Project Documentation — DiariCore*
