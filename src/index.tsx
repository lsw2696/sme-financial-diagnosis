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

    // 진단 이력 저장 (연락처 포함)
    await DB.prepare(`
      INSERT INTO diagnosis_history (
        company_name, industry_code, firm_size_type, year,
        sales, current_assets, current_liabilities, total_assets, total_liabilities, equity,
        operating_income, net_income, inventory, receivables, interest_expense,
        calc_current_ratio, calc_debt_ratio, calc_equity_ratio, calc_operating_margin,
        calc_roa, calc_roe, diagnosis_result, risk_level,
        contact_email, contact_phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      diagnosis.risk_level,
      (financials as any).contact_email || null,
      (financials as any).contact_phone || null
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

// 모든 신보 표준지표 조회
app.get('/api/standards', async (c) => {
  const { DB } = c.env
  const result = await DB.prepare(`
    SELECT sr.*, ic.name as industry_name, ic.category 
    FROM sinbo_ratios sr 
    JOIN industry_codes ic ON sr.industry_code = ic.code 
    WHERE sr.valid_yn = 'Y'
    ORDER BY sr.year DESC, sr.industry_code, sr.firm_size_type
  `).all()
  return c.json(result.results)
})

// 계산식 안내 페이지
app.get('/formulas', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>재무비율 계산식 안내</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <div class="min-h-screen">
            <header class="bg-blue-600 text-white shadow-lg">
                <div class="max-w-7xl mx-auto px-4 py-6">
                    <div class="flex items-center justify-between">
                        <h1 class="text-3xl font-bold">
                            <i class="fas fa-calculator mr-3"></i>
                            재무비율 계산식 안내
                        </h1>
                        <a href="/" class="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-50">
                            <i class="fas fa-home mr-2"></i>홈으로
                        </a>
                    </div>
                </div>
            </header>

            <div class="max-w-7xl mx-auto px-4 py-8">
                <!-- 유동성 지표 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 class="text-2xl font-bold text-blue-600 mb-4">
                        <i class="fas fa-water mr-2"></i>유동성 지표
                    </h2>
                    
                    <div class="space-y-4">
                        <div class="border-l-4 border-blue-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">1. 유동비율 (%)</h3>
                            <p class="text-gray-600 mt-2">단기채무 상환능력을 나타내는 지표</p>
                            <div class="bg-blue-50 p-4 rounded mt-2">
                                <code class="text-lg">유동비율 = (유동자산 ÷ 유동부채) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 100% 이상 (안전), 150% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 유동부채 100원당 유동자산이 얼마인지 표시</p>
                        </div>

                        <div class="border-l-4 border-blue-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">2. 당좌비율 (%)</h3>
                            <p class="text-gray-600 mt-2">즉시 현금화 가능한 자산의 단기상환능력</p>
                            <div class="bg-blue-50 p-4 rounded mt-2">
                                <code class="text-lg">당좌비율 = (당좌자산 ÷ 유동부채) × 100</code>
                                <div class="text-sm mt-2">당좌자산 = 유동자산 - 재고자산</div>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 100% 이상 (안전)</p>
                            <p class="text-sm text-gray-500">• 의미: 재고자산을 제외한 즉시 현금화 가능 자산</p>
                        </div>
                    </div>
                </div>

                <!-- 안정성 지표 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 class="text-2xl font-bold text-green-600 mb-4">
                        <i class="fas fa-shield-alt mr-2"></i>안정성 지표
                    </h2>
                    
                    <div class="space-y-4">
                        <div class="border-l-4 border-green-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">3. 부채비율 (%)</h3>
                            <p class="text-gray-600 mt-2">자기자본 대비 타인자본 의존도</p>
                            <div class="bg-green-50 p-4 rounded mt-2">
                                <code class="text-lg">부채비율 = (총부채 ÷ 자기자본) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 200% 이하 (안전), 100% 이하 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 낮을수록 재무구조가 건전</p>
                        </div>

                        <div class="border-l-4 border-green-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">4. 자기자본비율 (%)</h3>
                            <p class="text-gray-600 mt-2">총자산 중 자기자본이 차지하는 비중</p>
                            <div class="bg-green-50 p-4 rounded mt-2">
                                <code class="text-lg">자기자본비율 = (자기자본 ÷ 총자산) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 30% 이상 (안전), 50% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 높을수록 재무구조가 안정적</p>
                        </div>
                    </div>
                </div>

                <!-- 수익성 지표 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 class="text-2xl font-bold text-purple-600 mb-4">
                        <i class="fas fa-chart-line mr-2"></i>수익성 지표
                    </h2>
                    
                    <div class="space-y-4">
                        <div class="border-l-4 border-purple-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">5. 매출액영업이익률 (%)</h3>
                            <p class="text-gray-600 mt-2">매출액 대비 영업이익 비율</p>
                            <div class="bg-purple-50 p-4 rounded mt-2">
                                <code class="text-lg">매출액영업이익률 = (영업이익 ÷ 매출액) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 5% 이상 (보통), 10% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 본업의 수익성을 나타냄</p>
                        </div>

                        <div class="border-l-4 border-purple-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">6. 매출액순이익률 (%)</h3>
                            <p class="text-gray-600 mt-2">매출액 대비 당기순이익 비율</p>
                            <div class="bg-purple-50 p-4 rounded mt-2">
                                <code class="text-lg">매출액순이익률 = (당기순이익 ÷ 매출액) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 3% 이상 (보통), 5% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 최종 수익성을 나타냄</p>
                        </div>

                        <div class="border-l-4 border-purple-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">7. ROA - 총자산순이익률 (%)</h3>
                            <p class="text-gray-600 mt-2">총자산을 활용한 수익창출능력</p>
                            <div class="bg-purple-50 p-4 rounded mt-2">
                                <code class="text-lg">ROA = (당기순이익 ÷ 총자산) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 5% 이상 (보통), 10% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 자산 효율성을 나타냄</p>
                        </div>

                        <div class="border-l-4 border-purple-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">8. ROE - 자기자본순이익률 (%)</h3>
                            <p class="text-gray-600 mt-2">자기자본 대비 수익창출능력</p>
                            <div class="bg-purple-50 p-4 rounded mt-2">
                                <code class="text-lg">ROE = (당기순이익 ÷ 자기자본) × 100</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 10% 이상 (보통), 15% 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 주주입장의 수익성을 나타냄</p>
                        </div>
                    </div>
                </div>

                <!-- 활동성 지표 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 class="text-2xl font-bold text-orange-600 mb-4">
                        <i class="fas fa-sync-alt mr-2"></i>활동성 지표
                    </h2>
                    
                    <div class="space-y-4">
                        <div class="border-l-4 border-orange-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">9. 총자산회전율 (회)</h3>
                            <p class="text-gray-600 mt-2">자산이 1년에 몇 번 회전하는가</p>
                            <div class="bg-orange-50 p-4 rounded mt-2">
                                <code class="text-lg">총자산회전율 = 매출액 ÷ 총자산</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 1회 이상 (보통), 업종별 차이 큼</p>
                            <p class="text-sm text-gray-500">• 의미: 자산 운용 효율성</p>
                        </div>

                        <div class="border-l-4 border-orange-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">10. 재고자산회전율 (회)</h3>
                            <p class="text-gray-600 mt-2">재고자산이 1년에 몇 번 판매되는가</p>
                            <div class="bg-orange-50 p-4 rounded mt-2">
                                <code class="text-lg">재고자산회전율 = 매출액 ÷ 재고자산</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 높을수록 좋음 (업종별 차이 큼)</p>
                            <p class="text-sm text-gray-500">• 의미: 재고관리 효율성</p>
                        </div>

                        <div class="border-l-4 border-orange-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">11. 매출채권회전율 (회)</h3>
                            <p class="text-gray-600 mt-2">외상매출금이 1년에 몇 번 회수되는가</p>
                            <div class="bg-orange-50 p-4 rounded mt-2">
                                <code class="text-lg">매출채권회전율 = 매출액 ÷ 매출채권</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 높을수록 좋음 (업종별 차이 큼)</p>
                            <p class="text-sm text-gray-500">• 의미: 채권회수 효율성</p>
                        </div>

                        <div class="border-l-4 border-orange-500 pl-4">
                            <h3 class="text-lg font-bold text-gray-800">12. 이자보상배율 (배)</h3>
                            <p class="text-gray-600 mt-2">이자비용 지급능력</p>
                            <div class="bg-orange-50 p-4 rounded mt-2">
                                <code class="text-lg">이자보상배율 = 영업이익 ÷ 이자비용</code>
                            </div>
                            <p class="text-sm text-gray-500 mt-2">• 기준: 1배 이상 (안전), 3배 이상 (우수)</p>
                            <p class="text-sm text-gray-500">• 의미: 이자 지급 여력</p>
                        </div>
                    </div>
                </div>

                <!-- 참고사항 -->
                <div class="bg-yellow-50 border-l-4 border-yellow-500 p-6 rounded">
                    <h3 class="font-bold text-lg text-gray-800 mb-3">
                        <i class="fas fa-info-circle text-yellow-600 mr-2"></i>참고사항
                    </h3>
                    <ul class="space-y-2 text-gray-700">
                        <li>• 각 재무비율의 적정 수준은 업종, 기업규모에 따라 다릅니다.</li>
                        <li>• 신용보증기금은 업종별/규모별 평균치를 기준으로 평가합니다.</li>
                        <li>• 단일 지표보다 여러 지표를 종합적으로 판단하는 것이 중요합니다.</li>
                        <li>• 추세 분석(과거 대비 개선/악화)도 중요한 평가요소입니다.</li>
                    </ul>
                </div>
            </div>
        </div>
    </body>
    </html>
  `)
})

