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
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from typing import Optional
from dotenv import load_dotenv
import google.generativeai as genai # [NEW] Gemini 연동

# DB 테이블 생성
models.Base.metadata.create_all(bind=engine)

app = FastAPI()
load_dotenv()

# --- [설정] ---
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

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
    if user is None: raise credentials_exception
    return user

# [NEW] 선택적 인증 (로그인 안 해도 접근 가능, 하면 유저 정보 반환)
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

def get_current_user_optional(token: str = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: return None
    except JWTError:
        return None
    
    user = db.query(models.User).filter(models.User.username == username).first()
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
async def signup(
    username: str = Form(...),
    password: str = Form(...),
    nickname: str = Form(None),
    profile_image: UploadFile = File(None),
    db: Session = Depends(get_db)
):
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 아이디")
    
    # 1. 유저 먼저 생성 (ID 확보를 위해)
    new_user = models.User(
        username=username,
        password=pwd_context.hash(password),
        nickname=nickname,
        role="USER",
        credit_balance=1000, # 가입 축하금
        profile_image="/static/default_profile.png" # 일단 기본값
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user) 
    
    # 2. 프로필 이미지 저장 (있다면)
    if profile_image:
        try:
            # 유저별 폴더 생성: static/profiles/{user_id}/
            user_profile_dir = os.path.join(STATIC_DIR, "profiles", str(new_user.id))
            os.makedirs(user_profile_dir, exist_ok=True)
            
            file_ext = os.path.splitext(profile_image.filename)[1] or ".png"
            filename = f"profile{file_ext}" # 이름 단순화 (어차피 폴더가 분리됨)
            save_path = os.path.join(user_profile_dir, filename)
            
            with open(save_path, "wb") as buffer:
                shutil.copyfileobj(profile_image.file, buffer)
                
            # DB 업데이트
            new_user.profile_image = f"/static/profiles/{new_user.id}/{filename}"
            db.commit()
            db.refresh(new_user)
            
        except Exception as e:
            print(f"프로필 이미지 저장 실패: {e}")
            # 실패해도 유저 가입은 성공시킴 (이미지는 기본값)
            
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

# [NEW] 유저 정보 수정 (프로필 사진 포함)
@app.put("/users/me", response_model=schemas.UserUpdateResponse)
async def update_users_me(
    username: Optional[str] = Form(None),
    nickname: Optional[str] = Form(None),
    profile_image: UploadFile = File(None),
    password: Optional[str] = Form(None), # [NEW] 검증용 비밀번호
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    is_username_changed = False

    # 1. 아이디(이메일) 변경 시 비밀번호 검증 및 중복 체크
    if username and username != current_user.username:
        # 비밀번호 확인
        if not password or not pwd_context.verify(password, current_user.password):
            raise HTTPException(status_code=401, detail="이메일 변경을 위해서는 현재 비밀번호 확인이 필요합니다.")

        existing = db.query(models.User).filter(models.User.username == username).first()
        if existing:
            raise HTTPException(status_code=400, detail="이미 존재하는 아이디(이메일)입니다.")
        current_user.username = username
        is_username_changed = True
        
    # 2. 닉네임 변경
    if nickname is not None:
        current_user.nickname = nickname
        
    # 3. 프로필 이미지 변경
    if profile_image:
        try:
            user_profile_dir = os.path.join(STATIC_DIR, "profiles", str(current_user.id))
            os.makedirs(user_profile_dir, exist_ok=True)
            
            file_ext = os.path.splitext(profile_image.filename)[1] or ".png"
            filename = f"profile_{uuid.uuid4().hex[:8]}{file_ext}"
            save_path = os.path.join(user_profile_dir, filename)
            
            with open(save_path, "wb") as buffer:
                shutil.copyfileobj(profile_image.file, buffer)
                
            current_user.profile_image = f"/static/profiles/{current_user.id}/{filename}"
        except Exception as e:
            print(f"이미지 업데이트 실패: {e}")
            raise HTTPException(status_code=500, detail="프로필 이미지 저장 실패")

    db.commit()
    db.refresh(current_user)

    # 토큰 갱신 (ID가 바뀌었으므로 기존 토큰 무효화됨)
    new_token = None
    token_type = None
    if is_username_changed:
        new_token = create_access_token(
            data={"sub": current_user.username, "role": current_user.role},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        token_type = "bearer"

    return schemas.UserUpdateResponse(
        id=current_user.id,
        username=current_user.username,
        nickname=current_user.nickname,
        role=current_user.role,
        credit_balance=current_user.credit_balance,
        profile_image=current_user.profile_image,
        created_at=current_user.created_at,
        access_token=new_token,
        token_type=token_type
    )

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

# [NEW] 홀짝 게임 API
@app.post("/game/oddeven")
def play_oddeven_game(
    game_req: schemas.OddEvenGameRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 유효성 검사
    if game_req.bet_amount <= 0:
        raise HTTPException(400, "배팅 금액은 0보다 커야 합니다.")
        
    if current_user.credit_balance < game_req.bet_amount:
        raise HTTPException(400, "크레딧이 부족합니다.")
        
    valid_choices = ["ODD", "EVEN"]
    user_choice = game_req.choice.upper()
    if user_choice not in valid_choices:
        raise HTTPException(400, "ODD 또는 EVEN 중 하나를 선택하세요.")

    # 2. 게임 로직
    # 1부터 10까지 랜덤 숫자 생성 (1,3,5... 홀수 / 2,4,6... 짝수)
    random_num = random.randint(1, 100)
    server_result = "ODD" if random_num % 2 != 0 else "EVEN"
    
    # 승패 판정
    result = "LOSE"
    winnings = 0
    
    if user_choice == server_result:
        result = "WIN"
        # 90%만 획득 (배팅액 포함 아님, 순수 이익이 배팅액의 90%인 것으로 간주? 아님 RPS랑 똑같이)
        # RPS 로직: 이기면 (배팅액 - 수수료)를 지급. (즉 원금 + 0.9*배팅액이 아니라, 그냥 0.9*배팅액을 줌?)
        # 확인: RPS에서 user_choice == server_choice면 DRAW (본전).
        # 이기면 winnings = bet - fee.
        # current_user.credit_balance += winnings.
        # 즉 원금(100) 걸고 이기면 100을 받는게 아니라 90을 "추가로" 받는게 아니라
        # DB상으로는 balance += 90.
        # 근데 배팅할 때 돈을 먼저 차감 안 함!
        # RPS 코드 보면:
        # 이기면: credit_balance += winnings (== 90)
        # 지면: credit_balance += winnings (== -100)
        # 즉 이기면 잔고가 +90 증가. (원금 유지 + 90 이득)
        # 지면 잔고가 -100 감소. (원금 상실)
        # 맞음.
        
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
                    transaction_type="ODDEVEN_FEE_IN",
                    description=f"홀짝 수수료 (User {current_user.username})",
                    reference_id=None
                ))
    else:
        result = "LOSE"
        winnings = -game_req.bet_amount # 배팅액만큼 차감

    # 3. 결과 반영
    current_user.credit_balance += winnings
    
    # 로그 기록
    log = models.CreditLog(
        user_id=current_user.id,
        amount=winnings,
        transaction_type=f"ODDEVEN_{result}",
        description=f"홀짝: {user_choice} vs {server_result} ({random_num})",
        reference_id=None
    )
    db.add(log)
    db.commit()

    return {
        "result": result,
        "user_choice": user_choice,
        "server_choice": server_result,
        "random_number": random_num,
        "credit_change": winnings,
        "current_balance": current_user.credit_balance
    }

# [NEW] 사다리 게임 API
@app.post("/game/ladder", response_model=schemas.LadderGameResponse)
def play_ladder_game(
    game_req: schemas.LadderGameRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 유효성 검사
    if game_req.bet_amount < 100:
        raise HTTPException(400, "배팅 금액은 최소 100 이상이어야 합니다.")
        
    if current_user.credit_balance < game_req.bet_amount:
        raise HTTPException(400, "크레딧이 부족합니다.")
    
    # 적어도 하나는 선택해야 함
    if not any([game_req.start_point, game_req.line_count, game_req.end_point]):
        raise HTTPException(400, "적어도 하나의 항목을 선택해야 합니다.")

    # 2. 게임 결과 생성 (백엔드 로직)
    # 2-1. 가로줄 개수 (3 or 4)
    line_count = random.choice([3, 4])
    
    # 2-2. 출발 지점 (0=LEFT, 1=RIGHT)
    start_idx = random.choice([0, 1]) # 0 or 1
    
    # 2-3. 가로줄 위치 생성 (7줄 중 line_count개 선택)
    # 사다리 높이: 7 (인덱스 0~6)
    ladder_height = 7
    # 0~6 사이에서 line_count개만큼 랜덤 위치 선정 (중복 없음)
    horizontal_lines = sorted(random.sample(range(ladder_height), line_count))
    
    # 2-4. 도착 지점 계산
    # start_idx에서 시작해서 내려가면서 가로줄을 만나면 이동 (0->1, 1->0)
    current_pos = start_idx
    
    # 사다리를 위(0)에서 아래(6)로 내려가면서 체크
    # horizontal_lines에는 가로줄이 있는 인덱스가 들어있음
    # 예: [1, 3, 5] 라면 인덱스 1, 3, 5에서 교차 발생
    for i in range(ladder_height):
        if i in horizontal_lines:
            # 가로줄을 만나면 위치 변경 (0 <-> 1)
            current_pos = 1 - current_pos
            
    end_idx = current_pos
    
    # 결과 문자열 변환
    start_str = "LEFT" if start_idx == 0 else "RIGHT"
    end_str = "LEFT" if end_idx == 0 else "RIGHT"
    
    # 3. 승패 판정
    # 사용자가 선택한 항목들이 실제 결과와 일치하는지 확인
    # 선택하지 않은 항목(None)은 패스
    
    is_win = True
    match_count = 0
    
    if game_req.start_point:
        if game_req.start_point == start_str:
            match_count += 1
        else:
            is_win = False
            
    if game_req.line_count:
        if game_req.line_count == line_count:
            match_count += 1
        else:
            is_win = False
            
    if game_req.end_point:
        if game_req.end_point == end_str:
            match_count += 1
        else:
            is_win = False
            
    # 배팅 로직: 하나라도 틀리면 LOSE (조건부 승리)
    # 다 맞으면 승리 -> 배당: 1.8 ^ 맞춘 개수
    
    payout = 0
    profit = 0
    result_status = "LOSE"
    
    if is_win and match_count > 0:
        result_status = "WIN"
        
        # [수정] 공정 배당 - 수수료 10% 방식
        # 공정 확률: 1/2 (1개), 1/4 (2개), 1/8 (3개) -> 배당 2배, 4배, 8배
        fair_odds = 2 ** match_count
        
        # 실제 배당 (수수료 10% 차감)
        real_odds = fair_odds * 0.9
        
        # 유저에게 줄 금액 (소수점 버림)
        payout = int(game_req.bet_amount * real_odds)
        
        # 순수익
        profit = payout - game_req.bet_amount

        # [NEW] 관리자 수수료 (총 승리 금액의 10%)
        # total_win_theory = game_req.bet_amount * fair_odds
        # fee = int(total_win_theory * 0.1)
        # 그냥 간단하게: (공정배당금액 - 실제지급액) 차액을 수수료로 간주
        theory_payout = int(game_req.bet_amount * fair_odds)
        fee = theory_payout - payout
        
        if fee > 0:
            system_admin = db.query(models.User).filter(models.User.username == "admin").first()
            if system_admin:
                system_admin.credit_balance += fee
                db.add(models.CreditLog(
                    user_id=system_admin.id,
                    amount=fee,
                    transaction_type="LADDER_FEE_IN",
                    description=f"사다리 수수료 (User {current_user.username}, {match_count} Combo)",
                    reference_id=None
                ))
    else:
        # 패배 시: 배팅액만큼 차감
        profit = -game_req.bet_amount
        
    # 4. 결과 반영
    current_user.credit_balance += profit
    
    # 0 미만 방지 (빚쟁이 방지)
    if current_user.credit_balance < 0:
        current_user.credit_balance = 0

    # 로그
    db.add(models.CreditLog(
        user_id=current_user.id,
        amount=profit,
        transaction_type=f"LADDER_{result_status}",
        description=f"사다리: {start_str}/{line_count}/{end_str} (Bet:{game_req.bet_amount})",
        reference_id=None
    ))
    db.commit()
    
    return {
        "result": result_status,
        "start_point": start_str,
        "line_count": line_count,
        "end_point": end_str,
        "payout": payout,
        "current_balance": current_user.credit_balance,
        "ladder_data": {
            "start_idx": start_idx,
            "horizontal_lines": horizontal_lines,
            "end_idx": end_idx
        }
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

    # [NEW] 중복 투표 방지
    existing_vote = db.query(models.MatchVote).filter(
        models.MatchVote.user_id == current_user.id,
        models.MatchVote.match_id == vote.match_id
    ).first()

    if existing_vote:
        raise HTTPException(status_code=400, detail="이미 투표한 경기입니다.")

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


# [NEW] 경기 목록 조회 (전체)
@app.get("/matches", response_model=list[schemas.MatchResponse])
def list_matches(
    status: Optional[str] = None,
    current_user: Optional[models.User] = Depends(get_current_user_optional), # [MOD] 선택적 유저
    db: Session = Depends(get_db)
):
    query = db.query(models.Match)
    if status:
        query = query.filter(models.Match.status == status)
    
    # 최신순 정렬
    matches = query.order_by(models.Match.created_at.desc()).all()
    
    # 유저가 로그인한 경우, 투표 여부 확인
    my_votes_map = {} # match_id -> team_id
    if current_user:
        my_votes = db.query(models.MatchVote).filter(
            models.MatchVote.user_id == current_user.id
        ).all()
        for v in my_votes:
            my_votes_map[v.match_id] = v.team_id
            
    # 응답(Schema) 형태로 변환 후 is_voted 주입
    results = []
    for m in matches:
        # Pydantic 모델로 변환 (ORM 모드)
        resp = schemas.MatchResponse.from_orm(m)
        
        # 내가 투표했는지 체크
        if m.id in my_votes_map:
            resp.is_voted = True
            resp.my_vote_team_id = my_votes_map[m.id]
        else:
            resp.is_voted = False
            resp.my_vote_team_id = None
            
        results.append(resp)
        
    return results


# =========================================================
# 3. [Voice Market] 목소리 등록, 조회, 생성 (AI)
# =========================================================

# 목소리 등록 (Fine-tuning 요청)
@app.post("/voice/train")
async def create_voice_model(
    name: str = Form(...),
    description: str = Form(None),
    price: int = Form(0), # [NEW] 가격 설정 (기본 0)
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

        # [NEW] 샘플 오디오 자동 생성 (비동기 처리 권장이지만 여기선 동기 처리)
        try:
            sample_text = "안녕하세요. 제 목소리를 들어보세요."
            demo_url = _internal_tts_process(
                text=sample_text,
                voice_model_path=model_path,
                user_id=current_user.id,
                ref_audio_path=shared_path, # 학습 시 사용한 파일 재사용
                prompt_text=ref_text        # 학습 시 사용한 텍스트 재사용
            )
            new_model.demo_audio_url = demo_url
            db.commit()
        except Exception as e:
            print(f"샘플 생성 실패 (무시됨): {e}")
            # 샘플 생성 실패해도 모델 생성은 성공으로 간주
        
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
        
        # [NEW] 제작자 정보 주입
        if model.creator:
            resp.creator_name = model.creator.nickname or model.creator.username
            resp.creator_profile_image = model.creator.profile_image
            
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
    
    # [SAFEGUARD] 내 모델은 구매할 수 없음 (이미 소유)
    if model.user_id == current_user.id:
        return {"msg": "본인이 제작한 모델입니다."}

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

    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"결제 실패: {str(e)}")

# [NEW] 목소리 공개 여부 수정
@app.put("/voice/update/{model_id}")
async def update_voice_model_visibility(
    model_id: int,
    update_data: schemas.VoiceModelUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 모델 조회
    model = db.query(models.VoiceModel).filter(models.VoiceModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="모델을 찾을 수 없습니다.")

    # 2. 권한 확인 (본인 모델만 수정 가능)
    if model.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="수정 권한이 없습니다.")

    # 3. 업데이트
    model.is_public = update_data.is_public
    db.commit()
    
    return {"msg": "모델 공개 설정이 변경되었습니다.", "is_public": model.is_public}

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

# [MODIFIED] 내 제작 목록 조회 (순수하게 내가 만든 것)
@app.get("/voice/my_list", response_model=list[schemas.VoiceModelResponse])
async def list_my_created_voices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 내가 만든 모델만 조회
    my_models = db.query(models.VoiceModel).filter(
        models.VoiceModel.user_id == current_user.id
    ).all()
    
    results = []
    for m in my_models:
        resp = schemas.VoiceModelResponse.from_orm(m)
        resp.is_purchased = True # 내가 만든 건 내꺼
        
        # [NEW] 제작자 정보 (나 자신)
        resp.creator_name = current_user.nickname or current_user.username
        resp.creator_profile_image = current_user.profile_image
        
        results.append(resp)
        
    return results

# [NEW] 저장한 목록 조회 (내가 만든 것 제외)
@app.get("/voice/saved_list", response_model=list[schemas.VoiceModelResponse])
async def list_saved_voices_only(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # UserSavedVoice 중 내가 만든 모델은 제외하고 조회
    saved_models = db.query(models.VoiceModel).join(
        models.UserSavedVoice, 
        models.UserSavedVoice.voice_model_id == models.VoiceModel.id
    ).filter(
        models.UserSavedVoice.user_id == current_user.id,
        models.VoiceModel.user_id != current_user.id # [중요] 내 모델 제외
    ).all()
    
    results = []
    for m in saved_models:
        resp = schemas.VoiceModelResponse.from_orm(m)
        resp.is_purchased = True
        
        # [NEW] 제작자 정보
        if m.creator:
            resp.creator_name = m.creator.nickname or m.creator.username
            resp.creator_profile_image = m.creator.profile_image
            
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

    # 2. 권한 확인 (UserSavedVoice에 있거나, 모델의 제작자여야 함)
    is_saved = db.query(models.UserSavedVoice).filter(
        models.UserSavedVoice.user_id == current_user.id, 
        models.UserSavedVoice.voice_model_id == voice_model.id
    ).first()
    
    is_owner = (voice_model.user_id == current_user.id)

    if not is_saved and not is_owner:
        raise HTTPException(status_code=403, detail="사용 권한이 없습니다. (먼저 모델을 구매해주세요)")
    
    if not voice_model.model_path:
         raise HTTPException(status_code=400, detail="학습이 완료되지 않은 모델입니다.")

    # 3. 잔액 확인
    if current_user.credit_balance < COST:
        raise HTTPException(status_code=400, detail="잔액 부족")

    # --- [결제 및 정산 (트랜잭션)] ---
    # 먼저 결제 처리를 하고, AI 생성을 시도합니다.
    # 만약 AI 생성이 실패하면 롤백 여부를 고민해야 하지만, 여기선 단순화합니다.
    
    current_user.credit_balance -= COST
    voice_model.usage_count += 1
    
    log_use = models.CreditLog(
        user_id=current_user.id,
        amount=-COST,
        transaction_type="TTS_USE",
        description=f"TTS 생성 (모델: {voice_model.model_name})",
        reference_id=voice_model.id
    )
    db.add(log_use)

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

    # 내부 로직 호출
    try:
        audio_url = _internal_tts_process(
            text=request.text, 
            voice_model_path=voice_model.model_path, 
            user_id=current_user.id
        )
    except Exception as e:
        # 실패 시 롤백 (간단히 예외 던지기, 실제론 transaction rollback 필)
        raise HTTPException(status_code=500, detail=f"AI 생성 실패: {str(e)}")

    # 히스토리 저장
    history = models.TTSHistory(
        user_id=current_user.id,
        voice_model_id=voice_model.id,
        text_content=request.text,
        audio_url=audio_url,
        cost_credit=COST
    )
    db.add(history)
    db.commit()

    return {
        "msg": "생성 성공",
        "audio_url": audio_url,
        "remaining_credits": current_user.credit_balance
    }

# [NEW] 텍스트 채팅만 (빠른 응답용, 무료)
@app.post("/chat/text", response_model=schemas.ChatTextResponse)
async def chat_text_only(
    request: schemas.ChatRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 1. 모델 확인
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == request.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="보이스 모델을 찾을 수 없습니다.")

    # 2. Gemini에게 답변 받기
    if not GEMINI_API_KEY:
         raise HTTPException(status_code=500, detail="서버에 Gemini API 키가 설정되지 않았습니다.")
    
    try:
        model = genai.GenerativeModel('gemini-2.5-flash-lite')
        prompt = f"당신은 '{voice_model.model_name}'라는 캐릭터입니다. 캐릭터의 말투를 사용하여 사용자의 말에 대해 50자 이내로 짧고 자연스럽게 한국어로 대답해주세요.\n사용자: {request.text}"
        
        response = model.generate_content(prompt)
        reply_text = response.text
    except Exception as e:
        print(f"Gemini Error: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini 오류: {str(e)}")

    # 3. 로그 저장 (무료라도 기록은 남김)
    # 히스토리에는 오디오가 없으므로 'text_content'만 저장하거나, 별도 로그로 남길 수 있습니다.
    # 여기선 CreditLog만 남기되 금액은 0
    log_use = models.CreditLog(
        user_id=current_user.id,
        amount=0,
        transaction_type="CHAT_TEXT",
        description=f"AI 대화(텍스트) (모델: {voice_model.model_name})",
        reference_id=voice_model.id
    )
    db.add(log_use)
    db.commit()

    return {
        "reply_text": reply_text,
        "remaining_credits": current_user.credit_balance
    }

# [NEW] 내부 전용 TTS 처리 함수 (채팅에서도 쓰려고 분리)
# [NEW] 내부 전용 TTS 처리 함수 (채팅에서도 쓰려고 분리)
def _internal_tts_process(
    text: str, 
    voice_model_path: str, 
    user_id: int, 
    ref_audio_path: str = None, 
    prompt_text: str = ""
) -> str:
    payload = {
        "text": text,
        "text_lang": "ko",
        "model_path": voice_model_path,
        "ref_audio_path": ref_audio_path, # [NEW]
        "prompt_text": prompt_text,       # [NEW]
        "prompt_lang": "ko",
        "text_split_method": "cut5",
        "speed_factor": 1.0
    }
    ai_url = "http://gpt-sovits:9880"
    response = requests.post(f"{ai_url}/tts", json=payload)
    
    if response.status_code != 200:
        raise Exception(f"AI Server Error: {response.text}")

    user_gen_dir = os.path.join(GEN_DIR, str(user_id))
    os.makedirs(user_gen_dir, exist_ok=True)
    
    output_filename = f"tts_{uuid.uuid4()}.wav"
    output_path = os.path.join(user_gen_dir, output_filename)

    with open(output_path, "wb") as f:
        f.write(response.content)
        
    return f"/static/generated/{user_id}/{output_filename}"

# [NEW] Gemini Chat + TTS 통합 엔드포인트
@app.post("/chat/voice", response_model=schemas.ChatResponse)
async def chat_with_voice(
    request: schemas.ChatRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    COST = 10 # 대화 1회 비용 (TTS 비용과 동일하게 책정)

    # 1. 모델 확인
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == request.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="보이스 모델을 찾을 수 없습니다.")

    if not voice_model.model_path:
        raise HTTPException(status_code=400, detail="학습되지 않은 모델입니다.")

    # 2. 잔액 확인
    if current_user.credit_balance < COST:
        raise HTTPException(status_code=400, detail="크래딧이 부족합니다.")

    # 3. Gemini에게 답변 받기
    if not GEMINI_API_KEY:
         raise HTTPException(status_code=500, detail="서버에 Gemini API 키가 설정되지 않았습니다.")
    
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        # 간단한 프롬프트 설정
        prompt = f"당신은 '{voice_model.model_name}'라는 캐릭터입니다. 사용자의 말에 대해 50자 이내로 짧고 자연스럽게 한국어로 대답해주세요.\n사용자: {request.text}"
        
        response = model.generate_content(prompt)
        reply_text = response.text
    except Exception as e:
        print(f"Gemini Error: {e}")
        # 실패 시 봇의 기본 응답으로 대체할 수도 있음
        raise HTTPException(status_code=500, detail=f"Gemini 오류: {str(e)}")

    # 4. 결제 처리 (성공 시 차감)
    current_user.credit_balance -= COST
    voice_model.usage_count += 1
    
    log_use = models.CreditLog(
        user_id=current_user.id,
        amount=-COST,
        transaction_type="CHAT_USE",
        description=f"AI 대화 (모델: {voice_model.model_name})",
        reference_id=voice_model.id
    )
    db.add(log_use)

    # 관리자 수익
    system_admin = db.query(models.User).filter(models.User.username == "admin").first()
    if system_admin:
        system_admin.credit_balance += COST
        log_admin = models.CreditLog(
            user_id=system_admin.id,
            amount=COST,
            transaction_type="FEE_CHAT",
            description=f"대화 수익",
            reference_id=voice_model.id
        )
        db.add(log_admin)

    # 5. 응답 텍스트를 오디오로 변환
    try:
        audio_url = _internal_tts_process(
            text=reply_text,
            voice_model_path=voice_model.model_path,
            user_id=current_user.id
        )
    except Exception as e:
        db.rollback() # TTS 실패 시 돈 돌려주기 위해 롤백
        raise HTTPException(status_code=500, detail=f"음성 합성 실패: {str(e)}")

    # 히스토리 저장 (Chat 타입으로 따로 저장할 수도 있지만, 우선 TTS 히스토리에 남김)
    history = models.TTSHistory(
        user_id=current_user.id,
        voice_model_id=voice_model.id,
        text_content=f"[Q] {request.text} -> [A] {reply_text}",
        audio_url=audio_url,
        cost_credit=COST
    )
    db.add(history)
    db.commit()

    return {
        "reply_text": reply_text,
        "audio_url": audio_url,
        "remaining_credits": current_user.credit_balance
    }


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

# [NEW] 프론트엔드 정적 파일 서빙 (React + Vite)
FRONTEND_DIR = os.path.join(BASE_DIR, "../frontend/dist")

if os.path.exists(FRONTEND_DIR):
    # 1. Assets 폴더 (js, css 등) 마운트
    # 1. Assets 폴더 (js, css 등) 마운트
    # Vite는 보통 dist/assets 안에 빌드 결과물을 넣습니다.
    # 프론트에서 /assets/... 로 요청하면 여기서 처리
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    # [NEW] 루트 경로(/) 처리 -> index.html 반환
    @app.get("/")
    async def serve_root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    # 2. SPA 라우팅 (모든 경로 -> index.html)
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # API 요청이나 이미 정의된 /static 요청은 위에서 먼저 걸러짐
        
        # 만약 dist 폴더에 있는 실존 파일(예: vite.svg, robots.txt)이라면 그걸 반환
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
            
        # 그 외에는 무조건 index.html 반환 (React Router가 처리)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:
    print(f"경고: 프론트엔드 빌드 폴더({FRONTEND_DIR})가 없습니다. API 전용 모드로 동작합니다.")