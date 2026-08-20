"""VCTM Foundly - Enterprise Production Backend (FastAPI + SQLAlchemy + PostgreSQL/SQLite).

High-concurrency asynchronous API and web application server with database ORM,
automated smart-matching notifications, direct connection channels, OpenAPI documentation, and security middleware.
"""
import csv
import hashlib
import io
import os
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response as RawResponse
from pydantic import BaseModel, Field
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    desc,
    func,
    or_,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session

ROOT = Path(__file__).parent

# -------------------------------------------------------------
# DATABASE CONFIGURATION (PostgreSQL or SQLite)
# -------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    db_file = os.environ.get("DATABASE_PATH", str(ROOT / "foundly.db"))
    DATABASE_URL = f"sqlite:///{db_file}"
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# -------------------------------------------------------------
# CONFIGURATION & RATE LIMITING
# -------------------------------------------------------------
raw_domains = os.environ.get("ALLOWED_DOMAINS", "vctm.in,vctm.edu,gmail.com,foundly.test")
COLLEGE_DOMAINS = [d.strip().lower() for d in raw_domains.split(",") if d.strip()]
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@foundly.test").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ALLOW_ALL_DOMAINS = "*" in COLLEGE_DOMAINS or os.environ.get("ALLOW_ALL_DOMAINS", "").lower() in ("true", "1")

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
# ORM DATABASE MODELS
# -------------------------------------------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)
    password_salt = Column(String(64), nullable=False)
    password_hash = Column(String(128), nullable=False)
    role = Column(String(20), default="user")
    campus_role = Column(String(50), default="Student")
    phone = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("Item", back_populates="owner", cascade="all, delete-orphan")


class UserSession(Base):
    __tablename__ = "sessions"
    token = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    category = Column(String(50), nullable=False)
    location = Column(String(120), nullable=False)
    item_date = Column(String(30), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(20), nullable=False)  # 'Lost' or 'Found'
    status = Column(String(20), default="Open")  # 'Open' or 'Resolved'
    image_data = Column(Text, nullable=True)
    proof_question = Column(String(200), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="items")
    connections = relationship("Connection", back_populates="item", cascade="all, delete-orphan")


class Connection(Base):
    __tablename__ = "connections"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), default="Pending")  # 'Pending', 'Accepted', 'Declined', 'Matched'
    created_at = Column(DateTime, default=datetime.utcnow)

    item = relationship("Item", back_populates="connections")
    sender = relationship("User", foreign_keys=[sender_id])
    recipient = relationship("User", foreign_keys=[recipient_id])


# Create database schema
Base.metadata.create_all(bind=engine)


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
# DATABASE INITIAL SEEDING
# -------------------------------------------------------------
def seed_database():
    db = SessionLocal()
    try:
        # Seed Admin user
        admin = db.query(User).filter(func.lower(User.email) == ADMIN_EMAIL).first()
        if not admin:
            salt, digest = password_hash(ADMIN_PASSWORD)
            admin = User(
                name="VCTM Administrator",
                email=ADMIN_EMAIL,
                password_salt=salt,
                password_hash=digest,
                role="admin",
                campus_role="Administrator",
                phone="+91 9876543210",
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)

        # Seed sample items if database is fresh
        if db.query(Item).count() == 0:
            samples = [
                ("Silver laptop sleeve", "Electronics", "Engineering block", "2026-08-20", "Left near the second-floor computer lab.", "Found", "Open", "What color is the zipper pull?"),
                ("Brown leather wallet", "Accessories", "Student centre", "2026-08-20", "Contains ID card and student passes.", "Lost", "Open", "What initials are embossed inside?"),
                ("Set of house keys", "Keys", "West parking", "2026-08-20", "Three silver keys on a yellow spiral keyring.", "Found", "Open", "Describe the small figurine attached."),
                ("Blue water bottle", "Other", "Sports complex", "2026-08-20", "Insulated bottle with college club stickers.", "Lost", "Open", ""),
                ("Engineering drawing book", "Books & stationery", "Mechanical lab", "2026-08-19", "Contains ED assignment sheets with name on first page.", "Lost", "Resolved", ""),
                ("Prescription glasses", "Accessories", "Seminar hall", "2026-08-18", "Black rectangular frame in a blue hard case.", "Found", "Open", "Brand of the case?"),
            ]
            for s in samples:
                it = Item(
                    name=s[0], category=s[1], location=s[2], item_date=s[3],
                    description=s[4], type=s[5], status=s[6], proof_question=s[7],
                    owner_id=admin.id
                )
                db.add(it)
            db.commit()
    finally:
        db.close()