// 신보 표준지표 조회 페이지
app.get('/standards', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>신보 업종별 표준지표</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <div class="min-h-screen">
            <header class="bg-green-600 text-white shadow-lg">
                <div class="max-w-7xl mx-auto px-4 py-6">
                    <div class="flex items-center justify-between">
                        <h1 class="text-3xl font-bold">
                            <i class="fas fa-database mr-3"></i>
                            신보 업종별 표준지표
                        </h1>
                        <div class="space-x-4">
                            <a href="/formulas" class="bg-white text-green-600 px-4 py-2 rounded-lg font-bold hover:bg-green-50">
                                <i class="fas fa-calculator mr-2"></i>계산식
                            </a>
                            <a href="/" class="bg-white text-green-600 px-4 py-2 rounded-lg font-bold hover:bg-green-50">
                                <i class="fas fa-home mr-2"></i>홈으로
                            </a>
                        </div>
                    </div>
                </div>
            </header>

            <div class="max-w-7xl mx-auto px-4 py-8">
                <!-- 필터 -->
                <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                    <div class="grid md:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">업종</label>
                            <select id="filterIndustry" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                <option value="">전체</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">기업규모</label>
                            <select id="filterSize" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                <option value="">전체</option>
                                <option value="외감">외감</option>
                                <option value="비외감">비외감</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">연도</label>
                            <select id="filterYear" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                                <option value="">전체</option>
                                <option value="2023">2023</option>
                                <option value="2022">2022</option>
                            </select>
                        </div>
                    </div>
                    <button onclick="applyFilter()" class="mt-4 w-full bg-green-600 text-white py-2 rounded-lg font-bold hover:bg-green-700">
                        <i class="fas fa-filter mr-2"></i>검색
                    </button>
                </div>

                <!-- 결과 테이블 -->
                <div class="bg-white rounded-lg shadow-md p-6">
                    <div class="overflow-x-auto">
                        <table class="w-full border-collapse text-sm">
                            <thead>
                                <tr class="bg-gray-100">
                                    <th class="border p-2">업종</th>
                                    <th class="border p-2">규모</th>
                                    <th class="border p-2">연도</th>
                                    <th class="border p-2">유동<br/>비율</th>
                                    <th class="border p-2">당좌<br/>비율</th>
                                    <th class="border p-2">부채<br/>비율</th>
                                    <th class="border p-2">자기자본<br/>비율</th>
                                    <th class="border p-2">영업<br/>이익률</th>
                                    <th class="border p-2">순<br/>이익률</th>
                                    <th class="border p-2">ROA</th>
                                    <th class="border p-2">ROE</th>
                                    <th class="border p-2">자산<br/>회전율</th>
                                    <th class="border p-2">재고<br/>회전율</th>
                                    <th class="border p-2">채권<br/>회전율</th>
                                    <th class="border p-2">이자<br/>보상배율</th>
                                </tr>
                            </thead>
                            <tbody id="dataTable">
                                <tr>
                                    <td colspan="15" class="border p-4 text-center text-gray-500">
                                        <i class="fas fa-spinner fa-spin mr-2"></i>로딩 중...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <script>
            let allData = []
            let industries = []

            async function loadData() {
                try {
                    const [standardsRes, industriesRes] = await Promise.all([
                        fetch('/api/standards'),
                        fetch('/api/industries')
                    ])
                    
                    allData = await standardsRes.json()
                    industries = await industriesRes.json()
                    
                    // 업종 필터 채우기
                    const filterIndustry = document.getElementById('filterIndustry')
                    industries.forEach(ind => {
                        const option = document.createElement('option')
                        option.value = ind.code
                        option.textContent = ind.code + ' - ' + ind.name
                        filterIndustry.appendChild(option)
                    })
                    
                    displayData(allData)
                } catch (error) {
                    console.error('데이터 로드 실패:', error)
                    document.getElementById('dataTable').innerHTML = '<tr><td colspan="15" class="border p-4 text-center text-red-500">데이터 로드 실패</td></tr>'
                }
            }

            function applyFilter() {
                const industry = document.getElementById('filterIndustry').value
                const size = document.getElementById('filterSize').value
                const year = document.getElementById('filterYear').value

                let filtered = allData
                if (industry) filtered = filtered.filter(d => d.industry_code === industry)
                if (size) filtered = filtered.filter(d => d.firm_size_type === size)
                if (year) filtered = filtered.filter(d => d.year == year)

                displayData(filtered)
            }

            function displayData(data) {
                const tbody = document.getElementById('dataTable')
                
                if (data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="15" class="border p-4 text-center text-gray-500">검색 결과가 없습니다.</td></tr>'
                    return
                }

                let html = ''
                let prevIndustry = null
                let industryRowCount = 0
                let industryStartIndex = 0
                
                // 먼저 데이터를 업종별로 정렬
                data.sort((a, b) => {
                    if (a.industry_code !== b.industry_code) {
                        return a.industry_code.localeCompare(b.industry_code)
                    }
                    return a.year - b.year
                })
                
                // 각 행 생성
                data.forEach((row, index) => {
                    // 새로운 업종이 시작되면
                    if (row.industry_code !== prevIndustry) {
                        // 이전 업종의 rowspan 계산
                        if (prevIndustry !== null && industryRowCount > 0) {
                            // 이미 생성된 HTML에서 placeholder를 실제 rowspan으로 교체
                            const placeholder = 'ROWSPAN_' + prevIndustry
                            html = html.replace(new RegExp(placeholder, 'g'), industryRowCount.toString())
                        }
                        
                        prevIndustry = row.industry_code
                        industryRowCount = 1
                        industryStartIndex = index
                        
                        // 새 행 시작 - 업종 셀 포함
                        html += '<tr class="hover:bg-gray-50">'
                        html += '<td class="border p-2 text-xs align-middle" rowspan="ROWSPAN_' + row.industry_code + '">' + 
                                '<div class="font-medium">' + row.industry_code + '</div>' +
                                '<div class="text-gray-500 text-xs">' + (row.industry_name || '') + '</div></td>'
                    } else {
                        // 같은 업종 계속
                        industryRowCount++
                        html += '<tr class="hover:bg-gray-50">'
                    }
                    
                    // 나머지 컬럼들
                    html += '<td class="border p-2 text-center">' + row.firm_size_type + '</td>' +
                            '<td class="border p-2 text-center">' + row.year + '</td>' +
                            '<td class="border p-2 text-right">' + (row.current_ratio || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.quick_ratio || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.debt_ratio || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.equity_ratio || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.operating_margin || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.net_margin || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.roa || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.roe || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.asset_turnover || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.inventory_turnover || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.receivable_turnover || '-') + '</td>' +
                            '<td class="border p-2 text-right">' + (row.interest_coverage || '-') + '</td>' +
                            '</tr>'
                })
                
                // 마지막 업종의 rowspan 처리
                if (prevIndustry !== null && industryRowCount > 0) {
                    const placeholder = 'ROWSPAN_' + prevIndustry
                    html = html.replace(new RegExp(placeholder, 'g'), industryRowCount.toString())
                }
                
                tbody.innerHTML = html
            }

            loadData()
        </script>
    </body>
    </html>
  `)
})

// 테스트 페이지
app.get('/test', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>입력 테스트</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="p-8">
      <h1 class="text-2xl font-bold mb-4">숫자 입력 테스트</h1>
      <div class="space-y-4">
        <div>
          <label class="block mb-2">테스트 입력 (포커스 시 콤마 제거, blur 시 콤마 추가)</label>
          <input type="text" data-number-input class="border p-2 rounded w-full" placeholder="숫자를 입력하세요">
        </div>
        <div>
          <label class="block mb-2">일반 입력 (비교용)</label>
          <input type="text" class="border p-2 rounded w-full" placeholder="일반 입력">
        </div>
        <div id="log" class="mt-4 p-4 bg-gray-100 rounded"></div>
      </div>
      
      <script>
        const log = document.getElementById('log')
        function addLog(msg) {
          log.innerHTML += '<div>' + new Date().toLocaleTimeString() + ': ' + msg + '</div>'
        }
        
        document.addEventListener('DOMContentLoaded', () => {
          addLog('DOMContentLoaded 이벤트 발생')
          const numberInputs = document.querySelectorAll('[data-number-input]')
          addLog('발견된 입력 필드: ' + numberInputs.length + '개')
          
          numberInputs.forEach(input => {
            addLog('이벤트 리스너 등록 중...')
            
            input.addEventListener('focus', function() {
              addLog('Focus: "' + this.value + '" → 콤마 제거')
              this.value = this.value.replace(/,/g, '')
              addLog('Focus 후: "' + this.value + '"')
            })
            
            input.addEventListener('blur', function() {
              addLog('Blur: "' + this.value + '"')
              let val = this.value.replace(/,/g, '')
              if (val && !isNaN(val)) {
                if (val.includes('.')) {
                  const parts = val.split('.')
                  parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
                  this.value = parts.join('.')
                } else {
                  this.value = val.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
                }
                addLog('Blur 후: "' + this.value + '"')
              }
            })
            
            input.addEventListener('input', function() {
              addLog('Input: "' + this.value + '"')
            })
          })
        })
      </script>
    </body>
    </html>
  `)
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
                    <div class="flex items-center justify-between">
                        <div>
                            <h1 class="text-3xl font-bold">
                                <i class="fas fa-chart-line mr-3"></i>
                                중소기업 재무진단 시스템
                            </h1>
                            <p class="mt-2 text-blue-100">신용보증기금 재무비율 기준 자동 분석 서비스</p>
                        </div>
                        <div class="flex space-x-3">
                            <a href="/standards" class="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-50 transition">
                                <i class="fas fa-database mr-2"></i>표준지표
                            </a>
                            <a href="/formulas" class="bg-white text-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-50 transition">
                                <i class="fas fa-calculator mr-2"></i>계산식
                            </a>
                        </div>
                    </div>
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
                                    <input type="text" name="sales" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="5,000">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">유동자산 *</label>
                                    <input type="text" name="current_assets" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="2,000">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">유동부채 *</label>
                                    <input type="text" name="current_liabilities" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="1,500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">총자산 *</label>
                                    <input type="text" name="total_assets" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="4,000">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">총부채 *</label>
                                    <input type="text" name="total_liabilities" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="2,500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">자기자본 *</label>
                                    <input type="text" name="equity" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="1,500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">영업이익 *</label>
                                    <input type="text" name="operating_income" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="250">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">당기순이익 *</label>
                                    <input type="text" name="net_income" required data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="180">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">재고자산</label>
                                    <input type="text" name="inventory" data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="300">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">매출채권</label>
                                    <input type="text" name="receivables" data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="600">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-2">이자비용</label>
                                    <input type="text" name="interest_expense" data-number-input
                                        class="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="40">
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

                <!-- 연락처 입력 모달 -->
                <div id="contactModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            <i class="fas fa-user-circle text-blue-600 mr-2"></i>
                            연락처 입력
                        </h3>
                        <p class="text-gray-600 mb-6">진단 결과를 확인하려면 연락처를 입력해주세요. (이메일 또는 전화번호 중 하나만 입력)</p>
                        
                        <form id="contactForm" class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">이메일</label>
                                <input type="email" id="contactEmail" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="your@email.com">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-2">전화번호</label>
                                <input type="tel" id="contactPhone" 
                                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="010-1234-5678">
                            </div>
                            <div id="contactError" class="hidden text-red-600 text-sm"></div>
                            <div class="flex space-x-3">
                                <button type="button" id="cancelContact" 
                                    class="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                                    취소
                                </button>
                                <button type="submit" 
                                    class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                                    확인
                                </button>
                            </div>
                        </form>
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

        <!-- 푸터 -->
        <footer class="bg-gray-800 text-white py-6 mt-12">
            <div class="max-w-7xl mx-auto px-4 text-center">
                <div class="mb-3">
                    <p class="text-lg font-bold">리베르컨설팅</p>
                    <p class="text-gray-300 mt-2">
                        <i class="fas fa-phone mr-2"></i>
                        <a href="tel:02-525-8870" class="hover:text-blue-400 transition">02-525-8870</a>
                    </p>
                </div>
                <div class="border-t border-gray-700 pt-4 mt-4">
                    <p class="text-sm text-gray-400">
                        © 2025 리베르컨설팅. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>

        <script>
            // 천단위 콤마 추가 함수
            function formatNumber(num) {
                return num.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
            }

            // 콤마 제거 함수
            function removeCommas(str) {
                return str.replace(/,/g, '')
            }

            // 숫자 입력 필드에 콤마 자동 추가
            document.addEventListener('DOMContentLoaded', () => {
                const numberInputs = document.querySelectorAll('[data-number-input]')
                console.log('Found number inputs:', numberInputs.length)
                
                numberInputs.forEach(input => {
                    // 포커스 시 콤마 제거
                    input.addEventListener('focus', function() {
                        console.log('Focus:', this.name)
                        this.value = this.value.replace(/,/g, '')
                    })
                    
                    // 포커스 벗어날 때 콤마 추가
                    input.addEventListener('blur', function() {
                        console.log('Blur:', this.name, 'value:', this.value)
                        let val = this.value.replace(/,/g, '')
                        if (val && !isNaN(val)) {
                            // 소수점 처리
                            if (val.includes('.')) {
                                const parts = val.split('.')
                                parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
                                this.value = parts.join('.')
                            } else {
                                this.value = val.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
                            }
                            console.log('Formatted:', this.value)
                        }
                    })
                })
            })

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

            // 전역 변수로 진단 데이터 저장
            let diagnosisData = null
            let diagnosisResult = null

            // 폼 제출 - 연락처 입력 모달 표시
            document.getElementById('diagnosisForm').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const formData = new FormData(e.target)
                const data = {}
                formData.forEach((value, key) => {
                    if (value) {
                        const cleanValue = removeCommas(value)
                        data[key] = isNaN(cleanValue) ? value : parseFloat(cleanValue)
                    }
                })
                
                diagnosisData = data
                
                // 연락처 입력 모달 표시
                document.getElementById('contactModal').classList.remove('hidden')
                document.getElementById('contactEmail').value = ''
                document.getElementById('contactPhone').value = ''
                document.getElementById('contactError').classList.add('hidden')
            })

            // 연락처 모달 취소
            document.getElementById('cancelContact').addEventListener('click', () => {
                document.getElementById('contactModal').classList.add('hidden')
            })

            // 연락처 입력 및 진단 수행
            document.getElementById('contactForm').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const email = document.getElementById('contactEmail').value.trim()
                const phone = document.getElementById('contactPhone').value.trim()
                const errorDiv = document.getElementById('contactError')
                
                // 연락처 검증
                if (!email && !phone) {
                    errorDiv.textContent = '이메일 또는 전화번호 중 하나는 필수입니다.'
                    errorDiv.classList.remove('hidden')
                    return
                }
                
                if (email && !validateEmail(email)) {
                    errorDiv.textContent = '올바른 이메일 형식이 아닙니다.'
                    errorDiv.classList.remove('hidden')
                    return
                }
                
                if (phone && !validatePhone(phone)) {
                    errorDiv.textContent = '올바른 전화번호 형식이 아닙니다. (예: 010-1234-5678)'
                    errorDiv.classList.remove('hidden')
                    return
                }
                
                // 연락처 추가
                diagnosisData.contact_email = email || null
                diagnosisData.contact_phone = phone || null
                
                // 모달 닫기
                document.getElementById('contactModal').classList.add('hidden')
                
                // 로딩 표시
                const loading = document.getElementById('loading')
                const resultArea = document.getElementById('resultArea')
                loading.classList.remove('hidden')
                resultArea.classList.add('hidden')

                try {
                    const response = await fetch('/api/diagnose', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(diagnosisData)
                    })

                    if (!response.ok) {
                        const error = await response.json()
                        throw new Error(error.error || '진단 실패')
                    }

                    diagnosisResult = await response.json()
                    displayResult(diagnosisResult)
                    
                    resultArea.classList.remove('hidden')
                    resultArea.scrollIntoView({ behavior: 'smooth' })
                } catch (error) {
                    alert('오류: ' + error.message)
                } finally {
                    loading.classList.add('hidden')
                }
            })

            // 이메일 검증
            function validateEmail(email) {
                const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                return re.test(email)
            }

            // 전화번호 검증
            function validatePhone(phone) {
                const re = /^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/
                return re.test(phone)
            }

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

