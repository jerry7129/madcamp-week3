from sqlalchemy import Column, Integer, String, TIMESTAMP, text, ForeignKey, Boolean, Text, DateTime
from database import Base
from sqlalchemy import ForeignKey
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    password = Column(String(255), nullable=False)
    nickname = Column(String(50))
    role = Column(String(20), default="USER") # USER or ADMIN
    profile_image = Column(String(500), nullable=True)
    credit_balance = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255))
    image_url = Column(String(500))

class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    team_a_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    team_b_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    winner_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    status = Column(String(20), default="READY") # READY, OPEN, CLOSED, FINISHED

class MatchVote(Base):
    __tablename__ = "match_votes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    match_id = Column(Integer, ForeignKey("matches.id"), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=False)
    bet_amount = Column(Integer, nullable=False)
    result_status = Column(String(20), default="PENDING") # PENDING, WON, LOST

class CreditLog(Base):
    __tablename__ = "credit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Integer, nullable=False) # 변동량 (-500, +1000)
    transaction_type = Column(String(20), nullable=False) # CHARGE, BET_ENTRY, BET_WIN
    description = Column(String(255))
    reference_id = Column(Integer) # 관련 match_id 등
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

# --- [Voice Market] 목소리 모델 테이블 ---
class VoiceModel(Base):
    __tablename__ = "voice_models"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    model_name = Column(String(100), nullable=False)
    gpt_path = Column(String(500), nullable=False)
    sovits_path = Column(String(500), nullable=False)
    is_public = Column(Boolean, default=False) # 마켓 공개 여부
    usage_count = Column(Integer, default=0)   # 인기 척도
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

# --- [Voice Market] TTS 생성 기록 테이블 ---
class TTSHistory(Base):
    __tablename__ = "tts_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False) # 구매자
    voice_model_id = Column(Integer, ForeignKey("voice_models.id"), nullable=True)
    text_content = Column(Text, nullable=False)
    audio_url = Column(String(500), nullable=False)
    cost_credit = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

class VoiceModel(Base):
    __tablename__ = "voice_models"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"))  # ⭐ 누가 만들었나 (User ID 연결)
    
    name = Column(String(50), nullable=False)        # 모델 별명 (예: "차분한 톤")
    description = Column(String(200), nullable=True) # 설명
    
    audio_path = Column(String(255), nullable=False) # 원본 녹음 파일 경로
    ref_text = Column(String(500), nullable=False)   # 학습 시 읽은 텍스트
    
    is_public = Column(Boolean, default=False)       # ⭐ 공유 여부 (True면 남들도 씀)
    usage_count = Column(Integer, default=0)         # 사용 횟수
    
    created_at = Column(DateTime, default=datetime.now)