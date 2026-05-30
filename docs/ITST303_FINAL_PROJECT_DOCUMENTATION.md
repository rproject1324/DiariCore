# DIARICORE: AN INTELLIGENT WEB-BASED PERSONAL JOURNAL WITH EMOTION CLASSIFICATION, INSIGHTS ANALYTICS, AND PROGRESSIVE WEB APPLICATION DEPLOYMENT

A Final Project presented to the  
Faculty of College of Computer Studies  
Laguna State Polytechnic University — San Pablo City Campus  

In Partial Fulfillment of the Requirements for the Degree  
**BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY**

*(Member 1 Name)*  
*(Member 2 Name)*  
*(Member 3 Name)*  

May 2026

---

## Project Overview

DiariCore: An Intelligent Web-Based Personal Journal with Emotion Classification, Insights Analytics, and Progressive Web Application Deployment is a web-based application designed to help users record their thoughts, organize journal entries, and understand emotional patterns in a more structured and meaningful way. The system allows users to create private accounts, write journal entries with optional tags and images, and receive machine-learning-assisted mood and sentiment labels based on the text they submit. These stored records serve as the basis for dashboard analytics, reflection-oriented insights, streak tracking, and optional push reminders.

The project was developed in response to the growing need for a dedicated journaling tool that supports mobile use, privacy-aware onboarding, and data-driven self-reflection. Many individuals already write notes on paper or in generic applications, but they may still have difficulty maintaining consistent entries, reviewing mood patterns over time, or understanding how recurring themes in their writing relate to how they feel. DiariCore addresses this concern by helping users not only store personal reflections, but also interpret them through emotion classification, visual summaries, and narrative insights generated from their own journal history.

The system uses a fine-tuned text classification model deployed on a Hugging Face Space to classify journal text into emotion categories such as happy, sad, anxious, angry, and neutral. The application is not intended to present basic text storage alone, but also to give users a clearer view of how their writing may reflect emotional tone over days and weeks. This is supported through dashboard charts, an insights module that highlights possible stress and happiness triggers, and keyword-linked reflection messages derived from entry statistics.

Another important feature of DiariCore is its Progressive Web Application support, which allows the system to behave more like a mobile application through installability, service worker caching, and offline-tolerant draft saving. Users may continue drafting entries when connectivity is limited and synchronize their data when the connection returns. The system also includes Web Push notification features designed to encourage consistent journaling through reminders such as daily reflection prompts and streak-related follow-ups.

Since the system handles personal and emotionally sensitive information, privacy and security are also important parts of the project. DiariCore includes secure authentication, password hashing, session management, CSRF protection on sensitive requests, email OTP verification, optional two-factor authentication, privacy consent at registration aligned with the Data Privacy Act of 2012 (RA 10173), and role-separated admin access for system configuration. Deployment is demonstrated on Railway as a managed platform and on Amazon Web Services EC2 as a self-managed cloud environment.

---

## Statement of the Problem

Personal journaling is a common habit for self-expression, stress relief, and reflection. However, many individuals do not have an organized digital system for recording their thoughts, tagging important themes, attaching memories, and reviewing emotional patterns in one place. Some rely on paper notebooks, generic notes applications, or social platforms that are not designed for private long-term journaling. While these methods remain useful, they may not always provide enough support for users who want structured entry management, mood awareness, and secure handling of sensitive content.

Although users may write regularly, they may still find it difficult to determine whether their emotional tone is improving, worsening, or connected to specific topics such as school, work, relationships, or health. Without a system that organizes entries and applies consistent mood labeling, users may have to interpret their patterns on their own. This can be challenging, especially for individuals who want visual summaries, search and filter tools, and reflection prompts based on their own writing history.

Students and young adults may also encounter challenges when trying to maintain journaling habits on mobile devices. Some applications do not support reliable offline use, installable app-like behavior, or reminder notifications that encourage consistency. When internet access is unstable, users may lose drafts or stop recording altogether, which reduces the usefulness of digital journaling over time.

Although journaling and mood-tracking applications already exist, many systems mainly focus on simple note storage or generic mood pickers without analyzing the actual journal text. Some may not include automated emotion classification, dashboard analytics, insights generation, privacy consent during registration, secure account recovery, administrative configuration, and cloud deployment in one integrated platform. This shows the need for a system that goes beyond basic recording and helps users understand their journal information in a clearer, more organized, and data-driven way while applying proper web, database, and machine learning integration practices required in ITST 303.

---

## Objectives of the Project

### General Objective

