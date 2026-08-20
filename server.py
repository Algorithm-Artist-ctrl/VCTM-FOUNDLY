"""VCTM Foundly - Enterprise Campus Lost & Found System.

Complete backend architecture:
- REST API with Smart Matching correlation algorithm
- Threaded in-app chat messenger & contact reveal
- SQLite database with automatic migrations & seeding
- Dual-mode authentication (Token + HTTP-Only Cookie)
- Rate limiting & security headers
- Zero-dependency reliability for 100% cloud uptime.
"""
import csv
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
DB_PATH = os.environ.get("DATABASE_PATH", str(ROOT / "foundly.db"))
PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")

raw_domains = os.environ.get("ALLOWED_DOMAINS", "vctm.in,vctm.edu,gmail.com,foundly.test")
COLLEGE_DOMAINS = [d.strip().lower() for d in raw_domains.split(",") if d.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@foundly.test").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ALLOW_ALL_DOMAINS = "*" in COLLEGE_DOMAINS or os.environ.get("ALLOW_ALL_DOMAINS", "").lower() in ("true", "1")

# In-memory rate limiting: 120 requests/minute per IP
RATE_LIMITS = defaultdict(list)
MAX_REQUESTS_PER_WINDOW = 120
RATE_WINDOW_SECONDS = 60


def check_rate_limit(ip_address: str) -> bool:
    now = time.time()
    RATE_LIMITS[ip_address] = [t for t in RATE_LIMITS[ip_address] if now - t < RATE_WINDOW_SECONDS]
    if len(RATE_LIMITS[ip_address]) >= MAX_REQUESTS_PER_WINDOW:
        return False
    RATE_LIMITS[ip_address].append(now)
    return True


# -------------------------------------------------------------
# DATABASE SCHEMA & MIGRATIONS
# -------------------------------------------------------------
def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def initialise_database():
    con = get_db()
    with con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                campus_role TEXT DEFAULT 'Student',
                phone TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                location TEXT NOT NULL,
                item_date TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL,
                status TEXT DEFAULT 'Open',
                image_data TEXT,
                proof_question TEXT,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES users(id),
                recipient_id INTEGER NOT NULL REFERENCES users(id),
                message TEXT NOT NULL,
                status TEXT DEFAULT 'Pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Migrations
        user_cols = [r[1] for r in con.execute("PRAGMA table_info(users)").fetchall()]
        if "phone" not in user_cols:
            con.execute("ALTER TABLE users ADD COLUMN phone TEXT")

        item_cols = [r[1] for r in con.execute("PRAGMA table_info(items)").fetchall()]
        if "status" not in item_cols:
            con.execute("ALTER TABLE items ADD COLUMN status TEXT DEFAULT 'Open'")
        if "image_data" not in item_cols:
            con.execute("ALTER TABLE items ADD COLUMN image_data TEXT")
        if "proof_question" not in item_cols:
            con.execute("ALTER TABLE items ADD COLUMN proof_question TEXT")

        # Seed Admin user
        admin = con.execute("SELECT * FROM users WHERE LOWER(email) = ?", (ADMIN_EMAIL,)).fetchone()
        if not admin:
            salt, digest = password_hash(ADMIN_PASSWORD)
            con.execute(
                "INSERT INTO users (name, email, password_salt, password_hash, role, campus_role, phone) VALUES (?, ?, ?, ?, 'admin', 'Administrator', '+91 9876543210')",
                ("VCTM Administrator", ADMIN_EMAIL, salt, digest),
            )
            admin_id = con.execute("SELECT id FROM users WHERE LOWER(email) = ?", (ADMIN_EMAIL,)).fetchone()["id"]
        else:
            admin_id = admin["id"]

        # Seed sample items if database is empty
        item_count = con.execute("SELECT COUNT(*) AS c FROM items").fetchone()["c"]
        if item_count == 0:
            samples = [
                ("Silver Dell Inspiron Laptop", "Electronics", "Engineering Block Lab 204", "2026-08-20", "15-inch silver laptop with Python sticker on back.", "Lost", "Open", "What is the lockscreen wallpaper?", admin_id),
                ("Dell Laptop in Black Sleeve", "Electronics", "Computer Lab 2nd Floor", "2026-08-20", "Found silver laptop inside a neoprene black sleeve.", "Found", "Open", "What brand is the charger?", admin_id),
                ("Brown Leather Titan Wallet", "Accessories", "Student Centre Cafeteria", "2026-08-20", "Contains college library card and ID.", "Lost", "Open", "What initials are embossed inside?", admin_id),
                ("Leather Wallet (Brown)", "Accessories", "Cafeteria Table 6", "2026-08-20", "Found brown gents wallet near water dispenser.", "Found", "Open", "Describe the card in front slot.", admin_id),
                ("Set of 3 Bike Keys", "Keys", "West Campus Parking", "2026-08-20", "Honda bike key with a yellow spiral keychain.", "Found", "Open", "What color is the rubber cap?", admin_id),
                ("Scientific Calculator Casio fx-991EX", "Electronics", "Mechanical Workshop", "2026-08-19", "Classwiz model with name written in marker.", "Lost", "Open", "What is written on the back cover?", admin_id),
                ("Engineering Drawing Book", "Books & stationery", "Room 102", "2026-08-19", "Contains isometric and orthographic sheets.", "Lost", "Resolved", "", admin_id),
            ]
            for s in samples:
                con.execute(
                    "INSERT INTO items (name, category, location, item_date, description, type, status, proof_question, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    s,
                )
    con.close()


# -------------------------------------------------------------
# PASSWORD & AUTH UTILITIES
# -------------------------------------------------------------
def password_hash(password: str, salt: Optional[bytes] = None):
    salt = salt or os.urandom(16)
    value = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return salt.hex(), value.hex()


def verify_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        _, calculated = password_hash(password, salt)
        return secrets.compare_digest(calculated, expected_hash_hex)
    except Exception:
        return False


def is_college_email(email: str) -> bool:
    if ALLOW_ALL_DOMAINS:
        return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email))
    email = email.lower().strip()
    return any(email.endswith("@" + domain) for domain in COLLEGE_DOMAINS)


