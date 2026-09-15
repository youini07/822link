import fs from 'fs'
import path from 'path'

const API_URL = 'https://api.bunjang.co.kr/api/1/categories/list.json'
const OUTPUT_PATH = path.join(process.cwd(), 'src', 'constants', 'bunjangCategories.json')

/**
 * 번개장터의 카테고리 트리(대/중/소)를 간소화하여 재귀적으로 파싱합니다.
 */
function parseCategories(categories: any[]): any[] {
  if (!categories || !Array.isArray(categories)) return []
  
  return categories.map(cat => {
    return {
      id: cat.id,
      title: cat.title,
      // 하위 카테고리가 존재하면 재귀 파싱
      subCategories: parseCategories(cat.categories || [])
    }
  })
}

async function fetchAndSaveCategories() {
  console.log('[RPA] 번개장터 최신 카테고리 API 데이터 추출 시작...')
  
  try {
    const response = await fetch(API_URL)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (!data.categories) {
      throw new Error('API 응답에 categories 필드가 없습니다.')
    }
    
    console.log(`[RPA] 총 ${data.categories.length}개의 대분류 카테고리를 확보했습니다. 정제 작업을 시작합니다.`)
    
    // 카테고리 트리 간소화
    const cleanCategories = parseCategories(data.categories)
    
    // constants 폴더가 없으면 생성
    const constantsDir = path.dirname(OUTPUT_PATH)
    if (!fs.existsSync(constantsDir)) {
      fs.mkdirSync(constantsDir, { recursive: true })
    }
    
    // JSON 파일로 저장
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cleanCategories, null, 2), 'utf-8')
    
    console.log(`[RPA] 카테고리 데이터베이스 저장 완료! -> ${OUTPUT_PATH}`)
    
  } catch (error) {
    console.error('[RPA] 카테고리 데이터 추출 중 에러 발생:', error)
  }
}

// 스크립트 단독 실행을 위한 트리거
if (require.main === module) {
  fetchAndSaveCategories()
}

export { fetchAndSaveCategories }