// 관리자 로그인 페이지
app.get('/admin/login', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>관리자 로그인 | 재무진단 시스템</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 min-h-screen flex items-center justify-center">
        <div class="max-w-md w-full mx-4">
            <div class="bg-white rounded-lg shadow-lg p-8">
                <div class="text-center mb-8">
                    <i class="fas fa-user-shield text-5xl text-blue-600 mb-4"></i>
                    <h1 class="text-2xl font-bold text-gray-800">관리자 로그인</h1>
                    <p class="text-gray-600 mt-2">중소기업 재무진단 시스템</p>
                </div>

                <form id="loginForm" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">아이디</label>
                        <input type="text" id="username" required
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">비밀번호</label>
                        <input type="password" id="password" required
                            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div id="errorMessage" class="hidden text-red-600 text-sm"></div>
                    <button type="submit" 
                        class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-bold hover:bg-blue-700 transition">
                        <i class="fas fa-sign-in-alt mr-2"></i>로그인
                    </button>
                </form>

                <div class="mt-6 text-center">
                    <a href="/" class="text-sm text-blue-600 hover:underline">
                        <i class="fas fa-home mr-1"></i>메인 페이지로 돌아가기
                    </a>
                </div>

                <div class="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p class="text-xs text-yellow-800">
                        <i class="fas fa-info-circle mr-1"></i>
                        <strong>테스트 계정:</strong> admin / admin123
                    </p>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('loginForm').addEventListener('submit', async (e) => {
                e.preventDefault()
                
                const username = document.getElementById('username').value
                const password = document.getElementById('password').value
                const errorDiv = document.getElementById('errorMessage')
                
                errorDiv.classList.add('hidden')

                try {
                    const response = await fetch('/api/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, password })
                    })

                    const data = await response.json()

                    if (!response.ok) {
                        throw new Error(data.error || '로그인 실패')
                    }

                    // 토큰 저장
                    localStorage.setItem('admin_token', data.token)
                    localStorage.setItem('admin_user', JSON.stringify(data.admin))

                    // 관리자 페이지로 이동
                    window.location.href = '/admin'
                } catch (error) {
                    errorDiv.textContent = error.message
                    errorDiv.classList.remove('hidden')
                }
            })
        </script>
    </body>
    </html>
  `)
})

// 관리자 대시보드 페이지 (리다이렉트)
app.get('/admin', (c) => {
  // 간단하게 /admin/login으로 리다이렉트하고, 인증 후 대시보드 표시는 클라이언트에서 처리
  return c.redirect('/admin/dashboard')
})

// 관리자 대시보드 실제 페이지
app.get('/admin/dashboard', (c) => {
  // admin-page.html 파일을 공개 폴더에 복사해서 제공 예정
  // 현재는 간단한 버전으로 구현
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>관리자 대시보드</title>
      <script>
        // 토큰 체크
        const token = localStorage.getItem('admin_token')
        if (!token) {
          window.location.href = '/admin/login'
        }
      </script>
      <meta http-equiv="refresh" content="0; url=/admin-dashboard.html">
    </head>
    <body>
      <p>Loading...</p>
    </body>
    </html>
  `)
})