# -------------------------------------------------------------
# SMART MATCHING CORRELATION ALGORITHM
# -------------------------------------------------------------
def extract_keywords(text: str):
    words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", text.lower())
    stop_words = {"the", "and", "for", "with", "item", "lost", "found", "room", "near", "hall", "lab", "block", "floor"}
    return set(w for w in words if w not in stop_words)


def calculate_match_score(lost_item: dict, found_item: dict):
    """Calculates match confidence percentage (50% - 98%) between a lost and found item."""
    score = 0
    matched_reasons = []

    # Category match (+45 points)
    if lost_item["category"] == found_item["category"] and lost_item["category"] != "Other":
        score += 45
        matched_reasons.append(f"Category: {lost_item['category']}")
    elif lost_item["category"] == found_item["category"]:
        score += 25

    # Title keyword overlap (up to +35 points)
    lost_title_words = extract_keywords(lost_item["name"])
    found_title_words = extract_keywords(found_item["name"])
    title_overlap = lost_title_words.intersection(found_title_words)
    if title_overlap:
        score += min(35, len(title_overlap) * 18)
        matched_reasons.append(f"Keywords: {', '.join(title_overlap)}")

    # Location keyword overlap (up to +20 points)
    lost_loc_words = extract_keywords(lost_item["location"])
    found_loc_words = extract_keywords(found_item["location"])
    loc_overlap = lost_loc_words.intersection(found_loc_words)
    if loc_overlap:
        score += min(20, len(loc_overlap) * 12)
        matched_reasons.append(f"Location: {', '.join(loc_overlap)}")

    # Description overlap
    lost_desc_words = extract_keywords(lost_item.get("description") or "")
    found_desc_words = extract_keywords(found_item.get("description") or "")
    desc_overlap = lost_desc_words.intersection(found_desc_words)
    if desc_overlap:
        score += min(15, len(desc_overlap) * 8)

    # Normalize score between 60% and 98%
    if score >= 40:
        confidence = min(98, 50 + int(score * 0.6))
        return confidence, matched_reasons
    return 0, []


