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

  if (companyRatios.current_ratio && industryAvg.current_ratio) {
    comparisons.push(compareRatio('current_ratio', '유동비율', companyRatios.current_ratio, industryAvg.current_ratio, true))
  }
  if (companyRatios.debt_ratio && industryAvg.debt_ratio) {
    comparisons.push(compareRatio('debt_ratio', '부채비율', companyRatios.debt_ratio, industryAvg.debt_ratio, false))
  }
  if (companyRatios.equity_ratio && industryAvg.equity_ratio) {
    comparisons.push(compareRatio('equity_ratio', '자기자본비율', companyRatios.equity_ratio, industryAvg.equity_ratio, true))
  }
  if (companyRatios.operating_margin && industryAvg.operating_margin) {
    comparisons.push(compareRatio('operating_margin', '영업이익률', companyRatios.operating_margin, industryAvg.operating_margin, true))
  }
  if (companyRatios.roa && industryAvg.roa) {
    comparisons.push(compareRatio('roa', 'ROA', companyRatios.roa, industryAvg.roa, true))
  }
  if (companyRatios.roe && industryAvg.roe) {
    comparisons.push(compareRatio('roe', 'ROE', companyRatios.roe, industryAvg.roe, true))
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
    if (ratio.ratio_name === 'current_ratio') recommendations.push('유동비율 개선: 단기차입금 상환 또는 유동자산 증대')
    if (ratio.ratio_name === 'debt_ratio') recommendations.push('부채비율 개선: 증자, 이익잉여금 축적, 장기부채 상환')
    if (ratio.ratio_name === 'operating_margin') recommendations.push('수익성 개선: 원가절감, 고부가가치 제품 확대')
    if (ratio.ratio_name === 'roa' || ratio.ratio_name === 'roe') recommendations.push('수익성 제고: 매출 증대 및 비용 효율화')
    if (ratio.ratio_name === 'equity_ratio') recommendations.push('자기자본 강화: 증자 또는 내부유보')
  }

  if (recommendations.length === 0) recommendations.push('현 재무상태 유지, 지속 모니터링 권장')
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
