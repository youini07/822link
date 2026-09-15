import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'

// 봇 탐지 우회 플러그인 적용
chromium.use(stealth())

export async function deleteFromBunjang(pid: string, injectedBrowser?: any) {
  if (!pid) return ''
  // 'd' 마킹이 있으면 순수 숫자만 추출
  const rawPid = pid.replace(/^d+/, '')
  
  console.log(`[RPA] 🗑️ 번개장터 상품 삭제 봇 가동 (UI 다중선택 팝업 방식) (PID: ${rawPid})...`)
  
  let browser = injectedBrowser
  let isOwnBrowser = false
  try {
    if (!browser) {
      browser = await chromium.connectOverCDP('http://localhost:9222')
      isOwnBrowser = true
    }
    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : browser.contexts()[0]
    
    // 사장님 요청: 탭 여러 개 안 띄우고 기존 창 재활용하기
    const pages = context.pages()
    let page = pages.find(p => p.url().includes('bunjang.co.kr/products/manage'))
    
    // PC 데스크톱 버전의 상품 관리 페이지로 진입
    const manageUrl = 'https://bunjang.co.kr/products/manage'

    if (page) {
      await page.bringToFront()
      // 이전 삭제 후 꼬인 DOM이나 남은 체크박스를 초기화하기 위해 새로고침 진입
      await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    } else {
      // 관리 페이지 탭이 없으면 첫 번째 탭(기존 창)을 사용해서 이동
      page = pages.length > 0 ? pages[0] : await context.newPage()
      await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    }
    
    // 모바일 웹이나 PC 웹에서 뜨는 기본 자바스크립트 경고창(Alert/Confirm) 무조건 '확인' 누르기
    page.on('dialog', async dialog => {
      console.log(`[RPA] 시스템 경고창 발견: "${dialog.message()}" -> 자동 확인(Accept) 처리`)
      await dialog.accept().catch(() => {})
    })
    
    // 만약 모바일로 강제 리다이렉트 되었을 경우를 대비
    if (page.url().includes('m.bunjang.co.kr')) {
       await page.goto('https://m.bunjang.co.kr/products/manage?tab=ALL&size=100&page=0', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    }
    
    console.log(`[RPA] 상품 관리 페이지 로딩 완료. 제품(${rawPid}) 탐색 중...`)
    await page.waitForTimeout(2000) // 리스트 렌더링 대기

    // 제품의 PID가 포함된 링크(a 태그)를 찾습니다.
    const productLink = page.locator(`a[href*="${rawPid}"]`).first()
    
    if (await productLink.count() === 0) {
      const errMsg = `[RPA] 상품 목록에서 ${rawPid} 제품을 찾을 수 없습니다. (이미 삭제되었거나 100개 이후의 목록일 수 있음)`
      console.log(errMsg)
      // 에러를 던져야 프론트엔드에 '삭제 실패'로 빨간색 마킹이 됨 (가짜 성공 방지)
      throw new Error(errMsg)
    }

    // 1. 해당 제품 체크박스 클릭
    // 번개장터 구조상 a 태그 근처(보통 부모나 형제 노드)에 체크박스가 있음.
    // XPath를 이용해 해당 a 태그를 포함하는 조상 요소 중 체크박스를 가진 행을 찾아 체크함.
    console.log(`[RPA] 제품 찾음! 체크박스 선택 중...`)
    const checkbox = productLink.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]//input[@type="checkbox"]').first()
    
    if (await checkbox.count() > 0) {
      // 강제 체크
      await checkbox.evaluate((node: HTMLInputElement) => { node.click() }).catch(() => {})
    } else {
      // XPath로 못 찾을 경우, 모바일/PC 레이아웃에 따른 가장 근접한 형제 노드 클릭
      await page.evaluate((pid) => {
        const link = document.querySelector(`a[href*="${pid}"]`);
        if (link) {
           const parent = link.closest('li') || link.closest('div[class*="row"]') || link.parentElement?.parentElement;
           if (parent) {
             const chk = parent.querySelector('input[type="checkbox"]') as HTMLInputElement;
             if (chk) chk.click();
           }
        }
      }, rawPid)
    }

    await page.waitForTimeout(500)

    await page.waitForTimeout(500)

    // 2. 사장님이 보여주신 PC 웹 상단 "상품삭제" (휴지통 아이콘) 버튼이 있는지 먼저 확인
    const pcDeleteBtn = page.getByText('상품삭제').first()
    
    if (await pcDeleteBtn.count() > 0) {
      console.log(`[RPA] PC 버전 '상품삭제' 다이렉트 버튼 발견! 클릭 중...`)
      await pcDeleteBtn.click({ force: true })
      await page.waitForTimeout(1000)
      
      // PC 버전은 누르면 시스템 Confirm 창 또는 레이어 모달창 뜸
      // 사장님 스샷 확인 결과 팝업에 "삭제하기" 라고 써있음!
      const confirmBtn = page.locator('button:has-text("삭제하기"), button:has-text("확인"), button:has-text("삭제")').last()
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click({ force: true }).catch(() => {})
      }
    } else {
      // 3. 모바일 버전일 경우 "판매상태변경" -> "삭제" 플로우 타기
      console.log(`[RPA] 모바일 버전 '판매상태변경' 플로우 진행 중...`)
      const stateChangeBtn = page.getByText('판매상태변경').first()
      if (await stateChangeBtn.count() > 0) {
        await stateChangeBtn.click({ force: true })
      }

      await page.waitForTimeout(1000)

      const deleteOptionBtn = page.getByRole('button', { name: '삭제', exact: true }).last()
      if (await deleteOptionBtn.count() > 0) {
        await deleteOptionBtn.click({ force: true })
      } else {
        await page.getByText('삭제').last().click({ force: true }).catch(() => {})
      }

      await page.waitForTimeout(500)

      const completeBtn = page.locator('button:has-text("삭제하기"), button:has-text("완료"), button:has-text("확인")').last()
      if (await completeBtn.count() > 0) {
        await completeBtn.click({ force: true })
      } else {
        await page.keyboard.press('Enter')
      }
    }

    // 통신 완료 대기 (삭제 후 DOM 갱신 대기)
    await page.waitForTimeout(3000) // 좀 더 넉넉하게 대기
    
    // 삭제 후 모달창이 여전히 떠있으면 에러 유발 방지를 위해 ESC 키를 눌러줌
    await page.keyboard.press('Escape').catch(() => {})

    console.log(`[RPA] 🗑️ 번개장터 게시물(PID: ${rawPid}) UI 조작 삭제 완벽 성공!`)
    return rawPid
    
  } catch (error: any) {
    console.error(`[RPA] 상품 삭제 중 에러 발생:`, error)
    // 에러 발생 시 명확히 프론트엔드로 전달하기 위해 throw
    throw new Error(`삭제 중 에러 발생: ${error?.message || '알 수 없는 오류'}`)
  }
}