def get_all_smart_matches(con: sqlite3.Connection):
    """Returns all active Lost <-> Found pairs with high match correlation."""
    lost_items = con.execute("""
        SELECT i.*, u.name AS owner_name, u.campus_role AS owner_role, u.email AS owner_email, u.phone AS owner_phone
        FROM items i JOIN users u ON i.owner_id = u.id
        WHERE i.type = 'Lost' AND i.status = 'Open'
        ORDER BY i.id DESC
    """).fetchall()

    found_items = con.execute("""
        SELECT i.*, u.name AS owner_name, u.campus_role AS owner_role, u.email AS owner_email, u.phone AS owner_phone
        FROM items i JOIN users u ON i.owner_id = u.id
        WHERE i.type = 'Found' AND i.status = 'Open'
        ORDER BY i.id DESC
    """).fetchall()

    matches = []
    for l in lost_items:
        l_dict = dict(l)
        l_dict["date"] = l_dict.get("item_date") or ""
        for f in found_items:
            f_dict = dict(f)
            f_dict["date"] = f_dict.get("item_date") or ""
            if l_dict["owner_id"] == f_dict["owner_id"]:
                continue

            score, reasons = calculate_match_score(l_dict, f_dict)
            if score >= 60:
                matches.append({
                    "score": score,
                    "reasons": reasons,
                    "lost_item": l_dict,
                    "found_item": f_dict,
                })

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches


