from pydantic import BaseModel
from typing import Optional, List

# --- [User & Auth] ---
class UserCreate(BaseModel):
    username: str
    password: str
    nickname: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    nickname: str
    role: str
    credit_balance: int
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

# --- [Betting (기존 유지)] ---
class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None

class MatchCreate(BaseModel):
    title: str
    team_a_id: int
    team_b_id: int

class MatchResultDecide(BaseModel):
    match_id: int
    winner_team_id: int

class VoteCreate(BaseModel):
    # username 제거함 (로그인 유저 자동 인식)
    match_id: int
    team_id: int
    bet_amount: int

class ChargeRequest(BaseModel):
    amount: int # username 제거

# --- [Voice Market (NEW)] ---

# 1. TTS 생성 요청 (통합됨)
class GenerateRequest(BaseModel):
    voice_model_id: int  # 사용할 모델 ID
    text: str            # 읽을 텍스트

# 2. 목소리 모델 응답용 (리스트 보여줄 때)
class VoiceModelResponse(BaseModel):
    id: int
    name: str
    owner_id: int
    description: Optional[str]
    is_public: bool
    usage_count: int
    
    class Config:
        from_attributes = True