The general objective of this project is to develop an intelligent web-based personal journaling system that can analyze user-written journal text, store structured entry records in a relational database, and present mood-related analytics and insights to support self-reflection. The system aims to provide secure account management, complete journal CRUD operations, machine learning–based emotion classification, data visualization, API integration, Progressive Web Application features, and online deployment to demonstrate practical application of Python programming, web and database integration, and machine learning concepts.

### Specific Objectives

The project specifically aims to:

1. Design and develop a web-based application that allows users to create an account, verify their email through OTP, log in securely, manage their profile, and access journaling features through a responsive interface.

2. Develop a journal entry module that supports creating, reading, updating, and deleting entries with title, text content, datetime, custom tags, and optional image attachments.

3. Integrate machine learning to classify journal text into emotion and sentiment categories and store prediction results in the database for dashboard and insights use.

4. Implement a dashboard module that displays mood distribution, activity summaries, and streak-related information using graphical visualizations.

5. Develop an insights module that presents reflection-oriented summaries such as stress triggers, happiness triggers, and keyword-linked narratives based on stored entry data.

6. Integrate external APIs and libraries including a Hugging Face Space for mood inference, Brevo for transactional email, Web Push with VAPID for notifications, and optional Hugging Face speech services for voice entry.

7. Apply data visualization using Chart.js to present mood charts, trend views, and related analytics outputs on the dashboard and insights pages.

8. Implement secure and reliable data management through PostgreSQL in production, password hashing, session handling, CSRF protection, rate limiting, input validation, and admin-configurable system settings.

9. Develop offline-tolerant journaling behavior through a service worker, IndexedDB draft storage, and synchronization when connectivity is restored.

10. Deploy the system online using Railway and Amazon Web Services EC2, and maintain the source code in a GitHub repository with organized project structure and documentation.

11. Evaluate the system based on functionality, database integration, machine learning output, API connectivity, deployment accessibility, user interface usability, and security practices.

---

## Project Scope and Limitation

This project focuses on the development of DiariCore, an intelligent web-based personal journaling system with emotion analysis, analytics, Progressive Web Application support, and cloud deployment. The system is designed for students and individuals who want a private, account-based space to record daily thoughts and observe emotional patterns over time. It enables users to write journal entries, organize them with tags and optional images, and receive machine-generated mood labels and reflection summaries based on their own stored writing.

The features of the system include user account management, secure login and registration with email OTP verification, journal entry CRUD operations, mood and sentiment prediction, dashboard analytics, insights generation, profile and theme preferences, optional two-factor authentication, administrative settings, push notifications, offline draft support, and deployment on Railway and AWS EC2.

Journal management functionalities consist of entry creation, entry listing with search and filters, entry detail viewing, entry editing, and entry deletion. Users can assign custom tags, attach images, and save datetime information together with model-generated emotion labels, sentiment labels, confidence scores, and probability distributions. The entries module collects the text and metadata needed for analytics, insights, streak tracking, and cross-device synchronization.

The system uses machine learning to classify journal text into five emotion categories: angry, anxious, happy, neutral, and sad. The prediction is based on the journal content submitted by the user and is processed through a Hugging Face Space that serves an ONNX export of the project’s fine-tuned model. The application also derives sentiment labels for dashboard display. These outputs are presented as reflection and awareness results, not as professional psychological or medical diagnoses.

DiariCore provides insights that identify recurring themes related to stress and happiness based on the user’s stored entries. These insights use template-based narratives and keyword statistics to explain possible patterns in the user’s writing, such as topics that appear more often on difficult days or during positive entries. Using the user’s recorded data and stored model outputs, the system helps users understand how their journaling history may reflect emotional trends over time.

The Analytics Dashboard provides users with a visual representation of their mood distribution and journaling activity. It displays chart-based summaries that help users review their emotional patterns instead of depending only on raw text entries. The insights page complements this by presenting reflection cards and trigger-related summaries that support better self-monitoring and personal awareness.

The system can store uploaded images for journal entries in a persistent uploads directory on the server. Push notification features are included to remind users about journaling habits, streaks, and related prompts where supported by the browser and deployment environment. The cloud-based architecture uses PostgreSQL for production data storage, Flask and Gunicorn for backend processing, and nginx as a reverse proxy on EC2.

Security features include password hashing, secure session cookies, CSRF validation on sensitive POST requests, rate limiting, privacy consent recording, OTP-based verification, optional TOTP authentication, and admin-only access to system settings. The application also supports Progressive Web Application installation through a web manifest and service worker caching for improved mobile usability.

