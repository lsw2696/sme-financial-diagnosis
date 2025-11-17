-- 업종코드 매핑 테이블
CREATE TABLE IF NOT EXISTS industry_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT
);

-- 신용보증기금 재무비율 기준 데이터
CREATE TABLE IF NOT EXISTS sinbo_ratios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  industry_code TEXT NOT NULL,
  firm_size_type TEXT NOT NULL, -- 외감/비외감
  current_ratio REAL,           -- 유동비율
  quick_ratio REAL,             -- 당좌비율
  debt_ratio REAL,              -- 부채비율
  equity_ratio REAL,            -- 자기자본비율
  operating_margin REAL,        -- 매출액영업이익률
  net_margin REAL,              -- 매출액순이익률
  roa REAL,                     -- 총자산순이익률(ROA)
  roe REAL,                     -- 자기자본순이익률(ROE)
  asset_turnover REAL,          -- 총자산회전율
  inventory_turnover REAL,      -- 재고자산회전율
  receivable_turnover REAL,     -- 매출채권회전율
  interest_coverage REAL,       -- 이자보상배율
  valid_yn TEXT DEFAULT 'Y',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (industry_code) REFERENCES industry_codes(code)
);

-- 진단 이력 테이블
CREATE TABLE IF NOT EXISTS diagnosis_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  industry_code TEXT NOT NULL,
  firm_size_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  
  -- 입력된 재무제표 데이터
  sales REAL,                   -- 매출액
  current_assets REAL,          -- 유동자산
  current_liabilities REAL,     -- 유동부채
  quick_assets REAL,            -- 당좌자산
  total_assets REAL,            -- 총자산
  total_liabilities REAL,       -- 총부채
  equity REAL,                  -- 자기자본
  operating_income REAL,        -- 영업이익
  net_income REAL,              -- 당기순이익
  inventory REAL,               -- 재고자산
  receivables REAL,             -- 매출채권
  interest_expense REAL,        -- 이자비용
  
  -- 계산된 재무비율
  calc_current_ratio REAL,
  calc_quick_ratio REAL,
  calc_debt_ratio REAL,
  calc_equity_ratio REAL,
  calc_operating_margin REAL,
  calc_net_margin REAL,
  calc_roa REAL,
  calc_roe REAL,
  calc_asset_turnover REAL,
  calc_inventory_turnover REAL,
  calc_receivable_turnover REAL,
  calc_interest_coverage REAL,
  
  -- 진단 결과
  diagnosis_result TEXT,        -- JSON 형태의 진단 결과
  risk_level TEXT,              -- HIGH/MEDIUM/LOW
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (industry_code) REFERENCES industry_codes(code)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sinbo_ratios_lookup ON sinbo_ratios(industry_code, year, firm_size_type);
CREATE INDEX IF NOT EXISTS idx_diagnosis_company ON diagnosis_history(company_name, created_at);
CREATE INDEX IF NOT EXISTS idx_diagnosis_industry ON diagnosis_history(industry_code, year);
