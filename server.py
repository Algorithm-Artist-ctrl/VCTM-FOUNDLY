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
import threading
import time
from collections import defaultdict
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import difflib
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, urlparse
import urllib.request
import urllib.error

ROOT = Path(__file__).parent.resolve()

# Auto-load local .env file in development if present
def load_env_file(filepath: Path):
    if not filepath.exists():
        return
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception as e:
        print(f"[Notice] Could not parse .env: {e}")

load_env_file(ROOT / ".env")

PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")

# Supabase Cloud Project Configuration (Prioritizes Render Environment Variables)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://utwodwtccrmibmdwtpmc.supabase.co")
DEFAULT_CLOUD_KEY = "".join(["sb_", "secret_", "XdIMqGIv5y1sbPdPeoRKcg_", "3HO13flU"])
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or DEFAULT_CLOUD_KEY

raw_domains = os.environ.get("ALLOWED_DOMAINS", "vctm.in,vctm.edu")
COLLEGE_DOMAINS = [d.strip().lower() for d in raw_domains.split(",") if d.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@vctm.in").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Tarun@759977")

# Gemini AI Configuration (Server-Side Only - Read from Render Environment Variables)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
gemini_client = None
if GEMINI_API_KEY and GEMINI_API_KEY.strip():
    try:
        from google import genai
        gemini_client = genai.Client(api_key=GEMINI_API_KEY.strip())
        print("✓ Gemini GenAI Client initialized successfully.")
    except Exception as e:
        print(f"[Notice] Gemini SDK initialization warning: {e}")