# -------------------------------------------------------------
# HTTP SERVER & API REQUEST HANDLER
# -------------------------------------------------------------
class FoundlyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def send_json(self, data, status_code=200, set_cookie=None):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, message, status_code=400):
        self.send_json({"error": message, "detail": message}, status_code)

    def parse_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 12 * 1024 * 1024:
            raise ValueError("Payload too large")
        body_bytes = self.rfile.read(length)
        if not body_bytes:
            return {}
        return json.loads(body_bytes.decode("utf-8"))

    def get_session_token(self):
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header.split(" ", 1)[1].strip()
        cookie_header = self.headers.get("Cookie", "")
        for item in cookie_header.split(";"):
            item = item.strip()
            if item.startswith("foundly_session="):
                return item.split("=", 1)[1]
        return None

    def get_current_user(self, con):
        token = self.get_session_token()
        if not token:
            return None
        row = con.execute("""
            SELECT u.id, u.name, u.email, u.role, u.campus_role, u.phone
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
        """, (token,)).fetchone()
        return dict(row) if row else None

    def do_GET(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            self.send_error_json("Too many requests. Please wait a moment.", 429)
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        con = get_db()
        try:
            # 1. Session status
            if path == "/api/session":
                user = self.get_current_user(con)
                if not user:
                    self.send_json({"user": None, "pending_count": 0, "matches_count": 0})
                    return
                pending = con.execute(
                    "SELECT COUNT(*) AS c FROM connections WHERE recipient_id = ? AND status IN ('Pending', 'Matched')",
                    (user["id"],)
                ).fetchone()["c"]
                all_matches = get_all_smart_matches(con)
                user_matches = sum(1 for m in all_matches if m["lost_item"]["owner_id"] == user["id"] or m["found_item"]["owner_id"] == user["id"])
                self.send_json({"user": user, "pending_count": pending, "matches_count": user_matches})
                return

            # 2. Smart Matches Hub API
            if path == "/api/matches":
                matches = get_all_smart_matches(con)
                self.send_json({"matches": matches, "count": len(matches)})
                return

            # 3. Items list with search & filters
            if path == "/api/items":
                search = query.get("search", [""])[0].strip().lower()
                cat = query.get("category", ["All"])[0]
                t = query.get("type", ["All"])[0]
                stat = query.get("status", ["All"])[0]

                sql = """
                    SELECT i.*, u.name AS owner_name, u.campus_role AS owner_role, u.email AS owner_email
                    FROM items i
                    JOIN users u ON i.owner_id = u.id
                    WHERE 1=1
                """
                params = []
                if stat != "All":
                    sql += " AND i.status = ?"
                    params.append(stat)
                if t != "All":
                    sql += " AND i.type = ?"
                    params.append(t)
                if cat != "All":
                    sql += " AND i.category = ?"
                    params.append(cat)
                if search:
                    sql += " AND (LOWER(i.name) LIKE ? OR LOWER(i.location) LIKE ? OR LOWER(i.description) LIKE ? OR LOWER(i.category) LIKE ?)"
                    s = f"%{search}%"
                    params.extend([s, s, s, s])

                sql += " ORDER BY i.id DESC"
                rows = con.execute(sql, params).fetchall()
                items_list = []
                for r in rows:
                    d = dict(r)
                    d["date"] = d.get("item_date") or ""
                    items_list.append(d)
                self.send_json({"items": items_list})
                return

            # 4. Item detail
            if path.startswith("/api/items/"):
                item_id = int(path.split("/")[3])
                row = con.execute("""
                    SELECT i.*, u.name AS owner_name, u.campus_role AS owner_role, u.email AS owner_email
                    FROM items i
                    JOIN users u ON i.owner_id = u.id
                    WHERE i.id = ?
                """, (item_id,)).fetchone()
                if not row:
                    self.send_error_json("Item not found", 404)
                    return
                d = dict(row)
                d["date"] = d.get("item_date") or ""
                self.send_json({"item": d})
                return

            # 5. User's own items
            if path == "/api/user/items":
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                rows = con.execute("""
                    SELECT i.*, (SELECT COUNT(*) FROM connections WHERE item_id = i.id) AS connections_count
                    FROM items i
                    WHERE i.owner_id = ?
                    ORDER BY i.id DESC
                """, (user["id"],)).fetchall()
                items_list = []
                for r in rows:
                    d = dict(r)
                    d["date"] = d.get("item_date") or ""
                    items_list.append(d)
                self.send_json({"items": items_list})
                return

            # 6. Connections & Messages
            if path == "/api/connections":
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                rows = con.execute("""
                    SELECT c.id, c.item_id, c.message, c.status, c.created_at,
                           i.name AS item_name, i.type AS item_type, i.location AS item_location,
                           s.id AS sender_id, s.name AS sender_name, s.email AS sender_email, s.campus_role AS sender_role, s.phone AS sender_phone,
                           r.id AS recipient_id, r.name AS recipient_name, r.email AS recipient_email, r.campus_role AS recipient_role, r.phone AS recipient_phone
                    FROM connections c
                    LEFT JOIN items i ON c.item_id = i.id
                    JOIN users s ON c.sender_id = s.id
                    JOIN users r ON c.recipient_id = r.id
                    WHERE c.sender_id = ? OR c.recipient_id = ?
                    ORDER BY c.id DESC
                """, (user["id"], user["id"])).fetchall()

                data = []
                for r in rows:
                    item_dict = dict(r)
                    if item_dict["status"] not in ("Accepted", "Matched"):
                        item_dict["sender_phone"] = None
                        item_dict["recipient_phone"] = None
                    data.append(item_dict)
                self.send_json({"connections": data})
                return

            # 7. Admin overview
            if path == "/api/admin/overview":
                user = self.get_current_user(con)
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                stats = {
                    "reports": con.execute("SELECT COUNT(*) AS c FROM items").fetchone()["c"],
                    "lost": con.execute("SELECT COUNT(*) AS c FROM items WHERE type = 'Lost'").fetchone()["c"],
                    "found": con.execute("SELECT COUNT(*) AS c FROM items WHERE type = 'Found'").fetchone()["c"],
                    "resolved": con.execute("SELECT COUNT(*) AS c FROM items WHERE status = 'Resolved'").fetchone()["c"],
                    "users": con.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"],
                    "connections": con.execute("SELECT COUNT(*) AS c FROM connections").fetchone()["c"],
                }
                items = [dict(r) for r in con.execute("""
                    SELECT i.id, i.name, i.category, i.location, i.item_date AS date, i.type, i.status, u.name AS owner_name
                    FROM items i JOIN users u ON i.owner_id = u.id ORDER BY i.id DESC LIMIT 30
                """).fetchall()]
                self.send_json({"stats": stats, "items": items})
                return

            # 8. Admin CSV export
            if path == "/api/admin/export":
                user = self.get_current_user(con)
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                items = con.execute("""
                    SELECT i.id, i.name, i.type, i.status, i.category, i.location, i.item_date, i.description,
                           u.name AS owner_name, u.campus_role, i.created_at
                    FROM items i JOIN users u ON i.owner_id = u.id ORDER BY i.id DESC
                """).fetchall()
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(["ID", "Name", "Type", "Status", "Category", "Location", "Date", "Description", "Reporter", "Campus Role", "Created At"])
                for it in items:
                    writer.writerow(list(it))
                csv_bytes = out.getvalue().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="vctm-foundly-reports.csv"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)
                return

            # Default static file serving
            super().do_GET()
        finally:
            con.close()

    def do_POST(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            self.send_error_json("Too many requests. Please wait a moment.", 429)
            return

        path = urlparse(self.path).path
        try:
            body = self.parse_body()
        except Exception:
            self.send_error_json("Invalid JSON payload", 400)
            return

        con = get_db()
        try:
            # 1. User Registration
            if path == "/api/register":
                name = (body.get("name") or "").strip()
                email = (body.get("email") or "").strip().lower()
                password = body.get("password") or ""
                campus_role = body.get("campus_role") or "Student"
                phone = (body.get("phone") or "").strip() or None

                if not name or len(name) < 2:
                    self.send_error_json("Please enter your full name.")
                    return
                if not is_college_email(email):
                    domains_str = ", ".join(["@" + d for d in COLLEGE_DOMAINS])
                    self.send_error_json(f"Please use an institutional email ({domains_str}).")
                    return
                if len(password) < 6:
                    self.send_error_json("Password must be at least 6 characters.")
                    return

                with con:
                    existing = con.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
                    if existing:
                        self.send_error_json("An account with this email already exists. Please sign in.", 409)
                        return
                    salt, digest = password_hash(password)
                    cur = con.execute(
                        "INSERT INTO users (name, email, password_salt, password_hash, campus_role, phone) VALUES (?, ?, ?, ?, ?, ?)",
                        (name, email, salt, digest, campus_role, phone),
                    )
                    user_id = cur.lastrowid
                    token = secrets.token_urlsafe(32)
                    con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))

                user = {"id": user_id, "name": name, "email": email, "role": "user", "campus_role": campus_role, "phone": phone}
                cookie = f"foundly_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                self.send_json({"user": user, "token": token}, 201, set_cookie=cookie)
                return

            # 2. User Login
            if path == "/api/login":
                email = (body.get("email") or "").strip().lower()
                password = body.get("password") or ""

                user_row = con.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
                if not user_row:
                    self.send_error_json("No account found with this email. Click 'Create account' to register in seconds.", 401)
                    return
                if not verify_password(password, user_row["password_salt"], user_row["password_hash"]):
                    self.send_error_json("Incorrect password. You can reset it using 'Forgot password?' below.", 401)
                    return

                token = secrets.token_urlsafe(32)
                with con:
                    con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_row["id"]))

                user = {
                    "id": user_row["id"], "name": user_row["name"], "email": user_row["email"],
                    "role": user_row["role"], "campus_role": user_row["campus_role"], "phone": user_row["phone"]
                }
                cookie = f"foundly_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                self.send_json({"user": user, "token": token}, 200, set_cookie=cookie)
                return

            # 3. Logout
            if path == "/api/logout":
                token = self.get_session_token()
                if token:
                    with con:
                        con.execute("DELETE FROM sessions WHERE token = ?", (token,))
                cookie = "foundly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
                self.send_json({"ok": True}, 200, set_cookie=cookie)
                return

            # 4. Password Reset
            if path == "/api/password/reset":
                email = (body.get("email") or "").strip().lower()
                new_pass = body.get("new_password") or ""
                if not email or len(new_pass) < 6:
                    self.send_error_json("Enter valid email and a password with at least 6 characters.")
                    return
                with con:
                    user_row = con.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
                    if not user_row:
                        self.send_error_json("No account found with this email.", 404)
                        return
                    salt, digest = password_hash(new_pass)
                    con.execute("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?", (salt, digest, user_row["id"]))
                self.send_json({"ok": True, "message": "Password updated successfully. Please sign in."})
                return

            # 5. Create Item Report
            if path == "/api/items":
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in to publish a report.", 401)
                    return
                name = (body.get("name") or "").strip()
                loc = (body.get("location") or "").strip()
                t = body.get("type") or "Lost"
                if not name or not loc or t not in ("Lost", "Found"):
                    self.send_error_json("Item title, location, and report type are required.")
                    return
                cat = (body.get("category") or "Other").strip()
                date_str = body.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
                desc = (body.get("description") or "").strip()
                img = body.get("image_data")
                proof = (body.get("proof_question") or "").strip()

                with con:
                    cur = con.execute(
                        "INSERT INTO items (name, category, location, item_date, description, type, status, image_data, proof_question, owner_id) VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)",
                        (name, cat, loc, date_str, desc, t, img, proof, user["id"])
                    )
                    item_id = cur.lastrowid

                self.send_json({"item": {"id": item_id}}, 201)
                return

            # 6. Update Item Status
            if path.startswith("/api/items/") and path.endswith("/status"):
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = int(path.split("/")[3])
                new_status = body.get("status")
                if new_status not in ("Open", "Resolved", "Archived"):
                    self.send_error_json("Invalid status")
                    return
                item_row = con.execute("SELECT owner_id FROM items WHERE id = ?", (item_id,)).fetchone()
                if not item_row:
                    self.send_error_json("Item not found", 404)
                    return
                if item_row["owner_id"] != user["id"] and user.get("role") != "admin":
                    self.send_error_json("Permission denied", 403)
                    return
                with con:
                    con.execute("UPDATE items SET status = ? WHERE id = ?", (new_status, item_id))
                self.send_json({"ok": True, "status": new_status})
                return

            # 7. Create Connection / Claim Request
            if path == "/api/connections":
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = body.get("item_id")
                msg = (body.get("message") or "").strip()
                if not item_id or not msg:
                    self.send_error_json("Please provide a claim message.")
                    return
                item_row = con.execute("SELECT owner_id FROM items WHERE id = ?", (item_id,)).fetchone()
                if not item_row:
                    self.send_error_json("Report no longer exists.", 404)
                    return
                if item_row["owner_id"] == user["id"]:
                    self.send_error_json("You cannot connect to your own report.")
                    return
                with con:
                    con.execute(
                        "INSERT INTO connections (item_id, sender_id, recipient_id, message, status) VALUES (?, ?, ?, ?, 'Pending')",
                        (item_id, user["id"], item_row["owner_id"], msg)
                    )
                self.send_json({"ok": True}, 201)
                return

            # 8. Accept / Decline Connection
            if path.startswith("/api/connections/") and path.endswith("/status"):
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                conn_id = int(path.split("/")[3])
                new_status = body.get("status")
                if new_status not in ("Accepted", "Declined"):
                    self.send_error_json("Invalid status")
                    return
                with con:
                    con.execute(
                        "UPDATE connections SET status = ? WHERE id = ? AND recipient_id = ?",
                        (new_status, conn_id, user["id"])
                    )
                self.send_json({"ok": True})
                return

            # 9. Send Chat Message in Connection Thread
            if path.startswith("/api/connections/") and path.endswith("/message"):
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                conn_id = int(path.split("/")[3])
                reply_text = (body.get("message") or "").strip()
                if not reply_text:
                    self.send_error_json("Message cannot be empty")
                    return
                conn_row = con.execute("""
                    SELECT * FROM connections WHERE id = ? AND (sender_id = ? OR recipient_id = ?)
                """, (conn_id, user["id"], user["id"])).fetchone()
                if not conn_row:
                    self.send_error_json("Conversation not found", 404)
                    return
                timestamp = datetime.utcnow().strftime("%H:%M")
                new_msg = f"{conn_row['message']}\n\n💬 [{user['name']} @ {timestamp}]: {reply_text}"
                new_status = "Accepted" if conn_row["status"] == "Pending" and user["id"] == conn_row["recipient_id"] else conn_row["status"]
                with con:
                    con.execute("UPDATE connections SET message = ?, status = ? WHERE id = ?", (new_msg, new_status, conn_id))
                self.send_json({"ok": True, "message": new_msg, "status": new_status})
                return

            self.send_error_json("Route not found", 404)
        finally:
            con.close()

    def do_DELETE(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            self.send_error_json("Too many requests. Please wait a moment.", 429)
            return

        path = urlparse(self.path).path
        con = get_db()
        try:
            if path.startswith("/api/items/"):
                user = self.get_current_user(con)
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = int(path.split("/")[3])
                item_row = con.execute("SELECT owner_id FROM items WHERE id = ?", (item_id,)).fetchone()
                if not item_row:
                    self.send_error_json("Item not found", 404)
                    return
                if item_row["owner_id"] != user["id"] and user.get("role") != "admin":
                    self.send_error_json("Permission denied", 403)
                    return
                with con:
                    con.execute("DELETE FROM items WHERE id = ?", (item_id,))
                self.send_json({"ok": True})
                return
            self.send_error_json("Route not found", 404)
        finally:
            con.close()


def run_server():
    initialise_database()
    server = ThreadingHTTPServer((HOST, PORT), FoundlyHandler)
    print(f"✓ VCTM Foundly Production Server running live on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully.")
        server.server_close()


if __name__ == "__main__":
    run_server()
