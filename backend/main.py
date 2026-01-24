from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import models, schemas
from database import engine, get_db

# DB 테이블 생성 (없으면 자동 생성)
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# 비밀번호 암호화 도구
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 회원가입 API
@app.post("/signup", response_model=schemas.UserResponse)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # 1. 아이디 중복 체크
    existing_user = db.query(models.User).filter(models.User.username == user.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 존재하는 아이디입니다."
        )
    
    # 2. 비밀번호 암호화 (보안 필수)
    hashed_password = pwd_context.hash(user.password)
    
    # 3. DB에 저장 (기본 role은 USER)
    new_user = models.User(
        username=user.username,
        password=hashed_password,
        nickname=user.nickname,
        role="USER",    # 일단 모두 일반 유저로 가입
        credit_balance=0 # 가입 축하금 0원 (원하면 수정 가능)
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user

# (테스트용) 전체 유저 조회 API - 나중에 관리자만 쓰게 막아야 함
@app.get("/users")
def get_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()

# --- [Admin] 1. 팀 등록 API ---
@app.post("/teams")
def create_team(team: schemas.TeamCreate, db: Session = Depends(get_db)):
    # 1. 관리자 권한 체크
    admin = db.query(models.User).filter(models.User.username == team.admin_username).first()
    if not admin or admin.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자만 팀을 등록할 수 있습니다.")

    # 2. 팀 생성
    new_team = models.Team(name=team.name, description=team.description)
    db.add(new_team)
    db.commit()
    return {"msg": "팀 등록 성공", "team_name": new_team.name}

# --- [Admin] 2. 매치(경기) 생성 API ---
@app.post("/matches")
def create_match(match: schemas.MatchCreate, db: Session = Depends(get_db)):
    # 1. 관리자 체크
    admin = db.query(models.User).filter(models.User.username == match.admin_username).first()
    if not admin or admin.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")

    # 2. 매치 생성
    new_match = models.Match(
        title=match.title,
        team_a_id=match.team_a_id,
        team_b_id=match.team_b_id,
        status="OPEN"  # 생성하자마자 투표 가능하게 오픈
    )
    db.add(new_match)
    db.commit()
    return {"msg": "경기 생성 완료. 투표가 시작됩니다!", "match_title": new_match.title}

# --- [Admin] 3. 경기 종료 및 배당금 분배 (핵심 기능) ---
@app.post("/matches/decide")
def decide_match_result(data: schemas.MatchResultDecide, db: Session = Depends(get_db)):
    # 1. 관리자 체크
    admin = db.query(models.User).filter(models.User.username == data.admin_username).first()
    if not admin or admin.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자만 결과를 결정할 수 있습니다.")

    # 2. 경기 정보 가져오기
    match = db.query(models.Match).filter(models.Match.id == data.match_id).first()
    if not match or match.status == "FINISHED":
        raise HTTPException(status_code=400, detail="존재하지 않거나 이미 끝난 경기입니다.")

    # 3. 경기 종료 처리
    match.winner_team_id = data.winner_team_id
    match.status = "FINISHED"
    
    # --- 💰 배당금 계산 로직 (Pari-mutuel) ---
    
    # A. 전체 판돈 계산 (Total Pot)
    total_bets = db.query(models.MatchVote).filter(models.MatchVote.match_id == match.id).all()
    total_pot = sum(vote.bet_amount for vote in total_bets)
    
    if total_pot == 0:
        db.commit()
        return {"msg": "경기 종료됨 (배팅한 사람이 없어서 배당 없음)"}

    # B. 승리 팀에 건 사람들과 총액 찾기
    winner_votes = [v for v in total_bets if v.team_id == data.winner_team_id]
    winner_pot = sum(v.bet_amount for v in winner_votes)

    # C. 배당 지급 (승리자들에게 분배)
    if winner_pot > 0:
        for vote in winner_votes:
            # 내 지분율 = (내 배팅액 / 승리팀 총 배팅액)
            # 받을 돈 = 내 지분율 * 전체 판돈
            share = (vote.bet_amount / winner_pot) * total_pot
            prize = int(share) # 소수점 버림
            
            # 유저에게 돈 지급
            user = db.query(models.User).filter(models.User.id == vote.user_id).first()
            user.credit_balance += prize
            vote.result_status = "WON"
            
            # 로그 남기기 (중요!)
            # (로그 모델은 아직 models.py에 없으므로 생략하지만, 실제론 꼭 넣어야 함)
            
    # 패배자 처리
    for vote in total_bets:
        if vote.team_id != data.winner_team_id:
            vote.result_status = "LOST"

    db.commit()
    
    return {
        "msg": "경기 종료 및 정산 완료!",
        "winner_team": data.winner_team_id,
        "total_pot": total_pot,
        "winner_pot": winner_pot
    }

# main.py 에 추가 (기존 API들 아래에)

# --- [Test] 0. 크레딧 충전 API (테스트용) ---
@app.post("/charge")
def charge_credit(req: schemas.ChargeRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == req.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    
    # 1. 돈 올려주기
    user.credit_balance += req.amount
    
    # 2. 로그 남기기
    log = models.CreditLog(
        user_id=user.id,
        amount=req.amount,
        transaction_type="CHARGE",
        description="테스트용 충전"
    )
    db.add(log)
    db.commit()
    
    return {"msg": f"{req.amount} 크레딧 충전 완료!", "current_balance": user.credit_balance}


# --- [User] 1. 경기 투표(베팅) API ---
@app.post("/votes")
def vote_match(vote: schemas.VoteCreate, db: Session = Depends(get_db)):
    # 1. 유저 확인
    user = db.query(models.User).filter(models.User.username == vote.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저가 없습니다.")

    # 2. 잔액 확인 (돈 없으면 빠꾸)
    if user.credit_balance < vote.bet_amount:
        raise HTTPException(status_code=400, detail="크레딧이 부족합니다!")

    # 3. 경기 확인 (열려있는 경기가 아니면 에러)
    match = db.query(models.Match).filter(models.Match.id == vote.match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="경기가 없습니다.")
    if match.status != "OPEN":
        raise HTTPException(status_code=400, detail="투표 가능한 상태가 아닙니다 (OPEN 상태만 가능).")

    # 4. 팀 확인 (그 경기에 나가는 팀이 맞는지)
    if vote.team_id not in [match.team_a_id, match.team_b_id]:
        raise HTTPException(status_code=400, detail="해당 경기에 참여하는 팀이 아닙니다.")

    # --- 트랜잭션 시작 (돈 빼고 -> 표 넣고 -> 로그 쓰고) ---
    try:
        # A. 돈 차감
        user.credit_balance -= vote.bet_amount

        # B. 투표 내역 저장
        new_vote = models.MatchVote(
            user_id=user.id,
            match_id=match.id,
            team_id=vote.team_id,
            bet_amount=vote.bet_amount,
            result_status="PENDING"
        )
        db.add(new_vote)

        # C. 장부(로그) 기록
        new_log = models.CreditLog(
            user_id=user.id,
            amount=-vote.bet_amount, # 나간 돈이니까 마이너스
            transaction_type="BET_ENTRY",
            description=f"경기 #{match.id} 투표",
            reference_id=match.id
        )
        db.add(new_log)

        # 모두 성공하면 저장
        db.commit()
        
        return {
            "msg": "투표 성공!", 
            "team_id": vote.team_id, 
            "bet_amount": vote.bet_amount,
            "remaining_credit": user.credit_balance
        }

    except Exception as e:
        db.rollback() # 에러나면 돈 뺀거 다시 취소
        raise HTTPException(status_code=500, detail=f"투표 중 오류 발생: {e}")
    
# --- [Voice Market] 1. 목소리 모델 등록 API ---
@app.post("/voice-models")
def register_voice_model(model: schemas.VoiceModelCreate, db: Session = Depends(get_db)):
    # 1. 유저 확인
    user = db.query(models.User).filter(models.User.username == model.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")

    # 2. 모델 등록
    new_model = models.VoiceModel(
        user_id=user.id,
        model_name=model.model_name,
        gpt_path=model.gpt_path,
        sovits_path=model.sovits_path,
        is_public=model.is_public,
        usage_count=0
    )
    db.add(new_model)
    db.commit()
    return {"msg": "모델 등록 성공!", "model_id": new_model.id}


# --- [Voice Market] 2. 공개된 모델 목록 조회 (마켓) ---
@app.get("/voice-models/market")
def get_voice_market(db: Session = Depends(get_db)):
    # is_public이 True인 것만 가져오기
    models_list = db.query(models.VoiceModel).filter(models.VoiceModel.is_public == True).all()
    return models_list


# --- [Voice Market] 3. TTS 생성 및 수익 배분 (핵심!) ---
@app.post("/tts/generate")
def generate_tts(req: schemas.TTSRequest, db: Session = Depends(get_db)):
    # --- [설정] 가격 정책 ---
    COST_PER_REQ = 50       # 1회 생성 비용 (50 크레딧)
    PLATFORM_FEE = 0.2      # 플랫폼 수수료 20%
    CREATOR_SHARE = 0.8     # 원작자 수익 80% (40 크레딧)

    # 1. 사용자(소비자) 확인
    consumer = db.query(models.User).filter(models.User.username == req.username).first()
    if not consumer:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 2. 모델 확인
    voice_model = db.query(models.VoiceModel).filter(models.VoiceModel.id == req.voice_model_id).first()
    if not voice_model:
        raise HTTPException(status_code=404, detail="모델이 없습니다.")

    # 3. 잔액 확인
    if consumer.credit_balance < COST_PER_REQ:
        raise HTTPException(status_code=400, detail="크레딧이 부족합니다. 충전해주세요.")

    # 4. 모델 주인(원작자) 찾기
    creator = db.query(models.User).filter(models.User.id == voice_model.user_id).first()

    # 5. 시스템 계좌(법인 통장) 찾기
    system_wallet = db.query(models.User).filter(models.User.username == "system_wallet").first()

    # --- 트랜잭션 시작 ---
    try:
        # A. 소비자 지갑에서 전액 차감 (-50)
        consumer.credit_balance -= COST_PER_REQ
        
        # 로그: 소비자 지출
        log_use = models.CreditLog(
            user_id=consumer.id,
            amount=-COST_PER_REQ,
            transaction_type="USE",
            description=f"TTS 생성 (모델: {voice_model.model_name})",
            reference_id=voice_model.id
        )
        db.add(log_use)

        # B. 원작자에게 정산 (+40)
        # (자기가 자기 거 쓰면 수수료 없이 무료, 남이 쓸 때만 분배)
        if consumer.id != creator.id:
            royalty = int(COST_PER_REQ * CREATOR_SHARE) # 40
            platform_fee = COST_PER_REQ - royalty       # 10

            # 1. 원작자 입금
            creator.credit_balance += royalty
            log_earn = models.CreditLog(
                user_id=creator.id,
                amount=royalty,
                transaction_type="ROYALTY",
                description=f"수익 ({consumer.nickname}님 사용)",
                reference_id=voice_model.id
            )
            db.add(log_earn)

            # [New] 2. 플랫폼(시스템) 수수료 입금 (+10)
            if system_wallet:
                system_wallet.credit_balance += platform_fee
                log_fee = models.CreditLog(
                    user_id=system_wallet.id,
                    amount=platform_fee,
                    transaction_type="FEE", # 수수료 수익
                    description=f"플랫폼 수수료 (모델: {voice_model.id})",
                    reference_id=voice_model.id
                )
                db.add(log_fee)

        # C. 사용 횟수 증가 등 마무리
        voice_model.usage_count += 1
        
        mock_audio_url = f"http://minio-server/audio/{req.voice_model_id}_{consumer.id}.wav"
        history = models.TTSHistory(
            user_id=consumer.id,
            voice_model_id=voice_model.id,
            text_content=req.text,
            audio_url=mock_audio_url,
            cost_credit=COST_PER_REQ
        )
        db.add(history)
        
        db.commit()

        return {
            "msg": "TTS 생성 완료!",
            "audio_url": mock_audio_url,
            "cost": COST_PER_REQ,
            "remaining_credit": consumer.credit_balance
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"오류 발생: {e}")