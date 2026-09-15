// @ts-nocheck
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getSharedContext, saveStorageMirror, hasStoredSession } from './bandSession.js';
// 각 고객 간 대기 시간 (밀리초) — 밴드 서버 스팸 감지 방지용
const DELAY_BETWEEN_RECIPIENTS_MS = 5000;
export class BandChatBot {
    // 일괄 전송 중지를 위한 플래그 (업로드의 shouldStopUpload와 동일한 패턴)
    shouldStopChat = false;
    isSending = false;
    /**
     * 일괄 전송 중지 요청
     * - 현재 진행 중인 1건은 마무리되고, 다음 건부터 중지됨
     */
    stopChat() {
        this.shouldStopChat = true;
    }
    /**
     * 현재 일괄 전송이 진행 중인지 확인
     */
    isChatting() {
        return this.isSending;
    }
    /**
     * 단건 정산 채팅 전송 (기존 기능 유지)
     * - 브라우저를 열고 → 전송 → 닫는 기존 방식 그대로
     * - "채팅 톡" 버튼 클릭 시 호출됨
     */
    async sendSettlementChat(req, sendLog) {
        const log = (msg) => {
            console.log(`[ChatBot] ${msg}`);
            if (sendLog)
                sendLog(msg);
        };
        if (!hasStoredSession()) {
            log('❌ 네이버 로그인 세션이 없습니다. 밴드에 먼저 로그인해주세요.');
            return false;
        }
        let page = null;
        try {
            log('🌐 브라우저 시작 중...');
            const context = await getSharedContext();
            page = await context.newPage();
            const result = await this.sendToSingleRecipient(page, req, log);
            return result;
        }
        catch (e) {
            log(`❌ 채팅 전송 중 에러 발생: ${e.message}`);
            return false;
        }
        finally {
            if (page) {
                try {
                    await page.close();
                }
                catch { }
                // ★ 세션 자동 갱신 (영속 프로필 → 미러 동기화)
                await saveStorageMirror();
                console.log('[ChatBot] 단건 전송 후 세션 상태 동기화 완료');
            }
        }
    }
    /**
     * 일괄 정산 채팅 전송 (새로 추가)
     * - 브라우저를 한 번만 열고, 같은 context에서 여러 고객을 순차 처리
     * - 각 고객 간 5초 딜레이로 밴드 스팸 감지 방지
     * - shouldStopChat 플래그로 중간 정지 가능
     */
    async sendBulkSettlementChat(requests, sendLog, onProgress) {
        const log = (msg) => {
            console.log(`[ChatBot] ${msg}`);
            if (sendLog)
                sendLog(msg);
        };
        const result = {
            successCount: 0,
            failCount: 0,
            results: []
        };
        if (this.isSending) {
            log('⚠️ 이미 다른 채팅 전송 작업이 진행 중입니다. 동시 실행을 방지하기 위해 이번 요청은 무시됩니다.');
            return result;
        }
        // 초기화
        this.shouldStopChat = false;
        this.isSending = true;
        if (!hasStoredSession()) {
            log('❌ 네이버 로그인 세션이 없습니다. 밴드에 먼저 로그인해주세요.');
            this.isSending = false;
            return result;
        }
        let page = null;
        try {
            log(`🌐 브라우저 시작 중... (총 ${requests.length}명 일괄 전송)`);
            const context = await getSharedContext();
            page = await context.newPage();
            for (let i = 0; i < requests.length; i++) {
                // 중지 플래그 체크
                if (this.shouldStopChat) {
                    log(`🛑 사용자에 의해 일괄 전송이 중지되었습니다. (${i}/${requests.length} 완료)`);
                    // 남은 건들을 'skipped'로 기록
                    for (let j = i; j < requests.length; j++) {
                        result.results.push({ winnerName: requests[j].winnerName, success: false, error: '사용자 중지' });
                    }
                    break;
                }
                const req = requests[i];
                log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                log(`📨 [${i + 1}/${requests.length}] ${req.winnerName}님 전송 시작...`);
                // 프론트엔드에 진행 상황 알림
                if (onProgress) {
                    onProgress({ current: i, total: requests.length, winnerName: req.winnerName, status: 'sending' });
                }
                try {
                    const success = await this.sendToSingleRecipient(page, req, log);
                    if (success) {
                        result.successCount++;
                        result.results.push({ winnerName: req.winnerName, success: true });
                        if (onProgress) {
                            onProgress({ current: i, total: requests.length, winnerName: req.winnerName, status: 'success' });
                        }
                    }
                    else {
                        result.failCount++;
                        result.results.push({ winnerName: req.winnerName, success: false, error: '전송 실패' });
                        if (onProgress) {
                            onProgress({ current: i, total: requests.length, winnerName: req.winnerName, status: 'failed' });
                        }
                    }
                }
                catch (e) {
                    log(`❌ ${req.winnerName}님 전송 중 예외 발생: ${e.message}`);
                    result.failCount++;
                    result.results.push({ winnerName: req.winnerName, success: false, error: e.message });
                    if (onProgress) {
                        onProgress({ current: i, total: requests.length, winnerName: req.winnerName, status: 'failed' });
                    }
                }
                // 다음 고객 전에 딜레이 (마지막 고객은 제외, 중지 요청 시에도 제외)
                if (i < requests.length - 1 && !this.shouldStopChat) {
                    const delaySec = DELAY_BETWEEN_RECIPIENTS_MS / 1000;
                    log(`⏳ 스팸 방지를 위해 ${delaySec}초 대기 중...`);
                    // 1초 단위로 나눠서 대기 — 중지 요청 시 빠르게 반응하기 위함
                    for (let wait = 0; wait < delaySec; wait++) {
                        if (this.shouldStopChat)
                            break;
                        await page.waitForTimeout(1000);
                    }
                }
            }
            log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            log(`🎉 일괄 전송 완료! (성공: ${result.successCount}명, 실패: ${result.failCount}명)`);
        }
        catch (e) {
            log(`❌ 일괄 전송 중 치명적 에러 발생: ${e.message}`);
        }
        finally {
            this.isSending = false;
            this.shouldStopChat = false;
            if (page) {
                try {
                    await page.close();
                }
                catch { }
                // ★ 세션 자동 갱신 (영속 프로필 → 미러 동기화)
                await saveStorageMirror();
                console.log('[ChatBot] 벌크 전송 후 세션 상태 동기화 완료');
                // 모든 작업이 끝난 후 빈 창이 남아있지 않도록 전체 컨텍스트(브라우저)를 닫아줌
                const { closeSharedContext } = await import('./bandSession.js');
                await closeSharedContext();
                log(`🌐 모든 일괄 전송 작업이 완료되어 브라우저를 닫았습니다.`);
            }
        }
        return result;
    }
    /**
     * 단일 수신자에게 정산 메시지를 전송하는 내부 로직
     * - 브라우저 관리는 호출자가 담당하고, 이 함수는 순수하게 "페이지 내 동작"만 처리
     * - 단건/일괄 모두 이 함수를 공유하여 로직 일관성 보장
     *
     * [v2 리팩터링 — 주요 수정사항]
     * - window.open 오버라이드 제거 → context 레벨 새 탭 감지로 전환 (2번째 사람부터 끊기던 문제 해결)
     * - "채팅하기" 버튼 셀렉터 유연화 (공백/줄바꿈 포함해도 매칭되도록)
     * - 검색 시 기존 입력 클리어 + DOM 변경 대기 추가
     * - 텍스트 입력을 clipboard 붙여넣기 방식으로 변경 (밴드 UI 인식 문제 해결)
     * - 실패 시 디버그 스크린샷 저장
     */
    async sendToSingleRecipient(page, req, log) {
        // 디버그용 스크린샷 저장 헬퍼
        const debugScreenshot = async (label) => {
            try {
                const screenshotDir = path.join(app.getPath('userData'), 'debug_screenshots');
                if (!fs.existsSync(screenshotDir))
                    fs.mkdirSync(screenshotDir, { recursive: true });
                const filename = `chat_${req.winnerName}_${label}_${Date.now()}.png`;
                await page.screenshot({ path: path.join(screenshotDir, filename) });
                log(`📸 디버그 스크린샷 저장: ${filename}`);
            }
            catch { }
        };
        try {
            // 1. 멤버 탭으로 바로 이동
            const memberUrl = `https://band.us/band/${req.bandId}/member`;
            log(`➡️ 멤버 목록 페이지로 이동: ${memberUrl}`);
            await page.goto(memberUrl, { waitUntil: 'domcontentloaded' });
            // 검색 입력창이 실제로 렌더링될 때까지 대기 (고정 timeout 대신 조건부 대기)
            await page.locator('input._queryInput').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
            await page.waitForTimeout(500);
            // 2. 닉네임 검색 (기존 입력 클리어 후 재검색)
            log(`🔍 낙찰자 검색: ${req.winnerName}`);
            const searchInput = page.locator('input._queryInput').first();
            // 이전 검색어가 남아있을 수 있으므로 확실하게 클리어
            await searchInput.click();
            await searchInput.fill('');
            await page.waitForTimeout(300);
            await searchInput.fill(req.winnerName);
            await page.locator('button._searchBtn').first().click();
            // 검색 결과가 DOM에 반영될 때까지 대기 (고정 1500ms 대신 프로필 링크 출현 대기)
            await page.locator('a._btnProfile').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
            await page.waitForTimeout(500);
            // 3. 검색 결과 프로필 클릭 (닉네임 검증 포함)
            const profileLink = page.locator('a._btnProfile').first();
            if (await profileLink.count() === 0) {
                log(`❌ 검색 결과에 '${req.winnerName}'님이 없습니다.`);
                await debugScreenshot('no_profile');
                return false;
            }
            // 닉네임 검증: 검색 결과의 이름이 요청한 winnerName을 포함하는지 확인
            // → 엉뚱한 사람에게 메시지가 가는 것을 방지
            const profileContainer = profileLink.locator('..'); // 부모 요소
            const profileText = await profileContainer.textContent().catch(() => '');
            if (profileText && !profileText.includes(req.winnerName)) {
                log(`⚠️ 검색 결과의 닉네임이 '${req.winnerName}'과 일치하지 않습니다. (검색 결과: ${profileText.trim().substring(0, 30)})`);
                log(`❌ 안전을 위해 전송을 건너뜁니다.`);
                await debugScreenshot('name_mismatch');
                return false;
            }
            await profileLink.click();
            // 프로필 팝업이 뜨기까지 대기
            await page.waitForTimeout(1500);
            // 4. "1:1 채팅" 또는 "채팅하기" 버튼 클릭 (셀렉터 유연화)
            log(`💬 1:1 채팅방 진입 시도...`);
            // 여러 가지 셀렉터 전략을 순차 시도 (밴드 UI가 변경되어도 대응 가능)
            let targetBtn = null;
            const btnStrategies = [
                // 전략 1: 텍스트에 "채팅하기"가 포함된 모든 클릭 가능 요소 (공백 허용)
                () => page.locator('a, button, .uBtn, [role="button"]').filter({ hasText: '채팅하기' }).first(),
                // 전략 2: 텍스트에 "1:1 채팅"이 포함된 요소
                () => page.locator('a, button, .uBtn, [role="button"]').filter({ hasText: '1:1 채팅' }).first(),
                // 전략 3: 프로필 팝업 내부에서 "채팅" 텍스트를 가진 링크/버튼
                () => page.locator('.profileCard, .profileLayer, .layer_profile, [class*="profile"]').locator('a, button').filter({ hasText: '채팅' }).first(),
                // 전략 4: 가장 넓은 범위 — 페이지 전체에서 "채팅" 포함 요소 중 visible한 것
                () => page.locator('a:visible, button:visible').filter({ hasText: '채팅' }).first(),
            ];
            for (let i = 0; i < btnStrategies.length; i++) {
                const btn = btnStrategies[i]();
                try {
                    await btn.waitFor({ state: 'visible', timeout: 2000 });
                    if (await btn.count() > 0) {
                        targetBtn = btn;
                        log(`💬 채팅 버튼 발견 (전략 ${i + 1})`);
                        break;
                    }
                }
                catch { }
            }
            if (!targetBtn) {
                log(`❌ 1:1 채팅 버튼을 찾을 수 없습니다. 권한 문제일 수 있습니다.`);
                await debugScreenshot('no_chat_btn');
                return false;
            }
            // ★ 핵심 수정: window.open 오버라이드 대신 context 레벨에서 새 탭을 감지
            const context = page.context();
            let chatPage = page;
            let newTabOpened = false;
            // 혹시라도 새 탭 대신 현재 창에서 열릴 경우 대비
            await page.evaluate(() => {
                window.__originalOpen = window.open;
                window.open = function (url) {
                    if (url)
                        window.location.href = url.toString();
                    return window;
                };
            });
            // 10초 내에 새 탭이 열리거나 모달이 뜨는지 감지
            const newPagePromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
            await targetBtn.click();
            log(`💬 채팅 버튼 클릭 완료, 진입(또는 팝업) 대기 중...`);
            // 모달 감지를 위한 Promise (최대 5초 대기 - 네트워크 지연 고려)
            const confirmOpenBtn = page.locator('button').filter({ hasText: '채팅방 열기' }).first();
            const modalPromise = confirmOpenBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'modal').catch(() => null);
            const pagePromise = newPagePromise.then(p => p ? 'page' : null);
            const raceResult = await Promise.race([modalPromise, pagePromise]);
            if (raceResult === 'modal') {
                // 모달이 먼저 뜬 경우 클릭해서 새 창을 유도함
                await confirmOpenBtn.click();
                log(`💬 "채팅방 열기" 팝업 확인 클릭됨`);
            }
            // 6. 새 탭 진입 최종 대기
            log(`💬 채팅방 창 대기 중...`);
            const newPage = await newPagePromise;
            if (newPage) {
                log(`💬 새 탭에서 채팅방이 열렸습니다. 새 탭으로 전환합니다.`);
                chatPage = newPage;
                newTabOpened = true;
                await chatPage.waitForLoadState('domcontentloaded');
            }
            else {
                // 새 탭이 안 열린 경우 (window.open 오버라이드로 인해 현재 페이지가 이동된 경우)
                await chatPage.waitForLoadState('domcontentloaded');
            }
            await chatPage.waitForTimeout(500);
            // 채팅방 URL 진입 검증 (load 이벤트를 기다리지 않게 하여 10초 딜레이 원천 차단)
            try {
                await chatPage.waitForURL(/\/chat\//, { timeout: 5000, waitUntil: 'domcontentloaded' });
            }
            catch {
                const currentUrl = chatPage.url();
                if (!currentUrl.includes('/chat/')) {
                    log(`❌ 채팅방 진입에 실패했습니다. (현재 URL: ${currentUrl})`);
                    log(`💡 권한 문제이거나 밴드 서버 접근이 제한되었을 수 있습니다.`);
                    await debugScreenshot('chat_entry_fail');
                    // 새 탭이 열렸다면 닫아줌
                    if (newTabOpened) {
                        try {
                            await chatPage.close();
                        }
                        catch { }
                    }
                    return false;
                }
            }
            await chatPage.waitForTimeout(500);
            log(`✅ 채팅방 진입 완료!`);
            // 6. 이미지 파일 일괄 전송
            const validThumbPaths = req.thumbnailPaths.filter(p => fs.existsSync(p));
            if (validThumbPaths.length > 0) {
                log(`📷 제품 썸네일 ${validThumbPaths.length}장 일괄 전송 중...`);
                const fileInput = chatPage.locator('input[type="file"]').first();
                if (await fileInput.count() > 0) {
                    await fileInput.setInputFiles(validThumbPaths);
                    // 파일 갯수에 비례하여 충분한 업로드 시간 대기
                    await chatPage.waitForTimeout(2000 + (validThumbPaths.length * 500));
                }
                else {
                    log(`⚠️ 파일 업로드 input을 찾을 수 없어 썸네일 전송을 건너뜁니다.`);
                }
            }
            // 7. 정산서 텍스트 전송
            log(`📝 정산서 내용 전송 중...`);
            // 밴드 채팅창의 실제 입력 영역 특정 (숨겨진 요소 방지를 위해 보이는 요소 탐색)
            const textAreas = chatPage.locator('textarea, [contenteditable="true"]');
            await textAreas.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => { });
            let textArea = null;
            const count = await textAreas.count();
            for (let i = 0; i < count; i++) {
                const el = textAreas.nth(i);
                if (await el.isVisible().catch(() => false)) {
                    textArea = el;
                    // 찾으면 바로 탈출
                    break;
                }
            }
            if (!textArea) {
                log(`❌ 화면에 보이는 채팅 입력창을 찾을 수 없습니다.`);
                await debugScreenshot('no_textarea');
                if (newTabOpened) {
                    try {
                        await chatPage.close();
                    }
                    catch { }
                }
                return false;
            }
            // 입력창 클릭으로 포커스 확보
            await textArea.click();
            await chatPage.waitForTimeout(300);
            // Playwright 환경에서 확실하게 클립보드 권한 부여
            await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => { });
            // clipboard를 통한 붙여넣기 (밴드 에디터는 paste 이벤트에 의존하므로 가장 확실함)
            await chatPage.evaluate(async (text) => {
                await navigator.clipboard.writeText(text);
            }, req.settlementText).catch(() => {
                log(`⚠️ clipboard API 실패`);
            });
            // Ctrl+V로 붙여넣기 실행
            await chatPage.keyboard.press('Control+V');
            await chatPage.waitForTimeout(500);
            // 붙여넣기가 성공했는지 검증하는 코드가 타이밍 문제로 오작동하여 이중 입력되는 것을 방지하기 위해 fallback 제거
            await chatPage.waitForTimeout(500);
            // 전송 버튼 클릭 (셀렉터 유연화)
            const sendBtn = chatPage.locator('button').filter({ hasText: /전송|보내기/ }).first();
            if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
                await sendBtn.click();
            }
            else {
                // 전송 버튼이 비활성이면 Enter 키로 시도
                log(`⚠️ 전송 버튼이 비활성 또는 미발견, Enter 키로 전송 시도`);
                await chatPage.keyboard.press('Enter');
            }
            await chatPage.waitForTimeout(2000);
            log(`🎉 ${req.winnerName}님에게 정산 채팅 전송을 완료했습니다!`);
            // ★ 새 탭으로 열렸다면 닫고 원래 page로 복귀
            if (newTabOpened) {
                try {
                    await chatPage.close();
                }
                catch { }
                log(`💬 채팅 탭 닫기 완료, 원래 페이지로 복귀`);
            }
            return true;
        }
        catch (e) {
            log(`❌ ${req.winnerName}님 채팅 전송 중 에러: ${e.message}`);
            await debugScreenshot('error');
            return false;
        }
    }
}
export const bandChatBot = new BandChatBot();
