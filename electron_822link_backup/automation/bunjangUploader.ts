import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

// 봇 탐지 우회(Stealth) 플러그인 적용
chromium.use(stealth())

const BUNJANG_UPLOAD_URL = 'https://bunjang.co.kr/products/new'

export interface ProductData {
  imagePaths: string[] // 절대경로 이미지 6장
  title: string
  categories: string[] // ['남성의류', '상의', '후드티/후드집업']
  price: string | number
  description: string
  condition: string // 5가지 상태 텍스트
  isExchangeable?: boolean
  hashtags?: string
  size?: string
}

let activePage: any = null

export async function cancelActiveBunjangUpload() {
  if (activePage) {
    console.log('[bunjangUploader] 작업 강제 중단 요청! 현재 탭을 닫습니다.')
    try {
      await activePage.close()
    } catch (e) {}
    activePage = null
  }
}

export async function uploadToBunjang(productData: any, injectedBrowser?: any) {
  console.log(`[RPA] ${productData.title} 번개장터 업로드 시작...`)
  
  // 사용자가 이미 띄워놓은 실제 크롬 창(디버깅 포트 9222)에 찰싹 달라붙습니다(Attach).
  let browser = injectedBrowser
  let isOwnBrowser = false
  try {
    if (!browser) {
      browser = await chromium.connectOverCDP('http://localhost:9222')
      isOwnBrowser = true
    }
    console.log('[RPA] ⚡ 열려있는 크롬 창에 성공적으로 연결되었습니다.')
  } catch (err) {
    throw new Error('열려있는 디버깅 크롬 창(포트 9222)을 찾을 수 없습니다. 크롬 바로가기 설정을 확인해주세요.')
  }

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : browser.contexts()[0]
  
  // 열려있는 탭을 찾고 없으면 새 탭을 엽니다
  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()
  activePage = page
  
  // 이미 사용자가 로그인해 놓은 창이므로 바로 상품 등록 페이지로 직행!
  // networkidle 조건은 무한 로딩 리스크가 있으므로 domcontentloaded 로 완화
  await page.goto(BUNJANG_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  
  try {
    // 1. 이미지 첨부 (멀티 파일 업로드)
    console.log('[RPA] 사진 첨부 중...')
    // 번개장터의 사진 첨부 인풋 태그는 hidden 처리되어 있으므로 state: 'attached' 로 기다립니다.
    const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached' })
    if (fileInput) {
      await fileInput.setInputFiles(productData.imagePaths)
    }
    
    // 1.5 이미지가 서버에 모두 올라가서 UI에 반영될 때까지 대기
    // 번개장터는 "상품이미지 (업로드수/12)" 형식으로 표시되므로, 해당 텍스트가 나타날 때까지 기다립니다.
    const imgCount = productData.imagePaths.length
    const maxWaitTime = imgCount * 2500 + 5000 // 1장당 2.5초 + 기본 5초 여유
    console.log(`[RPA] 사진 ${imgCount}장 업로드 대기 중 (최대 ${maxWaitTime/1000}초)...`)
    
    try {
      // 텍스트가 "상품이미지 (N/12)" 처럼 변하는 것을 감지
      await page.waitForFunction(
        (count) => {
          return document.body.innerText.includes(`(${count}/12)`) || document.body.innerText.includes(`(${count}/10)`)
        },
        imgCount,
        { timeout: maxWaitTime }
      )
      console.log('[RPA] 사진 업로드 UI 반영 완료 확인!')
    } catch (e) {
      console.log(`[RPA] 완벽한 사진 업로드 감지 실패. (지정된 대기시간이 만료되어 강제 진행합니다)`)
    }
    
    // 추가적인 렌더링 안정화 딜레이
    await page.waitForTimeout(1000)

    // 2. 상품명 입력
    console.log('[RPA] 상품명 기입 중...')
    await page.getByPlaceholder('상품명을 입력해 주세요').fill(productData.title)

    // 3. 카테고리 클릭 (추천 카테고리 무조건 첫 번째 항목 클릭)
    console.log('[RPA] 카테고리 매핑 중...')
    let recommendedClicked = false
    try {
      console.log('[RPA] AI 추천 카테고리 렌더링 대기 중...')
      
      // 번개장터 화면 구조상 '〉' 등의 꺾쇠 기호는 추천 카테고리에만 나타납니다.
      // 가장 깊숙한(실제 텍스트를 가진) 요소 중 첫 번째(가장 좌측) 요소를 타겟으로 잡습니다.
      const recommendBtn = page.getByText(/[〉>›＞]/).first()
      
      // 네트워크 속도에 따라 추천 항목이 뜨는 데 시간이 걸릴 수 있으므로 최대 5초까지 넉넉하게 기다립니다.
      await recommendBtn.waitFor({ state: 'visible', timeout: 5000 })
      
      // 요소가 나타나면 즉시 클릭합니다.
      await recommendBtn.click()
      recommendedClicked = true
      
      console.log('[RPA] ⚡ 인공지능 추천 카테고리를 성공적으로 클릭했습니다.')
      await page.waitForTimeout(1000)
    } catch (e) {
      console.log('[RPA] 추천 카테고리 자동 클릭 에러:', e)
    }

    if (!recommendedClicked) {
      for (const cat of productData.categories) {
        // 상단 메뉴(GNB)와 중복될 경우, 화면 아래쪽(실제 박스)에 있는 항목을 클릭하기 위해 last() 사용
        try {
          const catLocators = page.getByText(cat, { exact: true })
          if (await catLocators.count() > 1) {
            await catLocators.last().click({ timeout: 5000 })
          } else {
            await catLocators.click({ timeout: 5000 })
          }
          await page.waitForTimeout(500)
        } catch (e) {
          console.log(`[RPA] 수동 카테고리(${cat}) 클릭 실패 (무시하고 진행)`)
        }
      }
    }

    // 4. 상태 및 옵션
    console.log('[RPA] 상태/옵션 선택 중...')
    
    // 시트에 적힌 값(예: "새상품", "사용감적음")을 번개장터의 정확한 메뉴명으로 스마트 매핑
    let targetCondition = '사용감 적음' // 기본값
    if (productData.condition) {
      const raw = productData.condition.replace(/\s+/g, '') // 공백 제거
      if (raw.includes('새상품') || raw.includes('미사용')) targetCondition = '새 상품 (미사용)'
      else if (raw.includes('사용감없음')) targetCondition = '사용감 없음'
      else if (raw.includes('사용감많음') || raw.includes('많음')) targetCondition = '사용감 많음'
      else if (raw.includes('고장') || raw.includes('파손')) targetCondition = '고장/파손 상품'
      else targetCondition = '사용감 적음'
    }

    try {
      // 드롭다운 열기
      const conditionDropdown = page.getByText('상품 상태를 선택해 주세요', { exact: true }).first()
      if (await conditionDropdown.isVisible()) {
        await conditionDropdown.click()
        await page.waitForTimeout(500)
      }
    } catch (e) {}

    try {
      // 매핑된 상태 버튼 클릭
      const conditionBtn = page.getByText(targetCondition, { exact: true }).last()
      await conditionBtn.click({ timeout: 2000 })
      await page.waitForTimeout(300)
    } catch (e) {
      console.log(`[RPA] 상태 버튼(${targetCondition})을 찾지 못해 기본값으로 진행합니다.`)
      // 드롭다운 창이 계속 열려있어 다음 클릭(가격, 사이즈 등)을 가로막는(Intercept) 현상 방지
      await page.mouse.click(0, 0) // 허공 클릭하여 팝업 닫기
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    
    // 4.5 사이즈 선택 (다이얼로그 팝업 형태 처리)
    try {
      const sizeDropdown = page.getByText('사이즈를 선택해 주세요', { exact: true })
      if (await sizeDropdown.isVisible()) {
        await sizeDropdown.click()
        await page.waitForTimeout(1000) // 팝업창이 완전히 뜰 때까지 1초 대기

        const rawSize = productData.size ? productData.size.trim() : ''
        const commonSizes = ['Free', 'FREE', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
        let targetSizeStr = rawSize

        // AI가 뽑은 사이즈(예: "95(M)")에서 공용 사이즈 단어 추출하여 타겟 변경
        for (const s of commonSizes) {
          const regex = new RegExp(`(^|[^a-zA-Z])${s}([^a-zA-Z]|$)`, 'i')
          if (regex.test(rawSize)) {
            targetSizeStr = s.toUpperCase() === 'FREE' ? 'Free' : s.toUpperCase()
            break
          }
        }
        
        let sizeClicked = false
        // 1. 타겟 사이즈 클릭 (자바스크립트 강제 주입 방식으로 100% 타겟팅)
        if (targetSizeStr) {
          try {
            sizeClicked = await page.evaluate((txt) => {
              const els = Array.from(document.querySelectorAll('button, div, span, li'));
              // DOM 트리의 맨 끝(모달 팝업)부터 역순으로 탐색
              for (let i = els.length - 1; i >= 0; i--) {
                const el = els[i] as HTMLElement;
                const tagName = el.tagName.toLowerCase();
                if (!['button', 'span', 'div', 'li'].includes(tagName)) continue;
                
                // 요소의 텍스트가 정확히 일치하고 화면에 크기를 가지고 있는 경우
                if (el.innerText && el.innerText.trim() === txt) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    return true;
                  }
                }
              }
              return false;
            }, targetSizeStr)

            if (!sizeClicked) {
              // 백업 플랜: Playwright로 다시 시도 (보이는 요소 중 가장 나중에 나타난 요소)
              const btns = page.getByText(targetSizeStr, { exact: true })
              const count = await btns.count()
              for(let i=count-1; i>=0; i--){
                 const b = btns.nth(i);
                 if (await b.isVisible()) {
                    await b.scrollIntoViewIfNeeded({ timeout: 200 }).catch(()=>{})
                    await b.click({ force: true, timeout: 500 }).catch(()=>{})
                    sizeClicked = true;
                    break;
                 }
              }
            }
            console.log(`[RPA] 사이즈(${targetSizeStr}) 선택 성공`)
            await page.waitForTimeout(300)
          } catch(err) {}
        }
        
        // 2. 팝업에 없거나 클릭 실패 시 즉시 '기타' 클릭
        if (!sizeClicked) {
          try {
            console.log(`[RPA] 사이즈(${targetSizeStr})가 없어서 기타로 넘어갑니다.`)
            const etcBtn = page.getByText('기타 (상품설명에 작성)').last()
            await etcBtn.scrollIntoViewIfNeeded({ timeout: 200 }).catch(() => {})
            await etcBtn.click({ force: true, timeout: 200 })
          } catch(err) {}
        }

        // 3. '완료' 버튼 클릭
        const completeBtn = page.getByRole('button', { name: '완료' }).last()
        await completeBtn.scrollIntoViewIfNeeded({ timeout: 200 }).catch(() => {})
        await completeBtn.click({ force: true, timeout: 200 })
        await page.waitForTimeout(100)
      }
    } catch (e) {
      console.log('[RPA] 사이즈 선택 중 에러 발생 (무시하고 진행):', e)
    } finally {
      // 사이즈 팝업이 혹시 안 닫혔을 경우를 대비해 허공 클릭 및 ESC 키를 날려 강제로 닫음
      await page.keyboard.press('Escape').catch(() => {})
      await page.mouse.click(0, 0).catch(() => {})
      await page.waitForTimeout(300)
    }

    // 교환가능/교환불가 옵션 (없을 경우 30초 무한 대기 방지를 위해 타임아웃 500ms 강제 설정)
    await page.getByText(productData.isExchangeable ? '교환가능' : '교환불가', { exact: true }).last().click({ timeout: 500 }).catch(() => {})

    // 5. 가격 입력
    console.log('[RPA] 가격 기입 중...')
    await page.getByPlaceholder('가격을 입력해 주세요').fill(productData.price.toString())

    // 6. 상품 설명 입력
    console.log('[RPA] 상품 설명 기입 중...')
    try {
      // textarea 요소를 찾아서 최우선으로 입력 시도
      const descBox = page.locator('textarea').first()
      await descBox.scrollIntoViewIfNeeded().catch(() => {})
      // 클릭 없이 직접 value 주입 (Playwright fill)
      await descBox.fill(productData.description)
    } catch (err) {
      console.log('[RPA] textarea fill 실패, 대체 방법 시도:', err)
      try {
        // 혹시 contenteditable div로 되어있다면
        const contentEditable = page.locator('[contenteditable="true"]').first()
        await contentEditable.click({ force: true })
        await page.waitForTimeout(100)
        await page.keyboard.insertText(productData.description)
      } catch (err2) {
        console.log('[RPA] 상품 설명 대체 기입 에러:', err2)
      }
    }

    // 7. 배송비 포함 및 가격 제안 받기 (기본 디폴트값 유지)
    // await page.getByText('배송비 포함', { exact: true }).first().click().catch(() => {})
    // await page.getByText('가격 제안받기', { exact: true }).first().click().catch(() => {})

    // 7.5 해시태그 입력 (시트 Q열)
    if (productData.hashtags) {
      console.log('[RPA] 태그 기입 중...')
      try {
        const tagInput = page.locator('input[placeholder*="태그를 입력해 주세요"]')
        if (await tagInput.count() > 0) {
          await tagInput.first().scrollIntoViewIfNeeded().catch(() => {})
          
          // 사장님 요청: # 기호 떼고 한글만 넣고 엔터 치는 과정을 한 개씩 반복 (최대 5개)
          const tags = productData.hashtags
            .split(/\s+/) // 공백 기준으로 분리
            .map(t => t.replace(/#/g, '').trim()) // '#' 기호 제거 및 앞뒤 공백 제거
            .filter(t => t.length > 0) // 빈 문자열 제거
            .slice(0, 5) // 번개장터 태그는 최대 5개까지만

          for (const tag of tags) {
            await tagInput.first().fill(tag)
            await page.waitForTimeout(300) // 번개장터 자동완성 UI 반응 대기
            await tagInput.first().press('Enter') // 엔터를 쳐서 칩(Chip) 형태로 등록
            await page.waitForTimeout(200) // 등록 애니메이션 대기
          }
        }
      } catch (err) {
        console.log('[RPA] 태그 기입 에러 (무시하고 진행):', err)
      }
    }

    // 혹시 열려있는 드롭다운(해시태그 자동완성 등)이나 백드롭이 등록하기 버튼을 가리는 현상을 방지
    await page.mouse.click(0, 0).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)

    // 8. 등록하기 버튼 클릭
    console.log('[RPA] 최종 폼 제출 (등록하기)...')
    // 실제 버튼명이 다를 수 있으나, 보통 "등록하기" 입니다.
    const submitBtn = page.locator('button', { hasText: '등록하기' })
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {})
    await submitBtn.click({ force: true })

    // 9. 완료 페이지(상품 상세 페이지)로 완전히 넘어갈 때까지 대기
    // 단순히 네비게이션 1회를 기다리면 중간 로딩 페이지에서 멈출 수 있으므로, URL 패턴을 확인합니다.
    console.log('[RPA] 상품 등록 처리 대기 중 (최대 30초)...')
    let pid = ''
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(500)
      const currentUrl = page.url()
      const pidMatch = currentUrl.match(/\/products\/(\d+)/)
      
      // /products/new 가 아닌 실제 숫자 ID가 부여된 URL을 감지
      if (pidMatch && pidMatch[1] && pidMatch[1] !== 'new') {
        pid = pidMatch[1]
        break
      }
    }

    if (!pid) {
      console.log('[RPA] 지정된 시간 내에 PID를 추출하지 못했습니다. (네트워크 지연 또는 필수 항목 누락으로 인한 업로드 실패 가능성)')
      throw new Error('상품 등록 실패 (필수 항목 누락 또는 번개장터 서버 지연)')
    } else {
      console.log(`[RPA] ⚡ ${productData.title} 업로드 성공! PID: ${pid}`)
    }
    
    return pid
  } catch (error) {
    console.error(`[RPA] 업로드 중 에러 발생:`, error)
    throw error // 에러를 삼키지 않고 Main 프로세스로 던져서 실패 창을 띄웁니다.
  } finally {
    console.log('[RPA] 단일 상품 프로세스 완료.')
    // 완료 후 브라우저 닫지 않음 (사용자 크롬 창이므로)
  }
}
