import { Browser } from 'playwright-core'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 번개장터 상품 수정 페이지에 접속하여 가격만 업데이트하는 자동화 봇
 */
export async function updateBunjangPrice(
  pid: string,
  newPrice: string,
  injectedBrowser?: Browser
): Promise<string> {
  const isInternalBrowser = !injectedBrowser
  let browser: Browser | null = injectedBrowser || null

  try {
    if (!browser) {
      throw new Error('브라우저 인스턴스가 제공되지 않았습니다.')
    }

    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : browser.contexts()[0]
    
    const pages = context.pages()
    const page = pages.length > 0 ? pages[0] : await context.newPage()

    // 1. 번개장터 상품 수정 페이지로 직접 이동 (정확한 주소 적용)
    const editUrl = `https://bunjang.co.kr/products/${pid}/edit`
    console.log(`[RPA] 상품 수정 폼으로 다이렉트 이동: ${editUrl}`)
    
    // 타임아웃을 넉넉히 설정하여 로딩 대기
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    
    // 로그인 체크 로직
    if (page.url().includes('login')) {
      throw new Error('로그인이 풀려있습니다. 로봇 전용 크롬창에서 다시 로그인해 주세요.')
    }

    await delay(3000) // 폼 로딩 대기

    // 2. 가격 입력칸 찾기
    console.log(`[RPA] 기존 가격 지우기 및 새 가격(${newPrice}) 입력 중...`)
    
    // 번개장터의 가격 입력칸은 '가격을 입력해 주세요' 플레이스홀더를 가짐
    const priceInput = page.getByPlaceholder('가격을 입력해 주세요')
    
    // 해당 입력창이 뜰 때까지 대기
    await priceInput.waitFor({ state: 'visible', timeout: 15000 })
    
    // 기존 입력값 지우고 새 가격 입력
    await priceInput.click()
    await priceInput.fill(newPrice.toString())
    
    await delay(1000)

    // 3. 수정완료/변경하기/등록하기/수정하기 버튼 클릭
    console.log(`[RPA] 가격 수정 사항 저장 중...`)
    
    // 텍스트 정규식 매칭을 통해 하단의 제출 버튼을 찾습니다. ('수정하기' 추가)
    const submitBtn = page.getByRole('button', { name: /수정하기|수정완료|변경하기|등록하기/ }).last()
    
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 })

    // 혹시 열려있는 드롭다운이나 백드롭이 버튼을 가리는 현상을 방지
    await page.mouse.click(0, 0).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    await delay(300)

    await submitBtn.click({ force: true })

    // 4. 완료 페이지 (상세 페이지)로 전환되는지 확인
    console.log(`[RPA] 가격 수정 완료, 상세 페이지로 이동 대기 중...`)
    
    // /products/숫자 형식으로 이동하는지 체크 (edit가 빠진 상세 URL)
    let isSuccess = false
    for (let i = 0; i < 30; i++) {
      const currentUrl = page.url()
      // edit 경로를 벗어나 순수 상세 페이지로 이동했다면 성공
      if (currentUrl.includes(`/products/${pid}`) && !currentUrl.includes('/edit/')) {
        isSuccess = true
        break
      }
      await delay(500)
    }

    if (!isSuccess) {
      throw new Error('가격 수정 후 상세 페이지로 전환되지 않았습니다. (서버 지연 또는 필수값 누락)')
    }

    console.log(`[RPA] ⚡ PID [${pid}] 가격 업데이트 완료!`)

    return pid
  } catch (err: any) {
    console.error('[updateBunjangPrice Error]', err)
    throw new Error(err.message || '알 수 없는 이유로 가격 수정에 실패했습니다.')
  }
}