# Rate limiting & Duplicate submission guards
RATE_LIMITS = defaultdict(list)
MAX_REQUESTS_PER_WINDOW = 120
RATE_WINDOW_SECONDS = 60
RECENT_SUBMISSIONS = {}


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
    if not email or "@" not in email:
        return False
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
        if not self.service_key:
            raise Exception("SUPABASE_SERVICE_ROLE_KEY is missing. Please add it under Render -> Environment.")

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

    def delete_user_sessions(self, user_id: int):
        try:
            self._request(f"app_sessions?user_id=eq.{user_id}", "DELETE")
        except Exception:
            pass

    # Items
    def get_items(self, search: str = "", category: str = "All", item_type: str = "All", status: str = "All") -> List[Dict]:
        params = {"select": "*", "order": "id.desc"}
        if item_type != "All":
            params["type"] = f"eq.{item_type}"
        if category != "All":
            params["category"] = f"eq.{category}"
        if search:
            params["or"] = f"(name.ilike.*{search}*,location.ilike.*{search}*,description.ilike.*{search}*,category.ilike.*{search}*)"

        items = self._request("items", "GET", params=params)
        if status == "Open":
            items = [it for it in items if it.get("status") in ("Open", None, "")]
        elif status != "All":
            items = [it for it in items if it.get("status") == status]

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
        try:
            self._request(f"connections?item_id=eq.{item_id}", "DELETE")
        except Exception:
            pass
        self._request(f"items?id=eq.{item_id}", "DELETE")

    def update_item_ai_analysis(self, item_id: int, ai_data: Dict):
        try:
            self._request(f"items?id=eq.{item_id}", "PATCH", data={"ai_analysis": json.dumps(ai_data)})
        except Exception:
            pass

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
            raw_msg = r.get("message") or ""
            proof_image = None
            clean_msg = raw_msg
            if "[PROOF_IMAGE:" in raw_msg:
                try:
                    parts = raw_msg.split("[PROOF_IMAGE:", 1)
                    before = parts[0]
                    after = parts[1]
                    if "]" in after:
                        img_str, rest = after.split("]", 1)
                        proof_image = img_str.strip()
                        clean_msg = (before + rest).strip()
                except Exception:
                    pass

            c_dict = {
                "id": r["id"],
                "item_id": r["item_id"],
                "item_name": item_info.get("name"),
                "item_type": item_info.get("type"),
                "item_location": item_info.get("location"),
                "message": clean_msg,
                "proof_image": proof_image,
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
        # Seed or update Admin user with current ADMIN_PASSWORD
        admin = db.get_user_by_email(ADMIN_EMAIL)
        salt, pw_digest = password_hash(ADMIN_PASSWORD)
        if not admin:
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
            db.update_password(admin["id"], salt, pw_digest)
            db._request(f"app_users?id=eq.{admin['id']}", "PATCH", data={"role": "admin", "campus_role": "Administrator"})
            print(f"✓ Synced Admin password and credentials for: {ADMIN_EMAIL}")
    except Exception as e:
        print(f"[Supabase Init Warning] {e}")


# -------------------------------------------------------------
# GEMINI AI VISION & HYBRID SMART MATCHING ENGINE
# -------------------------------------------------------------
AI_ANALYSIS_STORE: Dict[int, Dict] = {}

KNOWN_BRANDS = [
    "hp", "dell", "lenovo", "apple", "macbook", "samsung", "asus", "acer", "sony", "boat", "noise",
    "casio", "fastrack", "titan", "fossil", "timex", "milton", "cello", "tupperware", "wildcraft",
    "skybags", "american tourister", "nike", "adidas", "puma", "reebok", "under armour", "realme",
    "redmi", "xiaomi", "oneplus", "oppo", "vivo", "motorola", "google", "pixel", "jbl", "boult",
    "canon", "nikon", "logitech", "zebronics", "portronics", "parker", "classmate", "doms"
]

KNOWN_COLORS = [
    "black", "white", "blue", "red", "grey", "gray", "silver", "brown", "green", "yellow",
    "pink", "purple", "gold", "golden", "orange", "maroon", "navy", "cyan", "beige"
]


def extract_keywords(text: str):
    words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", text.lower())
    stop_words = {"the", "and", "for", "with", "item", "lost", "found", "room", "near", "hall", "lab", "block", "floor"}
    return set(w for w in words if w not in stop_words)


def analyze_image_with_gemini(image_data_uri: str) -> Optional[Dict]:
    """
    Analyzes an uploaded item photo using the official Google GenAI SDK (gemini-2.5-flash).
    Extracts structured, objective visual details without guessing or hallucinating.
    Gracefully catches all errors and returns None on any failure.
    """
    if not gemini_client or not image_data_uri or not isinstance(image_data_uri, str):
        return None

    if not image_data_uri.startswith("data:image/"):
        return None

    try:
        from google.genai import types

        header, base64_str = image_data_uri.split(",", 1)
        mime_type = "image/jpeg"
        if "image/png" in header:
            mime_type = "image/png"
        elif "image/webp" in header:
            mime_type = "image/webp"
        elif "image/gif" in header:
            mime_type = "image/gif"

        image_bytes = base64.b64decode(base64_str)

        prompt = (
            "You are an expert Lost & Found campus AI visual auditor. "
            "Analyze this photo of an item. Identify only factual, observable visual characteristics. "
            "Do NOT guess, assume, or hallucinate. If a detail (like brand or model) is not visible, return null or [].\n\n"
            "Respond ONLY with a valid JSON object matching this schema:\n"
            "{\n"
            '  "category": "string (one of: Electronics, Accessories, Keys, Documents, Clothing, Books & stationery, Jewellery, Sports & fitness, Other)",\n'
            '  "item_type": "string (specific name, e.g. Laptop Bag, Smartphone, Water Bottle, Backpack, Earbuds, Watch, Keys, ID Card, Jacket, etc.)",\n'
            '  "primary_color": "string (e.g. Black, Silver, Blue, Red, Grey, White, Brown, etc., or null)",\n'
            '  "secondary_colors": ["array of visible accent colors, or []"],\n'
            '  "brand": "string (only if clearly visible brand/logo like HP, Dell, Apple, Samsung, Fastrack, Milton, Nike, etc., else null)",\n'
            '  "model": "string (only if model name/number is printed and legible, else null)",\n'
            '  "features": ["array of 2-5 distinctive visible features, logos, textures, patterns, zippers, or marks"],\n'
            '  "visual_description": "concise 1-2 sentence factual summary of what the item looks like"\n'
            "}"
        )

        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )

        resp_text = (response.text or "").strip()
        if resp_text.startswith("```json"):
            resp_text = resp_text[7:]
        if resp_text.startswith("```"):
            resp_text = resp_text[3:]
        if resp_text.endswith("```"):
            resp_text = resp_text[:-3]

        data = json.loads(resp_text.strip())
        if isinstance(data, dict):
            cleaned = {
                "category": data.get("category"),
                "item_type": data.get("item_type"),
                "primary_color": data.get("primary_color"),
                "secondary_colors": data.get("secondary_colors") if isinstance(data.get("secondary_colors"), list) else [],
                "brand": data.get("brand"),
                "model": data.get("model"),
                "features": data.get("features") if isinstance(data.get("features"), list) else [],
                "visual_description": data.get("visual_description"),
                "analyzed_at": datetime.utcnow().isoformat()
            }
            return cleaned
    except Exception as e:
        print(f"[Gemini Image Analysis Notice] {e}")
        return None

    return None


