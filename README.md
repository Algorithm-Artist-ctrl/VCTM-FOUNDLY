# VCTM Foundly 🎓

A verified, secure, and production-ready Lost & Found platform designed for Vivekananda College of Technology and Management (VCTM).

---

## 🌟 Key Real-World Features

- **🔐 Verified Institutional Access**: Secure registration restricted to `@vctm.in` / `@vctm.edu` college email domains (configurable via environment variables).
- **📸 High-Resolution Photo Uploads**: Drag-and-drop image dropzone with client-side canvas optimization and responsive image rendering.
- **🔒 Ownership Verification Questions**: Post secret questions (e.g., lock screen wallpaper, case markings) to verify claim authenticity before revealing contact details.
- **🤝 Safe Connections & Contact Protection**: Direct emails and phone numbers remain private until the reporter reviews and accepts a claim request.
- **🔄 Complete Item Lifecycle**: Mark items as `Open` $\leftrightarrow$ `Resolved / Claimed`.
- **📊 My Reports Dashboard**: Dedicated center to manage posted reports, see incoming claim requests, and track handoffs.
- **🛡️ Rate Limiting & Security Hardening**: Built-in sliding-window rate limiter, secure session cookies, and security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- **👨‍💼 Campus Admin Console & CSV Export**: Real-time metrics overview, moderation controls, and 1-click CSV export for campus security and lost-and-found desks.

---

## 🚀 Running Locally

1. **Start the server**:
   ```bash
   python3 server.py
   ```
2. **Open in browser**:
   ```
   http://localhost:8000
   ```

---

## ⚙️ Environment Variables (Configurable for Cloud & Production)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the HTTP server to listen on. |
| `HOST` | `0.0.0.0` | Host interface binding. |
| `ALLOWED_DOMAINS` | `vctm.in,vctm.edu,gmail.com,foundly.test` | Comma-separated list of allowed email domains. Use `*` to allow all. |
| `DATABASE_PATH` | `foundly.db` | Path to the SQLite database file. |
| `ADMIN_EMAIL` | `admin@foundly.test` | Default admin email. |
| `ADMIN_PASSWORD` | `admin123` | Default admin password (change before public deployment). |

---

## ☁️ Cloud Deployment

### 1. Render (Recommended Free 24/7 Hosting)
- Build Command: *(leave empty)*
- Start Command: `python3 server.py`
- Environment: Python 3

### 2. Docker
```bash
docker build -t vctm-foundly .
docker run -d -p 8000:8000 --name foundly-app vctm-foundly
```

---

## 🔑 Default Accounts

- **Admin Account**: `admin@foundly.test` / `admin123`
- **Student Demo**: Register with any `@vctm.in` or `@gmail.com` email address.

