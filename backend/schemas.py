from pydantic import BaseModel
from typing import Optional

# --- 유저 관련 ---
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

# --- 베팅 관련 ---
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
    username: str
    match_id: int
    team_id: int
    bet_amount: int

class ChargeRequest(BaseModel):
    username: str
    amount: int

# --- 보이스 마켓 관련 ---
class VoiceModelCreate(BaseModel):
    username: str        
    model_name: str      
    gpt_path: str        
    sovits_path: str
    is_public: bool = False 

# TTS 요청 (통합됨)
class TTSRequest(BaseModel):
    username: str        # 사용자
    voice_model_id: int  # 모델 ID
    text: str            # 내용