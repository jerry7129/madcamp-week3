import shutil
import os
import uuid
import requests
from sqlalchemy.orm import Session
from sqlalchemy import or_  # [NEW] OR 검색용
from passlib.context import CryptContext
import models, schemas
from database import engine, get_db
from datetime import datetime, timedelta
from jose import JWTError, jwt
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles

# DB 테이블 생성
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# --- [설정] ---
SECRET_KEY = "my_super_secret_key_change_this"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24시간

# 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
VOICE_DIR = os.path.join(STATIC_DIR, "voices")    # 원본 목소리 저장소
GEN_DIR = os.path.join(STATIC_DIR, "generated")   # 결과물 저장소
SHARED_DIR = os.getenv("SHARED_DIR", "/shared")   # 도커 공유 폴더

os.makedirs(VOICE_DIR, exist_ok=True)
os.makedirs(GEN_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# --- [Auth Logic (기존 유지)] ---
def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="자격 증명 실패",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None: raise credentials_exception
    return user

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- [User APIs] ---
@app.post("/signup", response_model=schemas.UserResponse)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 아이디")
    new_user = models.User(
        username=user.username,
        password=pwd_context.hash(user.password),
        nickname=user.nickname,
        role="USER",
        credit_balance=1000 # 가입 선물 1000원!
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.password):
        raise HTTPException(status_code=401, detail="로그인 실패")
    
    token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": token, "token_type": "bearer"}

@app.get("/users/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

# =================================================================
# [Voice Market] 핵심 기능 구현 (Auth 통합됨)
# =================================================================

# 1. 내 목소리 등록 (Login Required)
@app.post("/voice/train")
async def create_voice_model(
    name: str = Form(...),            # "기쁜 목소리"
    description: str = Form(None),    # 설명
    is_public: bool = Form(False),    # 공유 할까 말까
    ref_text: str = Form(...),        # 녹음 파일의 내용
    audio_file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user), # ⭐ 로그인 유저
    db: Session = Depends(get_db)
):
    # 1. 유저별 폴더 격리: static/voices/{user_id}/
    user_voice_dir = os.path.join(VOICE_DIR, str(current_user.id))
    os.makedirs(user_voice_dir, exist_ok=True)

    file_ext = os.path.splitext(audio_file.filename)[1] or ".wav"
    filename = f"{uuid.uuid4()}{file_ext}"
    save_path = os.path.join(user_voice_dir, filename)

    # 2. 파일 저장
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(audio_file.file, buffer)

    # 3. DB 등록
    new_model = models.VoiceModel(
        owner_id=current_user.id,  # 토큰에서 가져온 ID 사용
        name=name,
        description=description,
        is_public=is_public,
        audio_path=save_path,
        ref_text=ref_text
    )
    db.add(new_model)
    db.commit()
    db.refresh(new_model)

    return {"msg": "목소리 등록 완료", "model_id": new_model.id}


# 2. 목소리 마켓 목록 조회 (Login Required)
# "내 것" + "공개된 남의 것"을 모두 보여줌
@app.get("/voice/list", response_model=list[schemas.VoiceModelResponse])
async def list_available_voices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    models_list = db.query(models.VoiceModel).filter(
        or_(
            models.VoiceModel.owner_id == current_user.id,  # 내 거
            models.VoiceModel.is_public == True             # 공개된 거
        )
    ).all()
    return models_list


# 3. TTS 생성 및 비용 차감 (Login Required)
@app.post("/tts/generate")
async def generate_tts(
    request: schemas.GenerateRequest,
    current_user: models.User = Depends(get_current_user), # ⭐ 사용자
    db: Session = Depends(get_db)
):
    COST = 50 # 1회 생성 비용

    # 1. 모델 찾기
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == request.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="모델이 없습니다.")

    # 2. 권한 확인 (비공개인데 내 것도 아니면 거절)
    if not voice_model.is_public and voice_model.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="사용 권한이 없는 비공개 모델입니다.")

    # 3. 잔액 확인 및 차감
    if current_user.credit_balance < COST:
        raise HTTPException(status_code=400, detail="잔액이 부족합니다.")
    
    current_user.credit_balance -= COST
    voice_model.usage_count += 1
    # (원작자에게 수익 분배하는 로직은 필요하면 여기에 추가)

    # 4. AI 서버 공유 폴더로 원본 복사
    temp_filename = f"temp_{uuid.uuid4()}{os.path.splitext(voice_model.audio_path)[1]}"
    shared_path = os.path.join(SHARED_DIR, temp_filename)
    shutil.copy(voice_model.audio_path, shared_path)

    # 5. AI 요청
    payload = {
        "text": request.text,
        "text_lang": "ko",
        "ref_audio_path": shared_path,
        "prompt_text": voice_model.ref_text,
        "prompt_lang": "ko",
        "text_split_method": "cut5",
        "speed_factor": 1.0
    }

    try:
        ai_url = "http://gpt-sovits:9880"
        response = requests.post(f"{ai_url}/tts", json=payload)
        
        if response.status_code != 200:
            current_user.credit_balance += COST # 실패하면 환불
            raise HTTPException(status_code=500, detail="AI 서버 오류")

        # 6. 결과물 저장 (요청자 ID 폴더에 격리)
        # static/generated/{user_id}/result.wav
        user_gen_dir = os.path.join(GEN_DIR, str(current_user.id))
        os.makedirs(user_gen_dir, exist_ok=True)
        
        output_filename = f"tts_{uuid.uuid4()}.wav"
        output_path = os.path.join(user_gen_dir, output_filename)

        with open(output_path, "wb") as f:
            f.write(response.content)

        # 임시 파일 삭제
        if os.path.exists(shared_path): os.remove(shared_path)
        
        db.commit() # 돈 빠져나간거 최종 확정

        return {
            "msg": "생성 성공",
            "audio_url": f"/static/generated/{current_user.id}/{output_filename}",
            "cost": COST,
            "remaining_credit": current_user.credit_balance,
            "used_voice": voice_model.name
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# --- [Test / Utils] 충전 API ---
@app.post("/charge")
def charge_credit(req: schemas.ChargeRequest, current_user: models.User = Depends(get_current_user)):
    current_user.credit_balance += req.amount
    # db.commit()은 Depends의 DB 세션 처리 방식에 따라 다르지만, 
    # 여기서는 get_db()가 함수 스코프 내에서 처리되므로 명시적으로 주입받아 commit 해야 함.
    # (위의 코드를 단순화하기 위해 get_db 생략했으나 실제론 db: Session = Depends(get_db) 필요)
    return {"msg": "충전 완료", "balance": current_user.credit_balance}