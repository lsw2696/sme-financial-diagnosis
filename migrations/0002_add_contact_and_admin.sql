-- 진단 이력 테이블에 연락처 필드 추가
ALTER TABLE diagnosis_history ADD COLUMN contact_email TEXT;
ALTER TABLE diagnosis_history ADD COLUMN contact_phone TEXT;

-- 관리자 사용자 테이블 생성
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

-- 기본 관리자 계정 생성 (비밀번호: admin123)
-- 실제 운영시에는 반드시 변경하세요!
INSERT INTO admin_users (username, password_hash, full_name, email) VALUES 
('admin', 'e10adc3949ba59abbe56e057f20f883e', '관리자', 'admin@example.com');

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_diagnosis_contact_email ON diagnosis_history(contact_email);
CREATE INDEX IF NOT EXISTS idx_diagnosis_contact_phone ON diagnosis_history(contact_phone);
CREATE INDEX IF NOT EXISTS idx_diagnosis_created_at ON diagnosis_history(created_at);
