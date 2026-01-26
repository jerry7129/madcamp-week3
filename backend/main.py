import shutil
import os
import uuid
import requests
from sqlalchemy.orm import Session
from sqlalchemy import or_
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
VOICE_DIR = os.path.join(STATIC_DIR, "voices")    # 원본 목소리
GEN_DIR = os.path.join(STATIC_DIR, "generated")   # 결과물
SHARED_DIR = os.getenv("SHARED_DIR", "/shared")   # 도커 공유 폴더

os.makedirs(VOICE_DIR, exist_ok=True)
os.makedirs(GEN_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- [인증 로직] ---
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

# 관리자 체크용 의존성
def get_admin_user(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return current_user

# =========================================================
# 1. 회원가입 / 로그인 / 정보 조회
# =========================================================
@app.post("/signup", response_model=schemas.UserResponse)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 아이디")
    new_user = models.User(
        username=user.username,
        password=pwd_context.hash(user.password),
        nickname=user.nickname,
        role="USER",
        credit_balance=1000 # 가입 축하금
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

# =========================================================
# 2. [Betting System] 팀, 경기, 투표 기능 (복구됨!)
# =========================================================

# 팀 등록 (관리자 전용)
@app.post("/teams")
def create_team(
    team: schemas.TeamCreate, 
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_admin_user)
):
    new_team = models.Team(name=team.name, description=team.description)
    db.add(new_team)
    db.commit()
    return {"msg": "팀 등록 성공", "team_name": new_team.name}

# 매치 생성 (관리자 전용)
@app.post("/matches")
def create_match(
    match: schemas.MatchCreate, 
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_admin_user)
):
    new_match = models.Match(
        title=match.title,
        team_a_id=match.team_a_id,
        team_b_id=match.team_b_id,
        status="OPEN"
    )
    db.add(new_match)
    db.commit()
    return {"msg": "경기 생성 완료", "match_title": new_match.title}

# 투표 하기 (일반 유저)
@app.post("/votes")
def vote_match(
    vote: schemas.VoteCreate, 
    current_user: models.User = Depends(get_current_user), # 토큰 사용
    db: Session = Depends(get_db)
):
    # 1. 잔액 확인
    if current_user.credit_balance < vote.bet_amount:
        raise HTTPException(status_code=400, detail="크레딧이 부족합니다!")

    # 2. 경기 확인
    match = db.query(models.Match).filter(models.Match.id == vote.match_id).first()
    if not match or match.status != "OPEN":
        raise HTTPException(status_code=400, detail="투표 가능한 경기가 아닙니다.")

    # 3. 팀 확인
    if vote.team_id not in [match.team_a_id, match.team_b_id]:
        raise HTTPException(status_code=400, detail="해당 경기에 참여하는 팀이 아닙니다.")

    try:
        # A. 돈 차감
        current_user.credit_balance -= vote.bet_amount

        # B. 투표 기록
        new_vote = models.MatchVote(
            user_id=current_user.id,
            match_id=match.id,
            team_id=vote.team_id,
            bet_amount=vote.bet_amount,
            result_status="PENDING"
        )
        db.add(new_vote)

        # C. 로그 기록
        new_log = models.CreditLog(
            user_id=current_user.id,
            amount=-vote.bet_amount,
            transaction_type="BET_ENTRY",
            description=f"경기 #{match.id} 투표",
            reference_id=match.id
        )
        db.add(new_log)

        db.commit()
        return {"msg": "투표 성공", "remaining_credit": current_user.credit_balance}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# 경기 결과 입력 및 배당금 지급 (관리자 전용)
@app.post("/matches/decide")
def decide_match_result(
    data: schemas.MatchResultDecide, 
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_admin_user)
):
    match = db.query(models.Match).filter(models.Match.id == data.match_id).first()
    if not match or match.status == "FINISHED":
        raise HTTPException(status_code=400, detail="이미 끝난 경기이거나 없습니다.")

    match.winner_team_id = data.winner_team_id
    match.status = "FINISHED"
    
    # 배당 로직
    total_bets = db.query(models.MatchVote).filter(models.MatchVote.match_id == match.id).all()
    total_pot = sum(vote.bet_amount for vote in total_bets)
    
    winner_votes = [v for v in total_bets if v.team_id == data.winner_team_id]
    winner_pot = sum(v.bet_amount for v in winner_votes)

    if winner_pot > 0:
        for vote in winner_votes:
            share = (vote.bet_amount / winner_pot) * total_pot
            prize = int(share)
            
            user = db.query(models.User).filter(models.User.id == vote.user_id).first()
            user.credit_balance += prize
            vote.result_status = "WON"
            
            # 로그 추가
            log = models.CreditLog(
                user_id=user.id,
                amount=prize,
                transaction_type="BET_WIN",
                description=f"경기 #{match.id} 배당금",
                reference_id=match.id
            )
            db.add(log)
            
    for vote in total_bets:
        if vote.team_id != data.winner_team_id:
            vote.result_status = "LOST"

    db.commit()
    return {"msg": "경기 종료 및 정산 완료", "winner": data.winner_team_id}


