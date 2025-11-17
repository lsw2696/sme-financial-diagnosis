import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings, CompanyFinancials, IndustryCode, SinboRatio } from './types'
import { calculateFinancialRatios, roundAllRatios } from './utils/calculator'
import { compareRatios } from './utils/diagnosis'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// 업종코드 목록 조회
app.get('/api/industries', async (c) => {
  const { DB } = c.env
  const result = await DB.prepare('SELECT * FROM industry_codes ORDER BY code').all()
  return c.json(result.results)
})

// 특정 업종의 신보 기준 비율 조회
app.get('/api/ratios/:industryCode/:year/:firmSize', async (c) => {
  const { DB } = c.env
  const industryCode = c.req.param('industryCode')
  const year = c.req.param('year')
  const firmSize = c.req.param('firmSize')

  const result = await DB.prepare(
    'SELECT * FROM sinbo_ratios WHERE industry_code = ? AND year = ? AND firm_size_type = ? AND valid_yn = ?'
  )
    .bind(industryCode, parseInt(year), firmSize, 'Y')
    .first()

  if (!result) {
    return c.json({ error: '해당 조건의 신보 기준 데이터가 없습니다.' }, 404)
  }

  return c.json(result)
})

// 재무제표 진단 API
app.post('/api/diagnose', async (c) => {
  try {
    const { DB } = c.env
    const financials: CompanyFinancials = await c.req.json()

    // 입력 검증
    if (!financials.company_name || !financials.industry_code || !financials.year) {
      return c.json({ error: '필수 입력값(회사명, 업종코드, 연도)이 누락되었습니다.' }, 400)
    }

    // 업종명 조회
    const industryResult = await DB.prepare(
      'SELECT name FROM industry_codes WHERE code = ?'
    ).bind(financials.industry_code).first<IndustryCode>()

    if (!industryResult) {
      return c.json({ error: '유효하지 않은 업종코드입니다.' }, 400)
    }

    // 신보 기준 비율 조회
    const sinboResult = await DB.prepare(
      'SELECT * FROM sinbo_ratios WHERE industry_code = ? AND year = ? AND firm_size_type = ? AND valid_yn = ?'
    )
      .bind(financials.industry_code, financials.year, financials.firm_size_type, 'Y')
      .first<SinboRatio>()

    if (!sinboResult) {
      return c.json({ error: '해당 조건의 신보 기준 데이터가 없습니다. 2023년 데이터를 사용해주세요.' }, 404)
    }

    // 재무비율 계산
    const calculatedRatios = calculateFinancialRatios(financials)
    const roundedRatios = roundAllRatios(calculatedRatios)

    // 진단 수행
    const diagnosis = compareRatios(
      roundedRatios,
      sinboResult,
      financials.company_name,
      industryResult.name,
      financials.year,
      financials.firm_size_type
    )

    // 진단 이력 저장
    await DB.prepare(`
      INSERT INTO diagnosis_history (
        company_name, industry_code, firm_size_type, year,
        sales, current_assets, current_liabilities, total_assets, total_liabilities, equity,
        operating_income, net_income, inventory, receivables, interest_expense,
        calc_current_ratio, calc_debt_ratio, calc_equity_ratio, calc_operating_margin,
        calc_roa, calc_roe, diagnosis_result, risk_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      financials.company_name,
      financials.industry_code,
      financials.firm_size_type,
      financials.year,
      financials.sales,
      financials.current_assets,
      financials.current_liabilities,
      financials.total_assets,
      financials.total_liabilities,
      financials.equity,
      financials.operating_income,
      financials.net_income,
      financials.inventory || null,
      financials.receivables || null,
      financials.interest_expense || null,
      roundedRatios.current_ratio || null,
      roundedRatios.debt_ratio || null,
      roundedRatios.equity_ratio || null,
      roundedRatios.operating_margin || null,
      roundedRatios.roa || null,
      roundedRatios.roe || null,
      JSON.stringify(diagnosis),
      diagnosis.risk_level
    ).run()

    return c.json(diagnosis)
  } catch (error) {
    console.error('진단 오류:', error)
    return c.json({ error: '진단 중 오류가 발생했습니다.', details: String(error) }, 500)
  }
})

// 진단 이력 조회
app.get('/api/history', async (c) => {
  const { DB } = c.env
  const result = await DB.prepare(
    'SELECT id, company_name, industry_code, year, risk_level, created_at FROM diagnosis_history ORDER BY created_at DESC LIMIT 20'
  ).all()
  return c.json(result.results)
})

// 메인 페이지
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>중소기업 재무진단 시스템 | 신용보증기금 기준</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body class="bg-gray-50">
        <div class="min-h-screen">
            <!-- 헤더 -->
            <header class="bg-blue-600 text-white shadow-lg">
                <div class="max-w-7xl mx-auto px-4 py-6">
                    <h1 class="text-3xl font-bold">
                        <i class="fas fa-chart-line mr-3"></i>
                        중소기업 재무진단 시스템
                    </h1>
                    <p class="mt-2 text-blue-100">신용보증기금 재무비율 기준 자동 분석 서비스</p>
                </div>
            </header>

            <div class="max-w-7xl mx-auto px-4 py-8">
                <!-- 기능 설명 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-info-circle text-blue-500 mr-2"></i>
                        서비스 소개
                    </h2>
                    <div class="grid md:grid-cols-3 gap-4">
                        <div class="p-4 bg-blue-50 rounded-lg">
                            <i class="fas fa-upload text-blue-600 text-2xl mb-2"></i>
                            <h3 class="font-bold text-gray-800">1. 재무제표 입력</h3>
                            <p class="text-sm text-gray-600">매출액, 자산, 부채 등 주요 재무항목 입력</p>
                        </div>
                        <div class="p-4 bg-green-50 rounded-lg">
                            <i class="fas fa-calculator text-green-600 text-2xl mb-2"></i>
                            <h3 class="font-bold text-gray-800">2. 자동 계산</h3>
                            <p class="text-sm text-gray-600">12개 주요 재무비율 자동 산출</p>
                        </div>
                        <div class="p-4 bg-purple-50 rounded-lg">
                            <i class="fas fa-chart-bar text-purple-600 text-2xl mb-2"></i>
                            <h3 class="font-bold text-gray-800">3. 업종 비교</h3>
                            <p class="text-sm text-gray-600">신보 업종평균과 비교 및 진단</p>
                        </div>
                    </div>
                </div>

                <!-- 입력 폼 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                    <h2 class="text-xl font-bold text-gray-800 mb-6">
                        <i class="fas fa-edit text-green-500 mr-2"></i>
                        재무제표 입력
                    </h2>
                    
                    <form id="diagnosisForm" class="space-y-6">
                        <!-- 기본 정보 -->
                        <div class="grid md:grid-cols-4 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">회사명 *</label>
                                <input type="text" name="company_name" required
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">업종 *</label>
                                <select name="industry_code" id="industrySelect" required
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="">선택하세요</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">기준연도 *</label>
                                <select name="year" required
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="2023">2023</option>
                                    <option value="2022">2022</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">기업규모 *</label>
                                <select name="firm_size_type" required
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                    <option value="외감">외감법인</option>
                                    <option value="비외감">비외감법인</option>
                                </select>
                            </div>
                        </div>

                        <!-- 재무제표 항목 -->
                        <div class="border-t pt-6">
                            <h3 class="font-bold text-gray-800 mb-4">재무상태표 (단위: 백만원)</h3>
                            <div class="grid md:grid-cols-3 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">매출액 *</label>
                                    <input type="number" name="sales" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">유동자산 *</label>
                                    <input type="number" name="current_assets" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">유동부채 *</label>
                                    <input type="number" name="current_liabilities" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">총자산 *</label>
                                    <input type="number" name="total_assets" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">총부채 *</label>
                                    <input type="number" name="total_liabilities" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">자기자본 *</label>
                                    <input type="number" name="equity" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">영업이익 *</label>
                                    <input type="number" name="operating_income" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">당기순이익 *</label>
                                    <input type="number" name="net_income" required step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">재고자산 (선택)</label>
                                    <input type="number" name="inventory" step="0.01"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                </div>
                            </div>
                        </div>

                        <button type="submit" 
                            class="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-bold hover:bg-blue-700 transition">
                            <i class="fas fa-chart-bar mr-2"></i>진단 시작
                        </button>
                    </form>
                </div>

                <!-- 결과 영역 -->
                <div id="resultArea" class="hidden">
                    <div class="bg-white rounded-lg shadow-md p-6 mb-8">
                        <h2 class="text-xl font-bold text-gray-800 mb-6">
                            <i class="fas fa-clipboard-check text-purple-500 mr-2"></i>
                            진단 결과
                        </h2>
                        <div id="resultContent"></div>
                    </div>
                </div>

                <!-- 로딩 -->
                <div id="loading" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div class="bg-white p-8 rounded-lg shadow-xl">
                        <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto"></div>
                        <p class="mt-4 text-gray-700 font-medium">진단 중...</p>
                    </div>
                </div>
            </div>
        </div>

        <script>
            // 업종 목록 로드
            async function loadIndustries() {
                const response = await fetch('/api/industries')
                const industries = await response.json()
                const select = document.getElementById('industrySelect')
                industries.forEach(ind => {
                    const option = document.createElement('option')
                    option.value = ind.code
                    option.textContent = ind.code + ' - ' + ind.name
                    select.appendChild(option)
                })
            }

            // 폼 제출
            document.getElementById('diagnosisForm').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const loading = document.getElementById('loading')
                const resultArea = document.getElementById('resultArea')
                
                loading.classList.remove('hidden')
                resultArea.classList.add('hidden')

                const formData = new FormData(e.target)
                const data = {}
                formData.forEach((value, key) => {
                    if (value) {
                        data[key] = isNaN(value) ? value : parseFloat(value)
                    }
                })

                try {
                    const response = await fetch('/api/diagnose', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    })

                    if (!response.ok) {
                        const error = await response.json()
                        throw new Error(error.error || '진단 실패')
                    }

                    const result = await response.json()
                    displayResult(result)
                    
                    resultArea.classList.remove('hidden')
                    resultArea.scrollIntoView({ behavior: 'smooth' })
                } catch (error) {
                    alert('오류: ' + error.message)
                } finally {
                    loading.classList.add('hidden')
                }
            })

            function displayResult(result) {
                const riskColors = {
                    'LOW': 'bg-green-100 text-green-800 border-green-300',
                    'MEDIUM': 'bg-yellow-100 text-yellow-800 border-yellow-300',
                    'HIGH': 'bg-red-100 text-red-800 border-red-300'
                }
                const riskText = { 'LOW': '낮음', 'MEDIUM': '보통', 'HIGH': '높음' }

                let html = '<div class="space-y-6">'
                
                // 종합 평가
                html += '<div class="border-l-4 border-blue-500 bg-blue-50 p-4">'
                html += '<div class="flex items-center justify-between mb-2">'
                html += '<h3 class="font-bold text-lg">' + result.company_name + ' 종합 평가</h3>'
                html += '<span class="px-4 py-2 rounded-full font-bold border-2 ' + riskColors[result.risk_level] + '">리스크: ' + riskText[result.risk_level] + '</span>'
                html += '</div>'
                html += '<p class="text-gray-700">' + result.overall_comment + '</p>'
                html += '</div>'

                // 비율 비교표
                html += '<div><h3 class="font-bold text-lg mb-4">업종 평균 비교</h3>'
                html += '<div class="overflow-x-auto"><table class="w-full border-collapse">'
                html += '<thead><tr class="bg-gray-100"><th class="border p-3">재무비율</th><th class="border p-3">귀사</th><th class="border p-3">업종평균</th><th class="border p-3">차이</th><th class="border p-3">평가</th></tr></thead><tbody>'
                
                result.comparisons.forEach(comp => {
                    const statusColors = {
                        'good': 'bg-green-50',
                        'warning': 'bg-yellow-50',
                        'danger': 'bg-red-50'
                    }
                    const statusIcons = {
                        'good': '<i class="fas fa-check-circle text-green-600"></i>',
                        'warning': '<i class="fas fa-exclamation-circle text-yellow-600"></i>',
                        'danger': '<i class="fas fa-times-circle text-red-600"></i>'
                    }
                    html += '<tr class="' + statusColors[comp.status] + '">'
                    html += '<td class="border p-3 font-medium">' + comp.ratio_name_kr + '</td>'
                    html += '<td class="border p-3 text-right">' + comp.company_value + '</td>'
                    html += '<td class="border p-3 text-right">' + comp.industry_avg + '</td>'
                    html += '<td class="border p-3 text-right">' + comp.difference_pct + '%</td>'
                    html += '<td class="border p-3">' + statusIcons[comp.status] + ' ' + comp.comment + '</td>'
                    html += '</tr>'
                })
                
                html += '</tbody></table></div></div>'

                // 개선 권고사항
                html += '<div class="bg-yellow-50 border-l-4 border-yellow-500 p-4">'
                html += '<h3 class="font-bold text-lg mb-3"><i class="fas fa-lightbulb text-yellow-600 mr-2"></i>개선 권고사항</h3>'
                html += '<ul class="space-y-2">'
                result.recommendations.forEach(rec => {
                    html += '<li class="flex items-start"><i class="fas fa-arrow-right text-yellow-600 mr-2 mt-1"></i><span>' + rec + '</span></li>'
                })
                html += '</ul></div>'

                html += '</div>'
                document.getElementById('resultContent').innerHTML = html
            }

            loadIndustries()
        </script>
    </body>
    </html>
  `)
})

export default app
