// @ts-nocheck
import { getAuthClient } from './catalogGoogleUploader.js';
import { google } from 'googleapis';
import { getSharedContext, saveStorageMirror, hasStoredSession } from './bandSession.js';
// 로그인 만료 에러를 구분하기 위한 커스텀 에러 클래스
class LoginExpiredError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LoginExpiredError';
    }
}
// 로그인 상태 선검증: band.us에 접속하여 로그인 페이지로 리다이렉트되는지 확인
async function verifyLoginStatus(page, sendLog) {
    try {
        await page.goto('https://band.us/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        const currentUrl = page.url();
        // 로그인 페이지로 리다이렉트되었으면 세션 만료
        if (currentUrl.includes('login_page') || currentUrl.includes('nid.naver.com') || currentUrl.includes('auth.band.us')) {
            sendLog('🚨 밴드 로그인이 만료되었습니다! 삭제를 중단합니다.');
            return false;
        }
        return true;
    }
    catch (e) {
        sendLog('🚨 로그인 상태 확인 중 오류 발생. 삭제를 중단합니다.');
        return false;
    }
}
async function deleteSinglePost(page, postUrl, rowIndex, productCode, settings, sendLog, webContents, skipLoginCheck = false) {
    sendLog(`🗑️ [행 ${rowIndex}] 게시물 삭제 시작: ${postUrl}`);
    // ★ 로그인 선검증: 첫 번째 건이거나 단건일 때만 확인
    if (!skipLoginCheck) {
        const isLoggedIn = await verifyLoginStatus(page, sendLog);
        if (!isLoggedIn) {
            throw new LoginExpiredError('밴드 로그인이 만료되어 삭제를 진행할 수 없습니다. 재로그인 후 다시 시도해주세요.');
        }
    }
    let targetUrl = postUrl;
    let isAlreadyDeleted = false;
    // ★ 실제로 삭제 버튼을 눌러 성공한 경우에만 true
    let actuallyDeleted = false;
    if (!targetUrl.startsWith('http')) {
        if (!settings.bandUrl) {
            throw new Error('게시물 주소가 없고 밴드 URL도 설정되어 있지 않아 검색할 수 없습니다.');
        }
        const searchKeyword = productCode;
        const searchUrl = `${settings.bandUrl}/search/${encodeURIComponent(searchKeyword)}`;
        sendLog(`🔍 게시물 주소가 없어 상품코드(${searchKeyword})로 검색을 시도합니다.`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        // 검색 결과에서 첫번째 게시물 링크 찾기
        const firstPostLink = page.locator('a[href*="/post/"]').first();
        if (await firstPostLink.isVisible({ timeout: 5000 })) {
            const href = await firstPostLink.getAttribute('href');
            targetUrl = href?.startsWith('http') ? href : `https://band.us${href}`;
            sendLog(`✅ 검색된 게시물 주소: ${targetUrl}`);
        }
        else {
            sendLog(`⚠️ 검색결과에서 상품코드(${searchKeyword})에 해당하는 게시물을 찾을 수 없습니다. (이미 삭제됨)`);
            isAlreadyDeleted = true;
        }
    }
    if (!isAlreadyDeleted) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        // 삭제되었거나 잘못된 주소면 /post/ 가 포함되어있지 않음 (홈으로 튕김)
        if (!page.url().includes('/post/')) {
            sendLog(`⚠️ 삭제되었거나 유효하지 않은 게시물 주소입니다. (밴드 홈으로 리다이렉트됨)`);
            isAlreadyDeleted = true;
        }
    }
    if (!isAlreadyDeleted) {
        // 2. 더보기 메뉴 클릭
        try {
            const moreSelector = 'button.postSet._btnPostMore, button._btnPostMore, button:has-text("더보기"), button:has-text("글 옵션"), .postMore .uButton, a._moreBtn, a:has-text("더보기")';
            await page.waitForSelector(moreSelector, { state: 'visible', timeout: 15000 });
            await page.locator(moreSelector).first().click({ timeout: 5000 });
        }
        catch (e) {
            throw new Error('게시물의 더보기 버튼을 찾을 수 없습니다. (접근 권한이 없을 수 있음)');
        }
        await page.waitForTimeout(1500);
        // 3. 삭제 버튼 클릭
        try {
            const deleteSelector = 'a:has-text("삭제하기"), a:has-text("삭제"), button._btnPostRemove, button:has-text("삭제")';
            await page.waitForSelector(deleteSelector, { state: 'visible', timeout: 10000 });
            await page.locator(deleteSelector).first().click({ timeout: 5000 });
        }
        catch (e) {
            throw new Error('더보기 메뉴에서 삭제 버튼을 찾을 수 없습니다. (권한이 없거나 이미 삭제된 글)');
        }
        await page.waitForTimeout(1500);
        // 4. 확인 팝업 "확인" 클릭
        try {
            const confirmSelector = 'button.uButton.-confirm:has-text("확인"), button.uBtn.-confirm:has-text("확인"), button:has-text("확인")';
            await page.waitForSelector(confirmSelector, { state: 'visible', timeout: 10000 });
            await Promise.all([
                page.waitForNavigation({ timeout: 5000 }).catch(() => { }),
                page.locator(confirmSelector).first().click({ timeout: 5000 })
            ]);
            // ★ 실제로 삭제 확인 버튼까지 성공적으로 눌렀을 때만 true
            actuallyDeleted = true;
            sendLog(`✅ [행 ${rowIndex}] 밴드 게시물이 성공적으로 삭제되었습니다.`);
            await page.waitForTimeout(2500);
        }
        catch (e) {
            throw new Error('삭제 확인 팝업을 찾을 수 없습니다.');
        }
    }
    // 5. 구글 시트 E열 업데이트: ★ 실제 삭제 성공 시에만 E열 초기화
    if (actuallyDeleted && settings.googleSpreadsheetUrl) {
        try {
            const auth = await getAuthClient();
            if (auth) {
                const match = settings.googleSpreadsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
                if (match) {
                    const spreadsheetId = match[1];
                    const sheets = google.sheets({ version: 'v4', auth });
                    const meta = await sheets.spreadsheets.get({ spreadsheetId });
                    let sheetName = 'Sheet1';
                    if (meta.data.sheets && meta.data.sheets.length > 0) {
                        const firstSheet = meta.data.sheets[0].properties;
                        if (firstSheet && firstSheet.title)
                            sheetName = firstSheet.title;
                    }
                    const aColData = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range: `'${sheetName}'!A:A`
                    });
                    const aColRows = aColData.data.values || [];
                    let actualRowIndex = -1;
                    const targetCode = String(productCode).replace(/[^0-9]/g, '');
                    for (let i = aColRows.length - 1; i >= 0; i--) {
                        const cellVal = aColRows[i][0];
                        if (cellVal && String(cellVal).replace(/[^0-9]/g, '') === targetCode) {
                            actualRowIndex = i + 1;
                            break;
                        }
                    }
                    if (actualRowIndex !== -1) {
                        await sheets.spreadsheets.values.update({
                            spreadsheetId,
                            range: `'${sheetName}'!E${actualRowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [['']] }
                        });
                        sendLog(`✅ [제품코드 ${productCode}] 구글 시트 E열(위치) 초기화 완료`);
                    }
                    else {
                        sendLog(`⚠️ [제품코드 ${productCode}] 구글 시트에서 제품을 찾을 수 없어 E열을 초기화하지 못했습니다.`);
                    }
                }
            }
        }
        catch (err) {
            sendLog(`⚠️ 게시글은 삭제되었으나 구글 시트 초기화에 실패했습니다: ${err.message}`);
        }
        // UI에 완료 상태 전송 (실제 삭제 시에만 postUrl 제거)
        webContents.send('upload:row-success', { rowIndex, postUrl: '' });
    }
    else if (isAlreadyDeleted) {
        // ★ 이미 삭제된 게시물: E열은 건드리지 않고 로그만 남김
        sendLog(`ℹ️ [행 ${rowIndex}] 게시물이 이미 없으므로 E열(위치) 링크는 보존합니다.`);
    }
}
// ----------------------------------------------------------------------
// 공통 브라우저 초기화 헬퍼 (공유 영속 컨텍스트 재사용)
async function launchBandBrowser() {
    if (!hasStoredSession()) {
        throw new Error('로그인 정보가 없습니다. 관리자 패널에서 네이버 로그인을 먼저 진행해주세요.');
    }
    const browserContext = await getSharedContext();
    const page = await browserContext.newPage();
    return { browserContext, page };
}
// ----------------------------------------------------------------------
// 기존 하위 호환: 단건 전송 (브라우저 1회 오픈/클로즈)
export async function deleteBandPost(postUrl, rowIndex, productCode, settings, webContents) {
    let ctx = null;
    const sendLog = (msg) => webContents.send('upload:log', msg);
    try {
        ctx = await launchBandBrowser();
        await deleteSinglePost(ctx.page, postUrl, rowIndex, productCode, settings, sendLog, webContents);
    }
    catch (err) {
        sendLog(`❌ [행 ${rowIndex}] 게시물 삭제 실패: ${err.message}`);
        throw err;
    }
    finally {
        if (ctx && ctx.page) {
            // ★ 세션 자동 갱신 (영속 프로필 → 미러 동기화) 후 페이지만 닫음
            await saveStorageMirror();
            try {
                await ctx.page.close();
            }
            catch { }
            console.log('[Deleter] 세션 상태 동기화 완료');
        }
    }
}
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
let shouldStopBulkDelete = false;
export function stopBulkBandPosts() {
    shouldStopBulkDelete = true;
}
// 신규: 일괄 전송 (브라우저 1회 재사용)
export async function deleteBulkBandPosts(requests, settings, webContents) {
    let ctx = null;
    const sendLog = (msg) => webContents.send('upload:log', msg);
    try {
        if (!requests || requests.length === 0)
            return;
        sendLog(`🚀 게시물 일괄 삭제 시작: 총 ${requests.length}건`);
        ctx = await launchBandBrowser();
        shouldStopBulkDelete = false;
        for (let i = 0; i < requests.length; i++) {
            if (shouldStopBulkDelete) {
                sendLog(`🛑 사용자에 의해 게시물 일괄 삭제가 중지되었습니다.`);
                break;
            }
            const req = requests[i];
            try {
                // 첫 번째(i===0) 건에만 로그인 검증을 하고, 그 이후 건들은 skipLoginCheck = true 로 넘겨서 속도를 높이고 불필요한 홈 이동 방지
                const skipLoginCheck = (i > 0);
                await deleteSinglePost(ctx.page, req.postUrl, req.rowIndex, req.productCode, settings, sendLog, webContents, skipLoginCheck);
            }
            catch (err) {
                // ★ 로그인 만료 에러인 경우 남은 건도 전부 실패할 것이므로 즉시 중단
                if (err instanceof LoginExpiredError || err.name === 'LoginExpiredError') {
                    sendLog(`🚨 로그인 만료로 인해 일괄 삭제를 전체 중단합니다. (${i}/${requests.length}건 처리)`);
                    break;
                }
                // 그 외 에러는 로그만 남기고 다음 건 계속 진행
                sendLog(`❌ [행 ${req.rowIndex}] 게시물 삭제 실패: ${err.message}`);
            }
            if (shouldStopBulkDelete)
                break;
            // 마지막 항목이 아니면 딜레이 추가 (어뷰징 감지 방지)
            if (i < requests.length - 1) {
                sendLog(`⏳ 다음 삭제 진행을 위해 1.5초 대기 중...`);
                // 딜레이 중에도 취소할 수 있도록 세분화
                for (let w = 0; w < 15; w++) {
                    if (shouldStopBulkDelete)
                        break;
                    await ctx.page.waitForTimeout(100);
                }
            }
        }
        if (!shouldStopBulkDelete) {
            sendLog(`🎉 게시물 일괄 삭제 완료`);
        }
    }
    catch (err) {
        sendLog(`❌ 게시물 일괄 삭제 중 치명적 오류 발생: ${err.message}`);
        throw err;
    }
    finally {
        if (ctx && ctx.page) {
            // ★ 세션 자동 갱신 (영속 프로필 → 미러 동기화) 후 페이지만 닫음
            await saveStorageMirror();
            try {
                await ctx.page.close();
            }
            catch { }
            console.log('[Deleter] 벌크 삭제 후 세션 상태 동기화 완료');
        }
    }
}