// ====== 관리자 API ======

// 관리자 로그인 API (간단한 비밀번호 체크)
app.post('/api/admin/login', async (c) => {
  try {
    const { DB } = c.env
    const { username, password } = await c.req.json()

    if (!username || !password) {
      return c.json({ error: '아이디와 비밀번호를 입력해주세요.' }, 400)
    }

    // SHA-256 해시로 비밀번호 검증
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    
    console.log('Login attempt:', username, 'Hash:', passwordHash)

    const admin = await DB.prepare(
      'SELECT id, username, full_name, email FROM admin_users WHERE username = ? AND password_hash = ?'
    ).bind(username, passwordHash).first()

    if (!admin) {
      return c.json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' }, 401)
    }

    // 마지막 로그인 시간 업데이트
    await DB.prepare(
      'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(admin.id).run()

    // 세션 토큰 생성 (간단한 구현)
    const token = Buffer.from(`${admin.id}:${Date.now()}`).toString('base64')

    return c.json({ 
      success: true, 
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        email: admin.email
      }
    })
  } catch (error) {
    console.error('로그인 오류:', error)
    return c.json({ error: '로그인 중 오류가 발생했습니다.' }, 500)
  }
})

// 관리자 인증 미들웨어 (간단한 토큰 체크)
const adminAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '인증이 필요합니다.' }, 401)
  }

  try {
    const token = authHeader.substring(7)
    const decoded = Buffer.from(token, 'base64').toString()
    const [adminId, timestamp] = decoded.split(':')
    
    // 토큰 유효기간 체크 (24시간)
    const tokenAge = Date.now() - parseInt(timestamp)
    if (tokenAge > 24 * 60 * 60 * 1000) {
      return c.json({ error: '토큰이 만료되었습니다.' }, 401)
    }

    c.set('adminId', adminId)
    await next()
  } catch (error) {
    return c.json({ error: '유효하지 않은 토큰입니다.' }, 401)
  }
}

