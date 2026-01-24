from pydantic import BaseModel
from typing import Optional

# 회원가입 할 때 받을 데이터
class UserCreate(BaseModel):
    username: str
    password: str
    nickname: Optional[str] = None

# 회원가입 완료 후 응답할 데이터 (비밀번호 제외)
class UserResponse(BaseModel):
    id: int
    username: str
    nickname: str
    role: str
    profile_image: Optional[str] = None
    credit_balance: int

    class Config:
        from_attributes = True

# 등록할 때 받을 데이터
class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None

# 매치 등록할 때 받을 데이터
class MatchCreate(BaseModel):
    title: str
    team_a_id: int
    team_b_id: int

# 경기 결과 결정할 때 받을 데이터
class MatchResultDecide(BaseModel):
    match_id: int
    winner_team_id: int

# 투표(베팅) 요청 데이터
class VoteCreate(BaseModel):
    username: str     # 누가 (로그인 구현 전이라 아이디로 받음)
    match_id: int     # 어느 경기에
    team_id: int      # 어느 팀에
    bet_amount: int   # 얼마를

# (테스트용) 돈 충전 요청 데이터
class ChargeRequest(BaseModel):
    username: str
    amount: int

# 목소리 모델 등록용
class VoiceModelCreate(BaseModel):
    username: str        # 모델 주인
    model_name: str      # 모델 이름 (예: "차분한 뉴스 톤")
    gpt_path: str        # 파일 경로 (일단 문자열로 입력)
    sovits_path: str
    is_public: bool = False # 공개 여부

# TTS 생성 요청용
class TTSRequest(BaseModel):
    username: str        # 사용자 (소비자)
    voice_model_id: int  # 사용할 모델 ID
    text: str            # 변환할 텍스트

# 토큰 응답용
class Token(BaseModel):
    access_token: str
    token_type: str