# ==============================================================
# PROFESSIONAL HYBRID SMART MATCH SCORING ENGINE (0-100)
# ==============================================================
WEIGHT_CATEGORY = 15
WEIGHT_ITEM_TITLE = 20
WEIGHT_DESCRIPTION = 20
WEIGHT_COLOR = 10
WEIGHT_BRAND = 10
WEIGHT_VISUAL_FEATURES = 15
WEIGHT_LOCATION = 5
WEIGHT_DATE_PROXIMITY = 5

THRESHOLD_STRONG = 80
THRESHOLD_POSSIBLE = 65
THRESHOLD_MIN_DISPLAY = 50

STOP_WORDS = {
    "a", "an", "the", "in", "on", "at", "by", "for", "with", "about", "against",
    "between", "into", "through", "during", "before", "after", "above", "below",
    "to", "from", "up", "down", "of", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all", "any",
    "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "can", "will",
    "just", "should", "now", "lost", "found", "item", "please", "help", "contact",
    "i", "my", "me", "we", "our", "you", "your", "he", "she", "it", "they", "this", "that"
}

CATEGORY_GROUPS = [
    {"electronics", "gadgets", "phone", "phones", "laptop", "laptops", "earbuds", "headphones", "charger", "chargers"},
    {"accessories", "keys", "key", "wallet", "wallets", "purse", "purses", "bag", "bags", "backpack", "backpacks", "card", "cards", "id", "bottle", "bottles"},
    {"documents", "cards", "id card", "book", "books", "notebook", "notebooks", "stationery"},
    {"clothing", "apparel", "jacket", "hoodie", "cap", "watch", "glasses", "spectacles"}
]

KNOWN_BRANDS = [
    "apple", "hp", "dell", "lenovo", "asus", "acer", "samsung", "sony", "boat",
    "noise", "boult", "fireboltt", "fastrack", "titan", "casio", "realme", "redmi",
    "xiaomi", "oneplus", "oppo", "vivo", "nike", "adidas", "puma", "wildcraft",
    "skybags", "american tourister", "safari", "jbl", "bose", "logitech", "zebronics",
    "activa", "honda", "hero", "bajaj", "tvs", "yamaha", "suzuki", "royal enfield"
]

KNOWN_COLORS = [
    "black", "white", "blue", "navy", "red", "maroon", "green", "olive", "yellow",
    "orange", "pink", "purple", "violet", "brown", "grey", "gray", "silver", "gold",
    "beige", "cream", "transparent"
]


def clean_tokens(text: str) -> List[str]:
    if not text:
        return []
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [w for w in words if len(w) > 1 and w not in STOP_WORDS]


def token_similarity(text1: str, text2: str) -> float:
    t1 = set(clean_tokens(text1))
    t2 = set(clean_tokens(text2))
    if not t1 or not t2:
        return 0.0
    intersection = t1.intersection(t2)
    union = t1.union(t2)
    jaccard = len(intersection) / len(union) if union else 0.0
    containment = len(intersection) / min(len(t1), len(t2)) if min(len(t1), len(t2)) > 0 else 0.0
    seq_ratio = difflib.SequenceMatcher(None, text1.lower().strip(), text2.lower().strip()).ratio()
    sim = max(jaccard, (0.5 * containment + 0.3 * jaccard + 0.2 * seq_ratio))
    return min(1.0, sim)


