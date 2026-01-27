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
    profile_image: Optional[str] = None # [NEW]
    created_at: datetime
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

# [NEW] 가위바위보 게임 요청
class RPSGameRequest(BaseModel):
    bet_amount: int
    choice: str  # "ROCK", "PAPER", "SCISSORS"

# 홀짝 게임 요청
class OddEvenGameRequest(BaseModel):
    bet_amount: int
    choice: str # "ODD", "EVEN"

# [NEW] 사다리 게임 요청
class LadderGameRequest(BaseModel):
    bet_amount: int
    # 사용자가 선택한 베팅 항목 (None이면 선택 안 함)
    # "LEFT", "RIGHT"
    start_point: Optional[str] = None 
    # 3 or 4
    line_count: Optional[int] = None
    # "LEFT", "RIGHT"
    end_point: Optional[str] = None

# 사다리 게임 결과 (디버깅/프론트 표시용)
class LadderGameResponse(BaseModel):
    result: str # WIN / LOSE
    start_point: str
    line_count: int
    end_point: str
    payout: int
    current_balance: int
    ladder_data: dict # 사다리 구조 데이터 (선택)

# --- 보이스 마켓 관련 ---
class VoiceModelCreate(BaseModel):
    model_name: str
    description: Optional[str] = None
    price: int = 1000  # [NEW]
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
    description: Optional[str] = None
    price: Optional[int] = 0 # None이면 0으로 처리
    is_public: bool
    usage_count: int
    model_path: Optional[str] = None
    created_at: datetime
    is_purchased: bool = False # [NEW] 구매 여부

    class Config:
        from_attributes = True