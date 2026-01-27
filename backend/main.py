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

import random # [NEW]

# ... (Imports)

@app.get("/users/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

# [NEW] 가위바위보 게임 API
@app.post("/game/rps")
def play_rps_game(
    game_req: schemas.RPSGameRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 유효성 검사
    if game_req.bet_amount <= 0:
        raise HTTPException(400, "배팅 금액은 0보다 커야 합니다.")
        
    if current_user.credit_balance < game_req.bet_amount:
        raise HTTPException(400, "크레딧이 부족합니다.")
        
    valid_choices = ["ROCK", "PAPER", "SCISSORS"]
    user_choice = game_req.choice.upper()
    if user_choice not in valid_choices:
        raise HTTPException(400, "ROCK, PAPER, SCISSORS 중 하나를 선택하세요.")

    # 2. 게임 로직
    server_choice = random.choice(valid_choices)
    
    # 승패 판정
    result = "DRAW"
    winnings = 0
    
    if user_choice == server_choice:
        result = "DRAW"
        # 비기면 본전 (돈 변화 없음)
    elif (
        (user_choice == "ROCK" and server_choice == "SCISSORS") or
        (user_choice == "PAPER" and server_choice == "ROCK") or
        (user_choice == "SCISSORS" and server_choice == "PAPER")
    ):
        result = "WIN"
        # [수정] 90%만 획득, 10%는 수수료
        total_win = game_req.bet_amount
        fee = int(total_win * 0.1)
        winnings = total_win - fee
        
        # 관리자에게 수수료 입금
        if fee > 0:
            system_admin = db.query(models.User).filter(models.User.username == "admin").first()
            if system_admin:
                system_admin.credit_balance += fee
                db.add(models.CreditLog(
                    user_id=system_admin.id,
                    amount=fee,
                    transaction_type="RPS_FEE_IN",
                    description=f"RPS 수수료 (User {current_user.username})",
                    reference_id=None
                ))

    else:
        result = "LOSE"
        winnings = -game_req.bet_amount # 배팅액만큼 차감 (100% 잃음)

    # 3. 결과 반영
    if result != "DRAW":
        current_user.credit_balance += winnings
        
        # 로그 기록
        log = models.CreditLog(
            user_id=current_user.id,
            amount=winnings,
            transaction_type=f"RPS_{result}",
            description=f"가위바위보: {user_choice} vs {server_choice}",
            reference_id=None
        )
        db.add(log)
        db.commit()

    return {
        "result": result,
        "user_choice": user_choice,
        "server_choice": server_choice,
        "credit_change": winnings,
        "current_balance": current_user.credit_balance
    }

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
    # 1. 경기 확인
    match = db.query(models.Match).filter(models.Match.id == data.match_id).first()
    if not match or match.status == "FINISHED":
        raise HTTPException(status_code=400, detail="이미 끝난 경기이거나 없습니다.")

    # 2. 결과 업데이트
    match.winner_team_id = data.winner_team_id
    match.status = "FINISHED"
    
    # 3. 전체 판돈 계산
    total_bets = db.query(models.MatchVote).filter(models.MatchVote.match_id == match.id).all()
    total_pot = sum(vote.bet_amount for vote in total_bets)
    
    # --- [NEW] 수수료 정산 로직 (Admin 징수) ---
    FEE_PERCENT = 0.10  # 수수료 10% 설정 (필요하면 변경 가능)
    
    if total_pot > 0:
        fee_amount = int(total_pot * FEE_PERCENT) # 관리자가 가져갈 돈
        prize_pot = total_pot - fee_amount        # 우승자들이 나눠가질 돈
        
        # 'admin' 계정 찾기
        system_admin = db.query(models.User).filter(models.User.username == "admin").first()
        
        if system_admin and fee_amount > 0:
            system_admin.credit_balance += fee_amount
            
            # 관리자 수입 로그 기록
            log_fee = models.CreditLog(
                user_id=system_admin.id,
                amount=fee_amount,
                transaction_type="FEE_IN",
                description=f"경기 #{match.id} 운영 수수료",
                reference_id=match.id
            )
            db.add(log_fee)
        else:
            # admin 계정이 없으면 수수료 없이 전액 배당 (혹은 에러 처리)
            prize_pot = total_pot 
    else:
        prize_pot = 0

    # 4. 우승자 배당금 분배
    winner_votes = [v for v in total_bets if v.team_id == data.winner_team_id]
    winner_pot = sum(v.bet_amount for v in winner_votes)
    
    actual_distributed_amount = 0  # [NEW] 실제로 사람들에게 나눠준 돈의 합계

    if winner_pot > 0:
        for vote in winner_votes:
            # 내 지분율대로 계산하고 소수점 버림
            share_ratio = vote.bet_amount / winner_pot
            prize = int(share_ratio * prize_pot)
            
            # 유저에게 입금
            user = db.query(models.User).filter(models.User.id == vote.user_id).first()
            user.credit_balance += prize
            vote.result_status = "WON"
            
            # [NEW] 나눠준 돈 기록
            actual_distributed_amount += prize 
            
            log = models.CreditLog(
                user_id=user.id,
                amount=prize,
                transaction_type="BET_WIN",
                description=f"경기 #{match.id} 배당금",
                reference_id=match.id
            )
            db.add(log)
            
    # --- [NEW] 자투리 돈(Dust) 처리 ---
    # (배당해야 할 총액) - (실제로 나눠준 돈) = 남은 찌꺼기 돈
    dust_amount = prize_pot - actual_distributed_amount
    
    if dust_amount > 0:
        # admin 계정 다시 조회 (위에서 이미 조회했지만 명확성을 위해)
        system_admin = db.query(models.User).filter(models.User.username == "admin").first()
        if system_admin:
            system_admin.credit_balance += dust_amount
            
            # 자투리 수입 로그
            log_dust = models.CreditLog(
                user_id=system_admin.id,
                amount=dust_amount,
                transaction_type="FEE_DUST",
                description=f"경기 #{match.id} 자투리 정산",
                reference_id=match.id
            )
            db.add(log_dust)
            
    # 5. 패배자 처리
    for vote in total_bets:
        if vote.team_id != data.winner_team_id:
            vote.result_status = "LOST"

    db.commit()
    return {
        "msg": "경기 종료 완료", 
        "winner": data.winner_team_id, 
        "total_pot": total_pot,
        "fee_taken": int(total_pot * FEE_PERCENT) if total_pot > 0 else 0
    }


# =========================================================
# 3. [Voice Market] 목소리 등록, 조회, 생성 (AI)
# =========================================================

# 목소리 등록 (Fine-tuning 요청)
@app.post("/voice/train")
async def create_voice_model(
    name: str = Form(...),
    description: str = Form(None),
    price: int = Form(1000), # [NEW] 가격 설정 (기본 1000)
    is_public: bool = Form(False),
    ref_text: str = Form(...),
    audio_file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # ... (파일 저장 및 AI 요청 로직 생략, 위와 동일) ...
    # 실제로는 diff가 너무 길어지므로 model 생성 부분만 대체합니다.
    # 하지만 replace_file_content는 context가 필요하므로 전체 함수 헤더를 수정해야 함.
    # 여기서는 "VoiceModel 객체 생성" 부분과 "함수 헤더"를 나눠서 수정하는게 나을듯 하지만
    # 한 번에 하는게 안전함.

    # 1. 파일 저장
    user_voice_dir = os.path.join(VOICE_DIR, str(current_user.id))
    os.makedirs(user_voice_dir, exist_ok=True)

    file_ext = os.path.splitext(audio_file.filename)[1] or ".wav"
    filename = f"{uuid.uuid4()}{file_ext}"
    save_path = os.path.join(user_voice_dir, filename)

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(audio_file.file, buffer)
        
    try:
        # 2. AI 서버에 학습 요청
        ai_url = "http://gpt-sovits:9880"
        
        shared_filename = f"train_{uuid.uuid4()}{file_ext}"
        shared_path = os.path.join(SHARED_DIR, shared_filename)
        shutil.copy(save_path, shared_path)

        payload = {
            "user_id": str(current_user.id),
            "model_name": name,
            "ref_audio_path": shared_path,
            "ref_text": ref_text
        }
        
        response = requests.post(f"{ai_url}/train_model", json=payload, timeout=600)
        
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"AI 학습 실패: {response.text}")
            
        result = response.json()
        model_path = result.get("model_path")
        
        if not model_path:
            raise HTTPException(status_code=500, detail="AI 서버가 모델 경로를 반환하지 않았습니다.")

        # 3. DB 저장
        new_model = models.VoiceModel(
            user_id=current_user.id,
            model_name=name,
            description=description,
            price=price, # [NEW]
            model_path=model_path,
            is_public=is_public,
            usage_count=0
        )

        db.add(new_model)
        db.commit()
        db.refresh(new_model)
        
        # [NEW] 제작자도 자동으로 '구매(소장)' 처리
        # 이렇게 하면 나중에 권한 체크할 때 'UserSavedVoice'만 보면 됨 (is_owner 체크 불필요)
        owner_saved = models.UserSavedVoice(user_id=current_user.id, voice_model_id=new_model.id)
        db.add(owner_saved)
        db.commit()
        db.refresh(new_model)
        
        # 임시 공유 파일 삭제
        if os.path.exists(shared_path): os.remove(shared_path)

        return {"msg": "목소리 모델 학습 완료", "model_id": new_model.id}

    except requests.exceptions.Timeout:
         raise HTTPException(status_code=504, detail="AI 서버 응답 시간 초과 (학습이 너무 오래 걸립니다)")
    except Exception as e:
        print(f"Error during training: {e}")
        # 실패 시 업로드한 파일 삭제 (선택)
        if os.path.exists(save_path): os.remove(save_path)
        raise HTTPException(status_code=500, detail=str(e))

# 목소리 마켓 목록
@app.get("/voice/list", response_model=list[schemas.VoiceModelResponse])
async def list_available_voices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 공개된 모델만 조회 (내꺼라도 비공개면 안 보여줌)
    models_list = db.query(models.VoiceModel).filter(
        models.VoiceModel.is_public == True
    ).all()
    
    # 2. 내가 구매한(저장한) 모델 ID 목록 조회
    purchased_ids = db.query(models.UserSavedVoice.voice_model_id).filter(
        models.UserSavedVoice.user_id == current_user.id
    ).all()
    
    # 튜플 리스트 -> set으로 변환 (검색 속도 향상)
    purchased_ids_set = {pid[0] for pid in purchased_ids}
    
    # 3. 응답 데이터 구성 (is_purchased 필드 채우기)
    results = []
    for model in models_list:
        # 내 모델이면 무조건 구매한 것으로 간주 (혹은 DB에 자동 저장 했으면 그걸로 체크)
        is_mine = (model.user_id == current_user.id)
        is_bought = (model.id in purchased_ids_set)
        
        # Pydantic 모델로 변환
        resp = schemas.VoiceModelResponse.from_orm(model)
        resp.is_purchased = (is_mine or is_bought)
        results.append(resp)
        
    return results

# [NEW] 목소리 구매 (저장 -> 구매)
@app.post("/voice/buy/{model_id}")
async def buy_voice_model(
    model_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    model = db.query(models.VoiceModel).filter(models.VoiceModel.id == model_id).first()
    if not model:
        raise HTTPException(404, "모델을 찾을 수 없습니다.")
    
    # 1. 이미 구매했는지(저장했는지) 확인
    exists = db.query(models.UserSavedVoice).filter(
        models.UserSavedVoice.user_id == current_user.id,
        models.UserSavedVoice.voice_model_id == model_id
    ).first()
    
    if exists:
        return {"msg": "이미 구매(저장)한 모델입니다."}
    
    # [주의] 자동 저장이 적용되었으므로, 모델 생성자는 이미 exists에 걸립니다.
    # 따라서 아래 '내 모델 공짜' 로직은 사실상 실행될 일이 없지만, 방어 코드로 남겨두거나 삭제해도 됩니다.
    # 여기서는 삭제합니다.

    # 2. 비공개 모델 구매 불가
    if not model.is_public:
        raise HTTPException(403, "비공개 모델입니다.")

    # 3. 잔액 확인
    price = model.price or 0
    if current_user.credit_balance < price:
        raise HTTPException(400, "잔액이 부족합니다.")

    # 4. 결제 로직 (70% 판매자, 30% 수수료)
    try:
        # 구매자 차감
        current_user.credit_balance -= price
        
        # 로그: 구매
        db.add(models.CreditLog(
            user_id=current_user.id,
            amount=-price,
            transaction_type="BUY_MODEL",
            description=f"모델 구매: {model.model_name}",
            reference_id=model.id
        ))

        # 수익 계산
        creator_share = int(price * 0.70)
        fee_share = price - creator_share

        # 판매자 입금
        creator = db.query(models.User).filter(models.User.id == model.user_id).first()
        if creator:
            creator.credit_balance += creator_share
            db.add(models.CreditLog(
                user_id=creator.id,
                amount=creator_share,
                transaction_type="SELL_MODEL",
                description=f"모델 판매 수익: {model.model_name}",
                reference_id=model.id
            ))

        # 관리자 수수료 입금
        if fee_share > 0:
            system_admin = db.query(models.User).filter(models.User.username == "admin").first()
            if system_admin:
                system_admin.credit_balance += fee_share
                db.add(models.CreditLog(
                    user_id=system_admin.id,
                    amount=fee_share,
                    transaction_type="FEE_SELL_MODEL",
                    description=f"모델 판매 수수료: {model.model_name}",
                    reference_id=model.id
                ))

        # 5. 라이브러리에 추가
        saved = models.UserSavedVoice(user_id=current_user.id, voice_model_id=model_id)
        db.add(saved)
        
        model.usage_count += 1
        db.commit()
        
        return {"msg": f"모델을 구매했습니다. (가격: {price} 크레딧)"}

    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"결제 실패: {str(e)}")

# [NEW] 목소리 저장 취소
@app.delete("/voice/save/{model_id}")
async def unsave_voice_model(
    model_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    saved = db.query(models.UserSavedVoice).filter(
        models.UserSavedVoice.user_id == current_user.id,
        models.UserSavedVoice.voice_model_id == model_id
    ).first()
    
    if not saved:
        raise HTTPException(404, "저장된 내역이 없습니다.")
        
    db.delete(saved)
    db.commit()
    return {"msg": "라이브러리에서 삭제되었습니다."}

# [NEW] 내 저장 목록 조회
@app.get("/voice/my_list", response_model=list[schemas.VoiceModelResponse])
async def list_saved_voices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # [최적화] UserSavedVoice 테이블을 통해 한 번에 조회
    # (이제 내 모델도 만들 때 UserSavedVoice에 추가되므로, 이것만 조회하면 됨)
    saved_models = db.query(models.VoiceModel).join(
        models.UserSavedVoice, 
        models.UserSavedVoice.voice_model_id == models.VoiceModel.id
    ).filter(
        models.UserSavedVoice.user_id == current_user.id
    ).all()
    
    # 응답 변환 (is_purchased=True)
    results = []
    for m in saved_models:
        resp = schemas.VoiceModelResponse.from_orm(m)
        resp.is_purchased = True
        results.append(resp)
        
    return results


# TTS 생성 (비용 차감 + 수익 분배 로직 적용)
@app.post("/tts/generate")
async def generate_tts(
    request: schemas.TTSRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    COST = 10           # [수정] 1회 생성 비용 10 (고정)
    
    # ... (모델, 권한, 학습 여부 확인 로직 동일 - 생략 불가하므로 반복)
    # 1. 모델 확인
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == request.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="모델이 없습니다.")

    # 2. 권한 확인 (UserSavedVoice에 있으면 OK)
    # [최적화] 이제 제작자도 UserSavedVoice에 있으므로 이것만 검사하면 됨
    is_saved = db.query(models.UserSavedVoice).filter(
        models.UserSavedVoice.user_id == current_user.id, 
        models.UserSavedVoice.voice_model_id == voice_model.id
    ).first()

    if not is_saved:
        raise HTTPException(status_code=403, detail="사용 권한이 없습니다. (먼저 모델을 구매해주세요)")
    
    if not voice_model.model_path:
         raise HTTPException(status_code=400, detail="학습이 완료되지 않은 모델입니다.")

    # 3. 잔액 확인
    if current_user.credit_balance < COST:
        raise HTTPException(status_code=400, detail="잔액 부족")

    # --- [결제 및 정산 로직 시작] ---
    try:
        # A. 사용자 돈 차감
        current_user.credit_balance -= COST
        voice_model.usage_count += 1
        
        # 사용 로그
        log_use = models.CreditLog(
            user_id=current_user.id,
            amount=-COST,
            transaction_type="TTS_USE",
            description=f"TTS 생성 (모델: {voice_model.model_name})",
            reference_id=voice_model.id
        )
        db.add(log_use)

        # B. 전액 관리자 수입 처리 (100%)
        system_admin = db.query(models.User).filter(models.User.username == "admin").first()
        if system_admin:
            system_admin.credit_balance += COST
            
            log_admin = models.CreditLog(
                user_id=system_admin.id,
                amount=COST,
                transaction_type="FEE_TTS",
                description=f"TTS 수익 (User {current_user.username} -> Model {voice_model.id})",
                reference_id=voice_model.id
            )
            db.add(log_admin)

        # (기존 수익 분배 로직 삭제됨)

        # --- [AI 요청 로직] ---
        
        # [NEW] Fine-tuning된 모델 사용 요청
        payload = {
            "text": request.text,
            "text_lang": "ko",
            "model_path": voice_model.model_path, # 학습된 체크포인트 전달
            "prompt_text": "", 
            "prompt_lang": "ko",
            "text_split_method": "cut5",
            "speed_factor": 1.0
        }

        ai_url = "http://gpt-sovits:9880"
        response = requests.post(f"{ai_url}/tts", json=payload)
        
        if response.status_code != 200:
            raise Exception("AI 서버 응답 오류")

        # 결과 저장
        user_gen_dir = os.path.join(GEN_DIR, str(current_user.id))
        os.makedirs(user_gen_dir, exist_ok=True)
        
        output_filename = f"tts_{uuid.uuid4()}.wav"
        output_path = os.path.join(user_gen_dir, output_filename)

        with open(output_path, "wb") as f:
            f.write(response.content)

        # 히스토리 저장
        history = models.TTSHistory(
            user_id=current_user.id,
            voice_model_id=voice_model.id,
            text_content=request.text,
            audio_url=f"/static/generated/{current_user.id}/{output_filename}",
            cost_credit=COST
        )
        db.add(history)
        
        # 모든 DB 변경사항 한방에 저장
        db.commit()

        return {
            "msg": "생성 성공",
            "audio_url": history.audio_url,
            "cost": COST,
            "remaining_credit": current_user.credit_balance
        }

    except Exception as e:
        db.rollback() 
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail="생성 중 오류가 발생했습니다.")

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