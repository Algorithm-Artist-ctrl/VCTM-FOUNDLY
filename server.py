"""VCTM Foundly - Production Campus Lost & Found Server.

A fast, zero-dependency, secure backend powered by Python's standard library and SQLite.
Configurable via environment variables for local development, Docker, and Cloud platforms.
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
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
DB_PATH = Path(os.environ.get("DATABASE_PATH", ROOT / "foundly.db"))

# Configuration via environment variables
raw_domains = os.environ.get("ALLOWED_DOMAINS", "vctm.in,vctm.edu,gmail.com,foundly.test")
COLLEGE_DOMAINS = [d.strip().lower() for d in raw_domains.split(",") if d.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@foundly.test").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ALLOW_ALL_DOMAINS = "*" in COLLEGE_DOMAINS or os.environ.get("ALLOW_ALL_DOMAINS", "").lower() in ("true", "1")

# In-memory sliding-window rate limiter
RATE_LIMITS = defaultdict(list)
MAX_REQUESTS_PER_WINDOW = 30
RATE_WINDOW_SECONDS = 60


def check_rate_limit(ip_address: str) -> bool:
    """Return True if request is allowed, False if rate limit exceeded."""
    now = time.time()
    timestamps = RATE_LIMITS[ip_address]
    # Filter out timestamps older than the window
    RATE_LIMITS[ip_address] = [t for t in timestamps if now - t < RATE_WINDOW_SECONDS]
    if len(RATE_LIMITS[ip_address]) >= MAX_REQUESTS_PER_WINDOW:
        return False
    RATE_LIMITS[ip_address].append(now)
    return True


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def password_hash(password, salt=None):
    salt = salt or os.urandom(16)
    value = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return salt.hex(), value.hex()


def verify_password(password, salt, expected):
    _, calculated = password_hash(password, bytes.fromhex(salt))
    return secrets.compare_digest(calculated, expected)


def is_college_email(email):
    if ALLOW_ALL_DOMAINS:
        return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email))
    email = email.lower()
    return any(email.endswith("@" + domain) for domain in COLLEGE_DOMAINS)


def initialise_database():
    connection = db()
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            campus_role TEXT,
            phone TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            item_date TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL CHECK(type IN ('Lost','Found')),
            status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Resolved','Archived')),
            image_data TEXT,
            proof_question TEXT,
            owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY,
            item_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY(sender_id) REFERENCES users(id),
            FOREIGN KEY(recipient_id) REFERENCES users(id)
        );
    """)

    # Safe column migrations for existing databases
    item_cols = [r[1] for r in connection.execute("PRAGMA table_info(items)").fetchall()]
    if "status" not in item_cols:
        connection.execute("ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'Open'")
    if "image_data" not in item_cols:
        connection.execute("ALTER TABLE items ADD COLUMN image_data TEXT")
    if "proof_question" not in item_cols:
        connection.execute("ALTER TABLE items ADD COLUMN proof_question TEXT")

    user_cols = [r[1] for r in connection.execute("PRAGMA table_info(users)").fetchall()]
    if "phone" not in user_cols:
        connection.execute("ALTER TABLE users ADD COLUMN phone TEXT")

    # Seed Admin User if not present
    if not connection.execute("SELECT 1 FROM users WHERE email = ?", (ADMIN_EMAIL,)).fetchone():
        salt, digest = password_hash(ADMIN_PASSWORD)
        connection.execute(
            "INSERT INTO users(name,email,password_salt,password_hash,role,campus_role) VALUES(?,?,?,?,?,?)",
            ("VCTM Administrator", ADMIN_EMAIL, salt, digest, "admin", "Administrator")
        )

    admin_id = connection.execute("SELECT id FROM users WHERE email=?", (ADMIN_EMAIL,)).fetchone()[0]

    # Seed initial samples if items table is empty
    if not connection.execute("SELECT 1 FROM items LIMIT 1").fetchone():
        samples = [
            ("Silver laptop sleeve", "Electronics", "Engineering block", "2026-08-20", "Left near the second-floor computer lab.", "Found", "Open", "What color is the zipper pull?"),
            ("Brown leather wallet", "Accessories", "Student centre", "2026-08-20", "Contains ID card and student passes.", "Lost", "Open", "What initials are embossed inside?"),
            ("Set of house keys", "Keys", "West parking", "2026-08-20", "Three silver keys on a yellow spiral keyring.", "Found", "Open", "Describe the small figurine attached."),
            ("Blue water bottle", "Other", "Sports complex", "2026-08-20", "Insulated bottle with college club stickers.", "Lost", "Open", ""),
            ("Engineering drawing book", "Books & stationery", "Mechanical lab", "2026-08-19", "Contains ED assignment sheets with name on first page.", "Lost", "Resolved", ""),
            ("Prescription glasses", "Accessories", "Seminar hall", "2026-08-18", "Black rectangular frame in a blue hard case.", "Found", "Open", "Brand of the case?"),
        ]
        connection.executemany(
            "INSERT INTO items(name,category,location,item_date,description,type,status,proof_question,owner_id) VALUES(?,?,?,?,?,?,?,?,?)",
            [(*item, admin_id) for item in samples]
        )
    connection.commit()
    connection.close()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Security and hardening headers
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(self)")
        super().end_headers()

    def json_response(self, status, payload, extra_headers=None):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 10 * 1024 * 1024:  # Max 10MB payload (allows compressed base64 images)
            raise ValueError("Payload exceeds maximum size limit (10MB).")
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON request data.")

    def current_user(self):
        raw = self.headers.get("Cookie", "")
        token = cookies.SimpleCookie(raw).get("foundly_session")
        if not token:
            return None
        connection = db()
        user = connection.execute("""
            SELECT u.id, u.name, u.email, u.role, u.campus_role, u.phone
            FROM sessions s
            JOIN users u ON u.id=s.user_id
            WHERE s.token=?
        """, (token.value,)).fetchone()
        connection.close()
        return dict(user) if user else None

    def require_user(self):
        user = self.current_user()
        if not user:
            self.json_response(401, {"error": "Please sign in to continue."})
        return user

    def require_admin(self):
        user = self.require_user()
        if user and user["role"] != "admin":
            self.json_response(403, {"error": "Administrator access is required."})
            return None
        return user

    def item_rows(self, query=None, category=None, item_type=None, status=None):
        connection = db()
        sql = """
            SELECT i.id, i.name, i.category, i.location, i.item_date AS date, i.description,
                   i.type, i.status, i.image_data, i.proof_question, i.created_at,
                   u.id AS owner_id, u.name AS owner_name, u.campus_role AS owner_role
            FROM items i
            JOIN users u ON u.id=i.owner_id
            WHERE 1=1
        """
        params = []
        if status and status != "All":
            sql += " AND i.status = ?"
            params.append(status)
        if item_type and item_type != "All":
            sql += " AND i.type = ?"
            params.append(item_type)
        if category and category != "All":
            sql += " AND i.category = ?"
            params.append(category)
        if query:
            q = f"%{query}%"
            sql += " AND (i.name LIKE ? OR i.category LIKE ? OR i.location LIKE ? OR i.description LIKE ?)"
            params.extend([q, q, q, q])

        sql += " ORDER BY i.id DESC"
        rows = connection.execute(sql, params).fetchall()
        connection.close()
        return [dict(row) for row in rows]

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query_params = parse_qs(parsed.query)

        # 1. Session verification with pending counts
        if path == "/api/session":
            user = self.current_user()
            pending_count = 0
            if user:
                connection = db()
                pending_count = connection.execute(
                    "SELECT COUNT(*) FROM connections WHERE recipient_id=? AND status='Pending'",
                    (user["id"],)
                ).fetchone()[0]
                connection.close()
            return self.json_response(200, {"user": user, "pending_count": pending_count})

        # 2. Items list with filtering
        if path == "/api/items":
            search_query = query_params.get("search", [""])[0].strip()
            cat = query_params.get("category", ["All"])[0]
            itype = query_params.get("type", ["All"])[0]
            istatus = query_params.get("status", ["All"])[0]
            return self.json_response(200, {"items": self.item_rows(search_query, cat, itype, istatus)})

        # 3. Single Item detail
        if path.startswith("/api/items/") and len(path.split("/")) == 4:
            item_id = path.split("/")[3]
            connection = db()
            row = connection.execute("""
                SELECT i.id, i.name, i.category, i.location, i.item_date AS date, i.description,
                       i.type, i.status, i.image_data, i.proof_question, i.created_at,
                       u.id AS owner_id, u.name AS owner_name, u.campus_role AS owner_role
                FROM items i JOIN users u ON u.id=i.owner_id WHERE i.id=?
            """, (item_id,)).fetchone()
            connection.close()
            if not row:
                return self.json_response(404, {"error": "Item report not found."})
            return self.json_response(200, {"item": dict(row)})

        # 4. User's Own Items
        if path == "/api/user/items":
            user = self.require_user()
            if not user:
                return
            connection = db()
            rows = connection.execute("""
                SELECT i.id, i.name, i.category, i.location, i.item_date AS date, i.description,
                       i.type, i.status, i.image_data, i.proof_question, i.created_at,
                       (SELECT COUNT(*) FROM connections WHERE item_id=i.id) AS connections_count
                FROM items i WHERE i.owner_id=? ORDER BY i.id DESC
            """, (user["id"],)).fetchall()
            connection.close()
            return self.json_response(200, {"items": [dict(r) for r in rows]})

        # 5. Connections list
        if path == "/api/connections":
            user = self.require_user()
            if not user:
                return
            connection = db()
            rows = connection.execute("""
                SELECT c.id, c.item_id, c.message, c.status, c.created_at,
                       i.name AS item_name, i.type AS item_type, i.location AS item_location,
                       sender.id AS sender_id, sender.name AS sender_name, sender.email AS sender_email,
                       sender.campus_role AS sender_role, sender.phone AS sender_phone,
                       recipient.id AS recipient_id, recipient.name AS recipient_name,
                       recipient.email AS recipient_email, recipient.campus_role AS recipient_role,
                       recipient.phone AS recipient_phone
                FROM connections c
                JOIN items i ON i.id=c.item_id
                JOIN users sender ON sender.id=c.sender_id
                JOIN users recipient ON recipient.id=c.recipient_id
                WHERE c.sender_id=? OR c.recipient_id=?
                ORDER BY c.id DESC
            """, (user["id"], user["id"])).fetchall()
            connection.close()
            return self.json_response(200, {"connections": [dict(row) for row in rows]})

        # 6. Admin Overview
        if path == "/api/admin/overview":
            user = self.require_admin()
            if not user:
                return
            connection = db()
            stats = {
                "reports": connection.execute("SELECT COUNT(*) FROM items").fetchone()[0],
                "lost": connection.execute("SELECT COUNT(*) FROM items WHERE type='Lost'").fetchone()[0],
                "found": connection.execute("SELECT COUNT(*) FROM items WHERE type='Found'").fetchone()[0],
                "resolved": connection.execute("SELECT COUNT(*) FROM items WHERE status='Resolved'").fetchone()[0],
                "users": connection.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                "connections": connection.execute("SELECT COUNT(*) FROM connections").fetchone()[0],
            }
            connection.close()
            return self.json_response(200, {"stats": stats, "items": self.item_rows()[:30]})

        # 7. Admin Export Reports as CSV
        if path == "/api/admin/export":
            user = self.require_admin()
            if not user:
                return
            items = self.item_rows()
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["ID", "Name", "Type", "Status", "Category", "Location", "Date", "Description", "Reporter", "Campus Role", "Created At"])
            for it in items:
                writer.writerow([
                    it["id"], it["name"], it["type"], it["status"], it["category"],
                    it["location"], it["date"], it.get("description", ""),
                    it.get("owner_name", ""), it.get("owner_role", ""), it["created_at"]
                ])
            csv_data = output.getvalue().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="vctm-foundly-reports.csv"')
            self.send_header("Content-Length", str(len(csv_data)))
            self.end_headers()
            self.wfile.write(csv_data)
            return

        return super().do_GET()

    def do_POST(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            return self.json_response(429, {"error": "Too many requests. Please slow down and try again."})

        parsed = urlparse(self.path)
        path = parsed.path
        try:
            data = self.body()
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})

        if path == "/api/register":
            return self.register(data)
        if path == "/api/login":
            return self.login(data)
        if path == "/api/logout":
            return self.logout()
        if path == "/api/password/reset":
            return self.reset_password(data)
        if path == "/api/items":
            return self.create_item(data)
        if path == "/api/connections":
            return self.create_connection(data)

        # Status update for item: /api/items/<id>/status
        if path.startswith("/api/items/") and path.endswith("/status"):
            item_id = path.split("/")[3]
            return self.update_item_status(item_id, data)

        # Status update for connection: /api/connections/<id>/status
        if path.startswith("/api/connections/") and path.endswith("/status"):
            return self.update_connection(path.split("/")[3], data)

        self.json_response(404, {"error": "Endpoint not found."})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/items/"):
            item_id = path.split("/")[3]
            return self.delete_item(item_id)
        self.json_response(404, {"error": "Endpoint not found."})

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        connection = db()
        connection.execute("INSERT INTO sessions(token, user_id) VALUES(?,?)", (token, user_id))
        connection.commit()
        connection.close()
        return {"Set-Cookie": f"foundly_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000"}

    def register(self, data):
        name = data.get("name", "").strip()
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        campus_role = data.get("campus_role", "Student")
        phone = data.get("phone", "").strip()

        if not name or len(name) < 2:
            return self.json_response(400, {"error": "Please enter your full name."})
        if not is_college_email(email):
            domains_str = ", ".join(["@" + d for d in COLLEGE_DOMAINS])
            return self.json_response(400, {"error": f"Please use a verified institutional email ({domains_str})."})
        if len(password) < 6:
            return self.json_response(400, {"error": "Password must be at least 6 characters."})
        if campus_role not in ("Student", "Faculty", "Staff member", "Campus worker", "Administrator"):
            return self.json_response(400, {"error": "Choose a valid campus role."})

        salt, digest = password_hash(password)
        connection = db()
        try:
            cursor = connection.execute(
                "INSERT INTO users(name, email, password_salt, password_hash, campus_role, phone) VALUES(?,?,?,?,?,?)",
                (name, email, salt, digest, campus_role, phone)
            )
            connection.commit()
            user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            connection.close()
            return self.json_response(409, {"error": "An account with this email already exists."})
        connection.close()
        return self.json_response(201, {
            "user": {"id": user_id, "name": name, "email": email, "role": "user", "campus_role": campus_role, "phone": phone}
        }, self.create_session(user_id))

    def login(self, data):
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        connection = db()
        row = connection.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        connection.close()
        if not row or not verify_password(password, row["password_salt"], row["password_hash"]):
            return self.json_response(401, {"error": "Email or password is incorrect."})
        return self.json_response(200, {
            "user": {key: row[key] for key in ("id", "name", "email", "role", "campus_role", "phone")}
        }, self.create_session(row["id"]))

    def reset_password(self, data):
        email = data.get("email", "").strip().lower()
        new_password = data.get("new_password", "")
        if not email or len(new_password) < 6:
            return self.json_response(400, {"error": "Enter valid email and a new password with at least 6 characters."})
        connection = db()
        user = connection.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if not user:
            connection.close()
            return self.json_response(404, {"error": "No account found with this email."})
        salt, digest = password_hash(new_password)
        connection.execute("UPDATE users SET password_salt=?, password_hash=? WHERE id=?", (salt, digest, user["id"]))
        connection.commit()
        connection.close()
        return self.json_response(200, {"ok": True, "message": "Password updated successfully. Please sign in."})

    def logout(self):
        token = cookies.SimpleCookie(self.headers.get("Cookie", "")).get("foundly_session")
        if token:
            connection = db()
            connection.execute("DELETE FROM sessions WHERE token=?", (token.value,))
            connection.commit()
            connection.close()
        return self.json_response(200, {"ok": True}, {"Set-Cookie": "foundly_session=; Max-Age=0; Path=/"})

    def create_item(self, data):
        user = self.require_user()
        if not user:
            return
        name = data.get("name", "").strip()
        location = data.get("location", "").strip()
        item_type = data.get("type")
        category = data.get("category", "Other").strip() or "Other"
        item_date = data.get("date") or time.strftime("%Y-%m-%d")
        description = data.get("description", "").strip()
        image_data = data.get("image_data")  # base64 encoded photo
        proof_question = data.get("proof_question", "").strip()

        if not name or not location or item_type not in ("Lost", "Found"):
            return self.json_response(400, {"error": "Item title, location, and report type (Lost/Found) are required."})

        connection = db()
        cursor = connection.execute(
            """INSERT INTO items(name, category, location, item_date, description, type, status, image_data, proof_question, owner_id)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (name, category, location, item_date, description, item_type, "Open", image_data, proof_question, user["id"])
        )
        connection.commit()
        item_id = cursor.lastrowid
        connection.close()
        return self.json_response(201, {"item": {"id": item_id}})

    def update_item_status(self, item_id, data):
        user = self.require_user()
        if not user:
            return
        status = data.get("status")
        if status not in ("Open", "Resolved", "Archived"):
            return self.json_response(400, {"error": "Invalid status value."})

        connection = db()
        item = connection.execute("SELECT owner_id FROM items WHERE id=?", (item_id,)).fetchone()
        if not item:
            connection.close()
            return self.json_response(404, {"error": "Item not found."})

        if item["owner_id"] != user["id"] and user["role"] != "admin":
            connection.close()
            return self.json_response(403, {"error": "You do not have permission to modify this item."})

        connection.execute("UPDATE items SET status=? WHERE id=?", (status, item_id))
        connection.commit()
        connection.close()
        return self.json_response(200, {"ok": True, "status": status})

    def delete_item(self, item_id):
        user = self.require_user()
        if not user:
            return
        connection = db()
        item = connection.execute("SELECT owner_id FROM items WHERE id=?", (item_id,)).fetchone()
        if not item:
            connection.close()
            return self.json_response(404, {"error": "Item not found."})

        if item["owner_id"] != user["id"] and user["role"] != "admin":
            connection.close()
            return self.json_response(403, {"error": "You do not have permission to delete this report."})

        connection.execute("DELETE FROM items WHERE id=?", (item_id,))
        connection.commit()
        connection.close()
        return self.json_response(200, {"ok": True})

    def create_connection(self, data):
        user = self.require_user()
        if not user:
            return
        item_id = data.get("item_id")
        message = data.get("message", "").strip()
        if not item_id or not message:
            return self.json_response(400, {"error": "Please provide a verification message."})

        connection = db()
        item = connection.execute("SELECT owner_id FROM items WHERE id=?", (item_id,)).fetchone()
        if not item:
            connection.close()
            return self.json_response(404, {"error": "This report no longer exists."})
        if item["owner_id"] == user["id"]:
            connection.close()
            return self.json_response(400, {"error": "You cannot request connection to your own report."})

        duplicate = connection.execute(
            "SELECT 1 FROM connections WHERE item_id=? AND sender_id=? AND status='Pending'",
            (item_id, user["id"])
        ).fetchone()
        if duplicate:
            connection.close()
            return self.json_response(409, {"error": "You already have a pending request for this report."})

        connection.execute(
            "INSERT INTO connections(item_id, sender_id, recipient_id, message) VALUES(?,?,?,?)",
            (item_id, user["id"], item["owner_id"], message)
        )
        connection.commit()
        connection.close()
        return self.json_response(201, {"ok": True})

    def update_connection(self, connection_id, data):
        user = self.require_user()
        if not user:
            return
        status = data.get("status")
        if status not in ("Accepted", "Declined"):
            return self.json_response(400, {"error": "Invalid request status."})

        connection = db()
        cursor = connection.execute(
            "UPDATE connections SET status=? WHERE id=? AND recipient_id=? AND status='Pending'",
            (status, connection_id, user["id"])
        )
        connection.commit()
        connection.close()
        if not cursor.rowcount:
            return self.json_response(404, {"error": "This connection request is no longer available or already handled."})
        return self.json_response(200, {"ok": True})


if __name__ == "__main__":
    initialise_database()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"VCTM Foundly (Production Ready) is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped gracefully.")

