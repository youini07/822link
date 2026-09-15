// @ts-nocheck
/**
 * [marketJoongnaUploader.ts]
 * 중고나라(web.joongna.com) 상품 업로드 자동화 모듈 (Full Automation)
 *
 * 업로드 흐름:
 * 1. 상품 등록 페이지 이동
 * 2. 이미지 첨부 → AI 카테고리/제목 자동완성 대기
 * 3. 상품명 입력 (AI가 이미 채워준 경우도 덮어씀)
 * 4. 가격 입력
 * 5. 상품설명 입력
 * 6. 상품상태: Q열이 '새상품'이면 새상품 선택, 그 외 기본값(중고) 유지
 * 7. 직거래 체크 해제 (만나서 직거래가 체크되어 있으면 해제)
 * 8. 판매하기 버튼 클릭 → 상품 URL 파싱해서 반환
 */
import { chromium } from 'playwright';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
const JOONGNA_UPLOAD_URL = 'https://web.joongna.com/product/form?type=regist';
let activeJoongnaPage = null;
async function connectJoognaBrowser() {
    try {
        return await chromium.connectOverCDP('http://localhost:9222');
    }
    catch {
        console.log('[Joongna RPA] 디버깅 크롬이 없어 자동 실행합니다...');
        const userDataDir = path.join(os.homedir(), 'bunjang_chrome_profile');
        const cmd = `start chrome --remote-debugging-port=9222 --user-data-dir="${userDataDir}" "https://web.joongna.com"`;
        exec(cmd, (error) => {
            if (error)
                console.error('[Joongna Chrome Launch Error]', error);
        });
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const browser = await chromium.connectOverCDP('http://localhost:9222');
                console.log('[Joongna RPA] 디버깅 크롬 연결 성공!');
                return browser;
            }
            catch { /* 재시도 */ }
        }
        throw new Error('디버깅 크롬(포트 9222) 자동 실행에 실패했습니다.');
    }
}
export async function cancelActiveJoongnaUpload() {
    if (activeJoongnaPage) {
        console.log('[Joongna] 작업 강제 중단! 현재 탭을 닫습니다.');
        try {
            await activeJoongnaPage.close();
        }
        catch { }
        activeJoongnaPage = null;
    }
}
export async function checkJoongnaSession() {
    let browser;
    try {
        browser = await connectJoognaBrowser();
        const contexts = browser.contexts();
        const context = contexts[0];
        if (context) {
            const pages = context.pages();
            let targetPage = pages.find((p) => p.url().includes('joongna.com'));
            if (!targetPage) {
                targetPage = pages.length > 0 ? pages[0] : await context.newPage();
            }
            await targetPage.goto('https://web.joongna.com/');
            await targetPage.bringToFront();
        }
    }
    catch (error) {
        console.error('[Joongna] 세션 체크 오류:', error);
        throw error;
    }
    finally {
        if (browser)
            await browser.disconnect();
    }
}
export async function bumpJoongnaProduct(pid, injectedBrowser) {
    let browser = injectedBrowser;
    let page = null;
    let isNewSession = false;
    try {
        if (!browser) {
            browser = await connectJoognaBrowser();
            isNewSession = true;
        }
        const contexts = browser.contexts();
        const context = contexts[0];
        page = await context.newPage();
        // 1. 상품 상세 페이지 접속
        const productUrl = `https://web.joongna.com/product/${pid}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        // 2. '위로 올리기' 텍스트 클릭 (하단 툴바 등에 위치, button이 아닐 수 있음)
        const bumpText = page.getByText('위로 올리기', { exact: true }).first();
        if (await bumpText.count() === 0) {
            return { success: false, error: '위로 올리기 버튼을 찾을 수 없습니다.' };
        }
        await bumpText.click();
        await page.waitForTimeout(1500);
        // 3. 우측 슬라이드(드로어) 내의 최종 '위로 올리기' 버튼 클릭
        // 페이지 내의 모든 '위로 올리기' 텍스트/버튼 중 가장 마지막에 있는 것(드로어 하단 검은색 버튼)을 클릭합니다.
        const modalBumpButton = page.locator('button:has-text("위로 올리기"), div[role="button"]:has-text("위로 올리기")').last();
        if (await modalBumpButton.count() > 0) {
            await modalBumpButton.click({ force: true });
            await page.waitForTimeout(1500);
        }
        else {
            // 혹시 button 태그가 아니라면 텍스트 기반으로 마지막 요소를 클릭
            const fallbackBtn = page.getByText('위로 올리기', { exact: true }).last();
            if (await fallbackBtn.count() > 0) {
                await fallbackBtn.click({ force: true });
                await page.waitForTimeout(1500);
            }
        }
        // 클릭 후 토스트 메시지나 알림창에서 한도 초과 메시지 확인
        const toastLocator = page.locator('.Toastify__toast-body, div[role="alert"], div:text-matches("초과|종료|불가", "i")').first();
        if (await toastLocator.count() > 0) {
            const text = await toastLocator.textContent();
            if (text && (text.includes('초과') || text.includes('불가') || text.includes('종료') || text.includes('최대 20번'))) {
                return { success: false, limitReached: true, error: text };
            }
        }
        return { success: true };
    }
    catch (error) {
        console.error(`[Joongna Bump Error] ${pid}:`, error);
        return { success: false, error: error.message };
    }
    finally {
        if (page)
            await page.close().catch(() => { });
        if (isNewSession && browser)
            await browser.disconnect().catch(() => { });
    }
}
/**
 * 중고나라에 상품을 완전 자동 업로드합니다.
 *
 * @returns 등록된 상품 URL (예: https://web.joongna.com/product/12345678)
 *          파싱 실패 시 빈 문자열
 */
export async function uploadToJoongna(productData, injectedBrowser) {
    console.log(`[Joongna RPA] "${productData.title}" 중고나라 업로드 시작...`);
    let browser = injectedBrowser;
    try {
        if (!browser)
            browser = await connectJoognaBrowser();
    }
    catch (err) {
        throw new Error('디버깅 크롬(포트 9222)에 연결할 수 없습니다.');
    }
    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
    // 탭 간섭 방지를 위해 무조건 새 탭 생성
    const page = await context.newPage();
    activeJoongnaPage = page;
    await page.goto(JOONGNA_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[Joongna RPA] 상품 등록 페이지 로드 대기 중 (자동 로그인 감지)...');
    let isLoginPage = false;
    try {
        // 리다이렉트 지연을 고려해 '이미지 첨부' 요소와 '네이버로 시작하기' 요소를 동시에 기다립니다.
        const loginBtnPromise = page.waitForSelector('text="네이버로 시작하기"', { state: 'visible', timeout: 15000 }).then(() => 'login');
        const fileInputPromise = page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 }).then(() => 'form');
        const result = await Promise.race([loginBtnPromise, fileInputPromise]);
        if (result === 'login') {
            isLoginPage = true;
        }
    }
    catch (e) {
        console.log('[Joongna RPA] 페이지 상태 감지 타임아웃, 기본 로직 진행');
    }
    if (isLoginPage || page.url().includes('/signin') || page.url().includes('/login')) {
        console.log('[Joongna RPA] 로그인 페이지 감지 → 네이버로 시작하기 자동 클릭');
        try {
            const naverBtn = page.getByText('네이버로 시작하기', { exact: true }).first();
            // 이미 화면에 있다는 걸 Promise.race에서 확인했으므로 바로 클릭 시도
            await naverBtn.click({ timeout: 5000 });
            console.log('[Joongna RPA] 네이버 로그인 처리 중, 상품 등록 페이지 복귀 대기...');
            await page.waitForURL(/joongna\.com\/product\/form/, { timeout: 20000 });
            console.log('[Joongna RPA] 로그인 완료! 상품 등록 페이지로 복귀했습니다.');
            await page.waitForTimeout(1000); // 페이지 안정화 대기
        }
        catch (e) {
            throw new Error('중고나라 자동 로그인 실패. 세션체크 버튼으로 직접 로그인 후 다시 시도해주세요.');
        }
    }
    try {
        // ===== 1단계: 이미지 첨부 =====
        console.log('[Joongna RPA] 이미지 첨부 시작...');
        const fileInput = await page.waitForSelector('input[type="file"]', {
            state: 'attached',
            timeout: 15000
        });
        const imagesToUpload = productData.imagePaths.slice(0, 10);
        await fileInput.setInputFiles(imagesToUpload);
        console.log(`[Joongna RPA] 이미지 ${imagesToUpload.length}장 첨부`);
        // 이미지 업로드 + AI 분석 대기
        const imgCount = imagesToUpload.length;
        const maxImgWait = imgCount * 3000 + 8000;
        try {
            await page.waitForFunction((count) => {
                if (document.body.innerText.includes(`${count}/10`))
                    return true;
                const imgs = document.querySelectorAll('[class*="preview"] img, [class*="thumb"] img, [class*="ImageWrap"] img');
                return imgs.length >= count;
            }, imgCount, { timeout: maxImgWait });
            console.log('[Joongna RPA] 이미지 업로드 UI 반영 확인!');
        }
        catch {
            console.log('[Joongna RPA] 이미지 업로드 감지 실패, 강제 진행');
        }
        // AI 분석 완료 대기 (카테고리 자동선택, 제목 자동완성)
        await page.waitForTimeout(4000);
        console.log('[Joongna RPA] AI 분석 대기 완료');
        // ===== 2단계: 상품명 입력 =====
        // AI가 채워준 값이 있어도 우리 데이터로 덮어씁니다
        console.log('[Joongna RPA] 상품명 입력...');
        try {
            // 상품명 input: placeholder "상품명을 입력해주세요" 또는 일반 text input
            const titleInput = page.locator('input[placeholder*="상품명"]').first();
            await titleInput.waitFor({ state: 'visible', timeout: 8000 });
            await titleInput.click({ clickCount: 3 }); // 기존 내용 전체 선택
            await titleInput.fill(productData.title);
            console.log(`[Joongna RPA] 상품명 입력 완료: ${productData.title}`);
        }
        catch (e) {
            console.warn('[Joongna RPA] 상품명 입력 실패 (무시하고 진행):', e);
        }
        // ===== 3단계: 판매가격 입력 =====
        console.log('[Joongna RPA] 판매가격 입력...');
        try {
            // 판매가격 input: placeholder "판매가격" 또는 type="number"
            const priceInput = page.locator('input[placeholder*="판매가격"], input[placeholder*="가격"]').first();
            await priceInput.waitFor({ state: 'visible', timeout: 8000 });
            await priceInput.click({ clickCount: 3 });
            await priceInput.fill(String(productData.price));
            console.log(`[Joongna RPA] 판매가격 입력 완료: ${productData.price}`);
            await page.waitForTimeout(500);
        }
        catch (e) {
            console.warn('[Joongna RPA] 판매가격 입력 실패 (무시하고 진행):', e);
        }
        // ===== 4단계: 상품설명 입력 =====
        console.log('[Joongna RPA] 상품설명 입력...');
        try {
            // --- Step 4-1: AI 자동생성 설명 칩 제거 ---
            // 중고나라는 이미지 분석 후 초록색 텍스트 + 우측 X 버튼으로 AI 설명을 표시합니다.
            // X 버튼은 일반 button이 아닌 SVG/div 클릭 영역일 수 있으므로
            // dispatchEvent(MouseEvent)로 강제 클릭합니다.
            console.log('[Joongna RPA] AI 설명 칩 제거 시도...');
            try {
                const removeClicked = await page.evaluate(() => {
                    // textarea를 찾고, 그 textarea를 감싸는 컨테이너를 탐색
                    const textareas = document.querySelectorAll('textarea');
                    for (const ta of Array.from(textareas)) {
                        // textarea placeholder로 설명 영역 확인
                        const ph = ta.placeholder || '';
                        if (!ph.includes('설명') && !ph.includes('내용') && !ph.includes('상품'))
                            continue;
                        // textarea의 부모/조상 컨테이너에서 X 버튼 찾기
                        let container = ta.parentElement;
                        for (let i = 0; i < 5; i++) {
                            if (!container)
                                break;
                            // 컨테이너 안의 모든 클릭 가능한 요소 탐색
                            const clickables = container.querySelectorAll('button, [role="button"], svg, [class*="close"], [class*="remove"], [class*="delete"], [class*="clear"], [class*="dismiss"]');
                            for (const el of Array.from(clickables)) {
                                const rect = el.getBoundingClientRect();
                                // 20~50px 사이의 작은 버튼이면 X 버튼으로 간주
                                if (rect.width > 0 && rect.width <= 50 && rect.height <= 50) {
                                    ;
                                    el.click();
                                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                    return `found: ${el.tagName}.${el.className.split(' ')[0]}`;
                                }
                            }
                            container = container.parentElement;
                        }
                    }
                    // 2차 시도: "상품설명" 레이블 근처의 X 버튼
                    const allElements = document.querySelectorAll('*');
                    for (const el of Array.from(allElements)) {
                        if (el.textContent?.trim() !== '상품설명')
                            continue;
                        let parent = el.parentElement;
                        for (let i = 0; i < 6; i++) {
                            if (!parent)
                                break;
                            const btns = parent.querySelectorAll('button, svg, [role="button"]');
                            for (const btn of Array.from(btns)) {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 0 && rect.width <= 40) {
                                    ;
                                    btn.click();
                                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                    return `found near label: ${btn.tagName}.${btn.className}`;
                                }
                            }
                            parent = parent.parentElement;
                        }
                    }
                    return null;
                });
                if (removeClicked) {
                    console.log(`[Joongna RPA] AI 설명 칩 제거 완료: ${removeClicked}`);
                    await page.waitForTimeout(800);
                }
                else {
                    console.log('[Joongna RPA] AI 설명 칩 없음 (이미 비어있거나 AI가 생성 안함)');
                }
            }
            catch (e) {
                console.warn('[Joongna RPA] AI 설명 칩 제거 실패 (무시하고 진행):', e);
            }
            // --- Step 4-2: 상품설명 textarea에 우리 설명 입력 ---
            const descLocator = page.locator('textarea[placeholder*="설명"], textarea[placeholder*="내용"], textarea[placeholder*="상품"]').first();
            await descLocator.waitFor({ state: 'visible', timeout: 8000 });
            // Ctrl+A → Delete로 완전 초기화 후 입력
            await descLocator.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
            await page.waitForTimeout(300);
            await descLocator.fill(productData.description);
            console.log('[Joongna RPA] 상품설명 입력 완료');
            await page.waitForTimeout(500);
        }
        catch (e) {
            console.warn('[Joongna RPA] 상품설명 입력 실패 (무시하고 진행):', e);
        }
        // ===== 5단계: 상품상태 선택 =====
        // Q열 값이 '새상품'인 경우에만 새상품 라디오를 클릭, 그 외 기본값(중고) 유지
        const isNew = productData.condition.replace(/\s+/g, '').includes('새상품');
        if (isNew) {
            console.log('[Joongna RPA] 상품상태: 새상품 선택...');
            try {
                const newItemRadio = page.getByText('새상품', { exact: true }).first();
                await newItemRadio.waitFor({ state: 'visible', timeout: 5000 });
                await newItemRadio.click();
                console.log('[Joongna RPA] 새상품 선택 완료');
                await page.waitForTimeout(300);
            }
            catch (e) {
                console.warn('[Joongna RPA] 새상품 라디오 클릭 실패:', e);
            }
        }
        else {
            console.log('[Joongna RPA] 상품상태: 기본값(중고) 유지');
        }
        // ===== 6단계: 직거래 체크 해제 =====
        // "만나서 직거래" 체크박스가 체크되어 있으면 해제합니다.
        console.log('[Joongna RPA] 직거래 체크 확인 및 해제...');
        try {
            // "만나서 직거래" 텍스트 근처의 체크박스를 찾아 체크 상태 확인 후 해제
            const directTradeLabel = page.getByText('만나서 직거래', { exact: true }).first();
            await directTradeLabel.waitFor({ state: 'visible', timeout: 8000 });
            // 체크박스: 라벨 클릭으로 체크/해제. 현재 체크 상태인지 확인
            // input[type="checkbox"]를 찾거나, 체크된 상태(아이콘)를 확인
            const isChecked = await page.evaluate(() => {
                // "만나서 직거래" 텍스트를 포함한 요소 주변에서 체크박스 찾기
                const labels = Array.from(document.querySelectorAll('label, [class*="checkbox"], [class*="CheckBox"]'));
                for (const el of labels) {
                    if (el.textContent?.includes('만나서 직거래')) {
                        // 체크 상태 확인: 아리아 또는 체크박스 input
                        const checkbox = el.querySelector('input[type="checkbox"]');
                        if (checkbox)
                            return checkbox.checked;
                        // 또는 aria-checked 속성
                        return el.getAttribute('aria-checked') === 'true' ||
                            el.classList.contains('checked') ||
                            el.classList.contains('active');
                    }
                }
                return false;
            });
            if (isChecked) {
                // 체크된 상태이면 클릭해서 해제
                await directTradeLabel.click();
                await page.waitForTimeout(500);
                console.log('[Joongna RPA] 만나서 직거래 체크 해제 완료');
            }
            else {
                console.log('[Joongna RPA] 만나서 직거래 이미 해제 상태');
            }
        }
        catch (e) {
            console.warn('[Joongna RPA] 직거래 체크 해제 실패 (무시하고 진행):', e);
        }
        await page.waitForTimeout(1000);
        // ===== 7단계: 판매하기 버튼 클릭 =====
        console.log('[Joongna RPA] 판매하기 버튼 클릭...');
        let productId = '';
        try {
            const submitBtn = page.getByRole('button', { name: /판매하기/ }).last();
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            await submitBtn.click();
            console.log('[Joongna RPA] 판매하기 클릭 완료, 결과 대기 중...');
            // 등록 완료 후 상품 상세 페이지로 이동 (3초 후 자동 이동)
            // URL 패턴: https://web.joongna.com/product/231927316
            await page.waitForURL(/joongna\.com\/product\/\d+/, { timeout: 30000 });
            const finalUrl = page.url();
            // URL 마지막 숫자 부분을 상품 ID로 추출
            const idMatch = finalUrl.match(/\/product\/(\d+)/);
            productId = idMatch ? idMatch[1] : '';
            console.log(`[Joongna RPA] 업로드 완료! 상품 ID: ${productId} (URL: ${finalUrl})`);
        }
        catch (e) {
            console.warn('[Joongna RPA] 판매하기 완료 확인 실패:', e);
        }
        activeJoongnaPage = null;
        await page.close().catch(() => { });
        // 상품 ID를 반환 (marketHandlers.ts에서 AH열에 저장)
        return productId;
    }
    catch (err) {
        activeJoongnaPage = null;
        if (page)
            await page.close().catch(() => { });
        throw err;
    }
}
/**
 * 중고나라 상품을 삭제합니다.
 * 상품 상세 페이지(https://web.joongna.com/product/{pid})로 이동 후 하단 '삭제' 버튼 클릭 -> '확인' 클릭
 */
export async function deleteFromJoongna(pid, injectedBrowser) {
    if (!pid)
        return '';
    const rawPid = pid.replace(/^d+/, '');
    console.log(`[Joongna RPA] 🗑️ 중고나라 상품 삭제 가동 (PID: ${rawPid})...`);
    let browser = injectedBrowser;
    try {
        if (!browser) {
            browser = await connectJoognaBrowser();
        }
    }
    catch (err) {
        throw new Error('디버깅 크롬(포트 9222)에 연결할 수 없습니다.');
    }
    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
    // 삭제 시에도 새 탭을 열어서 간섭 방지
    const page = await context.newPage();
    // 삭제할 상품 페이지로 직접 이동
    const productUrl = `https://web.joongna.com/product/${rawPid}`;
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`[Joongna RPA] 상품 상세 페이지 진입: ${productUrl}`);
    // 이미 삭제된 상품인지 확인 (예: 판매완료/삭제된 상품입니다 안내)
    try {
        const errorText = await page.getByText('존재하지 않는 상품입니다').isVisible({ timeout: 3000 });
        if (errorText) {
            console.log(`[Joongna RPA] 이미 삭제되었거나 존재하지 않는 상품입니다: ${rawPid}`);
            return rawPid;
        }
    }
    catch { }
    try {
        // 하단 '삭제' 버튼 탐색 및 클릭
        console.log('[Joongna RPA] 삭제 버튼 찾는 중...');
        // SVG 아이콘 아래 "삭제" 텍스트가 있는 버튼
        const deleteBtn = page.getByRole('button', { name: '삭제' }).last();
        await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
        await deleteBtn.click();
        console.log('[Joongna RPA] 삭제 버튼 클릭됨, 확인 팝업 대기...');
        // 팝업에서 "확인" 버튼 클릭
        const confirmBtn = page.getByRole('button', { name: '확인' }).last();
        await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
        await confirmBtn.click();
        console.log('[Joongna RPA] 확인 버튼 클릭 완료, 삭제 처리 대기...');
        // 삭제 처리 완료 후 메인/스토어로 이동되는지 확인
        await page.waitForTimeout(3000);
        console.log(`[Joongna RPA] 상품 삭제 성공: ${rawPid}`);
        await page.close().catch(() => { });
        return rawPid;
    }
    catch (e) {
        await page.close().catch(() => { });
        console.warn(`[Joongna RPA] 상품 삭제 실패 (${rawPid}):`, e.message);
        throw new Error('삭제 버튼을 찾지 못했거나 이미 삭제된 상품일 수 있습니다.');
    }
}
