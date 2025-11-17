export type Bindings = {
  DB: D1Database;
}

export interface IndustryCode {
  code: string;
  name: string;
  category: string;
  description?: string;
}

export interface SinboRatio {
  id?: number;
  year: number;
  industry_code: string;
  firm_size_type: string;
  current_ratio?: number;
  quick_ratio?: number;
  debt_ratio?: number;
  equity_ratio?: number;
  operating_margin?: number;
  net_margin?: number;
  roa?: number;
  roe?: number;
  asset_turnover?: number;
  inventory_turnover?: number;
  receivable_turnover?: number;
  interest_coverage?: number;
  valid_yn?: string;
}

export interface CompanyFinancials {
  company_name: string;
  industry_code: string;
  firm_size_type: string;
  year: number;
  
  // 재무제표 항목
  sales: number;
  current_assets: number;
  current_liabilities: number;
  quick_assets?: number;
  total_assets: number;
  total_liabilities: number;
  equity: number;
  operating_income: number;
  net_income: number;
  inventory?: number;
  receivables?: number;
  interest_expense?: number;
}

export interface CalculatedRatios {
  current_ratio?: number;
  quick_ratio?: number;
  debt_ratio?: number;
  equity_ratio?: number;
  operating_margin?: number;
  net_margin?: number;
  roa?: number;
  roe?: number;
  asset_turnover?: number;
  inventory_turnover?: number;
  receivable_turnover?: number;
  interest_coverage?: number;
}

export interface ComparisonResult {
  ratio_name: string;
  ratio_name_kr: string;
  company_value: number;
  industry_avg: number;
  difference_pct: number;
  status: 'good' | 'warning' | 'danger';
  comment: string;
}

export interface DiagnosisResult {
  company_name: string;
  industry_name: string;
  year: number;
  firm_size_type: string;
  calculated_ratios: CalculatedRatios;
  industry_averages: CalculatedRatios;
  comparisons: ComparisonResult[];
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  overall_comment: string;
  recommendations: string[];
}