However, the proposed system has several limitations. DiariCore is not intended to replace professional counseling, clinical diagnosis, mental health treatment, or medical advice. Instead, it is designed as a supportive self-reflection tool that helps users organize personal writing and view automated mood estimates based on text analysis.

The system’s mood classification reliability depends on the availability of the hosted Hugging Face Space and the quality of the training dataset used during model development. If the Space is unavailable, sleeping, or experiencing a cold start delay, the application may temporarily use a simplified keyword-based fallback that is less accurate than the trained model. If users write very short, vague, or mixed-language entries not well represented in training data, prediction quality may be reduced.

The system does not directly connect to hospital systems, electronic medical records, or external counseling platforms. It is limited to private single-user journaling and does not support social sharing, collaborative editing, or public feeds between accounts.

Some features of the system may require a stable internet connection. These include email OTP delivery, Hugging Face mood inference, cloud database access, and synchronization of offline drafts after reconnecting. Although offline draft saving is included, full analysis, registration email verification, and first-time model inference generally require online access.

Email-based account verification depends on a properly configured Brevo API key and verified sender address. On fresh deployments without email configuration, verification may not reach end users unless environment variables are set before registration. Push notifications work most reliably when the application is installed as a Progressive Web Application over HTTPS. Basic EC2 demonstrations that use only HTTP on a public IP address may limit secure cookie behavior, install prompts, and some notification features.

Voice-to-text and other optional Hugging Face services may require separate API tokens and are subject to external service limits on free tiers. Administrative configuration stored in the database still depends on initial environment variable setup on new servers before the first administrator can complete registration and access the admin panel.

The project is designed to be completed within the given development period by focusing on the core features of secure journaling, database-driven CRUD operations, machine learning mood classification, analytics visualization, API integration, Progressive Web Application support, and online deployment rather than large-scale usability studies, formal clinical validation, or enterprise-level performance benchmarking.

---

## 5. System Features and Functionalities

### 5.1 User Account Management

DiariCore includes features that allow users to create an account, verify their email, log in or out, reset their password, and manage their profile information. The registration process collects basic profile details, validates password strength, records privacy consent, and stores pending registration data until the user enters a valid one-time password sent through email.

The system uses Brevo transactional email services for registration OTP delivery, password reset messages, and other account-related notifications. This ensures that only users with access to the registered email can complete verification or recovery processes. Login supports session-based authentication, and optional TOTP two-factor authentication may be required for accounts that enable it.

Admin and user access is separated through email-based role verification. When a user logs in with the email address configured as `DIARI_ADMIN_EMAIL`, the system grants access to the administrative page where settings such as Brevo credentials and notification preferences may be managed. This separation is important because the application stores personal journal content that should only be accessed by authenticated and authorized users.

### 5.2 Journal Entry Management (CRUD Module)

The journal entry module allows users to create, view, update, and delete personal journal records. Users may enter a title, body text, entry date and time, custom tags, and optional image attachments. When an entry is saved or re-analyzed, the system sends the text to the mood inference service and stores the returned emotion label, sentiment label, confidence scores, and probability distribution in the database.

The Create function is implemented through the write entry page and the `POST /api/entries` endpoint. The Read function is supported through the entries list, entry detail view, and related API retrieval routes that allow filtering by month, mood, tags, and search terms. The Update function allows users to edit existing entries and optionally request re-analysis of the modified text. The Delete function removes the entry from the database and cleans up associated uploaded image files when applicable.

This module is important because the user-entered records serve as the main data source for dashboard charts, insights generation, streak computation, and synchronization between devices. More complete and consistent journal entries improve the usefulness of the system’s analytics and reflection features.

### 5.3 Emotion and Sentiment Prediction

DiariCore includes a machine learning-based emotion classification feature. The mood model processes journal text and produces an emotion label together with a sentiment label and confidence-related scores. The purpose of this feature is to help users gain a structured understanding of the emotional tone expressed in their writing based on information stored in the database by the system.

The results generated by the system are not intended to serve as psychological diagnoses or replace professional evaluation. Instead, these results are designed to help users monitor personal writing patterns, increase awareness of emotional trends, and support reflective journaling. The application also provides a preview analysis option before saving an entry so users can see likely mood labels during writing.

When the Hugging Face Space is unavailable, the backend may use a keyword-based fallback so the application remains functional, although with reduced accuracy. Therefore, the identified limitations of the system remain consistent with its intended purpose as a supportive journaling and self-awareness tool.

### 5.4 Analytics Dashboard

The Analytics Dashboard provides a more visual way for users to understand their recorded journal information. It presents mood distribution, journaling activity, and streak-related summaries in an organized format. Chart.js is used to render visual outputs such as mood charts and related dashboard displays based on data retrieved from the backend.

