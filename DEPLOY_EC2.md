# Complete step-by-step Guide: Deploying DiariCore on AWS EC2 (Free Tier)

This document provides a comprehensive, click-by-click, and command-by-command guide to deploying the **DiariCore** Progressive Web App (PWA) on an Amazon Web Services (AWS) EC2 instance. It is written specifically to accommodate Windows users who are managing a cloud deployment.

---

## 1. Architecture Design

Before beginning, it is helpful to understand the target architecture on your EC2 server:

```mermaid
graph TD
    Client[Web Browser / Mobile PWA] -- HTTPS / Port 443 --> Nginx[Nginx Reverse Proxy]
    Client -- HTTP / Port 80 --> Nginx
    Nginx -- Redirect HTTP to HTTPS --> Nginx
    Nginx -- Dynamic Requests / Port 8080 --> Gunicorn[Gunicorn Web Server]
    Nginx -- Serve Static Files /static/* --> StaticFolder[/var/www/diaricore/static/]
    Nginx -- Serve Uploaded Images /static/img/uploads/* --> UploadsFolder[/var/lib/diaricore/uploads/]
    Gunicorn -- Local Connections --> Postgres[(PostgreSQL Database)]
    Gunicorn -- API requests --> HFSpace[Hugging Face Inference Space]
```

* **Gunicorn & systemd:** Gunicorn runs the Python Flask server on port `8080`. It runs under systemd, ensuring it starts automatically when the system boots and restarts if the app crashes.
* **Nginx:** Sits in front of Gunicorn, acting as the public face on port `80` (HTTP) and `443` (HTTPS). For maximum efficiency, Nginx bypasses Flask entirely when serving static files (CSS, JS, icons) and uploaded images.
* **PostgreSQL:** Running on the same EC2 instance, avoiding network overhead and ensuring the fastest possible database queries.
* **Hugging Face Space:** The heavy machine learning model is run on Hugging Face Spaces. This keeps the EC2 instance extremely lightweight and within AWS Free Tier limits (1 GB RAM).

---

## 2. Step-by-Step Instructions

### Step 2.1: Create and Launch the AWS EC2 Instance

