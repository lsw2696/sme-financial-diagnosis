import type { CalculatedRatios, ComparisonResult, DiagnosisResult, SinboRatio } from '../types'

export function compareRatios(
  companyRatios: CalculatedRatios,
  industryAvg: SinboRatio,
  companyName: string,
  industryName: string,
  year: number,
  firmSizeType: string
): DiagnosisResult {
  const comparisons: ComparisonResult[] = []

  // 1. 유동비율
  if (companyRatios.current_ratio && industryAvg.current_ratio) {
    comparisons.push(compareRatio('current_ratio', '유동비율 (%)', companyRatios.current_ratio, industryAvg.current_ratio, true))
  }
  
  // 2. 당좌비율
  if (companyRatios.quick_ratio && industryAvg.quick_ratio) {
    comparisons.push(compareRatio('quick_ratio', '당좌비율 (%)', companyRatios.quick_ratio, industryAvg.quick_ratio, true))
  }
  
  // 3. 부채비율
  if (companyRatios.debt_ratio && industryAvg.debt_ratio) {
    comparisons.push(compareRatio('debt_ratio', '부채비율 (%)', companyRatios.debt_ratio, industryAvg.debt_ratio, false))
  }
  
  // 4. 자기자본비율
  if (companyRatios.equity_ratio && industryAvg.equity_ratio) {
    comparisons.push(compareRatio('equity_ratio', '자기자본비율 (%)', companyRatios.equity_ratio, industryAvg.equity_ratio, true))
  }
  
  // 5. 매출액영업이익률
  if (companyRatios.operating_margin && industryAvg.operating_margin) {
    comparisons.push(compareRatio('operating_margin', '매출액영업이익률 (%)', companyRatios.operating_margin, industryAvg.operating_margin, true))
  }
  
  // 6. 매출액순이익률
  if (companyRatios.net_margin && industryAvg.net_margin) {
    comparisons.push(compareRatio('net_margin', '매출액순이익률 (%)', companyRatios.net_margin, industryAvg.net_margin, true))
  }
  
  // 7. ROA
  if (companyRatios.roa && industryAvg.roa) {
    comparisons.push(compareRatio('roa', 'ROA (총자산순이익률, %)', companyRatios.roa, industryAvg.roa, true))
  }
  
  // 8. ROE
  if (companyRatios.roe && industryAvg.roe) {
    comparisons.push(compareRatio('roe', 'ROE (자기자본순이익률, %)', companyRatios.roe, industryAvg.roe, true))
  }
  
  // 9. 총자산회전율
  if (companyRatios.asset_turnover && industryAvg.asset_turnover) {
    comparisons.push(compareRatio('asset_turnover', '총자산회전율 (회)', companyRatios.asset_turnover, industryAvg.asset_turnover, true))
  }
  
  // 10. 재고자산회전율
  if (companyRatios.inventory_turnover && industryAvg.inventory_turnover) {
    comparisons.push(compareRatio('inventory_turnover', '재고자산회전율 (회)', companyRatios.inventory_turnover, industryAvg.inventory_turnover, true))
  }
  
  // 11. 매출채권회전율
  if (companyRatios.receivable_turnover && industryAvg.receivable_turnover) {
    comparisons.push(compareRatio('receivable_turnover', '매출채권회전율 (회)', companyRatios.receivable_turnover, industryAvg.receivable_turnover, true))
  }
  
  // 12. 이자보상배율
  if (companyRatios.interest_coverage && industryAvg.interest_coverage) {
    comparisons.push(compareRatio('interest_coverage', '이자보상배율 (배)', companyRatios.interest_coverage, industryAvg.interest_coverage, true))
  }

  const riskLevel = calculateRiskLevel(comparisons)
  const overallComment = generateOverallComment(comparisons, riskLevel)
  const recommendations = generateRecommendations(comparisons)

  return {
    company_name: companyName,
    industry_name: industryName,
    year,
    firm_size_type: firmSizeType,
    calculated_ratios: companyRatios,
    industry_averages: extractIndustryAverages(industryAvg),
    comparisons,
    risk_level: riskLevel,
    overall_comment: overallComment,
    recommendations
  }
}