This feature supports the project’s goal of helping users review their emotional patterns instead of depending only on individual text entries. It also helps make the system more understandable and useful for monitoring journaling habits over time.

### 5.5 Insights and Reflection Module

DiariCore does not only display mood labels on entries. It also includes an insights module that helps identify possible recurring themes in the user’s journal history. These themes may include stress-related triggers, happiness-related triggers, and keyword patterns extracted from entries associated with certain emotional tones.

This functionality is useful because users can learn about possible patterns in their writing by viewing them in context rather than reading entries one by one without summary. The insights module supports improved interpretation of stored records and continues the reflective purpose of the system.

### 5.6 Personalized Tags and Profile Preferences

The system allows users to define and reuse custom tags for organizing entries. Tags are stored in the database and associated with the user account so they can be applied consistently across multiple entries. The profile module also supports user preferences such as theme and palette selection, avatar display, and account-related settings.

These features improve organization and usability by allowing users to personalize the interface and classify entries according to their own journaling style.

### 5.7 Image Upload Support

DiariCore allows users to attach images to journal entries. Uploaded files are stored in a server-side uploads directory configured through the `UPLOADS_DIR` environment variable. The system validates file handling paths safely and stores image URLs in the entry record so images can be displayed in the entry list and detail views.

This feature helps users preserve visual memories together with written reflections while keeping media paths under application control.

### 5.8 Push Notifications

DiariCore includes Web Push notification features designed to support consistent journaling and reminder delivery in supported browsers and installed Progressive Web Applications. Users may subscribe to push notifications, and the system stores subscription data in the database for later dispatch.

Notifications may include journaling reminders, streak-related prompts, and insight-related follow-ups depending on configured templates and scheduler behavior. This feature supports the overall goal of helping users maintain a regular reflection habit.

### 5.9 Offline Drafts with Auto-Sync

The system offers the option to continue working on journal drafts even when internet connectivity is limited. Offline drafts are stored locally through IndexedDB and coordinated by the service worker and offline client scripts. When connectivity becomes available again, synchronized entries and related data can be updated through the backend API.

By including offline draft support, users can continue recording thoughts during intermittent or temporary loss of internet access. This feature supports the overall program goal of making journaling more accessible and practical on mobile devices.

### 5.10 Progressive Web Application Support

DiariCore is enhanced through Progressive Web Application features such as a web app manifest, service worker caching, installability, and standalone display behavior. These features allow the application to behave more like a mobile app while still being delivered through the web platform.

The manifest defines application name, icons, start URL, and scope, while the service worker supports caching and offline-related behavior. Together, these components improve mobile usability and support ITST 303 requirements related to modern web application delivery.

### 5.11 Security and Privacy Features

DiariCore includes several security measures for protecting sensitive user and journal information. Passwords are securely hashed using Werkzeug and are never stored in readable form. The system also includes OTP-based verification, CSRF protection on sensitive POST routes, rate limiting, session management, optional TOTP authentication, input validation, and parameterized database queries.

In production deployments behind HTTPS, secure session cookie settings may be enabled to reduce session-related risks. Privacy consent is recorded during registration to support responsible handling of personal data. Combined, these features demonstrate that the project is focused not only on functionality but also on the secure management of sensitive personal content.

---

## 6. Database Design

DiariCore uses a dual-database approach depending on the deployment environment. The system uses PostgreSQL in production through the `DATABASE_URL` environment variable on Railway and AWS EC2. For local development, the system may use SQLite when `DATABASE_URL` is not set. Database connectivity is handled in `db.py` using `psycopg2` for PostgreSQL and the built-in `sqlite3` module for local testing.

### 6.1 PostgreSQL Production Mode

When PostgreSQL is enabled, the system stores records in relational tables connected through foreign keys. The identified core tables are:

- users  
- pending_registrations  
- password_resets  
- journal_entries  
- user_tags  
- push_subscriptions  
- system_settings  
- login_totp_challenges  
- user_password_change_challenges  
- user_profile_email_change_challenges  
- login_totp_recovery_otps  

The `users` table stores account credentials and profile-related fields. The `journal_entries` table stores the main journal content together with model-generated emotion and sentiment fields. The relationship between users and journal entries supports one-to-many record ownership, which allows each account to maintain a private collection of entries.

### 6.2 SQLite Development Mode

When PostgreSQL is not configured, SQLite is used for local development and testing. The same table structure is created through `db.init_db()`, allowing developers to run the application locally without requiring a separate database server. This mode is useful for development and debugging but is not used as the primary production storage strategy.