1. Log in to your [AWS Management Console](https://aws.amazon.com/).
2. In the top search bar, type **EC2** and click the first service result.
3. In the upper-right corner of the EC2 Dashboard, ensure you are in a geographical region close to you or your target users (e.g., **Singapore** or **Tokyo** for Southeast Asia, or **N. Virginia** / **Ohio**).
4. In the middle of the dashboard, click the orange **Launch instance** button.
5. Configure the launch settings:
   * **Name and tags:** Type `diaricore-prod` in the **Name** field.
   * **Application and OS Images (Amazon Machine Image):**
     * Click the **Quick Start** tab.
     * Select **Ubuntu**.
     * In the **Amazon Machine Image (AMI)** dropdown, select **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** (Ensure the label says **Free tier eligible**).
     * Architecture: **64-bit (x86)**.
   * **Instance Type:**
     * In the dropdown, select **t2.micro** (or **t3.micro** if your chosen region has t3.micro designated as the Free Tier option). Confirm that it says **Free tier eligible** underneath.
   * **Key Pair (login):**
     * Click **Create new key pair**.
     * **Key pair name:** Type `diaricore-key`.
     * **Key pair type:** Select `RSA`.
     * **Private key file format:** Select `.pem` (for OpenSSH / Windows Terminal).
     * Click **Create key pair**. Your browser will automatically download the file `diaricore-key.pem`. **Save this file in a folder you can easily access, such as your user folder or project directory.**
   * **Network Settings:**
     * Under **Firewall (security groups)**, select **Create security group**.
     * **Security group name:** Type `diaricore-sg`.
     * **Description:** Type `Security group for DiariCore PWA`.
     * Configure **Inbound Security Group Rules**:
       * **Rule 1 (SSH):** Check **Allow SSH traffic from**. In the dropdown, select **Anywhere** (or **My IP** for maximum security).
       * **Rule 2 (HTTPS):** Check **Allow HTTPS traffic from the internet** (port 443).
       * **Rule 3 (HTTP):** Check **Allow HTTP traffic from the internet** (port 80).
   * **Configure Storage:**
     * Leave the default setup: `1 volume(s) of 8 GiB gp3` (Note: AWS Free Tier allows up to 30 GiB of SSD storage. If you expect a large volume of journal images, you can change this from `8` to `20` or `30`).
6. Click the orange **Launch instance** button in the Summary sidebar.
7. Once the success message displays, click **View all instances** at the bottom right.

---

### Step 2.2: Allocate and Associate an Elastic IP

By default, AWS changes the public IP address of your EC2 instance every time it is stopped and restarted. An **Elastic IP** provides a static public IP that never changes.

1. On the EC2 Console left-hand sidebar, scroll down to the **Network & Security** section.
2. Click on **Elastic IPs**.
3. Click the orange **Allocate Elastic IP address** button at the top right.
4. Leave all settings at their default values and click **Allocate** at the bottom.
5. In the list, check the box next to your newly created Elastic IP.
6. Click the **Actions** dropdown button at the top right and select **Associate Elastic IP address**.
7. Configure the association:
   * **Resource type:** Select **Instance**.
   * **Instance:** Click the search box and select your `diaricore-prod` instance from the list.
   * **Private IP address:** Click the search box and select the internal IP address that appears.
8. Click **Associate**.
9. In the summary table, copy the **Public IPv4 address** (e.g. `16.176.11.240`). This is your server's permanent public IP.

---

### Step 2.3: Set up a Domain Name (for HTTPS & PWA)

Browsers require an HTTPS connection for Progressive Web Apps (PWAs) to install or send push notifications. To get a free SSL certificate, you need a domain name pointing to your Elastic IP. 

We will use **DuckDNS**, a free dynamic DNS service:

1. Open a new browser tab and navigate to [DuckDNS](https://www.duckdns.org/).
2. Log in using one of the authentication options (GitHub, Google, etc.).
3. Under **domains**, type a unique subdomain name in the input box (for example: `diaricore-app`) and click **add domain**.
4. Once added, find your subdomain in the list below:
   * In the **ip** text field, clear the existing IP and paste your **EC2 Elastic IP** (e.g., `16.176.11.240`).
   * Click the **update ip** button next to it.
5. Your public domain is now `http://<your-subdomain>.duckdns.org` (e.g., `http://diaricore-app.duckdns.org`), which routes directly to your EC2 instance.

---

### Step 2.4: Connect to EC2 from Windows

Windows includes a built-in OpenSSH client in PowerShell. However, SSH keys must have strict file permissions, or the SSH client will reject them with an "unprotected private key file" error.

#### Fix Key Permissions on Windows (PowerShell):
1. Open Windows PowerShell.
2. Navigate to the folder where you saved `diaricore-key.pem` (e.g. your Downloads folder):
   ```powershell
   cd C:\Users\YourUsername\Downloads
   ```
3. Run the following commands to strip all permissions from the file except for your user account:
   ```powershell
   # Reset inherited permissions
   icacls.exe .\diaricore-key.pem /reset
   # Grant explicit read permission to the current user
   icacls.exe .\diaricore-key.pem /grant:r "$($env:USERNAME):(R)"
   # Disable permission inheritance
   icacls.exe .\diaricore-key.pem /inheritance:r
   ```

#### Establish the SSH Connection:
Once permissions are set, run this command to log in to your instance:
```powershell
ssh -i .\diaricore-key.pem ubuntu@YOUR_DUCKDNS_DOMAIN
# Example: ssh -i .\diaricore-key.pem ubuntu@diaricore-app.duckdns.org
```
When asked: `Are you sure you want to continue connecting (yes/no/[fingerprint])?`, type `yes` and press `Enter`. You are now logged in as the `ubuntu` user on your cloud server.

---

### Step 2.5: Install System Dependencies

Update the Ubuntu package index and install Python, virtual environments, Git, Nginx, PostgreSQL, and compile libraries:

```bash
# Update local packages
sudo apt update && sudo apt upgrade -y

# Install Python components, Git, Nginx web server, and PostgreSQL database server
sudo apt install -y python3-pip python3-venv git nginx postgresql postgresql-contrib libpq-dev
```

---

### Step 2.6: Configure the PostgreSQL Database

We will run a PostgreSQL server locally on the EC2 machine. This keeps database connections instantaneous.

1. Open the PostgreSQL command terminal under the system `postgres` administrator account:
   ```bash
   sudo -i -u postgres psql
   ```
   *Your terminal prompt will change to `postgres=#`.*

2. Run the following SQL queries to create the database and application user. **Replace `ChangeThisToASecurePassword!` with a strong password of your choice:**
   ```sql
   CREATE DATABASE diaricore;
   CREATE USER diariuser WITH PASSWORD 'ChangeThisToASecurePassword!';
   GRANT ALL PRIVILEGES ON DATABASE diaricore TO diariuser;
   ```

3. Connect to the new database to configure schema permissions:
   ```sql
   \c diaricore
   ```
   *Your prompt will change to `diaricore=#`.*

4. Grant permissions to the `public` schema (required for PostgreSQL version 15 and above):
   ```sql
   GRANT ALL ON SCHEMA public TO diariuser;
   ```

5. Exit the PostgreSQL command prompt:
   ```sql
   \q
   ```

6. Confirm that the new user can log in locally:
   ```bash
   psql -h localhost -U diariuser -d diaricore
   ```
   When prompted, enter your password. Once verified, type `\q` and press `Enter` to return to the Linux shell.

Your PostgreSQL connection string (`DATABASE_URL`) is:
`postgresql://diariuser:ChangeThisToASecurePassword!@localhost:5432/diaricore`

---

### Step 2.7: Clone and Set Up the Application Directory

1. Create a root directory for the application and transfer ownership to your user:
   ```bash
   sudo mkdir -p /var/www/diaricore
   sudo chown -R ubuntu:ubuntu /var/www/diaricore
   cd /var/www/diaricore
   ```

2. Clone your repository into this folder (use `.` at the end to clone directly into the current directory instead of nesting it in a subfolder):
   ```bash
   git clone https://github.com/0323-3621-cell/diaricore.git .
   ```

3. Create a python virtual environment to keep python packages isolated:
   ```bash
   python3 -m venv .venv
   ```

4. Activate the virtual environment:
   ```bash
   source .venv/bin/activate
   # Your command line will now display (.venv) at the front.
   ```

5. Install and update packages:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

6. Create a persistent folder to store uploaded user avatars and journal images:
   ```bash
   sudo mkdir -p /var/lib/diaricore/uploads
   sudo chown -R ubuntu:ubuntu /var/lib/diaricore/uploads
   ```

---

### Step 2.8: Create the Environment File

We will store our configurations in a central environment file located at `/etc/diaricore.env`. Only root and the application owner will have permissions to read it.

1. Open the file with the `nano` text editor:
   ```bash
   sudo nano /etc/diaricore.env
   ```

2. Copy and paste the configuration block below. Make sure to update the **placeholder variables** to match your database password, admin email, and VAPID keys:
   ```env
   FLASK_ENV=production
   PORT=8080
   DATABASE_URL=postgresql://diariuser:ChangeThisToASecurePassword!@localhost:5432/diaricore
   SECRET_KEY=OP6ykJC0BGQDTQg4C5D7ivc4krFnD8R49vPk0Dbv8pDaF-j1lQXDV-tYntlv4Mv
   DIARI_ADMIN_EMAIL=diaricore.admin@gmail.com
   HF_API_TOKEN=hf_n1qBz1BgrnfQzVFAz1OwBiMNJjhcUkVwjf
   HF_EMOTION_MODEL=sseia/diari-core-mood
   PUSH_CRON_SECRET=kESyZ3LVOZQuOwyARcpGi8GZcOJychMqXVwGy8Ew
   UPLOADS_DIR=/var/lib/diaricore/uploads
   VAPID_CLAIM_EMAIL=mailto:diaricore.admin@gmail.com
   VAPID_PRIVATE_KEY=MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgfkcLBfJxkKSe4EUhQ1lGh6l2DNXh5RF44Wve5NDyrAqhRANCAASscR/11oGHQTza7lH2W6keJn3VIpJuBgVpMyPPD67xoyrhq4XhhyCOYfftn7kJIR4lYh73nZ1zDPxG8gninq
   VAPID_PUBLIC_KEY=BHixX... (REPLACE WITH YOUR RAILWAY VAPID_PUBLIC_KEY)
   
   # Optional: Set Brevo API keys if email OTP is needed:
   # BREVO_API_KEY=xkeysib-yourkey...
   # BREVO_SENDER_EMAIL=your-verified-email@domain.com
   # BREVO_SENDER_NAME=DiariCore
   ```
   *Keyboard Navigation in nano:*
   * To paste in Windows Terminal / PowerShell, right-click inside the window or press `Ctrl + Shift + V`.
   * Press `Ctrl + O` then `Enter` to write the changes to disk.
   * Press `Ctrl + X` to exit the editor.

3. Secure the file permissions:
   ```bash
   sudo chmod 600 /etc/diaricore.env
   sudo chown ubuntu:ubuntu /etc/diaricore.env
   ```

---

### Step 2.9: Create the Systemd Service

Setting up a systemd service guarantees that the Flask app starts when the server boots and runs continuously in the background.

1. Open a new systemd configuration file:
   ```bash
   sudo nano /etc/systemd/system/diaricore.service
   ```

2. Paste the following configuration details:
   ```ini
   [Unit]
   Description=DiariCore Gunicorn Application Service
   After=network.target postgresql.service

   [Service]
   User=ubuntu
   WorkingDirectory=/var/www/diaricore
   EnvironmentFile=/etc/diaricore.env
   ExecStart=/var/www/diaricore/.venv/bin/gunicorn app:app -c gunicorn.conf.py
   Restart=always
   # Redirect logs to standard output
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=diaricore

   [Install]
   WantedBy=multi-user.target
   ```
3. Save and close the editor (`Ctrl + O`, `Enter`, `Ctrl + X`).

4. Reload systemd daemon to recognize the new configuration:
   ```bash
   sudo systemctl daemon-reload
   ```

5. Enable the service to start automatically during system boot:
   ```bash
   sudo systemctl enable diaricore
   ```

6. Start the web application:
   ```bash
   sudo systemctl start diaricore
   ```

7. Check if Gunicorn started successfully:
   ```bash
   sudo systemctl status diaricore
   ```
   *Verify that you see a green `active (running)` status. If it failed, proceed to the Troubleshooting section to check your logs.*

---

### Step 2.10: Configure Nginx as a Reverse Proxy

Nginx acts as the gatekeeper, listening for incoming public HTTP and HTTPS traffic and routing it internally.

1. Create a configuration block for Nginx:
   ```bash
   sudo nano /etc/nginx/sites-available/diaricore
   ```

2. Paste the block below, replacing `yourdomain.duckdns.org` with your actual DuckDNS subdomain (e.g. `diaricore-app.duckdns.org`):
   ```nginx
   server {
       listen 80;
       server_name yourdomain.duckdns.org;

       # Restrict maximum upload sizes for images (20MB)
       client_max_body_size 20M;

       # Route public dynamic requests to Gunicorn running on port 8080
       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # Serve CSS, Javascript, PWA manifest, and icons directly via Nginx
       location /static/ {
           alias /var/www/diaricore/static/;
           expires 30d;
           add_header Cache-Control "public, no-transform";
       }

       # Serve uploaded journal attachment files directly via Nginx
       location /static/img/uploads/ {
           alias /var/lib/diaricore/uploads/;
           expires 30d;
           add_header Cache-Control "public, no-transform";
       }
   }
   ```
3. Save and close the editor.

4. Enable the configuration by creating a symlink in Nginx's enabled sites folder:
   ```bash
   sudo ln -s /etc/nginx/sites-available/diaricore /etc/nginx/sites-enabled/
   ```

5. Remove Nginx's default placeholder site to prevent conflict:
   ```bash
   sudo rm -f /etc/nginx/sites-enabled/default
   ```

6. Test the syntax configuration of Nginx:
   ```bash
   sudo nginx -t
   ```
   *Ensure it says: `syntax is ok` and `test is successful`.*

7. Restart the Nginx web server:
   ```bash
   sudo systemctl restart nginx
   ```

---

### Step 2.11: Set up SSL Certificates for HTTPS (Certbot)

To secure user login credentials and enable PWA install features, you must secure the site using HTTPS. We will use Certbot to automatically fetch and configure a free SSL certificate from Let's Encrypt.

1. Install Certbot using the snap package manager (preinstalled on Ubuntu):
   ```bash
   sudo snap install core; sudo snap refresh core
   sudo snap install --classic certbot
   ```

2. Link Certbot command line tool to your system bin directory:
   ```bash
   sudo ln -s /snap/bin/certbot /usr/bin/certbot
   ```

3. Run Certbot. Certbot will examine your Nginx configs, contact Let's Encrypt, download matching certificates, and edit your Nginx configuration automatically:
   ```bash
   sudo certbot --nginx -d YOUR_DUCKDNS_DOMAIN
   # Example: sudo certbot --nginx -d diaricore-app.duckdns.org
   ```
4. Follow the interactive prompts in the terminal:
   * **Email address:** Enter your personal email (used for certificate expiration notices).
   * **Terms of Service:** Type `A` to agree.
   * **Share Email:** Type `Y` or `N` to opt-in or out of EFF emails.
5. Once complete, Certbot will update your site configuration and display a success message indicating your certificate has been deployed.
6. Verify that Certbot is set to automatically renew your certificates (Let's Encrypt certificates last 90 days):
   ```bash
   sudo certbot renew --dry-run
   ```

Your site is now fully deployed at `https://yourdomain.duckdns.org`! Open it in your web browser to test.

---

## 3. Daily Operations and Maintenance

### Pulling Updates from GitHub
Whenever you push changes to your GitHub main branch, run these commands to update your live EC2 app:
```bash
cd /var/www/diaricore
git pull
sudo systemctl restart diaricore
```

### Inspecting Application Logs
To monitor what your Flask application is doing, print database execution errors, or track scheduler notifications, check the systemd log stream:
```bash
# Print last 50 lines of logs and follow new messages live:
sudo journalctl -u diaricore.service -n 50 -f
```

---

## 4. Troubleshooting Guide

### Issue 4.1: Nginx Shows `502 Bad Gateway`
This means Nginx is running and listening, but it cannot connect to your backend Flask server.

1. **Verify if your Flask app is running:**
   ```bash
   sudo systemctl status diaricore
   ```
2. **If the service is stopped or failed, inspect its logs:**
   ```bash
   sudo journalctl -u diaricore.service -n 100 --no-pager
   ```
3. **Common causes:**
   * **Missing packages in virtual environment:** Activate the virtual environment manually and run `python app.py` to check for import errors.
   * **Incorrect Database URL:** Ensure PostgreSQL is running and the connection credentials match exactly in `/etc/diaricore.env`.
   * **Upload folder permission issue:** Ensure the directory `/var/lib/diaricore/uploads` exists and is owned by `ubuntu:ubuntu`.

---

### Issue 4.2: PostgreSQL Connection Failures
Error: `psycopg2.OperationalError: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL: password authentication failed for user`

1. **Verify PostgreSQL status:**
   ```bash
   sudo systemctl status postgresql
   ```
2. **Double check your password:** Log in to `psql` locally under the `diariuser` user to confirm the password:
   ```bash
   psql -h localhost -U diariuser -d diaricore
   ```
   If it fails, log back into the admin postgres terminal (`sudo -i -u postgres psql`) and reset the password:
   ```sql
   ALTER USER diariuser WITH PASSWORD 'NewPasswordHere!';
   ```
   Remember to update the password in `/etc/diaricore.env` and run `sudo systemctl restart diaricore`.

---

### Issue 4.3: Emotion Analysis is Unresponsive or Fails
Because your backend calls an external Hugging Face Space for sentiment analysis, failures here are typically related to API tokens or cold starts.

1. **Is the Hugging Face Space active?**
   Navigate to `https://huggingface.co/spaces/sseia/diaricore-inference`. If it shows "Paused" or "Sleeping", click the "Wake up" button. 
2. **Are your credentials configured correctly?**
   Verify that your Hugging Face token is correct. It should match the variable `HF_API_TOKEN` in `/etc/diaricore.env`.
3. **Inspect the logs:** Check the Flask response when an entry is saved:
   ```bash
   sudo journalctl -u diaricore.service -n 50 -f
   ```
   Look for log lines starting with `[space_nlp]` to see the exact error message returned by Hugging Face.
