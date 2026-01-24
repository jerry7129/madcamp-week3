# 1. 파이썬 3.10 버전 사용
FROM python:3.10

# 2. 작업 폴더 설정
WORKDIR /backend

# 3. 라이브러리 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 소스 코드 복사
COPY . .

# 5. 서버 실행 명령어 (0.0.0.0으로 열어야 외부 접속 가능)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]