### 6.3 Stored Data and Records

The database design supports the major modules of the system. It stores account records, pending registration data, password reset codes, journal entries, tags, push subscriptions, and administrative settings. These stored records are used not only for basic CRUD operations, but also for mood analytics, insights generation, notification dispatch, and security-related processes.

### 6.4 Data Protection in the Database

Sensitive account data such as password hashes are stored using secure hashing rather than plain text. Personal journal content is stored as text fields in `journal_entries`, while model outputs such as `emotion_label`, `sentiment_label`, `emotion_score`, `sentiment_score`, and `all_probs_json` are stored together with each entry so the system can display analytics without repeating inference unnecessarily.

The application uses parameterized SQL queries through `db.py` to reduce the risk of SQL injection. Session-based authentication limits access to user-owned entries, and admin-only routes are restricted to configured administrator accounts.

### 6.5 Sample Database Queries

The following queries may be used during documentation screenshots or system demonstration:

```sql
SELECT id, nickname, email, created_at FROM users ORDER BY id DESC LIMIT 10;

SELECT id, user_id, emotion_label, sentiment_label,
       LEFT(text_content, 50) AS preview, created_at
FROM journal_entries ORDER BY id DESC LIMIT 5;

SELECT emotion_label, COUNT(*) AS total
FROM journal_entries GROUP BY emotion_label ORDER BY total DESC;
```

---

## 7. Machine Learning Methodology

DiariCore uses a fine-tuned text classification model deployed as an ONNX artifact and served through a Hugging Face Space inference API. The production web application does not load the full model locally on Railway or EC2. Instead, it sends journal text to the hosted inference service and receives structured JSON output for storage and display.

The machine learning workflow begins when the user submits journal text for preview or saving. The Flask backend validates the request, calls `space_nlp.analyze(text)`, and sends an HTTP POST request to the configured `SPACE_URL`, typically the DiariCore inference Space. The Space tokenizes the input, runs ONNX inference, applies calibration and keyword-related logic where implemented, and returns emotion and sentiment results to the web application.

### 7.1 Problem Definition and Model Output

The mood module performs multi-class text classification over journal content. The model assigns one primary emotion label from the following classes:

- angry  
- anxious  
- happy  
- neutral  
- sad  

The system also derives a sentiment label such as positive, negative, or neutral for dashboard use. The response may include confidence scores and a probability distribution across emotion classes, which are stored in the `journal_entries` table for later analytics.

### 7.2 Feature Preparation and Inference

Unlike tabular health datasets that use engineered numerical features, DiariCore processes free-text journal entries directly. The inference service tokenizes the text using the model tokenizer associated with the fine-tuned XLM-RoBERTa-based classifier. The ONNX runtime then executes the exported model and returns the predicted class and related scores.

This approach is appropriate for the project because journaling is naturally text-based. The system’s main ML input is the entry content itself rather than a separate form of manually encoded lifestyle metrics.

### 7.3 Fallback Behavior

If the Hugging Face Space is unreachable, times out, or returns an invalid response, the backend uses a keyword-based fallback classifier in `space_nlp.py`. This fallback returns the same response structure so the frontend and database layer can continue operating. While useful for reliability, the fallback is less accurate than the trained model and should be described as a backup mechanism rather than the primary prediction method.

### 7.4 Use of Model Output in the Application

The prediction output is used in several parts of the system. During writing, the user may preview mood classification before saving an entry. During save or update, the labels and scores are stored in PostgreSQL. On the dashboard and insights pages, stored labels are aggregated to produce charts and reflection summaries. This shows that the machine learning component is integrated into the application workflow rather than displayed as a separate disconnected tool.

### 7.5 Training and Deployment Workflow

The model training process is performed offline using the project dataset and training notebook. After fine-tuning, model artifacts are exported and uploaded to Hugging Face Hub. The inference Space in `hf_space/` downloads the ONNX model and tokenizer as needed and serves predictions to the production web application. This separation keeps the main web deployment lightweight while still meeting the course requirement for machine learning integration.

---

## 8. Dataset Description

The foundation of the DiariCore mood classification component is a project-specific labeled dataset used to train and evaluate the emotion model. The dataset file used in development is `FinalProject_Resources/1500_dataset_expanded.xlsx`, which contains approximately 1,500 expanded text samples intended for emotion classification experiments related to journal-like writing.

Since the dataset was prepared for academic model development rather than collected from live DiariCore users, it helps support training experiments while reducing dependency on exposing real user journal content during model creation. The dataset includes text samples and corresponding emotion labels mapped to the classes used by the application.

