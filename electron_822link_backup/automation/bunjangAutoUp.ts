import { Browser } from 'playwright-core'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 번개장터 내 상품 관리 페이지에 접속하여 가용한 모든 'UP하기' 버튼을 차례대로 클릭하는 자동화 봇
 */
export async function runAutoUp(
  injectedBrowser?: Browser
): Promise<{ success: number, failed: number }> {
  let browser: Browser | null = injectedBrowser || null

  try {
    if (!browser) {
      throw new Error('브라우저 인스턴스가 제공되지 않았습니다.')
    }

    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : browser.contexts()[0]
    
    const pages = context.pages()
    // 새 탭을 열어 백그라운드 작업을 격리
    const page = await context.newPage()

    let successCount = 0
    let failCount = 0
    let currentPage = 0

    // 페이지네이션(0, 1, 2...)을 돌며 UP 버튼을 누르기 위한 루프
    while (true) {
      console.log(`[RPA] '내 상품 관리' ${currentPage + 1}번째 페이지 로딩 중...`)
      
      const manageUrl = `https://m.bunjang.co.kr/products/manage?tab=ALL&size=100&page=${currentPage}`
      await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000) // 상품 목록 로딩 대기

      // 로그인 체크 (혹시나 풀렸을 경우)
      if (page.url().includes('login')) {
        await page.close()
        throw new Error('로그인이 풀려있습니다. 로봇 전용 창에서 다시 로그인해 주세요.')
      }

      // 페이지에 있는 활성화된 'UP하기' 버튼을 모두 찾음
      const upButtons = page.getByRole('button', { name: /^UP하기$/ })
      const count = await upButtons.count()

      if (count === 0) {
        // 이 페이지에 누를 수 있는 UP 버튼이 없다면 (모두 사용했거나, 상품이 없거나)
        // 다음 페이지가 아예 없는지(상품 목록 자체가 비었는지) 체크
        const items = page.locator('table tr, .product-item, [class*="product"]') 
        // 번개장터 구조에 따라 다를 수 있으나 보통 버튼이 0개면 종료하거나 다음 페이지로 넘어가야 함.
        // 여기서는 안전하게 0개 발견 시 종료
        console.log(`[RPA] ${currentPage + 1}페이지에 누를 수 있는 'UP하기' 버튼이 더 이상 없습니다. 로봇을 종료합니다.`)
        break
      }

      console.log(`[RPA] ${currentPage + 1}페이지에서 누를 수 있는 UP 버튼 ${count}개 발견. 클릭을 시작합니다.`)

      for (let i = 0; i < count; i++) {
        try {
          // 클릭마다 DOM이 변경될 수 있으므로 매번 버튼을 새로 평가해야 하지만, 
          // 같은 페이지 내에서는 로케이터 인덱싱이 보통 유지됨
          const btn = page.getByRole('button', { name: /^UP하기$/ }).nth(i)
          
          await btn.scrollIntoViewIfNeeded()
          await delay(500)
          await btn.click()
          
          await delay(1000) // 클릭 후 팝업 대기
          
          // UP 성공 팝업 닫기 ("UP완료!" 메시지가 있는 팝업의 "확인" 버튼)
          const successConfirmBtn = page.getByRole('button', { name: '확인' })
          if (await successConfirmBtn.count() > 0) {
            await successConfirmBtn.first().click()
            await delay(500)
          }

          // 횟수를 초과했거나 유료 결제 유도 팝업이 떴는지 확인
          const popups = page.getByText(/보유한 UP을 모두 사용|UP 구매|횟수를 초과|사용 가능한 UP이 없습니다/)
          if (await popups.count() > 0) {
            console.log(`[RPA] UP 한도를 모두 소진했거나 제한에 도달했습니다. 더 이상 진행할 수 없습니다.`)
            const closeBtn = page.getByRole('button', { name: /닫기|취소|확인/ })
            if (await closeBtn.count() > 0) {
              await closeBtn.first().click()
            }
            await page.close()
            return { success: successCount, failed: failCount }
          }
          
          successCount++
          
        } catch (e) {
          console.warn(`[RPA] ${i+1}번째 버튼 클릭 중 에러 발생, 건너뜁니다.`, e)
          failCount++
        }
      }

      // 현재 페이지의 버튼을 다 눌렀다면 다음 페이지로 넘어감
      currentPage++
    }

    console.log(`[RPA] 자동 UP 로봇 작업 완료. 총 ${successCount}건 처리.`)
    await page.close()

    return { success: successCount, failed: failCount }
  } catch (err: any) {
    console.error('[runAutoUp Error]', err)
    throw new Error(err.message || '알 수 없는 이유로 자동 UP 실행에 실패했습니다.')
  }
}
