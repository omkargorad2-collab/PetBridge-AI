import os, io, uuid, datetime, pathlib, secrets, hashlib, hmac, smtplib, ssl, re, logging
from email.message import EmailMessage
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime, Boolean, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from PIL import Image
import jwt
import httpx
from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
UPLOAD = ROOT / 'uploads'; UPLOAD.mkdir(exist_ok=True)
DB = os.getenv('DATABASE_URL', f'sqlite:///{ROOT / "pawconnect.db"}')
if DB.startswith('postgres://'): DB = 'postgresql://' + DB[len('postgres://'):]
engine = create_engine(DB, connect_args={'check_same_thread': False} if DB.startswith('sqlite') else {}, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()
SECRET = os.getenv('JWT_SECRET', 'CHANGE_ME_FOR_PRODUCTION')
PWD = CryptContext(schemes=['bcrypt'], deprecated='auto')
UTC = datetime.timezone.utc

def now(): return datetime.datetime.now(UTC)

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String(100)); email = Column(String(200), unique=True, index=True)
    password = Column(String(255)); role = Column(String(30), default='adopter')

class Pet(Base):
    __tablename__ = 'pets'
    id = Column(Integer, primary_key=True)
    name = Column(String(100)); species = Column(String(50)); breed = Column(String(100))
    age = Column(String(60)); city = Column(String(100)); description = Column(Text)
    image = Column(Text); status = Column(String(30), default='available')
    owner_id = Column(Integer, ForeignKey('users.id'))
    source = Column(String(150), default='Owner submission')
    contact_number = Column(String(15), nullable=True)
    contact_public = Column(Boolean, default=False)

class Application(Base):
    __tablename__ = 'applications'
    id = Column(Integer, primary_key=True)
    pet_id = Column(Integer, ForeignKey('pets.id')); user_id = Column(Integer, ForeignKey('users.id'))
    message = Column(Text); status = Column(String(30), default='pending')

class Lost(Base):
    __tablename__ = 'lost'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id')); name = Column(String(100))
    species = Column(String(50)); city = Column(String(100)); details = Column(Text)
    image = Column(Text); kind = Column(String(15), default='lost'); status = Column(String(20), default='open')

class PendingRegistration(Base):
    __tablename__ = 'pending_registrations'
    id = Column(Integer, primary_key=True)
    name = Column(String(100)); email = Column(String(200), unique=True, index=True)
    password = Column(String(255)); role = Column(String(30))
    otp_hash = Column(String(64)); expires_at = Column(DateTime(timezone=True))
    attempts = Column(Integer, default=0)
    last_sent_at = Column(DateTime(timezone=True))

