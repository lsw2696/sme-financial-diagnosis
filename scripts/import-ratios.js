import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// CSV 파일 읽기
const csvPath = path.join(__dirname, '../data/sinbo_ratios_sample.csv')
const csvContent = fs.readFileSync(csvPath, 'utf-8')

// CSV 파싱
const lines = csvContent.trim().split('\n')
const headers = lines[0].split(',')
const records = lines.slice(1).map(line => {
  const values = line.split(',')
  const record = {}
  headers.forEach((header, index) => {
    const value = values[index]
    // 숫자 변환
    if (header !== 'industry_code' && header !== 'firm_size_type' && header !== 'valid_yn') {
      record[header] = value ? parseFloat(value) : null
    } else {
      record[header] = value
    }
  })
  return record
})

// SQL INSERT 문 생성
const insertStatements = records.map(record => {
  const columns = Object.keys(record)
  const values = columns.map(col => {
    const val = record[col]
    if (val === null) return 'NULL'
    if (typeof val === 'string') return `'${val}'`
    return val
  })
  
  return `INSERT OR IGNORE INTO sinbo_ratios (${columns.join(', ')}) VALUES (${values.join(', ')});`
})

// SQL 파일 생성
const sqlPath = path.join(__dirname, '../data/seed_ratios.sql')
fs.writeFileSync(sqlPath, insertStatements.join('\n'))

console.log(`✅ Generated ${insertStatements.length} INSERT statements`)
console.log(`📁 Saved to: ${sqlPath}`)
