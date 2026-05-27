DiariCore - Final Project Security Requirements Verification

Document purpose: Map capstone requirements (letters A–D) to what is implemented in DiariCore.
Rule: At least one bullet per letter is required; this document lists what the codebase supports.

Prepared for: DiariCore / DiariCore capstone team
Date: May 2026


================================================================================
A. REQUIRED SECURITY IMPLEMENTATIONS
================================================================================

Requirement: The system must implement at least one of:
  - Secure Login System
  - Role-Based Access Control
  - Password Hashing or Encryption
  - Session Management
  - Unauthorized Access Protection

What the team listed:
  - Secure login system
  - Password hashing or encryption
  - Session management (login/logout)

Verification: CONFIRMED  - all three are implemented, plus additional items.

Evidence in DiariCore:

1. Secure login system
   - Login API with server-side validation
   - Rate limiting on login and related endpoints (auth_security.py)
   - Optional TOTP two-factor authentication for sign-in
   - Email OTP verification during registration

2. Password hashing or encryption
   - Passwords are stored using Werkzeug password hashing (generate_password_hash and check_password_hash in db.py)
   - Plain-text passwords are not stored in the database
   - Password strength policy on registration and password reset (password_policy.py)

3. Session management (login/logout)
   - Flask server-side session stores user_id and CSRF token
   - POST /api/logout and admin logout clear the session
   - Protected pages and APIs require an authenticated session

Additional A items also implemented (useful for documentation):

4. Unauthorized access protection
   - APIs return 401 when the user is not signed in
   - State-changing requests (POST, PUT, PATCH, DELETE) require CSRF validation
   - Client uses diari-security.js for same-origin API calls with CSRF header

5. Role-based access control (basic)
   - Admin vs regular user: admin determined by configured admin email
   - Admin-only routes (e.g. admin settings, admin page) blocked for normal users

Verdict for letter A: Requirement met. Team can cite three or more bullets.


================================================================================
B. DATA SECURITY
================================================================================

Requirement: The system must include at least one of:
  - Secure Database Storage
  - Input Validation
  - SQL Injection Protection
  - Backup Feature
  - Secure Handling of Sensitive Data

What the team listed:
  - Input validation
  - SQL injection protection
  - Secure database storage (uncertain)

Verification: CONFIRMED for the three items above, with notes below.

Evidence in DiariCore:

1. Input validation
   - Server-side: registration, login, password policy, field checks in app.py
   - Client-side: angle-bracket stripping and field validation in diari-security.js and register.js

2. SQL injection protection
   - Database layer (db.py) uses parameterized queries (%s for PostgreSQL, ? for SQLite)
   - User input is not concatenated into raw SQL strings

3. Secure database storage
   - Passwords stored as hashes only
   - Production deployment uses PostgreSQL on Railway (environment-based connection)
   - Journal entries are linked to user_id with foreign key relationships
   - Describe in the report as: hashed credentials plus hosted database accessed only through the application

Do NOT claim without clarification:

  - Backup feature (in-app): The Profile page shows a backup button with simulated messaging only (profile.js). There is no full in-app database backup and restore feature. Railway platform backups may be mentioned only if the instructor accepts hosting-level backup, not the Profile UI button.

Verdict for letter B: Requirement met via input validation, SQL injection protection, and secure database storage (described correctly).


================================================================================
C. DATA PRIVACY
================================================================================

Requirement: The system must demonstrate at least one of:
  - Privacy Notice or Consent
  - Limited Data Collection
  - Data Confidentiality
  - User Access Restrictions
  - Proper Handling of Personal Information

What the team listed:
  - Privacy notice or consent (sign-up page)

Verification: CONFIRMED  - and additional C bullets are also supported.

Evidence in DiariCore:

1. Privacy notice or consent
   - Privacy consent modal on the registration page (register.html, register.js)
   - User must agree before registration proceeds
   - Server stores privacy_agreed_at on pending registration and on the final user record (app.py, db.py)

2. Limited data collection (additional)
   - Collects account fields and journal content needed for the application purpose
   - Not open-ended or unrelated data harvesting

3. Data confidentiality (additional)
   - HTTPS in production on Railway
   - Session-based authentication
   - password_hash is not returned in API user JSON responses

4. User access restrictions (additional)
   - Journal entries and APIs are scoped to the logged-in user_id
   - Example: delete and update use get_journal_entry_by_id(entry_id, user_id)

5. Proper handling of personal information (additional)
   - Consent timestamp stored, validation, secure transport and session  - document in capstone narrative

Verdict for letter C: Requirement met. Privacy notice plus stored consent timestamp; other C bullets available for depth.


================================================================================
D. INFORMATION ASSURANCE
================================================================================

Requirement: The system must demonstrate at least one of:
  - Activity or Audit Logs
  - Backup and Recovery Mechanism
  - Error Handling
  - Data Integrity Checking
  - Availability Measures

What the team listed:
  - Uncertain if any bullet was implemented

Verification: CONFIRMED  - at least one bullet is clearly implemented.

Recommended primary bullet for presentations and reports:

1. Error handling  - STRONGEST CHOICE
   - APIs return structured JSON (success: false with error messages)
   - Server uses try/except around database and network operations
   - Client shows notifications and alerts instead of failing silently

Optional additional D bullets:

2. Data integrity checking (partial)
   - syncRevision and /api/sync/check for cross-device sync
   - Entries scoped by user_id; CSRF on mutations

3. Availability measures (partial)
   - Application hosted on Railway
   - /api/health endpoint
   - PWA offline cache for reading cached data when offline

Weak or not recommended as primary app features:

  - Backup and recovery: No real in-app backup; Profile backup is UI simulation only
  - Activity or audit logs: No dedicated audit log table or user-facing audit UI

Verdict for letter D: Requirement met. Lead with error handling; optionally add data integrity or availability.


================================================================================
SUMMARY TABLE FOR CAPSTONE REPORT
================================================================================

Letter A  - Required security implementations
  Status: Met
  Suggested claims: Secure login, password hashing, session logout, CSRF, rate limits, optional TOTP, admin role

Letter B  - Data security
  Status: Met
  Suggested claims: Input validation, SQL injection protection, secure DB storage (hashed passwords, parameterized SQL, PostgreSQL on Railway)

Letter C  - Data privacy
  Status: Met
  Suggested claims: Privacy notice and consent, privacy_agreed_at, limited collection, confidentiality, per-user access

Letter D  - Information assurance
  Status: Met
  Suggested claims: Error handling (primary); optionally data integrity or availability


================================================================================
CORRECTIONS TO THE TEAM'S ORIGINAL LIST
================================================================================

1. Letter A: The team undersold the project. Also mention unauthorized access protection (auth plus CSRF) and basic role-based access (admin).

2. Letter B: Secure database storage is acceptable if explained as hashed passwords and controlled database access, not as a generic encrypted backup product.

3. Letter C: Sign-up consent is correct; privacy_agreed_at stored in the database strengthens the evidence.

4. Letter D: The project does cover letter D. Use error handling as the main bullet in the presentation.


================================================================================
END OF DOCUMENT
================================================================================