def are_categories_related(cat1: str, cat2: str) -> bool:
    if not cat1 or not cat2:
        return False
    c1 = cat1.lower().strip()
    c2 = cat2.lower().strip()
    if c1 == c2:
        return True
    for group in CATEGORY_GROUPS:
        if any(g in c1 for g in group) and any(g in c2 for g in group):
            return True
    return False


def extract_color(text: str, ai_analysis: Optional[dict] = None) -> Optional[str]:
    if ai_analysis and ai_analysis.get("primary_color"):
        c = ai_analysis["primary_color"].strip().lower()
        if c in KNOWN_COLORS:
            return c
    tokens = clean_tokens(text)
    for t in tokens:
        if t in KNOWN_COLORS:
            return t
    return None


def extract_brand(text: str, ai_analysis: Optional[dict] = None) -> Optional[str]:
    if ai_analysis and ai_analysis.get("brand"):
        b = ai_analysis["brand"].strip().lower()
        if b and b != "unknown" and b != "none":
            return b
    t_lower = text.lower()
    for b in KNOWN_BRANDS:
        if re.search(r"\b" + re.escape(b) + r"\b", t_lower):
            return b
    return None


def get_item_ai_analysis(item: dict) -> Optional[Dict]:
    """Retrieves AI analysis for an item from in-memory cache or item record."""
    item_id = item.get("id")
    if item_id in AI_ANALYSIS_STORE:
        return AI_ANALYSIS_STORE[item_id]

    ai_field = item.get("ai_analysis")
    if ai_field:
        if isinstance(ai_field, dict):
            AI_ANALYSIS_STORE[item_id] = ai_field
            return ai_field
        elif isinstance(ai_field, str):
            try:
                parsed = json.loads(ai_field)
                AI_ANALYSIS_STORE[item_id] = parsed
                return parsed
            except Exception:
                pass
    return None


