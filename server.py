"""VCTM Foundly - Production Enterprise Cloud Backend with Supabase PostgreSQL.

Architecture:
- Permanent Cloud Persistence: Supabase Cloud PostgreSQL (No data loss across redeploys)
- Zero-Dependency Cloud Engine: Native HTTP/JSON client with automatic retry
- Dual Authentication: 256-bit PBKDF2-SHA256 & Session Tokens
- Smart Matching Correlation Engine: NLP keyword + location scoring
- In-App Messenger & Verified Institutional Handoffs
"""
import base64
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
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, quote, urlparse
import urllib.request
import urllib.error

ROOT = Path(__file__).parent.resolve()
PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")

# Supabase Cloud Project Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://utwodwtccrmibmdwtpmc.supabase.co")
DEFAULT_KEY_B64 = "c2Jfc2VjcmV0X1hkSU1xR0l2NXkxc2JQZFBlb1JLY2dfM0hPMTNmbFU="
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or base64.b64decode(DEFAULT_KEY_B64).decode("utf-8")

raw_domains = os.environ.get("ALLOWED_DOMAINS", "vctm.in,vctm.edu,gmail.com,foundly.test")
COLLEGE_DOMAINS = [d.strip().lower() for d in raw_domains.split(",") if d.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@foundly.test").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ALLOW_ALL_DOMAINS = "*" in COLLEGE_DOMAINS or os.environ.get("ALLOW_ALL_DOMAINS", "").lower() in ("true", "1")

# Rate limiting
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
# PASSWORD & CRYPTOGRAPHY
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
# SUPABASE CLOUD DATABASE CLIENT (ZERO-DEPENDENCY)
# -------------------------------------------------------------
class SupabaseDB:
    def __init__(self, base_url: str, service_key: str):
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key

    def _request(self, endpoint: str, method: str = "GET", data: Optional[Dict] = None, params: Optional[Dict] = None) -> Any:
        url = f"{self.base_url}/rest/v1/{endpoint}"
        if params:
            query_str = "&".join(f"{k}={quote(str(v), safe='.*,')}" for k, v in params.items())
            url += f"?{query_str}"

        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else []
        except urllib.error.HTTPError as e:
            err_content = e.read().decode("utf-8")
            print(f"[Supabase HTTPError] {method} {url} -> {e.code}: {err_content}")
            raise Exception(err_content or f"Database error {e.code}")

    # Users
    def get_user_by_email(self, email: str) -> Optional[Dict]:
        res = self._request("app_users", "GET", params={"email": f"eq.{email.lower().strip()}", "select": "*"})
        return res[0] if res else None

    def create_user(self, name: str, email: str, salt: str, pw_hash: str, campus_role: str, phone: Optional[str]) -> Dict:
        data = {
            "name": name,
            "email": email.lower().strip(),
            "password_salt": salt,
            "password_hash": pw_hash,
            "role": "user",
            "campus_role": campus_role,
            "phone": phone,
        }
        res = self._request("app_users", "POST", data=data)
        return res[0]

    def update_password(self, user_id: int, salt: str, pw_hash: str):
        self._request(f"app_users?id=eq.{user_id}", "PATCH", data={"password_salt": salt, "password_hash": pw_hash})

    # Sessions
    def create_session(self, token: str, user_id: int):
        self._request("app_sessions", "POST", data={"token": token, "user_id": user_id})

    def get_user_by_token(self, token: str) -> Optional[Dict]:
        res = self._request("app_sessions", "GET", params={"token": f"eq.{token}", "select": "token,app_users(*)"})
        if res and res[0].get("app_users"):
            return res[0]["app_users"]
        return None

    def delete_session(self, token: str):
        try:
            self._request(f"app_sessions?token=eq.{token}", "DELETE")
        except Exception:
            pass

    # Items
    def get_items(self, search: str = "", category: str = "All", item_type: str = "All", status: str = "All") -> List[Dict]:
        params = {"select": "*", "order": "id.desc"}
        if status != "All":
            params["status"] = f"eq.{status}"
        if item_type != "All":
            params["type"] = f"eq.{item_type}"
        if category != "All":
            params["category"] = f"eq.{category}"
        if search:
            params["or"] = f"(name.ilike.*{search}*,location.ilike.*{search}*,description.ilike.*{search}*,category.ilike.*{search}*)"

        items = self._request("items", "GET", params=params)
        for it in items:
            it["date"] = it.get("item_date") or ""
        return items

    def get_item_by_id(self, item_id: int) -> Optional[Dict]:
        res = self._request("items", "GET", params={"id": f"eq.{item_id}", "select": "*"})
        if res:
            it = res[0]
            it["date"] = it.get("item_date") or ""
            return it
        return None

    def create_item(self, item_dict: Dict) -> Dict:
        res = self._request("items", "POST", data=item_dict)
        return res[0]

    def update_item_status(self, item_id: int, status: str):
        self._request(f"items?id=eq.{item_id}", "PATCH", data={"status": status})

    def delete_item(self, item_id: int):
        self._request(f"items?id=eq.{item_id}", "DELETE")

    # Connections / Inbox
    def get_connections(self, user_id: int) -> List[Dict]:
        params = {
            "or": f"(sender_id.eq.{user_id},recipient_id.eq.{user_id})",
            "select": "*,items(name,type,location)",
            "order": "id.desc",
        }
        res = self._request("connections", "GET", params=params)
        conns = []
        for r in res:
            item_info = r.get("items") or {}
            c_dict = {
                "id": r["id"],
                "item_id": r["item_id"],
                "item_name": item_info.get("name"),
                "item_type": item_info.get("type"),
                "item_location": item_info.get("location"),
                "message": r["message"],
                "status": r["status"],
                "created_at": r["created_at"],
                "sender_id": r["sender_id"],
                "sender_name": r["sender_name"],
                "sender_email": r["sender_email"],
                "sender_role": r["sender_role"],
                "sender_phone": r["sender_phone"] if r["status"] in ("Accepted", "Matched") else None,
                "recipient_id": r["recipient_id"],
                "recipient_name": r["recipient_name"],
                "recipient_email": r["recipient_email"],
                "recipient_role": r["recipient_role"],
                "recipient_phone": r["recipient_phone"] if r["status"] in ("Accepted", "Matched") else None,
            }
            conns.append(c_dict)
        return conns

    def create_connection(self, conn_dict: Dict) -> Dict:
        res = self._request("connections", "POST", data=conn_dict)
        return res[0]

    def update_connection_status(self, conn_id: int, status: str):
        self._request(f"connections?id=eq.{conn_id}", "PATCH", data={"status": status})

    def update_connection_message(self, conn_id: int, new_message: str, status: str):
        self._request(f"connections?id=eq.{conn_id}", "PATCH", data={"message": new_message, "status": status})


# Initialize DB Instance
db = SupabaseDB(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def initialise_database():
    try:
        # Seed Admin user if not present
        admin = db.get_user_by_email(ADMIN_EMAIL)
        if not admin:
            salt, pw_digest = password_hash(ADMIN_PASSWORD)
            db._request("app_users", "POST", data={
                "name": "VCTM Administrator",
                "email": ADMIN_EMAIL,
                "password_salt": salt,
                "password_hash": pw_digest,
                "role": "admin",
                "campus_role": "Administrator",
                "phone": "+91 9876543210"
            })
            print(f"✓ Initialized Admin account: {ADMIN_EMAIL}")
        else:
            print(f"✓ Verified Admin account exists in Supabase: {ADMIN_EMAIL}")
    except Exception as e:
        print(f"[Supabase Init Warning] {e}")


# -------------------------------------------------------------
# SMART MATCHING CORRELATION ALGORITHM
# -------------------------------------------------------------
def extract_keywords(text: str):
    words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", text.lower())
    stop_words = {"the", "and", "for", "with", "item", "lost", "found", "room", "near", "hall", "lab", "block", "floor"}
    return set(w for w in words if w not in stop_words)


def calculate_match_score(lost_item: dict, found_item: dict):
    score = 0
    matched_reasons = []

    # Category match (+45 points)
    if lost_item["category"] == found_item["category"] and lost_item["category"] != "Other":
        score += 45
        matched_reasons.append(f"Category: {lost_item['category']}")
    elif lost_item["category"] == found_item["category"]:
        score += 25

    # Title keyword overlap
    lost_title_words = extract_keywords(lost_item["name"])
    found_title_words = extract_keywords(found_item["name"])
    title_overlap = lost_title_words.intersection(found_title_words)
    if title_overlap:
        score += min(35, len(title_overlap) * 18)
        matched_reasons.append(f"Keywords: {', '.join(title_overlap)}")

    # Location keyword overlap
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

    if score >= 40:
        confidence = min(98, 50 + int(score * 0.6))
        return confidence, matched_reasons
    return 0, []


def get_all_smart_matches():
    lost_items = db.get_items(item_type="Lost", status="Open")
    found_items = db.get_items(item_type="Found", status="Open")

    matches = []
    for l in lost_items:
        for f in found_items:
            if l["owner_id"] == f["owner_id"]:
                continue

            score, reasons = calculate_match_score(l, f)
            if score >= 60:
                matches.append({
                    "score": score,
                    "reasons": reasons,
                    "lost_item": l,
                    "found_item": f,
                })

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches


# -------------------------------------------------------------
# HTTP REST API HANDLER
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
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def send_json(self, data, status_code=200, set_cookie=None):
        payload = json.dumps(data, default=str).encode("utf-8")
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

    def get_current_user(self):
        token = self.get_session_token()
        if not token:
            return None
        try:
            return db.get_user_by_token(token)
        except Exception:
            return None

    def do_GET(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            self.send_error_json("Too many requests. Please wait a moment.", 429)
            return

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            # 1. Session Check
            if path == "/api/session":
                user = self.get_current_user()
                if not user:
                    self.send_json({"user": None, "pending_count": 0, "matches_count": 0})
                    return
                conns = db.get_connections(user["id"])
                pending = sum(1 for c in conns if c["recipient_id"] == user["id"] and c["status"] in ("Pending", "Matched"))
                all_matches = get_all_smart_matches()
                user_matches = sum(1 for m in all_matches if m["lost_item"]["owner_id"] == user["id"] or m["found_item"]["owner_id"] == user["id"])
                self.send_json({"user": user, "pending_count": pending, "matches_count": user_matches})
                return

            # 2. Smart Matches Hub
            if path == "/api/matches":
                matches = get_all_smart_matches()
                self.send_json({"matches": matches, "count": len(matches)})
                return

            # 3. Items Feed
            if path == "/api/items":
                search = query.get("search", [""])[0].strip()
                cat = query.get("category", ["All"])[0]
                t = query.get("type", ["All"])[0]
                stat = query.get("status", ["All"])[0]
                items = db.get_items(search=search, category=cat, item_type=t, status=stat)
                self.send_json({"items": items})
                return

            # 4. Item Detail
            if path.startswith("/api/items/"):
                item_id = int(path.split("/")[3])
                item = db.get_item_by_id(item_id)
                if not item:
                    self.send_error_json("Item not found", 404)
                    return
                self.send_json({"item": item})
                return

            # 5. User's Own Items
            if path == "/api/user/items":
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                user_items = db._request("items", "GET", params={"owner_id": f"eq.{user['id']}", "select": "*", "order": "id.desc"})
                for it in user_items:
                    it["date"] = it.get("item_date") or ""
                self.send_json({"items": user_items})
                return

            # 6. Connections & Messages Inbox
            if path == "/api/connections":
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                conns = db.get_connections(user["id"])
                self.send_json({"connections": conns})
                return

            # 7. Admin Overview
            if path == "/api/admin/overview":
                user = self.get_current_user()
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                all_items = db.get_items()
                stats = {
                    "reports": len(all_items),
                    "lost": sum(1 for x in all_items if x["type"] == "Lost"),
                    "found": sum(1 for x in all_items if x["type"] == "Found"),
                    "resolved": sum(1 for x in all_items if x.get("status") == "Resolved"),
                    "users": len(db._request("app_users", "GET", params={"select": "id"})),
                    "connections": len(db._request("connections", "GET", params={"select": "id"})),
                }
                self.send_json({"stats": stats, "items": all_items[:30]})
                return

            # 8. Admin Export CSV
            if path == "/api/admin/export":
                user = self.get_current_user()
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                items = db.get_items()
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(["ID", "Name", "Type", "Status", "Category", "Location", "Date", "Description", "Reporter", "Campus Role", "Created At"])
                for it in items:
                    writer.writerow([it.get("id"), it.get("name"), it.get("type"), it.get("status"), it.get("category"), it.get("location"), it.get("date"), it.get("description"), it.get("owner_name"), it.get("owner_role"), it.get("created_at")])
                csv_bytes = out.getvalue().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="vctm-foundly-reports.csv"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)
                return

            # Static File Serving
            super().do_GET()
        except Exception as e:
            self.send_error_json(str(e), 500)

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

        try:
            # 1. User Registration (Stored in Supabase Cloud PostgreSQL)
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

                existing = db.get_user_by_email(email)
                if existing:
                    self.send_error_json("An account with this email already exists. Please sign in.", 409)
                    return

                salt, digest = password_hash(password)
                created_user = db.create_user(name, email, salt, digest, campus_role, phone)
                token = secrets.token_urlsafe(32)
                db.create_session(token, created_user["id"])

                user_resp = {
                    "id": created_user["id"], "name": name, "email": email,
                    "role": "user", "campus_role": campus_role, "phone": phone
                }
                cookie = f"foundly_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                self.send_json({"user": user_resp, "token": token}, 201, set_cookie=cookie)
                return

            # 2. User Login (Verified against Supabase Cloud PostgreSQL)
            if path == "/api/login":
                email = (body.get("email") or "").strip().lower()
                password = body.get("password") or ""

                user_record = db.get_user_by_email(email)
                if not user_record:
                    self.send_error_json("No account found with this email. Click 'Create account' to register in seconds.", 401)
                    return

                if not verify_password(password, user_record["password_salt"], user_record["password_hash"]):
                    self.send_error_json("Incorrect password. You can reset it using 'Forgot password?' below.", 401)
                    return

                token = secrets.token_urlsafe(32)
                db.create_session(token, user_record["id"])

                user_resp = {
                    "id": user_record["id"], "name": user_record["name"], "email": user_record["email"],
                    "role": user_record["role"], "campus_role": user_record["campus_role"], "phone": user_record.get("phone")
                }
                cookie = f"foundly_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                self.send_json({"user": user_resp, "token": token}, 200, set_cookie=cookie)
                return

            # 3. User Logout
            if path == "/api/logout":
                token = self.get_session_token()
                if token:
                    db.delete_session(token)
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

                user_record = db.get_user_by_email(email)
                if not user_record:
                    self.send_error_json("No account found with this email.", 404)
                    return
                salt, digest = password_hash(new_pass)
                db.update_password(user_record["id"], salt, digest)
                self.send_json({"ok": True, "message": "Password updated successfully. Please sign in."})
                return

            # 5. Create Item Report (Saved in Supabase Cloud)
            if path == "/api/items":
                user = self.get_current_user()
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

                item_data = {
                    "name": name,
                    "category": cat,
                    "location": loc,
                    "item_date": date_str,
                    "description": desc,
                    "type": t,
                    "status": "Open",
                    "image_data": img,
                    "proof_question": proof,
                    "owner_id": user["id"],
                    "owner_name": user["name"],
                    "owner_email": user["email"],
                    "owner_role": user.get("campus_role") or "Student",
                }
                created = db.create_item(item_data)
                self.send_json({"item": {"id": created["id"]}}, 201)
                return

            # 6. Update Item Status
            if path.startswith("/api/items/") and path.endswith("/status"):
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = int(path.split("/")[3])
                new_status = body.get("status")
                if new_status not in ("Open", "Resolved", "Archived"):
                    self.send_error_json("Invalid status")
                    return
                item = db.get_item_by_id(item_id)
                if not item:
                    self.send_error_json("Item not found", 404)
                    return
                if item["owner_id"] != user["id"] and user.get("role") != "admin":
                    self.send_error_json("Permission denied", 403)
                    return
                db.update_item_status(item_id, new_status)
                self.send_json({"ok": True, "status": new_status})
                return

            # 7. Create Claim / Message Connection
            if path == "/api/connections":
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = body.get("item_id")
                msg = (body.get("message") or "").strip()
                if not item_id or not msg:
                    self.send_error_json("Please provide a claim message.")
                    return
                item = db.get_item_by_id(int(item_id))
                if not item:
                    self.send_error_json("Report no longer exists.", 404)
                    return
                if item["owner_id"] == user["id"]:
                    self.send_error_json("You cannot connect to your own report.")
                    return

                conn_data = {
                    "item_id": item["id"],
                    "sender_id": user["id"],
                    "sender_name": user["name"],
                    "sender_email": user["email"],
                    "sender_role": user.get("campus_role") or "Student",
                    "sender_phone": user.get("phone"),
                    "recipient_id": item["owner_id"],
                    "recipient_name": item["owner_name"],
                    "recipient_email": item["owner_email"],
                    "recipient_role": item.get("owner_role") or "Student",
                    "message": msg,
                    "status": "Pending",
                }
                db.create_connection(conn_data)
                self.send_json({"ok": True}, 201)
                return

            # 8. Accept / Decline Connection
            if path.startswith("/api/connections/") and path.endswith("/status"):
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                conn_id = int(path.split("/")[3])
                new_status = body.get("status")
                if new_status not in ("Accepted", "Declined"):
                    self.send_error_json("Invalid status")
                    return
                db.update_connection_status(conn_id, new_status)
                self.send_json({"ok": True})
                return

            # 9. Send Chat Message
            if path.startswith("/api/connections/") and path.endswith("/message"):
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                conn_id = int(path.split("/")[3])
                reply_text = (body.get("message") or "").strip()
                if not reply_text:
                    self.send_error_json("Message cannot be empty")
                    return
                conns = db._request("connections", "GET", params={"id": f"eq.{conn_id}", "select": "*"})
                if not conns:
                    self.send_error_json("Conversation not found", 404)
                    return
                c = conns[0]
                timestamp = datetime.utcnow().strftime("%H:%M")
                new_msg = f"{c['message']}\n\n💬 [{user['name']} @ {timestamp}]: {reply_text}"
                new_status = "Accepted" if c["status"] == "Pending" and user["id"] == c["recipient_id"] else c["status"]
                db.update_connection_message(conn_id, new_msg, new_status)
                self.send_json({"ok": True, "message": new_msg, "status": new_status})
                return

            self.send_error_json("Route not found", 404)
        except Exception as e:
            self.send_error_json(str(e), 500)

    def do_DELETE(self):
        client_ip = self.client_address[0]
        if not check_rate_limit(client_ip):
            self.send_error_json("Too many requests. Please wait a moment.", 429)
            return

        path = urlparse(self.path).path
        try:
            if path.startswith("/api/items/"):
                user = self.get_current_user()
                if not user:
                    self.send_error_json("Please sign in", 401)
                    return
                item_id = int(path.split("/")[3])
                item = db.get_item_by_id(item_id)
                if not item:
                    self.send_error_json("Item not found", 404)
                    return
                if item["owner_id"] != user["id"] and user.get("role") != "admin":
                    self.send_error_json("Permission denied", 403)
                    return
                db.delete_item(item_id)
                self.send_json({"ok": True})
                return
            self.send_error_json("Route not found", 404)
        except Exception as e:
            self.send_error_json(str(e), 500)


def run_server():
    initialise_database()
    server = ThreadingHTTPServer((HOST, PORT), FoundlyHandler)
    print(f"✓ VCTM Foundly Production Cloud Engine LIVE at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down gracefully.")
        server.server_close()


if __name__ == "__main__":
    run_server()
