import type { CompanyFinancials, CalculatedRatios } from '../types'

/**
 * 재무비율 자동 계산 함수
 */
export function calculateFinancialRatios(financials: CompanyFinancials): CalculatedRatios {
  const ratios: CalculatedRatios = {}

  // 유동비율 = (유동자산 / 유동부채) × 100
  if (financials.current_assets && financials.current_liabilities) {
    ratios.current_ratio = (financials.current_assets / financials.current_liabilities) * 100
  }

  // 당좌비율 = (당좌자산 / 유동부채) × 100
  if (financials.quick_assets && financials.current_liabilities) {
    ratios.quick_ratio = (financials.quick_assets / financials.current_liabilities) * 100
  } else if (financials.current_assets && financials.inventory && financials.current_liabilities) {
    // 당좌자산 = 유동자산 - 재고자산
    const quickAssets = financials.current_assets - financials.inventory
    ratios.quick_ratio = (quickAssets / financials.current_liabilities) * 100
  }

  // 부채비율 = (총부채 / 자기자본) × 100
  if (financials.total_liabilities && financials.equity) {
    ratios.debt_ratio = (financials.total_liabilities / financials.equity) * 100
  }

  // 자기자본비율 = (자기자본 / 총자산) × 100
  if (financials.equity && financials.total_assets) {
    ratios.equity_ratio = (financials.equity / financials.total_assets) * 100
  }

  // 매출액영업이익률 = (영업이익 / 매출액) × 100
  if (financials.operating_income && financials.sales) {
    ratios.operating_margin = (financials.operating_income / financials.sales) * 100
  }

  // 매출액순이익률 = (당기순이익 / 매출액) × 100
  if (financials.net_income && financials.sales) {
    ratios.net_margin = (financials.net_income / financials.sales) * 100
  }

  // ROA (총자산순이익률) = (당기순이익 / 총자산) × 100
  if (financials.net_income && financials.total_assets) {
    ratios.roa = (financials.net_income / financials.total_assets) * 100
  }

  // ROE (자기자본순이익률) = (당기순이익 / 자기자본) × 100
  if (financials.net_income && financials.equity) {
    ratios.roe = (financials.net_income / financials.equity) * 100
  }

  // 총자산회전율 = 매출액 / 총자산
  if (financials.sales && financials.total_assets) {
    ratios.asset_turnover = financials.sales / financials.total_assets
  }

  // 재고자산회전율 = 매출액 / 재고자산
  if (financials.sales && financials.inventory) {
    ratios.inventory_turnover = financials.sales / financials.inventory
  }

  // 매출채권회전율 = 매출액 / 매출채권
  if (financials.sales && financials.receivables) {
    ratios.receivable_turnover = financials.sales / financials.receivables
  }

  // 이자보상배율 = 영업이익 / 이자비용
  if (financials.operating_income && financials.interest_expense) {
    ratios.interest_coverage = financials.operating_income / financials.interest_expense
  }

  return ratios
}

/**
 * 비율 값을 소수점 2자리로 반올림
 */
export function roundRatio(value: number | undefined): number | undefined {
  if (value === undefined || isNaN(value)) return undefined
  return Math.round(value * 100) / 100
}

/**
 * 모든 비율 값을 반올림
 */
export function roundAllRatios(ratios: CalculatedRatios): CalculatedRatios {
  const rounded: CalculatedRatios = {}
  for (const [key, value] of Object.entries(ratios)) {
    rounded[key as keyof CalculatedRatios] = roundRatio(value)
  }
  return rounded
}
