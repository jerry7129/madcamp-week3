from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime

# 1. 유저 모델
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    password = Column(String(255))
    nickname = Column(String(50))
    role = Column(String(20), default="USER")
    credit_balance = Column(Integer, default=0)

# 2. 보이스 모델 (VoiceModel) - 중복 제거됨
class VoiceModel(Base):
    __tablename__ = "voice_models"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id")) # 소유자
    
    model_name = Column(String(100), nullable=False)
    gpt_path = Column(String(255), nullable=False)    # GPT 모델 경로
    sovits_path = Column(String(255), nullable=False) # SoVITS 모델 경로
    
    is_public = Column(Boolean, default=False)        # 공개 여부
    usage_count = Column(Integer, default=0)          # 사용 횟수
    created_at = Column(DateTime, default=datetime.now)

# 3. TTS 생성 기록 (정산 근거)
class TTSHistory(Base):
    __tablename__ = "tts_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))        # 구매자
    voice_model_id = Column(Integer, ForeignKey("voice_models.id")) # 사용한 모델
    
    text_content = Column(String(1000))  # 변환한 내용
    audio_url = Column(String(255))      # 결과물 주소
    cost_credit = Column(Integer)        # 지불한 금액
    created_at = Column(DateTime, default=datetime.now)

# 4. 팀 (베팅용)
class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True)
    description = Column(String(200))

# 5. 경기 (베팅용)
class Match(Base):
    __tablename__ = "matches"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(100))
    team_a_id = Column(Integer, ForeignKey("teams.id"))
    team_b_id = Column(Integer, ForeignKey("teams.id"))
    status = Column(String(20), default="OPEN") 
    winner_team_id = Column(Integer, nullable=True)

# 6. 투표 내역 (베팅용)
class MatchVote(Base):
    __tablename__ = "match_votes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    match_id = Column(Integer, ForeignKey("matches.id"))
    team_id = Column(Integer)
    bet_amount = Column(Integer)
    result_status = Column(String(20), default="PENDING") 

# 7. 크레딧 로그 (장부)
class CreditLog(Base):
    __tablename__ = "credit_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    amount = Column(Integer)
    transaction_type = Column(String(50)) 
    description = Column(String(255))
    reference_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.now)