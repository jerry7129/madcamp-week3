# 🎙️ Voice & Betting Platform (Madcamp Week 3)

AI 기반 음성 생성(GPT-SoVITS)과 미니게임 베팅 시스템이 결합된 웹 플랫폼입니다.
FastAPI 백엔드와 React 프론트엔드로 구성되어 있으며, Docker Compose를 통해 통합 실행됩니다.

## 🚀 기술 스택 (Tech Stack)

### **Backend**
*   **Framework:** FastAPI (Python)
*   **Database:** MySQL (Docker)
*   **ORM:** SQLAlchemy
*   **AI Engine:** GPT-SoVITS (Text-to-Speech Fine-tuning)
*   **Auth:** JWT (JSON Web Token)

### **Frontend**
*   **Framework:** React + Vite
*   **Integration:** 정적 빌드(Static Build) 후 FastAPI에서 서빙 (Single Server)

### **Infrastructure**
*   **Docker Compose:** 전체 서비스 오케스트레이션 (Backend + DB + AI + GPU Support)

---

## 🛠️ 설치 및 실행 (Installation & Run)

### 1. 선수 조건 (Prerequisites)
*   Docker & Docker Compose
*   Node.js (Frontend 빌드용)
*   NVIDIA GPU Driver (AI 학습/추론용, 선택사항)

### 2. 프론트엔드 빌드 (Frontend Build)
서버 실행 전, 리액트 프로젝트를 빌드하여 정적 파일을 생성해야 합니다.

```bash
cd frontend
npm install   # 의존성 설치 (최초 1회)
npm run build # 빌드 -> dist 폴더 생성
```

### 3. 환경 변수 설정 (.env)
`backend/.env` 파일을 생성하고 아래 내용을 설정하세요.

```env
# Database
MYSQL_ROOT_PASSWORD=root
MYSQL_DATABASE=gptsovits_db

# JWT Security
SECRET_KEY=your_super_secret_key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# External API
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. 서버 전체 실행 (Docker Compose)
프로젝트 최상위(또는 backend) 폴더에서 실행합니다.

```bash
cd backend
docker-compose up -d --build
```

*   **웹 접속:** `http://localhost/` (또는 서버 IP)
*   **API 문서:** `http://localhost/docs`

---

## 💡 주요 기능 (Features)

### 1. 🎤 보이스 마켓 (Voice Market)
*   **음성 학습:** 사용자가 자신의 목소리(5-10초)를 업로드하면 GPT-SoVITS가 파인튜닝(Fine-tuning)을 수행합니다.
*   **공유 및 판매:** 학습된 모델을 마켓에 공개하거나(`is_public`), 가격(`price`)을 매겨 판매할 수 있습니다.
*   **TTS 생성:** 구매한 모델로 텍스트를 음성으로 변환할 수 있습니다.

### 2. 🎲 베팅 게임 (Minigames)
*   **가위바위보 (RPS):** 서버와 대결하여 크레딧을 획득합니다.
*   **홀짝 (Odd/Even):** 숫자의 홀/짝을 맞추는 간편 게임.
*   **사다리 타기:** 다수의 유저가 실시간 결과를 확인하는 확률 게임. (구현 예정)
*   **e스포츠 승부 예측:** 실제 경기(Match) 목록을 보고 팀에 크레딧을 베팅합니다.

### 3. 💬 AI 음성 채팅 (Voice Chat)
*   **Gemini 연동:** LLM(Gemini)과 대화하고, 답변을 원하는 목소리로 듣습니다. (구현 예정)

---

## 📂 프로젝트 구조 (Structure)

```
week3/
├── backend/            # FastAPI 서버
│   ├── main.py         # 진입점 (API, 정적 파일 서빙)
│   ├── models.py       # DB 스키마 (User, VoiceModel, Match...)
│   ├── schemas.py      # Pydantic 데이터 검증
│   ├── ai_server.py    # GPT-SoVITS 래퍼(Wrapper)
│   ├── docker-compose.yml
│   └── static/         # 업로드/생성된 미디어 파일 저장소
│
├── frontend/           # React 프로젝트
│   ├── src/
│   ├── dist/           # 빌드 결과물 (backend가 이걸 보여줌)
│   └── package.json
│
└── GPT-SoVITS/         # AI 엔진 (서브모듈 또는 클론)
```

## ⚠️ 문제 해결 (Troubleshooting)

*   **404 Not Found:** 프론트엔드 빌드(`npm run build`)를 안 했거나 도커 볼륨 마운트가 안 된 경우입니다.
*   **500 Error (TTS):** GPU 메모리가 부족하거나 모델 파일 경로가 잘못된 경우입니다.
*   **DB 접속 불가:** `docker-compose`로 DB 컨테이너가 정상적으로 떴는지 확인하세요.