function compareRatio(ratioName: string, ratioNameKr: string, companyValue: number, industryAvg: number, higherIsBetter: boolean): ComparisonResult {
  const differencePct = ((companyValue - industryAvg) / industryAvg) * 100
  let status: 'good' | 'warning' | 'danger'
  let comment: string

  if (higherIsBetter) {
    if (differencePct >= 10) {
      status = 'good'
      comment = `업종 평균보다 ${differencePct.toFixed(1)}% 높아 우수합니다.`
    } else if (differencePct >= -10) {
      status = 'warning'
      comment = `업종 평균 수준입니다.`
    } else {
      status = 'danger'
      comment = `업종 평균보다 ${Math.abs(differencePct).toFixed(1)}% 낮아 개선 필요합니다.`
    }
  } else {
    if (differencePct <= -10) {
      status = 'good'
      comment = `업종 평균보다 ${Math.abs(differencePct).toFixed(1)}% 낮아 우수합니다.`
    } else if (differencePct <= 10) {
      status = 'warning'
      comment = `업종 평균 수준입니다.`
    } else {
      status = 'danger'
      comment = `업종 평균보다 ${differencePct.toFixed(1)}% 높아 개선 필요합니다.`
    }
  }

  return { ratio_name: ratioName, ratio_name_kr: ratioNameKr, company_value: Math.round(companyValue * 100) / 100, industry_avg: Math.round(industryAvg * 100) / 100, difference_pct: Math.round(differencePct * 100) / 100, status, comment }
}

function calculateRiskLevel(comparisons: ComparisonResult[]): 'HIGH' | 'MEDIUM' | 'LOW' {
  const dangerCount = comparisons.filter((c) => c.status === 'danger').length
  if (dangerCount >= 3) return 'HIGH'
  if (dangerCount >= 2) return 'MEDIUM'
  return 'LOW'
}

function generateOverallComment(comparisons: ComparisonResult[], riskLevel: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  const goodCount = comparisons.filter((c) => c.status === 'good').length
  const dangerCount = comparisons.filter((c) => c.status === 'danger').length

  if (riskLevel === 'LOW') {
    return `재무상태가 업종 평균 대비 양호합니다. ${goodCount}개 지표 우수, 신보 보증심사 시 긍정적 평가 예상됩니다.`
  } else if (riskLevel === 'MEDIUM') {
    return `업종 평균 수준이나 ${dangerCount}개 지표 개선 필요합니다. 개선 시 신보 보증 가능성 높아집니다.`
  } else {
    return `업종 평균 대비 취약합니다. ${dangerCount}개 주요지표 개선이 신보 승인에 필수적입니다.`
  }
}

function generateRecommendations(comparisons: ComparisonResult[]): string[] {
  const recommendations: string[] = []
  const dangerRatios = comparisons.filter((c) => c.status === 'danger')

  for (const ratio of dangerRatios) {
    if (ratio.ratio_name === 'current_ratio') recommendations.push('유동비율 개선: 단기차입금 상환 또는 유동자산(현금, 매출채권) 증대')
    if (ratio.ratio_name === 'quick_ratio') recommendations.push('당좌비율 개선: 현금성자산 확보, 재고자산 감축')
    if (ratio.ratio_name === 'debt_ratio') recommendations.push('부채비율 개선: 증자, 이익잉여금 축적, 장기부채 상환')
    if (ratio.ratio_name === 'equity_ratio') recommendations.push('자기자본비율 강화: 증자 또는 내부유보를 통한 자본 확충')
    if (ratio.ratio_name === 'operating_margin') recommendations.push('영업이익률 개선: 원가절감, 판매가격 조정, 고부가가치 제품 확대')
    if (ratio.ratio_name === 'net_margin') recommendations.push('순이익률 개선: 영업외비용 절감, 이자비용 감축')
    if (ratio.ratio_name === 'roa') recommendations.push('ROA 제고: 자산 효율화 및 수익성 개선')
    if (ratio.ratio_name === 'roe') recommendations.push('ROE 제고: 자기자본 대비 수익성 향상 필요')
    if (ratio.ratio_name === 'asset_turnover') recommendations.push('자산회전율 개선: 매출 증대 또는 유휴자산 처분')
    if (ratio.ratio_name === 'inventory_turnover') recommendations.push('재고회전율 개선: 재고관리 효율화, 적정재고 유지')
    if (ratio.ratio_name === 'receivable_turnover') recommendations.push('채권회전율 개선: 외상매출금 회수 강화, 신용관리')
    if (ratio.ratio_name === 'interest_coverage') recommendations.push('이자보상배율 개선: 영업이익 증대 또는 차입금 감축')
  }

  if (recommendations.length === 0) recommendations.push('현 재무상태 양호, 지속적 모니터링 및 유지 권장')
  return recommendations
}

function extractIndustryAverages(industryAvg: SinboRatio): CalculatedRatios {
  return {
    current_ratio: industryAvg.current_ratio,
    quick_ratio: industryAvg.quick_ratio,
    debt_ratio: industryAvg.debt_ratio,
    equity_ratio: industryAvg.equity_ratio,
    operating_margin: industryAvg.operating_margin,
    net_margin: industryAvg.net_margin,
    roa: industryAvg.roa,
    roe: industryAvg.roe,
    asset_turnover: industryAvg.asset_turnover,
    inventory_turnover: industryAvg.inventory_turnover,
    receivable_turnover: industryAvg.receivable_turnover,
    interest_coverage: industryAvg.interest_coverage
  }
}
