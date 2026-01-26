from pydantic import BaseModel
from typing import Optional
from datetime import datetime

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
    match_id: int
    team_id: int
    bet_amount: int

class ChargeRequest(BaseModel):
    amount: int

# --- 보이스 마켓 관련 ---
class VoiceModelCreate(BaseModel):
    model_name: str      
    gpt_path: str        
    sovits_path: str
    is_public: bool = False 

# TTS 요청
class TTSRequest(BaseModel):
    voice_model_id: int
    text: str

# [NEW] 이게 없어서 에러가 났었습니다! (DB 모델 필드와 일치시킴)
class VoiceModelResponse(BaseModel):
    id: int
    user_id: int
    model_name: str
    is_public: bool
    usage_count: int
    created_at: datetime

    class Config:
        from_attributes = True