The dataset includes journal-style or emotion-labeled textual content relevant to the emotional categories supported by the system. These samples provide the project with the labeled information needed to fine-tune the classifier, evaluate accuracy during development, and export a model artifact suitable for ONNX deployment.

For DiariCore, the dataset is used in developing the machine learning component of the system, particularly for emotion classification during journal entry analysis. The recorded labels help the model learn relationships between writing patterns and emotional categories. During training, the dataset is cleaned, tokenized, and split for model fitting and validation in the project notebook `FinalProject_Resources/DiariCore_Model_Final_Cleaned.ipynb`.

Typical preprocessing steps include removing empty rows, normalizing labels to the supported class set, tokenizing text using the Hugging Face tokenizer, and preparing tensors for fine-tuning. After training, label mappings and exported model files are uploaded to Hugging Face Hub for use by the inference Space.

---

## 9. API or Library Integration

DiariCore uses several external libraries and services that support its main functions in prediction, communication, visualization, storage, security, and Progressive Web Application behavior.

### 9.1 Hugging Face Space API for Mood Inference

The system uses a Hugging Face Space to perform emotion and sentiment inference on journal text. The backend module `space_nlp.py` sends a POST request to the Space endpoint such as `https://sseia-diaricore-inference.hf.space/predict` with JSON content containing the user’s text.

This integration allows the main Flask application to remain lightweight while still providing machine learning functionality in production. It also demonstrates API-based ML integration, which is appropriate for deployed systems with limited server resources.

### 9.2 Brevo Transactional Email API

The system uses Brevo transactional email services for different email-based functions. Based on the application implementation, these include:

- Registration verification OTP emails  
- Password reset OTP emails  
- Related account notification messages  

This integration supports account security and verification workflows required for responsible user onboarding.

### 9.3 Web Push and VAPID

DiariCore uses Web Push with VAPID keys through `pywebpush` and related client-side subscription logic. This allows the system to send reminder notifications to subscribed users in supported browsers and installed Progressive Web Applications without requiring a separate commercial push provider.

### 9.4 Chart.js for Data Visualization

Chart.js is used to display graphical outputs in the dashboard and insights sections of the system. Mood distribution and related chart data are prepared by the backend or client logic and rendered in the browser to help users understand their journaling patterns visually.

### 9.5 Flask, Gunicorn, and Database Libraries

The backend uses:

- Flask for routing and API handling  
- Gunicorn as the production WSGI server  
- psycopg2 for PostgreSQL connectivity  
- sqlite3 for local fallback development  
- Werkzeug for password hashing  
- httpx for external HTTP calls to the inference Space  

### 9.6 Security and Authentication Libraries

The system also uses:

- pyotp and segno for TOTP two-factor authentication  
- cryptography and py-vapid for push-related security  
- custom modules such as `auth_security.py`, `input_security.py`, and `password_policy.py`  

These libraries and modules support routing, forms, sessions, login control, database access, password handling, and environment-based configuration.

### 9.7 Optional Hugging Face Speech Integration

For voice-entry features, the application may use the Hugging Face Inference API through `hf_speech.py` to transcribe audio input into text before journal processing. This feature is optional and depends on environment configuration such as `HF_API_TOKEN` and `HF_SPEECH_MODEL`.

---

## 10. Deployment Process

The DiariCore application is deployed online using cloud-based hosting so users can access the system through a public URL with a connected database and functioning API integrations.

### 10.1 Railway Deployment

The group deployed DiariCore on Railway as the primary managed hosting environment. The GitHub repository is connected to the Railway web service, and the application is started using the Procfile command `gunicorn app:app -c gunicorn.conf.py`. A PostgreSQL plugin provides the `DATABASE_URL` environment variable automatically.

Important production environment variables include:

- SECRET_KEY  
- DATABASE_URL  
- BREVO_API_KEY  
- BREVO_SENDER_EMAIL  
- BREVO_SENDER_NAME  
- VAPID_PUBLIC_KEY  
- VAPID_PRIVATE_KEY  
- VAPID_CLAIM_EMAIL  
- PUSH_CRON_SECRET  
- DIARI_ADMIN_EMAIL  
- SPACE_URL  
- UPLOADS_DIR  

This deployment demonstrates Platform-as-a-Service hosting with database integration and external API configuration in a managed environment.

### 10.2 AWS EC2 Deployment

The system is also deployed on Amazon Web Services EC2 using an Ubuntu Server environment. In this setup, the group installs Python, nginx, Git, and PostgreSQL, clones the project repository, creates a virtual environment, installs dependencies from `requirements.txt`, and configures environment variables in `/etc/diaricore.env`.