seed_database()

# -------------------------------------------------------------
# FASTAPI APPLICATION & MIDDLEWARE
# -------------------------------------------------------------
app = FastAPI(
    title="VCTM Foundly API",
    description="Enterprise Campus Lost and Found REST API with Automated Smart Matcher",
    version="2.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "127.0.0.1"
    if request.url.path.startswith("/api/") and request.method in ("POST", "DELETE"):
        if not check_rate_limit(client_ip):
            return JSONResponse(status_code=429, content={"error": "Too many requests. Please wait a moment."})

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# -------------------------------------------------------------
# DEPENDENCIES (DUAL COOKIE & BEARER TOKEN)
# -------------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get("foundly_session")
    if not token:
        return None

    session_row = db.query(UserSession).filter(UserSession.token == token).first()
    if not session_row:
        return None
    return db.query(User).filter(User.id == session_row.user_id).first()


def require_user(current_user: Optional[User] = Depends(get_current_user)) -> User:
    if not current_user:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return current_user


def require_admin(current_user: User = Depends(require_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    return current_user


# -------------------------------------------------------------
# PYDANTIC SCHEMAS
# -------------------------------------------------------------
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    campus_role: Optional[str] = "Student"
    phone: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str


class ItemCreateRequest(BaseModel):
    name: str
    category: Optional[str] = "Other"
    location: str
    date: Optional[str] = None
    description: Optional[str] = ""
    type: str  # 'Lost' or 'Found'
    image_data: Optional[str] = None
    proof_question: Optional[str] = ""


class ItemStatusRequest(BaseModel):
    status: str  # 'Open' or 'Resolved'


class ConnectionCreateRequest(BaseModel):
    item_id: int
    message: str


class ConnectionStatusRequest(BaseModel):
    status: str  # 'Accepted' or 'Declined'


class MessageReplyRequest(BaseModel):
    message: str


# -------------------------------------------------------------
# STATIC FILE ROUTES (FRONTEND SPA)
# -------------------------------------------------------------
@app.get("/")
async def serve_index():
    return FileResponse(ROOT / "index.html")


@app.get("/styles.css")
async def serve_css():
    return FileResponse(ROOT / "styles.css", media_type="text/css")


@app.get("/app.js")
async def serve_js():
    return FileResponse(ROOT / "app.js", media_type="application/javascript")


# -------------------------------------------------------------
# AUTHENTICATION ENDPOINTS
# -------------------------------------------------------------
def create_user_session(response: Response, user_id: int, db: Session) -> str:
    token = secrets.token_urlsafe(32)
    session_obj = UserSession(token=token, user_id=user_id)
    db.add(session_obj)
    db.commit()
    response.set_cookie(
        key="foundly_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=2592000,
        path="/",
    )
    return token


@app.get("/api/session")
async def check_session(
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        return {"user": None, "pending_count": 0}

    pending_count = (
        db.query(Connection)
        .filter(Connection.recipient_id == current_user.id, Connection.status.in_(["Pending", "Matched"]))
        .count()
    )
    return {
        "user": {
            "id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
            "role": current_user.role,
            "campus_role": current_user.campus_role,
            "phone": current_user.phone,
        },
        "pending_count": pending_count,
    }


@app.post("/api/register", status_code=201)
async def register(
    data: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    email = data.email.strip().lower()
    password = data.password

    if not name or len(name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name.")
    if not is_college_email(email):
        domains_str = ", ".join(["@" + d for d in COLLEGE_DOMAINS])
        raise HTTPException(status_code=400, detail=f"Please use an institutional email ({domains_str}).")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    existing = db.query(User).filter(func.lower(User.email) == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in instead.")

    salt, digest = password_hash(password)
    user = User(
        name=name,
        email=email,
        password_salt=salt,
        password_hash=digest,
        campus_role=data.campus_role or "Student",
        phone=data.phone.strip() if data.phone else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_user_session(response, user.id, db)
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "campus_role": user.campus_role,
            "phone": user.phone,
        },
        "token": token,
    }


@app.post("/api/login")
async def login(
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = data.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="No account found with this email. Click 'Create account' to register in seconds.",
        )
    if not verify_password(data.password, user.password_salt, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Incorrect password. You can reset it using 'Forgot password?' below.",
        )

    token = create_user_session(response, user.id, db)
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "campus_role": user.campus_role,
            "phone": user.phone,
        },
        "token": token,
    }


@app.post("/api/logout")
async def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("foundly_session")
    if token:
        db.query(UserSession).filter(UserSession.token == token).delete()
        db.commit()
    response.delete_cookie("foundly_session", path="/")
    return {"ok": True}


@app.post("/api/password/reset")
async def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    if not email or len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Enter valid email and a password with at least 6 characters.")
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email.")
    salt, digest = password_hash(data.new_password)
    user.password_salt = salt
    user.password_hash = digest
    db.commit()
    return {"ok": True, "message": "Password updated successfully. Please sign in."}


# -------------------------------------------------------------
# AUTOMATED SMART MATCHING ENGINE
# -------------------------------------------------------------
def find_and_notify_matches(new_item: Item, db: Session):
    """When an item is reported, automatically search counterpart listings and send match notifications!"""
    opp_type = "Found" if new_item.type == "Lost" else "Lost"
    words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", f"{new_item.name} {new_item.location}".lower())
    stop_words = {"the", "and", "for", "with", "item", "lost", "found", "room", "near", "hall"}
    keywords = [w for w in words if w not in stop_words]

    candidates = (
        db.query(Item)
        .filter(
            Item.type == opp_type,
            Item.status == "Open",
            Item.owner_id != new_item.owner_id,
        )
        .all()
    )

    for cand in candidates:
        cand_text = f"{cand.name} {cand.location} {cand.description or ''}".lower()
        cat_match = cand.category == new_item.category and cand.category != "Other"
        kw_match = any(kw in cand_text for kw in keywords) if keywords else False

        if cat_match or kw_match:
            lost_user_id = new_item.owner_id if new_item.type == "Lost" else cand.owner_id
            finder_user_id = new_item.owner_id if new_item.type == "Found" else cand.owner_id
            found_item = new_item if new_item.type == "Found" else cand
            lost_item = new_item if new_item.type == "Lost" else cand

            existing = (
                db.query(Connection)
                .filter(
                    Connection.recipient_id == lost_user_id,
                    Connection.item_id == found_item.id,
                )
                .first()
            )
            if not existing:
                match_conn = Connection(
                    item_id=found_item.id,
                    sender_id=finder_user_id,
                    recipient_id=lost_user_id,
                    message=f"✦ Campus Match Alert: Someone reported finding '{found_item.name}' at '{found_item.location}' matching your lost '{lost_item.name}'. Click to contact and reclaim!",
                    status="Matched",
                )
                db.add(match_conn)
    db.commit()


# -------------------------------------------------------------
# ITEM MANAGEMENT ENDPOINTS
# -------------------------------------------------------------
@app.get("/api/items")
async def get_items(
    search: Optional[str] = "",
    category: Optional[str] = "All",
    type: Optional[str] = "All",
    status: Optional[str] = "All",
    db: Session = Depends(get_db),
):
    query = db.query(Item).join(User, Item.owner_id == User.id)
    if status and status != "All":
        query = query.filter(Item.status == status)
    if type and type != "All":
        query = query.filter(Item.type == type)
    if category and category != "All":
        query = query.filter(Item.category == category)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Item.name.ilike(s),
                Item.category.ilike(s),
                Item.location.ilike(s),
                Item.description.ilike(s),
            )
        )
    items = query.order_by(desc(Item.id)).all()
    return {
        "items": [
            {
                "id": it.id,
                "name": it.name,
                "category": it.category,
                "location": it.location,
                "date": it.item_date,
                "description": it.description,
                "type": it.type,
                "status": it.status,
                "image_data": it.image_data,
                "proof_question": it.proof_question,
                "created_at": it.created_at.isoformat() if it.created_at else "",
                "owner_id": it.owner.id,
                "owner_name": it.owner.name,
                "owner_role": it.owner.campus_role,
                "owner_email": it.owner.email,
            }
            for it in items
        ]
    }


@app.get("/api/items/{item_id}")
async def get_item_detail(item_id: int, db: Session = Depends(get_db)):
    it = db.query(Item).filter(Item.id == item_id).first()
    if not it:
        raise HTTPException(status_code=404, detail="Item report not found.")
    return {
        "item": {
            "id": it.id,
            "name": it.name,
            "category": it.category,
            "location": it.location,
            "date": it.item_date,
            "description": it.description,
            "type": it.type,
            "status": it.status,
            "image_data": it.image_data,
            "proof_question": it.proof_question,
            "created_at": it.created_at.isoformat() if it.created_at else "",
            "owner_id": it.owner.id,
            "owner_name": it.owner.name,
            "owner_role": it.owner.campus_role,
            "owner_email": it.owner.email,
        }
    }


@app.post("/api/items", status_code=201)
async def create_item(
    data: ItemCreateRequest,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    location = data.location.strip()
    if not name or not location or data.type not in ("Lost", "Found"):
        raise HTTPException(status_code=400, detail="Item title, location, and report type are required.")

    item = Item(
        name=name,
        category=data.category.strip() if data.category else "Other",
        location=location,
        item_date=data.date or datetime.utcnow().strftime("%Y-%m-%d"),
        description=data.description.strip() if data.description else "",
        type=data.type,
        status="Open",
        image_data=data.image_data,
        proof_question=data.proof_question.strip() if data.proof_question else "",
        owner_id=current_user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Run automated smart match notifications
    try:
        find_and_notify_matches(item, db)
    except Exception as e:
        print("Smart Matcher notice:", e)

    return {"item": {"id": item.id}}


@app.post("/api/items/{item_id}/status")
async def update_item_status(
    item_id: int,
    data: ItemStatusRequest,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if data.status not in ("Open", "Resolved", "Archived"):
        raise HTTPException(status_code=400, detail="Invalid status value.")
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    if item.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="You do not have permission to modify this item.")

    item.status = data.status
    db.commit()
    return {"ok": True, "status": data.status}


@app.delete("/api/items/{item_id}")
async def delete_item(
    item_id: int,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    if item.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="You do not have permission to delete this report.")

    db.delete(item)
    db.commit()
    return {"ok": True}


@app.get("/api/user/items")
async def get_user_items(
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    user_items = db.query(Item).filter(Item.owner_id == current_user.id).order_by(desc(Item.id)).all()
    return {
        "items": [
            {
                "id": it.id,
                "name": it.name,
                "category": it.category,
                "location": it.location,
                "date": it.item_date,
                "description": it.description,
                "type": it.type,
                "status": it.status,
                "image_data": it.image_data,
                "proof_question": it.proof_question,
                "created_at": it.created_at.isoformat() if it.created_at else "",
                "connections_count": len(it.connections),
            }
            for it in user_items
        ]
    }


# -------------------------------------------------------------
# SAFE CONNECTIONS, DIRECT CONTACTS & CHAT ENDPOINTS
# -------------------------------------------------------------
@app.get("/api/connections")
async def get_connections(
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    connections = (
        db.query(Connection)
        .filter(or_(Connection.sender_id == current_user.id, Connection.recipient_id == current_user.id))
        .order_by(desc(Connection.id))
        .all()
    )
    return {
        "connections": [
            {
                "id": c.id,
                "item_id": c.item_id,
                "item_name": c.item.name if c.item else "Campus Item",
                "item_type": c.item.type if c.item else "",
                "item_location": c.item.location if c.item else "",
                "message": c.message,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else "",
                "sender_id": c.sender.id,
                "sender_name": c.sender.name,
                "sender_email": c.sender.email,
                "sender_role": c.sender.campus_role,
                "sender_phone": c.sender.phone if c.status in ("Accepted", "Matched") else None,
                "recipient_id": c.recipient.id,
                "recipient_name": c.recipient.name,
                "recipient_email": c.recipient.email,
                "recipient_role": c.recipient.campus_role,
                "recipient_phone": c.recipient.phone if c.status in ("Accepted", "Matched") else None,
            }
            for c in connections
        ]
    }


@app.post("/api/connections", status_code=201)
async def create_connection(
    data: ConnectionCreateRequest,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    message = data.message.strip()
    if not data.item_id or not message:
        raise HTTPException(status_code=400, detail="Please provide a verification or claim message.")

    item = db.query(Item).filter(Item.id == data.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="This report no longer exists.")
    if item.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot send a connection request to your own report.")

    duplicate = (
        db.query(Connection)
        .filter(
            Connection.item_id == data.item_id,
            Connection.sender_id == current_user.id,
            Connection.status == "Pending",
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="You already sent a connection request for this report.")

    conn = Connection(
        item_id=data.item_id,
        sender_id=current_user.id,
        recipient_id=item.owner_id,
        message=message,
        status="Pending",
    )
    db.add(conn)
    db.commit()
    return {"ok": True}


@app.post("/api/connections/{connection_id}/status")
async def update_connection_status(
    connection_id: int,
    data: ConnectionStatusRequest,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if data.status not in ("Accepted", "Declined"):
        raise HTTPException(status_code=400, detail="Invalid request status.")

    conn = (
        db.query(Connection)
        .filter(Connection.id == connection_id, Connection.recipient_id == current_user.id)
        .first()
    )
    if not conn:
        raise HTTPException(status_code=404, detail="This connection request is not available or already handled.")

    conn.status = data.status
    db.commit()
    return {"ok": True}


@app.post("/api/connections/{connection_id}/message")
async def reply_connection_message(
    connection_id: int,
    data: MessageReplyRequest,
    current_user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    conn = (
        db.query(Connection)
        .filter(
            Connection.id == connection_id,
            or_(Connection.sender_id == current_user.id, Connection.recipient_id == current_user.id),
        )
        .first()
    )
    if not conn:
        raise HTTPException(status_code=404, detail="Connection conversation not found.")

    reply_text = data.message.strip()
    if not reply_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    timestamp = datetime.utcnow().strftime("%H:%M")
    conn.message = f"{conn.message}\n\n💬 [{current_user.name} @ {timestamp}]: {reply_text}"
    if conn.status == "Pending" and current_user.id == conn.recipient_id:
        conn.status = "Accepted"
    db.commit()
    return {"ok": True, "message": conn.message, "status": conn.status}


# -------------------------------------------------------------
# ADMIN CONSOLE & EXPORT ENDPOINTS
# -------------------------------------------------------------
@app.get("/api/admin/overview")
async def admin_overview(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stats = {
        "reports": db.query(Item).count(),
        "lost": db.query(Item).filter(Item.type == "Lost").count(),
        "found": db.query(Item).filter(Item.type == "Found").count(),
        "resolved": db.query(Item).filter(Item.status == "Resolved").count(),
        "users": db.query(User).count(),
        "connections": db.query(Connection).count(),
    }
    recent_items = db.query(Item).order_by(desc(Item.id)).limit(30).all()
    return {
        "stats": stats,
        "items": [
            {
                "id": it.id,
                "name": it.name,
                "category": it.category,
                "location": it.location,
                "date": it.item_date,
                "type": it.type,
                "status": it.status,
                "owner_name": it.owner.name,
            }
            for it in recent_items
        ],
    }


@app.get("/api/admin/export")
async def admin_export_csv(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    items = db.query(Item).order_by(desc(Item.id)).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Name", "Type", "Status", "Category", "Location", "Date", "Description", "Reporter", "Campus Role", "Created At"])
    for it in items:
        writer.writerow([
            it.id, it.name, it.type, it.status, it.category,
            it.location, it.item_date, it.description or "",
            it.owner.name if it.owner else "", it.owner.campus_role if it.owner else "",
            it.created_at.isoformat() if it.created_at else "",
        ])
    return RawResponse(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="vctm-foundly-reports.csv"'},
    )


# -------------------------------------------------------------
# MAIN ENTRYPOINT
# -------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting VCTM Foundly Production FastAPI Server on http://{host}:{port}")
    uvicorn.run("server:app", host=host, port=port, reload=False)