// 진단 이력 목록 조회 (관리자 전용)
app.get('/api/admin/diagnoses', adminAuth, async (c) => {
  try {
    const { DB } = c.env
    const { search, industry, startDate, endDate, limit = 100, offset = 0 } = c.req.query()

    let query = `
      SELECT 
        dh.id, dh.company_name, dh.industry_code, dh.firm_size_type, dh.year,
        dh.risk_level, dh.contact_email, dh.contact_phone, dh.created_at,
        ic.name as industry_name
      FROM diagnosis_history dh
      LEFT JOIN industry_codes ic ON dh.industry_code = ic.code
      WHERE 1=1
    `
    const params: any[] = []

    // 필터링
    if (search) {
      query += ' AND (dh.company_name LIKE ? OR dh.contact_email LIKE ? OR dh.contact_phone LIKE ?)'
      const searchParam = `%${search}%`
      params.push(searchParam, searchParam, searchParam)
    }

    if (industry) {
      query += ' AND dh.industry_code = ?'
      params.push(industry)
    }

    if (startDate) {
      query += ' AND DATE(dh.created_at) >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND DATE(dh.created_at) <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY dh.created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit as string), parseInt(offset as string))

    const results = await DB.prepare(query).bind(...params).all()
    
    // 총 개수 조회
    let countQuery = 'SELECT COUNT(*) as total FROM diagnosis_history WHERE 1=1'
    const countParams: any[] = []
    
    if (search) {
      countQuery += ' AND (company_name LIKE ? OR contact_email LIKE ? OR contact_phone LIKE ?)'
      const searchParam = `%${search}%`
      countParams.push(searchParam, searchParam, searchParam)
    }
    if (industry) {
      countQuery += ' AND industry_code = ?'
      countParams.push(industry)
    }
    if (startDate) {
      countQuery += ' AND DATE(created_at) >= ?'
      countParams.push(startDate)
    }
    if (endDate) {
      countQuery += ' AND DATE(created_at) <= ?'
      countParams.push(endDate)
    }

    const countResult = await DB.prepare(countQuery).bind(...countParams).first<{ total: number }>()

    return c.json({
      data: results.results,
      total: countResult?.total || 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    })
  } catch (error) {
    console.error('진단 이력 조회 오류:', error)
    return c.json({ error: '조회 중 오류가 발생했습니다.' }, 500)
  }
})

// 진단 이력 상세 조회 (관리자 전용)
app.get('/api/admin/diagnoses/:id', adminAuth, async (c) => {
  try {
    const { DB } = c.env
    const id = c.req.param('id')

    const result = await DB.prepare(`
      SELECT 
        dh.*,
        ic.name as industry_name,
        ic.category as industry_category
      FROM diagnosis_history dh
      LEFT JOIN industry_codes ic ON dh.industry_code = ic.code
      WHERE dh.id = ?
    `).bind(id).first()

    if (!result) {
      return c.json({ error: '해당 진단 이력을 찾을 수 없습니다.' }, 404)
    }

    return c.json(result)
  } catch (error) {
    console.error('진단 상세 조회 오류:', error)
    return c.json({ error: '조회 중 오류가 발생했습니다.' }, 500)
  }
})

// 통계 API (관리자 전용)
app.get('/api/admin/stats', adminAuth, async (c) => {
  try {
    const { DB } = c.env

    // 총 진단 건수
    const totalResult = await DB.prepare('SELECT COUNT(*) as total FROM diagnosis_history').first<{ total: number }>()
    
    // 오늘 진단 건수
    const todayResult = await DB.prepare(
      'SELECT COUNT(*) as today FROM diagnosis_history WHERE DATE(created_at) = DATE("now")'
    ).first<{ today: number }>()
    
    // 업종별 통계
    const industryStats = await DB.prepare(`
      SELECT 
        dh.industry_code, 
        ic.name as industry_name,
        COUNT(*) as count
      FROM diagnosis_history dh
      LEFT JOIN industry_codes ic ON dh.industry_code = ic.code
      GROUP BY dh.industry_code
      ORDER BY count DESC
      LIMIT 10
    `).all()
    
    // 리스크 레벨별 통계
    const riskStats = await DB.prepare(`
      SELECT 
        risk_level,
        COUNT(*) as count
      FROM diagnosis_history
      GROUP BY risk_level
    `).all()

    return c.json({
      total: totalResult?.total || 0,
      today: todayResult?.today || 0,
      by_industry: industryStats.results,
      by_risk: riskStats.results
    })
  } catch (error) {
    console.error('통계 조회 오류:', error)
    return c.json({ error: '통계 조회 중 오류가 발생했습니다.' }, 500)
  }
})

export default app