# =========================================================
# 3. [Voice Market] 목소리 등록, 조회, 생성 (AI)
# =========================================================

# 목소리 등록 (누구나 가능)
@app.post("/voice/train")
async def create_voice_model(
    name: str = Form(...),
    description: str = Form(None),
    is_public: bool = Form(False),
    ref_text: str = Form(...),
    audio_file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_voice_dir = os.path.join(VOICE_DIR, str(current_user.id))
    os.makedirs(user_voice_dir, exist_ok=True)

    file_ext = os.path.splitext(audio_file.filename)[1] or ".wav"
    filename = f"{uuid.uuid4()}{file_ext}"
    save_path = os.path.join(user_voice_dir, filename)

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(audio_file.file, buffer)

    new_model = models.VoiceModel(
        user_id=current_user.id,
        model_name=name,
        # GPT/SoVITS 경로는 실제 학습이 없으므로, 일단 원본 오디오 경로를 넣어둡니다 (데모용)
        gpt_path=save_path, 
        sovits_path=save_path,
        is_public=is_public,
        usage_count=0
    )
    # models.py에 ref_text 필드가 없다면 추가하거나 생략해야 함 (여기선 생략된 모델 가정)
    # 만약 models.py에 ref_text 필드가 있다면 아래 주석 해제:
    # new_model.ref_text = ref_text 

    db.add(new_model)
    db.commit()
    db.refresh(new_model)

    return {"msg": "목소리 등록 완료", "model_id": new_model.id}

# 목소리 마켓 목록
@app.get("/voice/list", response_model=list[schemas.VoiceModelResponse])
async def list_available_voices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    models_list = db.query(models.VoiceModel).filter(
        or_(
            models.VoiceModel.user_id == current_user.id,
            models.VoiceModel.is_public == True
        )
    ).all()
    return models_list

# TTS 생성 (비용 차감 포함)
@app.post("/tts/generate")
async def generate_tts(
    request: schemas.TTSRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    COST = 50 # 생성 비용

    # 모델 확인
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == request.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="모델이 없습니다.")

    # 권한 확인
    if not voice_model.is_public and voice_model.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="사용 권한이 없습니다.")

    # 잔액 확인
    if current_user.credit_balance < COST:
        raise HTTPException(status_code=400, detail="잔액 부족")

    # 결제 처리
    current_user.credit_balance -= COST
    voice_model.usage_count += 1
    
    # AI 요청 준비
    temp_filename = f"temp_{uuid.uuid4()}.wav"
    shared_path = os.path.join(SHARED_DIR, temp_filename)
    
    # (실제로는 gpt_path, sovits_path를 써야 하지만, 데모에선 원본 오디오를 사용)
    shutil.copy(voice_model.gpt_path, shared_path)

    payload = {
        "text": request.text,
        "text_lang": "ko",
        "ref_audio_path": shared_path,
        "prompt_text": "임시 텍스트", # DB에 저장 안 했으면 임시값
        "prompt_lang": "ko",
        "text_split_method": "cut5",
        "speed_factor": 1.0
    }

    try:
        ai_url = "http://gpt-sovits:9880"
        response = requests.post(f"{ai_url}/tts", json=payload)
        
        if response.status_code != 200:
            current_user.credit_balance += COST # 환불
            raise HTTPException(status_code=500, detail="AI 서버 에러")

        # 결과 저장
        user_gen_dir = os.path.join(GEN_DIR, str(current_user.id))
        os.makedirs(user_gen_dir, exist_ok=True)
        
        output_filename = f"tts_{uuid.uuid4()}.wav"
        output_path = os.path.join(user_gen_dir, output_filename)

        with open(output_path, "wb") as f:
            f.write(response.content)

        if os.path.exists(shared_path): os.remove(shared_path)
        
        # 로그 및 히스토리
        history = models.TTSHistory(
            user_id=current_user.id,
            voice_model_id=voice_model.id,
            text_content=request.text,
            audio_url=f"/static/generated/{current_user.id}/{output_filename}",
            cost_credit=COST
        )
        db.add(history)
        db.commit()

        return {
            "msg": "생성 성공",
            "audio_url": history.audio_url,
            "cost": COST,
            "remaining_credit": current_user.credit_balance
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# 충전 (테스트용)
@app.post("/charge")
def charge_credit(req: schemas.ChargeRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.credit_balance += req.amount
    
    log = models.CreditLog(
        user_id=current_user.id,
        amount=req.amount,
        transaction_type="CHARGE",
        description="테스트 충전"
    )
    db.add(log)
    db.commit()
    return {"msg": "충전 완료", "balance": current_user.credit_balance}