Base.metadata.create_all(engine)
# Small additive migration for databases created before contact fields existed.
with engine.begin() as conn:
    if engine.dialect.name == 'sqlite':
        existing = {r[1] for r in conn.execute(text('PRAGMA table_info(pets)'))}
    else:
        existing = {r[0] for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='pets'"))}
    if 'contact_number' not in existing:
        conn.execute(text('ALTER TABLE pets ADD COLUMN contact_number VARCHAR(15)'))
    if 'contact_public' not in existing:
        conn.execute(text('ALTER TABLE pets ADD COLUMN contact_public BOOLEAN DEFAULT FALSE'))
    # Existing pending listings were submitted under the former approval flow.
    conn.execute(text("UPDATE pets SET status='available' WHERE status='pending'"))

app = FastAPI(title='PawConnect AI API', version='2.0.0')
origins = [x.strip() for x in os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
app.mount('/uploads', StaticFiles(directory=str(UPLOAD)), name='uploads')

def db():
    s = SessionLocal()
    try: yield s
    finally: s.close()

def current(authorization: Optional[str] = Header(None), s: Session = Depends(db)):
    try:
        scheme, token = (authorization or '').split(' ', 1)
        if scheme.lower() != 'bearer': raise ValueError()
        uid = int(jwt.decode(token, SECRET, algorithms=['HS256'])['sub'])
        user = s.get(User, uid)
        if not user: raise ValueError()
        return user
    except Exception: raise HTTPException(401, 'Login required')

def public_pet(p, show_contact=False):
    d = {k: getattr(p, k) for k in ('id', 'name', 'species', 'breed', 'age', 'city', 'description', 'image', 'status', 'source', 'owner_id')}
    d['contact_number'] = p.contact_number if show_contact and p.contact_public else None
    return d

def public_lost(p):
    return {k: getattr(p, k) for k in ('id', 'name', 'species', 'city', 'details', 'image', 'kind', 'status')}

class Register(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8)
    role: str = 'adopter'

class Verify(BaseModel):
    email: str
    otp: str

class Login(BaseModel):
    email: str
    password: str

class PetInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    species: str
    breed: str = 'Unknown'
    age: str = 'Unknown'
    city: str
    description: str = ''
    image: str = ''
    source: str = 'Owner submission'
    contact_number: str
    contact_public: bool

class ApplicationInput(BaseModel):
    pet_id: int
    message: str = Field(min_length=10)

class LostInput(BaseModel):
    name: str; species: str; city: str; details: str; image: str = ''; kind: str = 'lost'

class StatusInput(BaseModel):
    status: str

def email_normalized(email):
    e = email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', e):
        raise HTTPException(400, 'Enter a valid email address')
    return e

def otp_digest(email, code):
    return hmac.new(SECRET.encode(), (email + ':' + code).encode(), hashlib.sha256).hexdigest()

def send_otp(email, code):
    api_key = os.getenv('BREVO_API_KEY', '').strip()
    sender = os.getenv('BREVO_SENDER_EMAIL', '').strip()
    sender_name = os.getenv('BREVO_SENDER_NAME', 'PawConnect AI').strip()
    if not api_key or not sender:
        raise HTTPException(503, 'Brevo email API is not configured on server')
    payload = {
        'sender': {'name': sender_name, 'email': sender},
        'to': [{'email': email}],
        'subject': 'PawConnect AI - Verify your email',
        'textContent': f'Your PawConnect AI verification code is {code}. It expires in 5 minutes. Do not share this code.'
    }
    try:
        with httpx.Client(timeout=20) as client:
            response = client.post(
                'https://api.brevo.com/v3/smtp/email',
                headers={'api-key': api_key, 'accept': 'application/json', 'content-type': 'application/json'},
                json=payload,
            )
        if response.status_code not in (200, 201, 202):
            logging.error('Brevo email API failed with status %s', response.status_code)
            raise HTTPException(503, 'Email provider rejected the request. Check sender verification and Brevo account status.')
    except httpx.RequestError:
        logging.exception('Brevo email API network error')
        raise HTTPException(503, 'Could not connect to email provider. Try again later.')

@app.get('/api/health')
def health(): return {'ok': True, 'service': 'PawConnect AI'}

@app.post('/api/register')
def register(data: Register, s: Session = Depends(db)):
    if data.role not in ('adopter', 'owner', 'ngo'): raise HTTPException(400, 'Invalid role')
    email = email_normalized(data.email)
    if s.query(User).filter_by(email=email).first(): raise HTTPException(409, 'Email already registered')
    pending = s.query(PendingRegistration).filter_by(email=email).first()
    if pending and pending.last_sent_at and (now() - pending.last_sent_at.replace(tzinfo=UTC)).total_seconds() < 60:
        raise HTTPException(429, 'Please wait 60 seconds before requesting another OTP')
    code = f'{secrets.randbelow(1000000):06d}'
    send_otp(email, code)
    if not pending:
        pending = PendingRegistration(email=email)
        s.add(pending)
    pending.name = data.name.strip(); pending.password = PWD.hash(data.password)
    pending.role = data.role; pending.otp_hash = otp_digest(email, code)
    pending.expires_at = now(); pending.expires_at += datetime.timedelta(minutes=5)
    pending.attempts = 0; pending.last_sent_at = now()
    s.commit()
    return {'message': 'OTP sent to your email. Enter it to activate your account.'}

@app.post('/api/verify-email')
def verify_email(data: Verify, s: Session = Depends(db)):
    email = email_normalized(data.email)
    pending = s.query(PendingRegistration).filter_by(email=email).first()
    if not pending: raise HTTPException(400, 'No pending registration. Please register again.')
    if now() > pending.expires_at.replace(tzinfo=UTC): raise HTTPException(400, 'OTP expired. Please register again.')
    if pending.attempts >= 5: raise HTTPException(429, 'Too many attempts. Please register again later.')
    pending.attempts += 1
    if not re.fullmatch(r'\d{6}', data.otp) or not hmac.compare_digest(pending.otp_hash, otp_digest(email, data.otp)):
        s.commit()
        raise HTTPException(400, 'Incorrect OTP')
    if s.query(User).filter_by(email=email).first(): raise HTTPException(409, 'Email already registered')
    s.add(User(name=pending.name, email=email, password=pending.password, role=pending.role))
    s.delete(pending); s.commit()
    return {'message': 'Email verified. You can now log in.'}

@app.post('/api/login')
def login(data: Login, s: Session = Depends(db)):
    u = s.query(User).filter_by(email=email_normalized(data.email)).first()
    if not u or not PWD.verify(data.password, u.password): raise HTTPException(401, 'Invalid credentials')
    token = jwt.encode({'sub': str(u.id), 'exp': now() + datetime.timedelta(days=7)}, SECRET, algorithm='HS256')
    return {'token': token, 'user': {'id': u.id, 'name': u.name, 'role': u.role, 'email': u.email}}

@app.get('/api/pets')
def pets(city: str = '', species: str = '', u: User = Depends(current), s: Session = Depends(db)):
    q = s.query(Pet).filter(Pet.status == 'available')
    if city: q = q.filter(Pet.city.ilike(f'%{city}%'))
    if species: q = q.filter(Pet.species.ilike(f'%{species}%'))
    return [public_pet(p, show_contact=True) for p in q.order_by(Pet.id.desc()).all()]

@app.get('/api/my/pets')
def mypets(u: User = Depends(current), s: Session = Depends(db)):
    return [public_pet(p, show_contact=True) for p in s.query(Pet).filter_by(owner_id=u.id).all()]

@app.post('/api/pets')
def add_pet(data: PetInput, u: User = Depends(current), s: Session = Depends(db)):
    if u.role not in ('owner', 'ngo'): raise HTTPException(403, 'Owner or NGO account required')
    if not re.fullmatch(r'[6-9]\d{9}', data.contact_number): raise HTTPException(400, 'Enter a valid 10-digit Indian mobile number')
    if not data.contact_public: raise HTTPException(400, 'Contact sharing consent is required for this listing')
    p = Pet(**data.model_dump(), owner_id=u.id, status='available')
    s.add(p); s.commit(); s.refresh(p)
    return public_pet(p, show_contact=True)

@app.post('/api/pets/{pid}/status')
def pet_status(pid: int, data: StatusInput, u: User = Depends(current), s: Session = Depends(db)):
    p = s.get(Pet, pid)
    if not p: raise HTTPException(404, 'Pet not found')
    if p.owner_id != u.id: raise HTTPException(403, 'Not your listing')
    if data.status not in ('available', 'adopted', 'unavailable'): raise HTTPException(400, 'Invalid status')
    p.status = data.status; s.commit(); return {'ok': True}

@app.post('/api/applications')
def apply(data: ApplicationInput, u: User = Depends(current), s: Session = Depends(db)):
    p = s.get(Pet, data.pet_id)
    if not p or p.status != 'available': raise HTTPException(404, 'Pet not available')
    if p.owner_id == u.id: raise HTTPException(400, 'Cannot apply to own pet')
    if s.query(Application).filter_by(pet_id=p.id, user_id=u.id).first(): raise HTTPException(409, 'Already applied')
    s.add(Application(pet_id=p.id, user_id=u.id, message=data.message)); s.commit(); return {'ok': True}

@app.get('/api/applications')
def applications(u: User = Depends(current), s: Session = Depends(db)):
    q = s.query(Application, Pet).join(Pet, Pet.id == Application.pet_id)
    q = q.filter(Pet.owner_id == u.id) if u.role in ('owner', 'ngo') else q.filter(Application.user_id == u.id)
    return [{'id': a.id, 'pet': p.name, 'message': a.message, 'status': a.status, 'pet_id': p.id} for a, p in q.all()]

@app.post('/api/applications/{aid}/status')
def application_status(aid: int, data: StatusInput, u: User = Depends(current), s: Session = Depends(db)):
    a = s.get(Application, aid)
    if not a or not s.get(Pet, a.pet_id) or s.get(Pet, a.pet_id).owner_id != u.id:
        raise HTTPException(403, 'Not permitted')
    if data.status not in ('approved', 'rejected', 'pending'): raise HTTPException(400, 'Invalid status')
    a.status = data.status; s.commit(); return {'ok': True}

@app.get('/api/lost')
def lost(u: User = Depends(current), s: Session = Depends(db)):
    return [public_lost(p) for p in s.query(Lost).filter_by(status='open').order_by(Lost.id.desc()).all()]

@app.post('/api/lost')
def report(data: LostInput, u: User = Depends(current), s: Session = Depends(db)):
    if data.kind not in ('lost', 'found'): raise HTTPException(400, 'Invalid kind')
    p = Lost(**data.model_dump(), user_id=u.id)
    s.add(p); s.commit(); s.refresh(p); return public_lost(p)

@app.post('/api/upload')
async def upload(file: UploadFile = File(...), u: User = Depends(current)):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024: raise HTTPException(413, 'Max 5 MB')
    try:
        im = Image.open(io.BytesIO(data)); im.verify()
        im = Image.open(io.BytesIO(data)).convert('RGB'); im.thumbnail((1400, 1400))
    except Exception: raise HTTPException(400, 'Invalid image')
    filename = f'{uuid.uuid4().hex}.jpg'; im.save(UPLOAD / filename, format='JPEG', quality=85)
    return {'url': f'/uploads/{filename}'}

@app.post('/api/identify')
async def identify(file: UploadFile = File(...), u: User = Depends(current)):
    # Browser-based MobileNet remains the supported free scanner.
    return {'available': False, 'message': 'Use the free on-device scanner in the PawConnect AI website.'}