The application runs under systemd as a Gunicorn service on port 8080, while nginx acts as a reverse proxy on port 80 and forwards public traffic to the backend. Persistent uploads are stored in `/var/lib/diaricore/uploads`, and PostgreSQL stores application records on the same server.

This deployment demonstrates self-managed cloud hosting, basic networking through security groups, backend service configuration, and public accessibility using the instance public IP address.

### 10.3 Hugging Face Space Deployment

The mood inference service is deployed separately as a Hugging Face Space using the files in `hf_space/`. This allows the ONNX model to run on Hugging Face infrastructure while the main DiariCore web application handles authentication, CRUD operations, analytics, and interface rendering.

---

## 11. Technologies Used

### Backend and Web Development

- Python  
- Flask  
- Gunicorn  
- Werkzeug  
- httpx  

### Database and Storage

- PostgreSQL  
- SQLite  
- psycopg2  

### Machine Learning and AI Integration

- Fine-tuned XLM-RoBERTa-based text classifier  
- ONNX Runtime on Hugging Face Space  
- Hugging Face Hub model hosting  
- Custom training notebook and project dataset  

### Frontend and Visualization

- HTML  
- CSS  
- JavaScript  
- Chart.js  
- Bootstrap Icons  
- Lottie animations  

### Progressive Web Application and Notifications

- Web App Manifest  
- Service Worker  
- IndexedDB  
- Web Push with VAPID  
- pywebpush  

### Email and External APIs

- Brevo Transactional Email API  
- Hugging Face Space API  
- Optional Hugging Face Inference API for speech transcription  

### Security and Privacy

- Password hashing through Werkzeug  
- OTP verification flows  
- CSRF protection  
- Rate limiting  
- Session management  
- Optional TOTP authentication  
- Role-based admin access  

### Deployment and Version Control

- Git  
- GitHub  
- Railway  
- Amazon Web Services EC2  
- nginx  
- systemd  

---

## 12. Conclusion and Recommendations

### Conclusion

DiariCore successfully demonstrates an intelligent web-based system that applies Python programming, relational database integration, machine learning–based text classification, API and library integration, data visualization, authentication, and online deployment. The system allows users to create secure accounts, manage journal entries through complete CRUD operations, receive mood and sentiment labels from journal text, and review analytics and insights that support personal reflection.

The project also demonstrates modern web application practices through Progressive Web Application support, offline draft handling, and push notification integration in supported environments. By deploying the same application on Railway and AWS EC2, the group showed that the system can operate in both managed and self-managed cloud contexts while using PostgreSQL for persistent storage and an external Hugging Face Space for inference.

Overall, DiariCore fulfills the intended outcomes of ITST 303 by combining web development, database design, machine learning integration, and deployment into one working platform focused on private journaling and emotional self-awareness.

### Recommendations

For future improvement, the group recommends enabling HTTPS on EC2 using a domain name and TLS certificate so secure cookies, PWA installation, and push notifications can function more reliably in production. The team also recommends expanding the training dataset with more natural journal samples, including mixed English and Tagalog entries, to improve real-world classification accuracy.

Additional recommendations include implementing automated tests for authentication, CRUD, and mood inference fallback behavior; monitoring Hugging Face Space cold starts before demonstrations; and rotating API keys regularly so sensitive credentials are not exposed in documentation or public repositories. Finally, future versions may explore richer analytics, exportable reflection reports, and stronger administrative monitoring tools while maintaining the system’s focus on privacy and non-clinical self-reflection.

---

## 13. System Screenshots

### Figure 1. Login Page

**[Insert screenshot here]**

Figure 1 shows the Login Page of DiariCore, where registered users can access their accounts by entering their email address or username and password. The page also provides options for signing up for a new account and recovering access through the forgot password feature. The interface is designed for mobile-friendly access and supports secure entry into the journaling system.

This page serves as the system’s main authentication interface, ensuring that only verified users can enter DiariCore and access their private journal entries, dashboard, insights, profile settings, and other protected features. When the configured administrator email is used, the system redirects the user to the admin page after successful login.

---

### Figure 2. Brevo Email API Integration for Registration OTP

**[Insert screenshot here]**

Figure 2 shows the Brevo Email API integration used in DiariCore for the account verification process. The first image may present the Verify Registration page, where the user is asked to enter the one-time password sent to the registered email address. The second image may show the actual email received by the user containing the generated OTP code for completing registration.

This integration helps support secure account creation by ensuring that only users with access to the registered email can activate their accounts. It also demonstrates how DiariCore uses an external email service to send system-generated verification messages as part of its authentication and security features.

