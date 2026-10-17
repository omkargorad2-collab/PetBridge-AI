import os, io, json, uuid, datetime, pathlib, logging
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from PIL import Image
import jwt, httpx
from dotenv import load_dotenv
load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

ROOT=pathlib.Path(__file__).resolve().parent
UPLOAD=ROOT/'uploads'; UPLOAD.mkdir(exist_ok=True)
DB=os.getenv('DATABASE_URL',f'sqlite:///{ROOT / "pawconnect.db"}')
if DB.startswith('postgres://'): DB='postgresql://'+DB[len('postgres://'):]
engine=create_engine(DB,connect_args={'check_same_thread':False} if DB.startswith('sqlite') else {},pool_pre_ping=True)
SessionLocal=sessionmaker(bind=engine)
Base=declarative_base()
SECRET=os.getenv('JWT_SECRET','CHANGE_ME_FOR_PRODUCTION')
PWD=CryptContext(schemes=['bcrypt'],deprecated='auto')

class User(Base):
 __tablename__='users'
 id=Column(Integer,primary_key=True); name=Column(String(100)); email=Column(String(200),unique=True,index=True); password=Column(String(255)); role=Column(String(30),default='adopter')
class Pet(Base):
 __tablename__='pets'
 id=Column(Integer,primary_key=True); name=Column(String(100)); species=Column(String(50)); breed=Column(String(100)); age=Column(String(60)); city=Column(String(100)); description=Column(Text); image=Column(Text); status=Column(String(30),default='pending'); owner_id=Column(Integer,ForeignKey('users.id')); source=Column(String(150),default='Owner submission')
class Application(Base):
 __tablename__='applications'
 id=Column(Integer,primary_key=True); pet_id=Column(Integer,ForeignKey('pets.id')); user_id=Column(Integer,ForeignKey('users.id')); message=Column(Text); status=Column(String(30),default='pending')
class Lost(Base):
 __tablename__='lost'
 id=Column(Integer,primary_key=True); user_id=Column(Integer,ForeignKey('users.id')); name=Column(String(100)); species=Column(String(50)); city=Column(String(100)); details=Column(Text); image=Column(Text); kind=Column(String(15),default='lost'); status=Column(String(20),default='open')
Base.metadata.create_all(engine)
app=FastAPI(title='PawConnect AI API',version='1.0.0')
origins=os.getenv('CORS_ORIGINS','http://localhost:5173').split(',')
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['*'],allow_headers=['*'])
app.mount('/uploads',StaticFiles(directory=str(UPLOAD)),name='uploads')

def db():
 s=SessionLocal()
 try: yield s
 finally: s.close()
def current(authorization:Optional[str]=Header(None),s:Session=Depends(db)):
 try:
  token=(authorization or '').split('Bearer ')[1]; uid=int(jwt.decode(token,SECRET,algorithms=['HS256'])['sub']); user=s.get(User,uid)
  if not user: raise ValueError()
  return user
 except Exception: raise HTTPException(401,'Login required')
def public_pet(p): return {k:getattr(p,k) for k in ['id','name','species','breed','age','city','description','image','status','source','owner_id']}
def public_lost(p): return {k:getattr(p,k) for k in ['id','name','species','city','details','image','kind','status']}
class Register(BaseModel):
 name:str=Field(min_length=2,max_length=100); email:str; password:str=Field(min_length=8); role:str='adopter'
class Login(BaseModel): email:str; password:str
class PetInput(BaseModel):
 name:str; species:str; breed:str='Unknown'; age:str='Unknown'; city:str; description:str=''; image:str=''; source:str='Owner submission'
class ApplicationInput(BaseModel): pet_id:int; message:str=Field(min_length=10)
class LostInput(BaseModel): name:str; species:str; city:str; details:str; image:str=''; kind:str='lost'
class StatusInput(BaseModel): status:str
@app.get('/api/health')
def health(): return {'ok':True,'service':'PawConnect AI'}
@app.post('/api/register')
def register(data:Register,s:Session=Depends(db)):
 if data.role not in ('adopter','owner','ngo'): raise HTTPException(400,'Invalid role')
 if s.query(User).filter(User.email==data.email.lower()).first(): raise HTTPException(409,'Email already registered')
 u=User(name=data.name,email=data.email.lower(),password=PWD.hash(data.password),role=data.role); s.add(u); s.commit(); return {'message':'Registered successfully'}
@app.post('/api/login')
def login(data:Login,s:Session=Depends(db)):
 u=s.query(User).filter(User.email==data.email.lower()).first()
 if not u or not PWD.verify(data.password,u.password): raise HTTPException(401,'Invalid credentials')
 token=jwt.encode({'sub':str(u.id),'exp':datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=7)},SECRET,algorithm='HS256')
 return {'token':token,'user':{'id':u.id,'name':u.name,'role':u.role,'email':u.email}}
@app.get('/api/pets')
def pets(city:str='',species:str='',s:Session=Depends(db)):
 q=s.query(Pet).filter(Pet.status=='available')
 if city:q=q.filter(Pet.city.ilike(f'%{city}%'))
 if species:q=q.filter(Pet.species.ilike(f'%{species}%'))
 return [public_pet(p) for p in q.order_by(Pet.id.desc()).all()]
@app.get('/api/my/pets')
def mypets(u:User=Depends(current),s:Session=Depends(db)):
 return [public_pet(p) for p in s.query(Pet).filter(Pet.owner_id==u.id).all()]
