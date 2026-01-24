from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 로컬 도커 MySQL 연결 주소 (비밀번호 root 기준)
# 만약 비밀번호가 다르면 'root:내비밀번호' 로 수정하세요.
SQLALCHEMY_DATABASE_URL = "mysql+pymysql://root:root@db:3306/gptsovits_db"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# DB 세션을 가져오는 함수 (Dependency)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()