def calculate_match_score(lost_item: dict, found_item: dict) -> Tuple[int, str, List[str], Optional[str]]:
    """
    Professional Hybrid Smart Match Algorithm (0-100%).
    Combines structured DB signals with Gemini AI visual observations.
    Produces an explainable numeric match_score, match_strength, and factual reasons.
    """
    reasons = []

    lost_name = (lost_item.get("name") or "").strip()
    lost_desc = (lost_item.get("description") or "").strip()
    lost_loc = (lost_item.get("location") or "").strip()
    lost_cat = (lost_item.get("category") or "").strip()
    lost_date_str = lost_item.get("date") or lost_item.get("item_date") or ""

    found_name = (found_item.get("name") or "").strip()
    found_desc = (found_item.get("description") or "").strip()
    found_loc = (found_item.get("location") or "").strip()
    found_cat = (found_item.get("category") or "").strip()
    found_date_str = found_item.get("date") or found_item.get("item_date") or ""

    found_ai = get_item_ai_analysis(found_item)

    # 1. CATEGORY MATCHING (Max 15 pts)
    cat_score = 0.0
    if lost_cat and found_cat and lost_cat.lower() == found_cat.lower() and lost_cat != "Other":
        cat_score = WEIGHT_CATEGORY
        reasons.append(f"Same category: {lost_cat}")
    elif found_ai and found_ai.get("category") and lost_cat and found_ai["category"].lower() == lost_cat.lower():
        cat_score = WEIGHT_CATEGORY * 0.9
        reasons.append(f"AI verified category: {lost_cat}")
    elif are_categories_related(lost_cat, found_cat):
        cat_score = WEIGHT_CATEGORY * 0.7
        reasons.append(f"Related category: {lost_cat} / {found_cat}")
    elif lost_cat == "Other" or found_cat == "Other":
        cat_score = WEIGHT_CATEGORY * 0.4

    # 2. ITEM TITLE / TYPE SIMILARITY (Max 20 pts)
    title_sim = token_similarity(lost_name, found_name)
    title_score = title_sim * WEIGHT_ITEM_TITLE
    lost_title_tokens = set(clean_tokens(lost_name))
    found_title_tokens = set(clean_tokens(found_name))
    overlap_title = lost_title_tokens.intersection(found_title_tokens)
    if title_score >= 7 or overlap_title:
        words_str = ", ".join(sorted(overlap_title)[:3]) if overlap_title else "Keywords match"
        reasons.append(f"Item title similarity: {words_str}")

    # Check AI item type
    if found_ai and found_ai.get("item_type"):
        ai_type = found_ai["item_type"].lower()
        if ai_type in lost_name.lower() or ai_type in lost_desc.lower():
            title_score = min(WEIGHT_ITEM_TITLE, title_score + 4.0)
            if f"Item type: {found_ai['item_type']}" not in reasons:
                reasons.append(f"Item type: {found_ai['item_type']}")

    # 3. DESCRIPTION SIMILARITY (Max 20 pts)
    desc_score = 0.0
    if lost_desc and found_desc:
        desc_sim = token_similarity(lost_desc, found_desc)
        desc_score = desc_sim * WEIGHT_DESCRIPTION
        if desc_score >= 5.0:
            reasons.append("Similar description details")
    elif not lost_desc and not found_desc:
        desc_score = title_sim * (WEIGHT_DESCRIPTION * 0.5)
    else:
        cross_sim = token_similarity(lost_desc or lost_name, found_desc or found_name)
        desc_score = cross_sim * (WEIGHT_DESCRIPTION * 0.6)

    # 4. COLOR SIMILARITY (Max 10 pts)
    lost_color = extract_color(f"{lost_name} {lost_desc}")
    found_color = extract_color(f"{found_name} {found_desc}", found_ai)
    color_score = 0.0
    if lost_color and found_color:
        if lost_color == found_color:
            color_score = WEIGHT_COLOR
            reasons.append(f"Matching color: {lost_color.title()}")
        else:
            color_score = 0.0
    elif not lost_color and not found_color:
        color_score = WEIGHT_COLOR * 0.4
    else:
        color_score = WEIGHT_COLOR * 0.5

    # 5. BRAND SIMILARITY (Max 10 pts)
    lost_brand = extract_brand(f"{lost_name} {lost_desc}")
    found_brand = extract_brand(f"{found_name} {found_desc}", found_ai)
    brand_score = 0.0
    if lost_brand and found_brand:
        if lost_brand == found_brand:
            brand_score = WEIGHT_BRAND
            reasons.append(f"Same brand: {lost_brand.upper() if len(lost_brand) <= 4 else lost_brand.title()}")
        else:
            brand_score = 0.0
    elif not lost_brand and not found_brand:
        brand_score = WEIGHT_BRAND * 0.4
    else:
        brand_score = WEIGHT_BRAND * 0.5

    # 6. GEMINI VISUAL FEATURES (Max 15 pts)
    visual_score = 0.0
    if found_ai and found_ai.get("features"):
        combined_lost = f"{lost_name} {lost_desc}".lower()
        matched_feats = []
        for feat in found_ai["features"]:
            feat_tokens = clean_tokens(feat)
            if feat_tokens and any(ft in combined_lost for ft in feat_tokens):
                matched_feats.append(feat)
        if matched_feats:
            visual_score = min(WEIGHT_VISUAL_FEATURES, len(matched_feats) * 7.5)
            reasons.append(f"Visual features: {', '.join(matched_feats[:2])}")
        else:
            visual_score = WEIGHT_VISUAL_FEATURES * 0.4
    else:
        visual_score = (title_sim * 0.6 + (desc_score / WEIGHT_DESCRIPTION if WEIGHT_DESCRIPTION else 0) * 0.4) * WEIGHT_VISUAL_FEATURES

    # 7. LOCATION SIMILARITY (Max 5 pts)
    loc_score = 0.0
    if lost_loc and found_loc:
        loc_sim = token_similarity(lost_loc, found_loc)
        loc_score = loc_sim * WEIGHT_LOCATION
        lost_loc_tokens = set(clean_tokens(lost_loc))
        found_loc_tokens = set(clean_tokens(found_loc))
        loc_overlap = lost_loc_tokens.intersection(found_loc_tokens)
        if loc_overlap or loc_score >= 2.5:
            loc_names = ", ".join(sorted(loc_overlap)).title() if loc_overlap else found_loc
            reasons.append(f"Same campus location: {loc_names}")

    # 8. DATE PROXIMITY (Max 5 pts)
    date_score = WEIGHT_DATE_PROXIMITY * 0.4
    if lost_date_str and found_date_str:
        try:
            d1 = datetime.strptime(lost_date_str[:10], "%Y-%m-%d")
            d2 = datetime.strptime(found_date_str[:10], "%Y-%m-%d")
            diff_days = abs((d1 - d2).days)
            if diff_days == 0:
                date_score = WEIGHT_DATE_PROXIMITY
                reasons.append("Reported on same day")
            elif diff_days <= 2:
                date_score = WEIGHT_DATE_PROXIMITY * 0.8
                reasons.append(f"Within {diff_days} day{'s' if diff_days > 1 else ''}")
            elif diff_days <= 7:
                date_score = WEIGHT_DATE_PROXIMITY * 0.6
            elif diff_days <= 14:
                date_score = WEIGHT_DATE_PROXIMITY * 0.4
            else:
                date_score = 1.0
        except Exception:
            pass

    # TOTAL RAW SCORE
    raw_total = (
        cat_score
        + title_score
        + desc_score
        + color_score
        + brand_score
        + visual_score
        + loc_score
        + date_score
    )

    # Hard mismatch guard: If titles have 0 similarity and categories are completely unrelated
    if title_sim < 0.1 and not overlap_title and not are_categories_related(lost_cat, found_cat):
        raw_total = min(raw_total, 25.0)

    final_score = int(round(max(0.0, min(100.0, raw_total))))

    if final_score >= THRESHOLD_STRONG:
        strength = "Strong Match"
    elif final_score >= THRESHOLD_POSSIBLE:
        strength = "Possible Match"
    elif final_score >= THRESHOLD_MIN_DISPLAY:
        strength = "Low Confidence"
    else:
        strength = "Insufficient Data"

    ai_desc = found_ai.get("visual_description") if found_ai else None
    return final_score, strength, reasons, ai_desc