---

### Figure 3. Dashboard Overview

**[Insert screenshot here]**

Figure 3 shows the Dashboard of DiariCore, which provides users with a clear view of their journaling activity and mood-related summaries. It may include mood distribution charts, streak information, recent activity indicators, and navigation to other modules such as Entries, Write Entry, and Insights.

This dashboard helps encourage consistent journaling while giving users a quick overview of their emotional patterns and engagement with the system.

---

### Figure 4. Dashboard Mood Visualization and Activity Summary

**[Insert screenshot here]**

Figure 4 shows the mood visualization and activity summary section of the DiariCore Dashboard. It presents chart-based summaries of the user’s stored emotion labels and related journaling statistics. This may include mood counts, recent trends, and visual indicators that help users understand how their recent entries are distributed across emotional categories.

The dashboard supports better self-monitoring by allowing users to review their emotional patterns visually instead of reading entries one by one.

---

### Figure 5. CRUD Module for Creating Journal Entries

**[Insert screenshot here]**

Figure 5 shows the Write Entry module of DiariCore, where users can create new journal records. The interface allows users to enter a title, body text, date and time, tags, and optional image attachments. The system may also display mood analysis results before or after saving the entry.

This module demonstrates the Create function of the system’s CRUD operations. By allowing users to save journal entries, DiariCore collects the text and metadata needed for analytics, emotion classification, insights generation, and database storage.

---

### Figure 6. CRUD Module for Reading and Managing Journal Entries

**[Insert screenshot here]**

Figure 6 shows the Entries page of DiariCore, where users can read, search, filter, and open existing journal records. Users may filter by month, mood, tags, or search terms to locate specific entries more easily.

This module demonstrates the Read function of the system’s CRUD operations and supports organized management of the user’s journaling history.

---

### Figure 7. CRUD Module for Updating and Viewing Entry Details

**[Insert screenshot here]**

Figure 7 shows the Entry View or Edit page of DiariCore, where users can open a selected entry, review its full content, and update or delete it if needed. The page may display the stored emotion label, sentiment label, tags, images, and entry date.

This module demonstrates the Update and Delete functions of the system’s CRUD operations and shows how analyzed mood results remain linked to each stored entry.

---

### Figure 8. Database Records

**[Insert screenshot here]**

Figure 8 shows database records stored in PostgreSQL for DiariCore. This may include query results from the `users` and `journal_entries` tables displayed in Railway, pgAdmin, or the EC2 terminal using `psql`.

This screenshot demonstrates that the system stores user and journal data persistently in a relational database and that CRUD operations performed in the interface are reflected in the database records.

---

### Figure 9. Prediction Module with Mood Analysis Output

**[Insert screenshot here]**

Figure 9 shows the Prediction Module of DiariCore during journal writing or entry analysis. It presents the emotion label, sentiment label, confidence-related information, and possibly the preview analysis results generated from the user’s text.

This feature demonstrates how the system uses machine learning to classify journal content and display the predicted emotional tone to the user before or after saving an entry.

---

### Figure 10. Insights and Analytics Module

**[Insert screenshot here]**

Figure 10 shows the Insights page or analytics section of DiariCore. It presents reflection summaries such as stress triggers, happiness triggers, and keyword-related insights derived from the user’s stored entries.

This module helps users understand possible patterns in their writing and supports the analytical and reflection goals of the system.

---

### Figure 11. API or Library Integration

**[Insert screenshot here]**

Figure 11 shows an API or library integration used by DiariCore. This may include a browser Network tab displaying a request to the Hugging Face Space prediction endpoint, a Brevo email verification message, or a push notification permission and test notification.

This screenshot demonstrates that the system depends on external services and libraries for machine learning inference, email communication, and notification delivery.

---

### Figure 12. Data Visualization Output

**[Insert screenshot here]**

Figure 12 shows the data visualization output of DiariCore using Chart.js. This may include a pie chart, bar chart, or line chart displayed on the dashboard or insights page to represent mood distribution or related statistics.

This feature supports the project requirement for graphical presentation of analyzed data and helps users interpret their journaling history more easily.

---

### Figure 13. Deployed System on Railway and AWS EC2

**[Insert screenshot here]**

Figure 13 shows the deployed DiariCore system accessible online. This may include the AWS EC2 Instances page showing a running instance, security group rules, the Railway deployment dashboard, and the application login page opened through a public URL.

This screenshot demonstrates that the project meets the deployment requirement of the course by making the system accessible online with a functioning interface and connected backend services.

---

*End of ITST 303 Final Project Documentation — DiariCore*
