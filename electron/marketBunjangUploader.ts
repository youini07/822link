// @ts-nocheck
/**
 * [marketBunjangUploader.ts]
 * 822-link의 automation/bunjangUploader.ts를 Band Admin용으로 이식한 모듈
 *
 * - playwright-extra 대신 bandadmin에 설치된 playwright를 사용하며,
 *   사용자가 띄워놓은 실제 크롬(디버깅 포트 9222)에 CDP attach 합니다.
 * - 실제 크롬 프로필(로그인 세션)을 그대로 사용하므로 stealth 플러그인이 불필요합니다.
 */
import { chromium } from 'playwright';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
const BUNJANG_UPLOAD_URL = 'https://bunjang.co.kr/products/new';
/**
 * 디버깅 크롬(포트 9222)에 연결을 시도하고,
 * 실행되어 있지 않으면 크롬을 자동으로 띄운 뒤 재연결을 시도합니다.
 */
export async function connectBunjangBrowser() {
    try {
        return await chromium.connectOverCDP('http://localhost:9222');
    }
    catch {
        // 디버깅 크롬이 없으면 자동 실행 (로그인 상태는 bunjang_chrome_profile에 유지됨)
        console.log('[RPA] 디버깅 크롬이 없어 자동 실행합니다...');
        const userDataDir = path.join(os.homedir(), 'bunjang_chrome_profile');
        const cmd = `start chrome --remote-debugging-port=9222 --user-data-dir="${userDataDir}" "https://bunjang.co.kr"`;
        exec(cmd, (error) => {
            if (error)
                console.error('[Chrome Launch Error]', error);
        });
        // 크롬 부팅 + CDP 활성화 대기 (최대 20초)
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const browser = await chromium.connectOverCDP('http://localhost:9222');
                console.log('[RPA] 디버깅 크롬 자동 실행 및 연결 성공!');
                return browser;
            }
            catch { /* 재시도 */ }
        }
        throw new Error('디버깅 크롬(포트 9222) 자동 실행에 실패했습니다. 크롬이 설치되어 있는지 확인해주세요.');
    }
}
let activePage = null;
export async function checkBunjangSession() {
    let browser;
    try {
        browser = await connectBunjangBrowser();
        const contexts = browser.contexts();
        const context = contexts[0];
        if (context) {
            const pages = context.pages();
            // 기존에 열려있는 번개장터 탭이 있으면 재활용, 없으면 첫번째 탭 사용, 그것도 없으면 새 탭 생성
            let targetPage = pages.find((p) => p.url().includes('bunjang.co.kr'));
            if (!targetPage) {
                targetPage = pages.length > 0 ? pages[0] : await context.newPage();
            }
            // 강제로 로그인 폼이 아닌 홈으로 이동하여 이미 로그인되어 있는지 자연스럽게 확인하게 함
            await targetPage.goto('https://bunjang.co.kr/');
            await targetPage.bringToFront();
        }
    }
    catch (error) {
        console.error('[Bunjang] 세션 체크 오류:', error);
        throw error;
    }
    finally {
        if (browser)
            await browser.disconnect();
    }
}
export async function cancelActiveBunjangUpload() {
    if (activePage) {
        console.log('[bunjangUploader] 작업 강제 중단 요청! 현재 탭을 닫습니다.');
        try {
            await activePage.close();
        }
        catch { }
        activePage = null;
    }
}
export async function uploadToBunjang(productData, injectedBrowser) {
    console.log(`[RPA] ${productData.title} 번개장터 업로드 시작...`);
    let browser = injectedBrowser;
    try {
        if (!browser) {
            browser = await connectBunjangBrowser();
        }
        console.log('[RPA] 열려있는 크롬 창에 성공적으로 연결되었습니다.');
    }
    catch (err) {
        throw new Error('디버깅 크롬(포트 9222)에 연결할 수 없습니다. 크롬이 설치되어 있는지 확인해주세요.');
    }
    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
    // 번개장터와 중고나라가 동시에 실행될 때 같은 탭을 쓰지 않도록 무조건 새 탭 생성
    const page = await context.newPage();
    activePage = page;
    await page.goto(BUNJANG_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
        // 1. 이미지 첨부 (멀티 파일 업로드)
        console.log('[RPA] 사진 첨부 중...');
        const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached' });
        if (fileInput) {
            await fileInput.setInputFiles(productData.imagePaths);
        }
        // 1.5 이미지 업로드 UI 반영 대기
        const imgCount = productData.imagePaths.length;
        const maxWaitTime = imgCount * 2500 + 5000;
        console.log(`[RPA] 사진 ${imgCount}장 업로드 대기 중 (최대 ${maxWaitTime / 1000}초)...`);
        try {
            await page.waitForFunction((count) => {
                return document.body.innerText.includes(`(${count}/12)`) || document.body.innerText.includes(`(${count}/10)`);
            }, imgCount, { timeout: maxWaitTime });
            console.log('[RPA] 사진 업로드 UI 반영 완료 확인!');
        }
        catch {
            console.log('[RPA] 완벽한 사진 업로드 감지 실패. (지정된 대기시간이 만료되어 강제 진행합니다)');
        }
        await page.waitForTimeout(1000);
        // 2. 상품명 입력
        console.log('[RPA] 상품명 기입 중...');
        await page.getByPlaceholder('상품명을 입력해 주세요').fill(productData.title);
        // 3. 카테고리 클릭 (추천 카테고리 무조건 첫 번째 항목 클릭)
        console.log('[RPA] 카테고리 매핑 중...');
        let recommendedClicked = false;
        try {
            const recommendBtn = page.getByText(/[〉>›＞]/).first();
            await recommendBtn.waitFor({ state: 'visible', timeout: 5000 });
            await recommendBtn.click();
            recommendedClicked = true;
            console.log('[RPA] 인공지능 추천 카테고리를 성공적으로 클릭했습니다.');
            await page.waitForTimeout(1000);
        }
        catch (e) {
            console.log('[RPA] 추천 카테고리 자동 클릭 에러:', e);
        }
        if (!recommendedClicked) {
            for (const cat of productData.categories) {
                try {
                    const catLocators = page.getByText(cat, { exact: true });
                    if ((await catLocators.count()) > 1) {
                        await catLocators.last().click({ timeout: 5000 });
                    }
                    else {
                        await catLocators.click({ timeout: 5000 });
                    }
                    await page.waitForTimeout(500);
                }
                catch {
                    console.log(`[RPA] 수동 카테고리(${cat}) 클릭 실패 (무시하고 진행)`);
                }
            }
        }
        // 4. 상태 및 옵션
        console.log('[RPA] 상태/옵션 선택 중...');
        let targetCondition = '사용감 적음';
        if (productData.condition) {
            const raw = productData.condition.replace(/\s+/g, '');
            if (raw.includes('새상품') || raw.includes('미사용'))
                targetCondition = '새 상품 (미사용)';
            else if (raw.includes('사용감없음'))
                targetCondition = '사용감 없음';
            else if (raw.includes('사용감많음') || raw.includes('많음'))
                targetCondition = '사용감 많음';
            else if (raw.includes('고장') || raw.includes('파손'))
                targetCondition = '고장/파손 상품';
            else
                targetCondition = '사용감 적음';
        }
        try {
            const conditionDropdown = page.locator('button, div').filter({ hasText: '상품 상태를 선택' }).last();
            if (await conditionDropdown.isVisible({ timeout: 2000 })) {
                await conditionDropdown.scrollIntoViewIfNeeded().catch(() => { });
                await conditionDropdown.click({ force: true });
                await page.waitForTimeout(500);
            }
        }
        catch (e) {
            console.log('[RPA] 상품 상태 드롭다운 열기 실패 (이미 열려있을 수 있음):', e);
        }
        try {
            const conditionBtn = page.getByText(targetCondition, { exact: true }).last();
            await conditionBtn.click({ timeout: 2000 });
            await page.waitForTimeout(300);
        }
        catch {
            console.log(`[RPA] 상태 버튼(${targetCondition})을 찾지 못해 기본값으로 진행합니다.`);
            await page.mouse.click(0, 0);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
        }
        // 4.5 사이즈 선택 (다이얼로그 팝업 형태 처리)
        try {
            const sizeDropdown = page.getByText('사이즈를 선택해 주세요', { exact: true });
            if (await sizeDropdown.isVisible()) {
                await sizeDropdown.click();
                await page.waitForTimeout(1000);
                const rawSize = productData.size ? productData.size.trim() : '';
                const commonSizes = ['Free', 'FREE', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
                let targetSizeStr = rawSize;
                for (const s of commonSizes) {
                    const regex = new RegExp(`(^|[^a-zA-Z])${s}([^a-zA-Z]|$)`, 'i');
                    if (regex.test(rawSize)) {
                        targetSizeStr = s.toUpperCase() === 'FREE' ? 'Free' : s.toUpperCase();
                        break;
                    }
                }
                let sizeClicked = false;
                if (targetSizeStr) {
                    try {
                        sizeClicked = await page.evaluate((txt) => {
                            const els = Array.from(document.querySelectorAll('button, div, span, li'));
                            for (let i = els.length - 1; i >= 0; i--) {
                                const el = els[i];
                                const tagName = el.tagName.toLowerCase();
                                if (!['button', 'span', 'div', 'li'].includes(tagName))
                                    continue;
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
                        }, targetSizeStr);
                        if (!sizeClicked) {
                            const btns = page.getByText(targetSizeStr, { exact: true });
                            const count = await btns.count();
                            for (let i = count - 1; i >= 0; i--) {
                                const b = btns.nth(i);
                                if (await b.isVisible()) {
                                    await b.scrollIntoViewIfNeeded({ timeout: 200 }).catch(() => { });
                                    await b.click({ force: true, timeout: 500 }).catch(() => { });
                                    sizeClicked = true;
                                    break;
                                }
                            }
                        }
                        console.log(`[RPA] 사이즈(${targetSizeStr}) 선택 성공`);
                        await page.waitForTimeout(300);
                    }
                    catch { }
                }
                if (!sizeClicked) {
                    try {
                        console.log(`[RPA] 사이즈(${targetSizeStr})가 없어 기타로 넘어갑니다.`);
                        const etcBtn = page.getByText('기타 (상품설명에 작성)').last();
                        await etcBtn.scrollIntoViewIfNeeded({ timeout: 200 }).catch(() => { });
                        await etcBtn.click({ force: true, timeout: 200 });
                    }
                    catch { }
                }
                const completeBtn = page.getByRole('button', { name: '완료' }).last();
                await completeBtn.scrollIntoViewIfNeeded({ timeout: 200 }).catch(() => { });
                await completeBtn.click({ force: true, timeout: 200 });
                await page.waitForTimeout(100);
            }
        }
        catch (e) {
            console.log('[RPA] 사이즈 선택 중 에러 발생 (무시하고 진행):', e);
        }
        finally {
            await page.keyboard.press('Escape').catch(() => { });
            await page.mouse.click(0, 0).catch(() => { });
            await page.waitForTimeout(300);
        }
        // 교환가능/교환불가 옵션
        await page.getByText(productData.isExchangeable ? '교환가능' : '교환불가', { exact: true }).last().click({ timeout: 500 }).catch(() => { });
        // 5. 가격 입력
        console.log('[RPA] 가격 기입 중...');
        await page.getByPlaceholder('가격을 입력해 주세요').fill(productData.price.toString());
        // 6. 상품 설명 입력
        console.log('[RPA] 상품 설명 기입 중...');
        try {
            const descBox = page.locator('textarea').first();
            await descBox.scrollIntoViewIfNeeded().catch(() => { });
            await descBox.fill(productData.description);
        }
        catch (err) {
            console.log('[RPA] textarea fill 실패, 대체 방법 시도:', err);
            try {
                const contentEditable = page.locator('[contenteditable="true"]').first();
                await contentEditable.click({ force: true });
                await page.waitForTimeout(100);
                await page.keyboard.insertText(productData.description);
                await page.keyboard.press('Space');
                await page.keyboard.press('Backspace');
            }
            catch (err2) {
                console.log('[RPA] 상품 설명 대체 기입 에러:', err2);
            }
        }
        // 7. 해시태그 입력 (최대 5개)
        if (productData.hashtags) {
            console.log('[RPA] 태그 기입 중...');
            try {
                const tagInput = page.locator('input[placeholder*="태그를 입력해 주세요"]');
                if ((await tagInput.count()) > 0) {
                    await tagInput.first().scrollIntoViewIfNeeded().catch(() => { });
                    const tags = productData.hashtags
                        .split(/\s+/)
                        .map(t => t.replace(/#/g, '').trim())
                        .filter(t => t.length > 0)
                        .slice(0, 5);
                    for (const tag of tags) {
                        await tagInput.first().fill(tag);
                        await page.waitForTimeout(300);
                        await tagInput.first().press('Enter');
                        await page.waitForTimeout(200);
                    }
                }
            }
            catch (err) {
                console.log('[RPA] 태그 기입 에러 (무시하고 진행):', err);
            }
        }
        // 드롭다운/백드롭 정리
        await page.mouse.click(0, 0).catch(() => { });
        await page.keyboard.press('Escape').catch(() => { });
        await page.waitForTimeout(300);
        // 8. 등록하기 버튼 클릭
        console.log('[RPA] 최종 폼 제출 (등록하기)...');
        const submitBtn = page.locator('button').filter({ hasText: /^등록하기$/ }).last();
        await submitBtn.scrollIntoViewIfNeeded().catch(() => { });
        try {
            // 1순위: DOM API를 이용한 직접 클릭 (상단 배너 겹침 등 무시)
            await submitBtn.evaluate((btn) => btn.click());
        }
        catch {
            // 2순위: Playwright 강제 클릭
            await submitBtn.click({ force: true });
        }
        // 9. 완료 페이지(PID) 감지
        console.log('[RPA] 상품 등록 처리 대기 중 (최대 30초)...');
        let pid = '';
        for (let i = 0; i < 60; i++) {
            await page.waitForTimeout(500);
            const currentUrl = page.url();
            const pidMatch = currentUrl.match(/\/products\/(\d+)/);
            if (pidMatch && pidMatch[1] && pidMatch[1] !== 'new') {
                pid = pidMatch[1];
                break;
            }
        }
        if (!pid) {
            console.log('[RPA] 지정된 시간 내에 PID를 추출하지 못했습니다.');
            throw new Error('상품 등록 실패 (필수 항목 누락 또는 번개장터 서버 지연)');
        }
        console.log(`[RPA] ${productData.title} 업로드 성공! PID: ${pid}`);
        // 번개장터는 자동화가 100% 되므로 완료 후 탭 닫기 (메모리 관리)
        await page.close().catch(() => { });
        return pid;
    }
    catch (error) {
        console.error('[RPA] 업로드 중 에러 발생:', error);
        throw error;
    }
    finally {
        console.log('[RPA] 단일 상품 프로세스 완료.');
    }
}
/**
 * 번개장터 상품 삭제 (822-link bunjangDeleter.ts 이식)
 * 상세 페이지가 아닌 '상품관리' 페이지에서 체크박스 선택 → 상품삭제 버튼 플로우로 삭제합니다.
 */
export async function deleteFromBunjang(pid, injectedBrowser) {
    if (!pid)
        return '';
    // 'd' 마킹이 있으면 순수 숫자만 추출
    const rawPid = pid.replace(/^d+/, '');
    console.log(`[RPA] 🗑️ 번개장터 상품 삭제 봇 가동 (UI 다중선택 팝업 방식) (PID: ${rawPid})...`);
    let browser = injectedBrowser;
    let page;
    try {
        if (!browser) {
            browser = await connectBunjangBrowser();
        }
        const context = browser.contexts().length > 0 ? browser.contexts()[0] : await browser.newContext();
        // 탭 꼬임 방지를 위해 새 탭 사용
        page = await context.newPage();
        // PC 데스크톱 버전의 상품 관리 페이지로 진입
        const manageUrl = 'https://bunjang.co.kr/products/manage';
        await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        // 모바일 웹이나 PC 웹에서 뜨는 기본 자바스크립트 경고창(Alert/Confirm) 무조건 '확인' 누르기
        page.on('dialog', async (dialog) => {
            console.log(`[RPA] 시스템 경고창 발견: "${dialog.message()}" -> 자동 확인(Accept) 처리`);
            await dialog.accept().catch(() => { });
        });
        // 만약 모바일로 강제 리다이렉트 되었을 경우를 대비
        if (page.url().includes('m.bunjang.co.kr')) {
            await page.goto('https://m.bunjang.co.kr/products/manage?tab=ALL&size=100&page=0', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        }
        console.log(`[RPA] 상품 관리 페이지 로딩 완료. 제품(${rawPid}) 탐색 중...`);
        await page.waitForTimeout(2000); // 리스트 렌더링 대기
        // 제품의 PID가 포함된 링크(a 태그)를 찾습니다.
        const productLink = page.locator(`a[href*="${rawPid}"]`).first();
        if ((await productLink.count()) === 0) {
            const errMsg = `상품 목록에서 ${rawPid} 제품을 찾을 수 없습니다. (이미 삭제되었거나 100개 이후의 목록일 수 있음)`;
            console.log(`[RPA] ${errMsg}`);
            // 에러를 던져야 프론트엔드에 '삭제 실패'로 빨간색 마킹이 됨 (가짜 성공 방지)
            throw new Error(errMsg);
        }
        // 1. 해당 제품 체크박스 클릭
        // 번개장터 구조상 a 태그 근처(보통 부모나 형제 노드)에 체크박스가 있음.
        console.log('[RPA] 제품 찾음! 체크박스 선택 중...');
        const checkbox = productLink.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]//input[@type="checkbox"]').first();
        if ((await checkbox.count()) > 0) {
            // 강제 체크
            await checkbox.evaluate((node) => { node.click(); }).catch(() => { });
        }
        else {
            // XPath로 못 찾을 경우, 모바일/PC 레이아웃에 따른 가장 근접한 형제 노드 클릭
            await page.evaluate((pidStr) => {
                const link = document.querySelector(`a[href*="${pidStr}"]`);
                if (link) {
                    const parent = link.closest('li') || link.closest('div[class*="row"]') || link.parentElement?.parentElement;
                    if (parent) {
                        const chk = parent.querySelector('input[type="checkbox"]');
                        if (chk)
                            chk.click();
                    }
                }
            }, rawPid);
        }
        await page.waitForTimeout(500);
        // 2. PC 웹 상단 "상품삭제" (휴지통 아이콘) 버튼이 있는지 먼저 확인
        const pcDeleteBtn = page.getByText('상품삭제').first();
        if ((await pcDeleteBtn.count()) > 0) {
            console.log("[RPA] PC 버전 '상품삭제' 다이렉트 버튼 발견! 클릭 중...");
            await pcDeleteBtn.click({ force: true });
            await page.waitForTimeout(1000);
            // PC 버전은 누르면 시스템 Confirm 창 또는 레이어 모달창 뜸 ("삭제하기" 버튼)
            const confirmBtn = page.locator('button:has-text("삭제하기"), button:has-text("확인"), button:has-text("삭제")').last();
            if ((await confirmBtn.count()) > 0) {
                await confirmBtn.click({ force: true }).catch(() => { });
            }
        }
        else {
            // 3. 모바일 버전일 경우 "판매상태변경" -> "삭제" 플로우 타기
            console.log("[RPA] 모바일 버전 '판매상태변경' 플로우 진행 중...");
            const stateChangeBtn = page.getByText('판매상태변경').first();
            if ((await stateChangeBtn.count()) > 0) {
                await stateChangeBtn.click({ force: true });
            }
            await page.waitForTimeout(1000);
            const deleteOptionBtn = page.getByRole('button', { name: '삭제', exact: true }).last();
            if ((await deleteOptionBtn.count()) > 0) {
                await deleteOptionBtn.click({ force: true });
            }
            else {
                await page.getByText('삭제').last().click({ force: true }).catch(() => { });
            }
            await page.waitForTimeout(500);
            const completeBtn = page.locator('button:has-text("삭제하기"), button:has-text("완료"), button:has-text("확인")').last();
            if ((await completeBtn.count()) > 0) {
                await completeBtn.click({ force: true });
            }
            else {
                await page.keyboard.press('Enter');
            }
        }
        // 통신 완료 대기 (삭제 후 DOM 갱신 대기)
        await page.waitForTimeout(3000);
        // 삭제 후 모달창이 여전히 떠있으면 에러 유발 방지를 위해 ESC 키를 눌러줌
        await page.keyboard.press('Escape').catch(() => { });
        await page.close().catch(() => { });
        console.log(`[RPA] 상품 삭제 성공: ${rawPid}`);
        return rawPid;
    }
    catch (error) {
        if (page)
            await page.close().catch(() => { });
        console.warn(`[RPA] 상품 삭제 실패 (${rawPid}):`, error.message);
        // 에러 발생 시 명확히 프론트엔드로 전달 (가짜 성공 방지)
        throw new Error(`삭제 중 에러 발생: ${error?.message || '알 수 없는 오류'}`);
    }
}
export async function bumpBunjangProduct(pid, injectedBrowser) {
    let browser = injectedBrowser;
    let page = null;
    let isNewSession = false;
    try {
        if (!browser) {
            browser = await connectBunjangBrowser();
            isNewSession = true;
        }
        const contexts = browser.contexts();
        const context = contexts[0];
        page = await context.newPage();
        // 1. 내 상품 관리 페이지에서 먼저 시도 (가장 확실한 방법)
        await page.goto('https://m.bunjang.co.kr/products/manage?tab=ALL&size=100&page=0', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        // pid가 포함된 a 태그를 가진 행(row)에서 UP하기 버튼 찾기
        const rowLocator = page.locator(`div[role="row"]:has(a[href*="/products/${pid}"])`).first();
        if (await rowLocator.count() > 0) {
            const rowUpBtn = rowLocator.locator('button', { hasText: 'UP하기' }).first();
            if (await rowUpBtn.count() > 0) {
                await rowUpBtn.click();
                await page.waitForTimeout(1500);
                // 결과 확인 (팝업 혹은 토스트)
                const popupText = page.locator('div:text-matches("초과|부족|하루|완료|최상단", "i")').first();
                if (await popupText.count() > 0) {
                    const text = await popupText.textContent();
                    if (text && (text.includes('초과') || text.includes('부족') || text.includes('하루에 한 번만'))) {
                        return { success: false, limitReached: true, error: text };
                    }
                }
                // "확인" 버튼 닫기
                const confirmBtn = page.getByRole('button', { name: '확인' }).first();
                if (await confirmBtn.count() > 0) {
                    await confirmBtn.click();
                }
                return { success: true };
            }
        }
        // 2. 만약 관리 페이지에 없거나 못 찾으면 기존처럼 상품 상세 페이지 접근 (데스크톱 URL 사용)
        const productUrl = `https://bunjang.co.kr/products/${pid}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        // UP하기 버튼 찾기
        const upButton = page.locator('button', { hasText: 'UP하기' }).first();
        if (await upButton.count() > 0) {
            await upButton.click();
            await page.waitForTimeout(1500);
            const toastLocator = page.locator('.Toastify__toast-body, .sc-toast, div:text-matches("초과|부족|하루|완료", "i")').first();
            if (await toastLocator.count() > 0) {
                const text = await toastLocator.textContent();
                if (text && (text.includes('초과') || text.includes('부족') || text.includes('하루에 한 번만'))) {
                    return { success: false, limitReached: true, error: text };
                }
            }
            return { success: true };
        }
        else {
            // 모바일 웹 뷰 등으로 다시 시도
            await page.goto(`https://m.bunjang.co.kr/products/${pid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            const mUpButton = page.locator('button', { hasText: 'UP하기' }).first();
            if (await mUpButton.count() > 0) {
                await mUpButton.click();
                await page.waitForTimeout(1500);
                const toastLocator = page.locator('div:text-matches("초과|부족|하루|완료|이용권", "i")').first();
                if (await toastLocator.count() > 0) {
                    const text = await toastLocator.textContent();
                    if (text && (text.includes('초과') || text.includes('부족') || text.includes('하루에 한 번만') || text.includes('이용권'))) {
                        return { success: false, limitReached: true, error: text };
                    }
                }
                return { success: true };
            }
            return { success: false, error: 'UP하기 버튼을 찾을 수 없습니다.' };
        }
    }
    catch (error) {
        console.error(`[Bunjang Bump Error] ${pid}:`, error);
        return { success: false, error: error.message };
    }
    finally {
        if (page)
            await page.close().catch(() => { });
        if (isNewSession && browser)
            await browser.disconnect().catch(() => { });
    }
}
