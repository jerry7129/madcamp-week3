from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
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

# 2. 보이스 모델
class VoiceModel(Base):
    __tablename__ = "voice_models"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id")) # owner_id -> user_id로 통일
    
    model_name = Column(String(100), nullable=False)
    gpt_path = Column(String(255), nullable=False)
    sovits_path = Column(String(255), nullable=False)
    
    is_public = Column(Boolean, default=False)
    usage_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.now)

# 3. TTS 생성 기록
class TTSHistory(Base):
    __tablename__ = "tts_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    voice_model_id = Column(Integer, ForeignKey("voice_models.id"))
    
    text_content = Column(String(1000))
    audio_url = Column(String(255))
    cost_credit = Column(Integer)
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