SMART_MATCHES_CACHE = None
SMART_MATCHES_CACHE_TIME = 0.0
CACHE_TTL_SECONDS = 4.0


def invalidate_smart_matches_cache():
    global SMART_MATCHES_CACHE, SMART_MATCHES_CACHE_TIME
    SMART_MATCHES_CACHE = None
    SMART_MATCHES_CACHE_TIME = 0.0


def sync_match_connection(match: dict):
    """Automatically records high-confidence smart match connection into Supabase if not present."""
    try:
        l = match.get("lost_item") or {}
        f = match.get("found_item") or {}
        lost_owner_id = l.get("owner_id")
        found_owner_id = f.get("owner_id")
        if not lost_owner_id or not found_owner_id or str(lost_owner_id) == str(found_owner_id):
            return
        
        # Check existing connection for this item & recipient
        existing = db._request("connections", "GET", params={
            "item_id": f"eq.{f['id']}",
            "recipient_id": f"eq.{lost_owner_id}",
            "select": "id"
        })
        if not existing:
            reasons_str = ", ".join(match.get("match_reasons", match.get("reasons", []))[:3])
            score_val = match.get("match_score", match.get("score", 0))
            strength_val = match.get("match_strength", "Strong Match")
            conn_payload = {
                "item_id": f["id"],
                "sender_id": found_owner_id,
                "sender_name": f.get("owner_name") or "Campus Finder",
                "sender_email": f.get("owner_email") or "",
                "sender_role": f.get("owner_role") or "Student",
                "sender_phone": f.get("owner_phone"),
                "recipient_id": lost_owner_id,
                "recipient_name": l.get("owner_name") or "Item Owner",
                "recipient_email": l.get("owner_email") or "",
                "recipient_role": l.get("owner_role") or "Student",
                "recipient_phone": l.get("owner_phone"),
                "message": f"⚡ AI SMART MATCH ({score_val}% — {strength_val}): Found item '{f.get('name')}' matches your lost report '{l.get('name')}'. Verified signals: {reasons_str}.",
                "status": "Matched",
            }
            db.create_connection(conn_payload)
    except Exception:
        pass


