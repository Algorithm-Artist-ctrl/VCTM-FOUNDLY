"""VCTM Foundly local application server.

Run: python3 server.py
Open: http://localhost:8000
"""
import hashlib
import json
import os
import secrets
import sqlite3
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).parent
DB_PATH = ROOT / "foundly.db"
COLLEGE_DOMAINS = ("vctm.in",)
ADMIN_EMAIL = "admin@foundly.test"
ADMIN_PASSWORD = "admin123"  # Change this before sharing the project.


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def password_hash(password, salt=None):
    salt = salt or os.urandom(16)
    value = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return salt.hex(), value.hex()


def verify_password(password, salt, expected):
    _, calculated = password_hash(password, bytes.fromhex(salt))
    return secrets.compare_digest(calculated, expected)


def is_college_email(email):
    return any(email.endswith("@" + domain) for domain in COLLEGE_DOMAINS)


def initialise_database():
    connection = db()
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
            password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user', campus_role TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, item_date TEXT NOT NULL, description TEXT,
            type TEXT NOT NULL CHECK(type IN ('Lost','Found')), owner_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY(sender_id) REFERENCES users(id), FOREIGN KEY(recipient_id) REFERENCES users(id)
        );
    """)
    if not connection.execute("SELECT 1 FROM users WHERE email = ?", (ADMIN_EMAIL,)).fetchone():
        salt, digest = password_hash(ADMIN_PASSWORD)
        connection.execute("INSERT INTO users(name,email,password_salt,password_hash,role,campus_role) VALUES(?,?,?,?,?,?)",
                           ("VCTM Administrator", ADMIN_EMAIL, salt, digest, "admin", "Administrator"))
    admin_id = connection.execute("SELECT id FROM users WHERE email=?", (ADMIN_EMAIL,)).fetchone()[0]
    if not connection.execute("SELECT 1 FROM items LIMIT 1").fetchone():
        samples = [
            ("Silver laptop sleeve", "Electronics", "Engineering block", "2026-08-20", "Left near the second-floor lab.", "Found"),
            ("Brown leather wallet", "Accessories", "Student centre", "2026-08-20", "Contains cards and a small photo.", "Lost"),
            ("Set of house keys", "Keys", "West parking", "2026-08-20", "Three keys on a yellow keyring.", "Found"),
            ("Blue water bottle", "Other", "Sports complex", "2026-08-20", "Blue insulated bottle.", "Lost"),
            ("Engineering drawing book", "Books & stationery", "Mechanical lab", "2026-08-19", "Name written on the first page.", "Lost"),
            ("Prescription glasses", "Accessories", "Seminar hall", "2026-08-18", "Black rectangular frame.", "Found"),
        ]
        connection.executemany("INSERT INTO items(name,category,location,item_date,description,type,owner_id) VALUES(?,?,?,?,?,?,?)", [(*item, admin_id) for item in samples])
    connection.commit()
    connection.close()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def json_response(self, status, payload, extra_headers=None):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for key, value in extra_headers.items(): self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        try: return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError: raise ValueError("Invalid request data.")

    def current_user(self):
        raw = self.headers.get("Cookie", "")
        token = cookies.SimpleCookie(raw).get("foundly_session")
        if not token: return None
        connection = db()
        user = connection.execute("""SELECT u.id,u.name,u.email,u.role,u.campus_role FROM sessions s
            JOIN users u ON u.id=s.user_id WHERE s.token=?""", (token.value,)).fetchone()
        connection.close()
        return dict(user) if user else None

    def require_user(self):
        user = self.current_user()
        if not user: self.json_response(401, {"error": "Please sign in to continue."})
        return user

    def require_admin(self):
        user = self.require_user()
        if user and user["role"] != "admin": self.json_response(403, {"error": "Administrator access is required."}); return None
        return user

    def item_rows(self):
        connection = db()
        rows = connection.execute("""SELECT i.id,i.name,i.category,i.location,i.item_date AS date,i.description,i.type,
          i.created_at,u.name AS owner_name FROM items i JOIN users u ON u.id=i.owner_id ORDER BY i.id DESC""").fetchall()
        connection.close()
        return [dict(row) for row in rows]

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/session": return self.json_response(200, {"user": self.current_user()})
        if path == "/api/items": return self.json_response(200, {"items": self.item_rows()})
        if path == "/api/connections":
            user = self.require_user()
            if not user: return
            connection = db()
            rows = connection.execute("""SELECT c.id,c.item_id,c.message,c.status,c.created_at,
              i.name AS item_name, sender.name AS sender_name,sender.email AS sender_email,
              recipient.name AS recipient_name,recipient.email AS recipient_email
              FROM connections c JOIN items i ON i.id=c.item_id JOIN users sender ON sender.id=c.sender_id
              JOIN users recipient ON recipient.id=c.recipient_id WHERE c.sender_id=? OR c.recipient_id=? ORDER BY c.id DESC""", (user["id"], user["id"])).fetchall()
            connection.close(); return self.json_response(200, {"connections": [dict(row) for row in rows]})
        if path == "/api/admin/overview":
            user = self.require_admin()
            if not user: return
            connection = db()
            stats = {"reports": connection.execute("SELECT COUNT(*) FROM items").fetchone()[0], "lost": connection.execute("SELECT COUNT(*) FROM items WHERE type='Lost'").fetchone()[0], "found": connection.execute("SELECT COUNT(*) FROM items WHERE type='Found'").fetchone()[0]}
            connection.close(); return self.json_response(200, {"stats": stats, "items": self.item_rows()[:12]})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try: data = self.body()
        except ValueError as error: return self.json_response(400, {"error": str(error)})
        if path == "/api/register": return self.register(data)
        if path == "/api/login": return self.login(data)
        if path == "/api/logout": return self.logout()
        if path == "/api/items": return self.create_item(data)
        if path == "/api/connections": return self.create_connection(data)
        if path.startswith("/api/connections/") and path.endswith("/status"):
            return self.update_connection(path.split("/")[3], data)
        self.json_response(404, {"error": "Endpoint not found."})

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32); connection = db()
        connection.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user_id)); connection.commit(); connection.close()
        return {"Set-Cookie": f"foundly_session={token}; HttpOnly; SameSite=Lax; Path=/"}

    def register(self, data):
        name, email, password = data.get("name", "").strip(), data.get("email", "").strip().lower(), data.get("password", "")
        campus_role = data.get("campus_role", "Student")
        if not name or not is_college_email(email): return self.json_response(400, {"error": "Use your full name and a verified @vctm.in email address."})
        if len(password) < 8: return self.json_response(400, {"error": "Use a password with at least 8 characters."})
        if campus_role not in ("Student", "Faculty", "Staff member", "Campus worker"): return self.json_response(400, {"error": "Choose a valid campus role."})
        salt, digest = password_hash(password); connection = db()
        try:
            cursor = connection.execute("INSERT INTO users(name,email,password_salt,password_hash,campus_role) VALUES(?,?,?,?,?)", (name, email, salt, digest, campus_role)); connection.commit(); user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            connection.close(); return self.json_response(409, {"error": "An account with this email already exists."})
        connection.close(); return self.json_response(201, {"user": {"id": user_id, "name": name, "email": email, "role": "user", "campus_role": campus_role}}, self.create_session(user_id))

    def login(self, data):
        email, password = data.get("email", "").strip().lower(), data.get("password", "")
        connection = db(); row = connection.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone(); connection.close()
        if not row or not verify_password(password, row["password_salt"], row["password_hash"]): return self.json_response(401, {"error": "Email or password is incorrect."})
        return self.json_response(200, {"user": {key: row[key] for key in ("id", "name", "email", "role", "campus_role")}}, self.create_session(row["id"]))

    def logout(self):
        token = cookies.SimpleCookie(self.headers.get("Cookie", "")).get("foundly_session")
        if token:
            connection = db(); connection.execute("DELETE FROM sessions WHERE token=?", (token.value,)); connection.commit(); connection.close()
        self.json_response(200, {"ok": True}, {"Set-Cookie": "foundly_session=; Max-Age=0; Path=/"})

    def create_item(self, data):
        user = self.require_user()
        if not user: return
        name, location, item_type = data.get("name", "").strip(), data.get("location", "").strip(), data.get("type")
        if not name or not location or item_type not in ("Lost", "Found"): return self.json_response(400, {"error": "Item name, location and report type are required."})
        connection = db(); cursor = connection.execute("INSERT INTO items(name,category,location,item_date,description,type,owner_id) VALUES(?,?,?,?,?,?,?)", (name, data.get("category", "Other").strip() or "Other", location, data.get("date") or "", data.get("description", "").strip(), item_type, user["id"])); connection.commit(); item_id = cursor.lastrowid; connection.close()
        self.json_response(201, {"item": {"id": item_id}})

    def create_connection(self, data):
        user = self.require_user()
        if not user: return
        item_id, message = data.get("item_id"), data.get("message", "").strip()
        if not item_id or not message: return self.json_response(400, {"error": "Write a message before sending the request."})
        connection = db(); item = connection.execute("SELECT owner_id FROM items WHERE id=?", (item_id,)).fetchone()
        if not item: connection.close(); return self.json_response(404, {"error": "This report no longer exists."})
        if item["owner_id"] == user["id"]: connection.close(); return self.json_response(400, {"error": "You cannot connect to your own report."})
        duplicate = connection.execute("SELECT 1 FROM connections WHERE item_id=? AND sender_id=? AND status='Pending'", (item_id, user["id"])).fetchone()
        if duplicate: connection.close(); return self.json_response(409, {"error": "You already have a pending request for this report."})
        connection.execute("INSERT INTO connections(item_id,sender_id,recipient_id,message) VALUES(?,?,?,?)", (item_id, user["id"], item["owner_id"], message)); connection.commit(); connection.close(); self.json_response(201, {"ok": True})

    def update_connection(self, connection_id, data):
        user = self.require_user()
        if not user: return
        status = data.get("status")
        if status not in ("Accepted", "Declined"): return self.json_response(400, {"error": "Invalid request status."})
        connection = db(); cursor = connection.execute("UPDATE connections SET status=? WHERE id=? AND recipient_id=? AND status='Pending'", (status, connection_id, user["id"])); connection.commit(); connection.close()
        if not cursor.rowcount: return self.json_response(404, {"error": "This connection request is no longer available."})
        self.json_response(200, {"ok": True})


if __name__ == "__main__":
    initialise_database()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"VCTM Foundly is running at http://{host}:{port}")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nServer stopped.")