@app.post('/api/pets')
def add_pet(data:PetInput,u:User=Depends(current),s:Session=Depends(db)):
 if u.role not in ('owner','ngo'):raise HTTPException(403,'Owner or NGO account required')
 p=Pet(**data.model_dump(),owner_id=u.id,status='pending');s.add(p);s.commit();s.refresh(p);return public_pet(p)
@app.post('/api/pets/{pid}/status')
def pet_status(pid:int,data:StatusInput,u:User=Depends(current),s:Session=Depends(db)):
 p=s.get(Pet,pid)
 if not p:raise HTTPException(404,'Pet not found')
 if p.owner_id!=u.id:raise HTTPException(403,'Not your listing')
 if data.status not in ('pending','adopted','unavailable'):raise HTTPException(400,'Invalid status')
 p.status=data.status;s.commit();return {'ok':True}
@app.post('/api/applications')
def apply(data:ApplicationInput,u:User=Depends(current),s:Session=Depends(db)):
 p=s.get(Pet,data.pet_id)
 if not p or p.status!='available':raise HTTPException(404,'Pet not available')
 if p.owner_id==u.id:raise HTTPException(400,'Cannot apply to own pet')
 if s.query(Application).filter_by(pet_id=p.id,user_id=u.id).first():raise HTTPException(409,'Already applied')
 a=Application(pet_id=p.id,user_id=u.id,message=data.message);s.add(a);s.commit();return {'ok':True}
@app.get('/api/applications')
def applications(u:User=Depends(current),s:Session=Depends(db)):
 q=s.query(Application,Pet).join(Pet,Pet.id==Application.pet_id)
 if u.role in ('owner','ngo'):q=q.filter(Pet.owner_id==u.id)
 else:q=q.filter(Application.user_id==u.id)
 return [{'id':a.id,'pet':p.name,'message':a.message,'status':a.status,'pet_id':p.id} for a,p in q.all()]
@app.post('/api/applications/{aid}/status')
def application_status(aid:int,data:StatusInput,u:User=Depends(current),s:Session=Depends(db)):
 a=s.get(Application,aid)
 if not a or not s.get(Pet,a.pet_id) or s.get(Pet,a.pet_id).owner_id!=u.id:raise HTTPException(403,'Not permitted')
 if data.status not in ('approved','rejected','pending'):raise HTTPException(400,'Invalid status')
 a.status=data.status;s.commit();return {'ok':True}
@app.get('/api/lost')
def lost(s:Session=Depends(db)):return [public_lost(p) for p in s.query(Lost).filter_by(status='open').order_by(Lost.id.desc()).all()]
@app.post('/api/lost')
def report(data:LostInput,u:User=Depends(current),s:Session=Depends(db)):
 if data.kind not in ('lost','found'):raise HTTPException(400,'Invalid kind')
 p=Lost(**data.model_dump(),user_id=u.id);s.add(p);s.commit();s.refresh(p);return public_lost(p)
@app.post('/api/upload')
async def upload(file:UploadFile=File(...),u:User=Depends(current)):
 data=await file.read()
 if len(data)>5*1024*1024:raise HTTPException(413,'Max 5 MB')
 try:
  im=Image.open(io.BytesIO(data));im.verify();im=Image.open(io.BytesIO(data)).convert('RGB');im.thumbnail((1400,1400))
 except Exception:raise HTTPException(400,'Invalid image')
 filename=f'{uuid.uuid4().hex}.jpg';im.save(UPLOAD/filename,format='JPEG',quality=85)
 return {'url':f'/uploads/{filename}'}
@app.post('/api/identify')
async def identify(file:UploadFile=File(...)):
 data=await file.read()
 if len(data)>5*1024*1024:raise HTTPException(413,'Max 5 MB')
 try:
  im=Image.open(io.BytesIO(data)).convert('RGB');im.thumbnail((1024,1024));buff=io.BytesIO();im.save(buff,format='JPEG');data=buff.getvalue()
 except Exception:raise HTTPException(400,'Invalid image')
 token=os.getenv('HF_TOKEN','')
 if not token:return {'available':False,'message':'AI identification is not configured. Set HF_TOKEN on the backend. Never trust unverified breed or age guesses.'}
 model=os.getenv('HF_MODEL','google/vit-base-patch16-224')
 try:
  async with httpx.AsyncClient(timeout=45) as client:
   r=await client.post(f'https://router.huggingface.co/hf-inference/models/{model}',headers={'Authorization':f'Bearer {token}','Content-Type':'image/jpeg'},content=data)
   r.raise_for_status();result=r.json()
  if not isinstance(result,list):raise ValueError('Unexpected AI response')
  return {'available':True,'predictions':result[:5],'warning':'Image labels are predictions, not verified breed, health, or age. Exact age cannot be reliably inferred from a photo.'}
 except Exception as e:
    logging.exception("Hugging Face AI identification failed")
    return {'available':False,'message':'AI service unavailable right now. Try again later.'}
def admin(u):return u.email.lower() in [x.strip().lower() for x in os.getenv('ADMIN_EMAILS','').split(',') if x.strip()]
@app.get('/api/admin/pending')
def pending(u:User=Depends(current),s:Session=Depends(db)):
 if not admin(u):raise HTTPException(403,'Admin only')
 return [public_pet(p) for p in s.query(Pet).filter(Pet.status=='pending').all()]
@app.post('/api/admin/pets/{pid}/approve')
def approve(pid:int,u:User=Depends(current),s:Session=Depends(db)):
 if not admin(u):raise HTTPException(403,'Admin only')
 p=s.get(Pet,pid)
 if not p:raise HTTPException(404,'Not found')
 p.status='available';s.commit();return {'ok':True}