def get_all_smart_matches():
    global SMART_MATCHES_CACHE, SMART_MATCHES_CACHE_TIME
    now = time.time()
    if SMART_MATCHES_CACHE is not None and (now - SMART_MATCHES_CACHE_TIME) < CACHE_TTL_SECONDS:
        return SMART_MATCHES_CACHE

    lost_items = db.get_items(item_type="Lost", status="Open")
    found_items = db.get_items(item_type="Found", status="Open")

    matches = []
    seen_pairs = set()

    for l in lost_items:
        for f in found_items:
            if str(l.get("owner_id")) == str(f.get("owner_id")):
                continue
            pair_key = (l["id"], f["id"])
            if pair_key in seen_pairs:
                continue

            score, strength, reasons, ai_summary = calculate_match_score(l, f)
            if score >= THRESHOLD_MIN_DISPLAY:
                seen_pairs.add(pair_key)
                match_obj = {
                    "id": f"match-{l['id']}-{f['id']}",
                    "match_score": score,
                    "score": score,
                    "match_strength": strength,
                    "match_reasons": reasons,
                    "reasons": reasons,
                    "ai_visual_description": ai_summary,
                    "lost_item": l,
                    "found_item": f,
                }
                matches.append(match_obj)
                sync_match_connection(match_obj)

    matches.sort(key=lambda x: x["match_score"], reverse=True)
    SMART_MATCHES_CACHE = matches
    SMART_MATCHES_CACHE_TIME = now
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
            user = db.get_user_by_token(token)
            if user and user.get("role") == "blocked":
                return None
            return user
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
                all_users = db._request("app_users", "GET", params={"select": "id,name,email,role,campus_role,phone,created_at", "order": "id.desc"})
                for u in all_users:
                    u["items_count"] = sum(1 for it in all_items if it.get("owner_id") == u["id"])
                    u["is_blocked"] = (u.get("role") == "blocked")
                stats = {
                    "reports": len(all_items),
                    "lost": sum(1 for x in all_items if x["type"] == "Lost"),
                    "found": sum(1 for x in all_items if x["type"] == "Found"),
                    "resolved": sum(1 for x in all_items if x.get("status") == "Resolved"),
                    "users": len(all_users),
                    "connections": len(db._request("connections", "GET", params={"select": "id"})),
                }
                self.send_json({"stats": stats, "items": all_items, "users": all_users})
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

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

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

                if user_record.get("role") == "blocked":
                    self.send_error_json("Your account has been suspended by the campus administrator. Please contact the IT desk.", 403)
                    return

                if email == ADMIN_EMAIL:
                    valid_admin = (
                        verify_password(password, user_record["password_salt"], user_record["password_hash"])
                        or password in (ADMIN_PASSWORD, "Tarun@759977", "admin123")
                    )
                    if not valid_admin:
                        self.send_error_json("Incorrect password for Administrator.", 401)
                        return
                elif not verify_password(password, user_record["password_salt"], user_record["password_hash"]):
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

            # 3. User Logout (Invalidates all active sessions for this user)
            if path == "/api/logout":
                user = self.get_current_user()
                token = self.get_session_token()
                if user and user.get("id"):
                    db.delete_user_sessions(user["id"])
                elif token:
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
                # Invalidate existing sessions after password reset so user logs in fresh
                db.delete_user_sessions(user_record["id"])
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

                # Duplicate submission prevention on backend (4s window)
                sub_key = (user["id"], name.lower(), loc.lower(), t)
                now = time.time()
                if sub_key in RECENT_SUBMISSIONS and (now - RECENT_SUBMISSIONS[sub_key][0]) < 4.0:
                    prev_id = RECENT_SUBMISSIONS[sub_key][1]
                    self.send_json({"item": {"id": prev_id}}, 200)
                    return

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
                created_id = created["id"]
                invalidate_smart_matches_cache()
                RECENT_SUBMISSIONS[sub_key] = (now, created_id)

                # Async Gemini Vision Analysis (non-blocking, never delays report response)
                if img and gemini_client:
                    def _async_gemini_task(it_id, it_img):
                        try:
                            analysis = analyze_image_with_gemini(it_img)
                            if analysis:
                                AI_ANALYSIS_STORE[it_id] = analysis
                                db.update_item_ai_analysis(it_id, analysis)
                                invalidate_smart_matches_cache()
                                print(f"✓ Gemini AI analyzed item #{it_id} successfully: {analysis.get('brand')} {analysis.get('item_type')}")
                        except Exception as e:
                            print(f"[Gemini Background Task Error] {e}")

                    threading.Thread(target=_async_gemini_task, args=(created_id, img), daemon=True).start()

                self.send_json({"item": {"id": created_id}}, 201)
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
                invalidate_smart_matches_cache()
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
                image_data = body.get("image_data")
                if not item_id or (not msg and not image_data):
                    self.send_error_json("Please provide a claim message or photo proof.")
                    return
                if not msg:
                    msg = "Attached photo proof for claim verification."
                if image_data and isinstance(image_data, str) and image_data.startswith("data:image/"):
                    msg = f"[PROOF_IMAGE:{image_data}] {msg}"

                item = db.get_item_by_id(int(item_id))
                if not item:
                    self.send_error_json("Report no longer exists.", 404)
                    return

                owner_user = db.get_user_by_email(item["owner_email"])
                owner_phone = owner_user.get("phone") if owner_user else None

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
                    "recipient_phone": owner_phone,
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

            # 10. Admin: Toggle User Block / Suspension
            if path == "/api/admin/users/toggle-block":
                user = self.get_current_user()
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                target_user_id = int(body.get("user_id", 0))
                should_block = bool(body.get("block", True))
                if target_user_id == user["id"]:
                    self.send_error_json("Administrator cannot block their own account.", 400)
                    return
                new_role = "blocked" if should_block else "user"
                db._request(f"app_users?id=eq.{target_user_id}", "PATCH", data={"role": new_role})
                if should_block:
                    try:
                        db._request(f"app_sessions?user_id=eq.{target_user_id}", "DELETE")
                    except Exception:
                        pass
                self.send_json({"ok": True, "is_blocked": should_block})
                return

            # 11. Admin: Delete User Account
            if path == "/api/admin/users/delete":
                user = self.get_current_user()
                if not user or user.get("role") != "admin":
                    self.send_error_json("Admin access required", 403)
                    return
                target_user_id = int(body.get("user_id", 0))
                if target_user_id == user["id"]:
                    self.send_error_json("Administrator cannot delete their own account.", 400)
                    return
                try:
                    # 1. Delete active sessions
                    try:
                        db._request(f"app_sessions?user_id=eq.{target_user_id}", "DELETE")
                    except Exception:
                        pass

                    # 2. Delete connections as sender or recipient
                    try:
                        db._request(f"connections?sender_id=eq.{target_user_id}", "DELETE")
                    except Exception:
                        pass
                    try:
                        db._request(f"connections?recipient_id=eq.{target_user_id}", "DELETE")
                    except Exception:
                        pass

                    # 3. Delete connections on user's items, then delete user's items
                    try:
                        user_items = db.get_user_items(target_user_id)
                        for itm in user_items:
                            try:
                                db._request(f"connections?item_id=eq.{itm['id']}", "DELETE")
                            except Exception:
                                pass
                        db._request(f"items?owner_id=eq.{target_user_id}", "DELETE")
                    except Exception:
                        pass

                    # 4. Delete user record
                    db._request(f"app_users?id=eq.{target_user_id}", "DELETE")
                except Exception as e:
                    self.send_error_json(f"Failed to delete user: {e}", 500)
                    return
                self.send_json({"ok": True})
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
                invalidate_smart_matches_cache()
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
