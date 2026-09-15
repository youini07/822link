// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { app, nativeImage } from 'electron';
import { getAuthClient, resolveSheetTitle } from './catalogGoogleUploader.js';
import { google } from 'googleapis';
import { getSharedContext, saveStorageMirror, hasStoredSession } from './bandSession.js';
const SETTINGS_PATH = path.join(app.getPath('userData'), 'upload_settings.json');
export function getUploadSettings() {
    if (fs.existsSync(SETTINGS_PATH)) {
        try {
            const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    return null;
}
export function saveUploadSettings(settings) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
// 업로드 대기열 파일 경로
const QUEUE_PATH = path.join(app.getPath('userData'), 'upload_queue.json');
export function getUploadQueue() {
    if (fs.existsSync(QUEUE_PATH)) {
        try {
            const data = fs.readFileSync(QUEUE_PATH, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return [];
        }
    }
    return [];
}
export function saveUploadQueue(queue) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}
export function addToUploadQueue(prodCode, scheduledTime, rowIndex) {
    const queue = getUploadQueue();
    queue.push({
        id: Date.now().toString() + Math.random().toString(36).substring(7),
        prodCode,
        rowIndex,
        scheduledTime,
        status: 'PENDING',
        createdAt: Date.now()
    });
    saveUploadQueue(queue);
}
// 구글 드라이브 파일 ID 추출 정규식
const driveIdRegex = /[-\w]{25,}/;
export async function fetchSpreadsheetData(url, prefer = 'band') {
    try {
        const auth = await getAuthClient();
        if (!auth)
            throw new Error('구글 인증 오류: 토큰이 없습니다. 먼저 카탈로그 탭에서 구글 계정을 연동해주세요.');
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!match)
            throw new Error('올바르지 않은 구글 스프레드시트 URL입니다.');
        const spreadsheetId = match[1];
        const sheets = google.sheets({ version: 'v4', auth });
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        let sheetName = 'Sheet1';
        if (meta.data.sheets && meta.data.sheets.length > 0) {
            sheetName = await resolveSheetTitle(sheets, spreadsheetId, prefer);
        }
        // A~AH 열 가져오기 (AD: 번개장터 PID, AF: 후르츠 PID, AH: 중고나라 PID 포함)
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:AH`,
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0) {
            return [];
        }
        const result = [];
        const CATALOG_CONFIG_PATH = path.join(app.getPath('userData'), 'catalog_config.json');
        let localImagePath = '';
        if (fs.existsSync(CATALOG_CONFIG_PATH)) {
            try {
                const catalogConfig = JSON.parse(fs.readFileSync(CATALOG_CONFIG_PATH, 'utf-8'));
                localImagePath = catalogConfig.localImagePath || '';
            }
            catch (e) { }
        }
        rows.forEach((row, index) => {
            // 행 번호는 2부터 시작
            const rowIndex = index + 2;
            const productCode = row[0] || ''; // A열 (상품코드) 또는 채번된 코드 사용
            const registrationDate = row[2] || ''; // C열 (등록일)
            const status = row[5] || ''; // F열 (상태)
            const startingBid = row[8] || ''; // I열 (가격/경매시작가격)
            const finalPrice = row[9] || ''; // J열 (실제판매가격)
            const winnerName = row[3] || ''; // D열 (낙찰자)
            const productName = row[13] || ''; // N열 (aiTitle)
            const description = row[18] || ''; // S열 (aiDescription)
            const imageStr = row[20] || ''; // U열 (Drive links)
            const location = row[4] || ''; // E열 (위치)
            // 빈 행 건너뛰기
            if (!productName && !description && !imageStr && !productCode)
                return;
            const imageLinks = imageStr
                .split(',')
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && driveIdRegex.test(l));
            let localThumbnailBase64 = undefined;
            const prodCode = String(productCode).replace(/[^0-9]/g, '');
            if (localImagePath && prodCode) {
                const targetFolder = prefer === 'market' ? 'OPENMARKET' : 'BAND';
                const prodFolder = path.join(localImagePath, targetFolder, prodCode);
                if (fs.existsSync(prodFolder)) {
                    const thumbPath = path.join(prodFolder, 'thumbnail', 'thumb.jpg');
                    if (fs.existsSync(thumbPath)) {
                        try {
                            const buffer = fs.readFileSync(thumbPath);
                            localThumbnailBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                        }
                        catch (e) { }
                    }
                    else {
                        // 폴백: 1번 이미지 읽어서 즉석 리사이징 (800x674 비율 맞춤 크롭)
                        const files = fs.readdirSync(prodFolder);
                        const found = files.find(file => file.match(/^1\.(jpg|jpeg|png|webp|heic)$/i)) || files.find(file => file.match(/\.(jpg|jpeg|png|webp|heic)$/i));
                        if (found) {
                            const imgPath = path.join(prodFolder, found);
                            try {
                                const img = nativeImage.createFromPath(imgPath);
                                const fullSize = img.getSize();
                                
                                let topHalfImg = img;
                                if (fullSize.width === 1080 && fullSize.height === 1920) {
                                    topHalfImg = img.crop({ x: 0, y: 0, width: 1080, height: 960 });
                                }
                                
                                const size = topHalfImg.getSize();
                                const targetRatio = 800 / 674;
                                const currentRatio = size.width / size.height;
                                
                                let croppedImg = topHalfImg;
                                if (currentRatio < targetRatio) {
                                    const cropHeight = Math.floor(size.width / targetRatio);
                                    croppedImg = topHalfImg.crop({ x: 0, y: 0, width: size.width, height: cropHeight });
                                } else if (currentRatio > targetRatio) {
                                    const cropWidth = Math.floor(size.height * targetRatio);
                                    const xOffset = Math.floor((size.width - cropWidth) / 2);
                                    croppedImg = topHalfImg.crop({ x: xOffset, y: 0, width: cropWidth, height: size.height });
                                }
                                
                                const resized = croppedImg.resize({ width: 800, height: 674, quality: 'good' });
                                localThumbnailBase64 = resized.toDataURL();
                            } catch (e) {
                                console.error('Thumbnail resize fallback error:', e);
                            }
                        }
                    }
                }
            }
            result.push({
                rowIndex,
                productCode,
                productName,
                description,
                imageLinks,
                startingBid,
                finalPrice,
                winnerName,
                status,
                location,
                localThumbnailBase64,
                registrationDate,
                bunjangPid: row[29] || '', // AD열: 번개장터 PID
                fruitsPid: row[31] || '', // AF열: 후르츠패밀리 PID
                joongnaPid: row[32] || '' // AG열: 중고나라 PID
            });
        });
        return result.reverse(); // 최신(아래) 행이 위로 오도록 반전
    }
    catch (err) {
        console.error('Spreadsheet fetch error:', err);
        throw new Error(`데이터 불러오기 실패: ${err.message}`);
    }
}
let isUploading = false;
let shouldStopUpload = false;
let uploadTimer = null;
let currentScheduledTime = null;
export function getUploadStatus() {
    return { isUploading, scheduledTime: currentScheduledTime };
}
function sendLog(wc, msg) {
    if (wc && !wc.isDestroyed()) {
        wc.send('upload:log', msg);
    }
}
export function stopAutoUpload() {
    shouldStopUpload = true;
    if (uploadTimer) {
        clearTimeout(uploadTimer);
        uploadTimer = null;
        isUploading = false;
        currentScheduledTime = null;
    }
}
export async function startAutoUpload(data, wc) {
    if (isUploading) {
        sendLog(wc, '❌ 이미 업로드가 진행 중이거나 예약 대기 중입니다.');
        return;
    }
    isUploading = true;
    shouldStopUpload = false;
    const { settings, rows, scheduledTime } = data;
    if (scheduledTime) {
        const now = new Date();
        let targetTime = new Date();
        if (scheduledTime.includes('T') || scheduledTime.includes('-')) {
            targetTime = new Date(scheduledTime);
        }
        else {
            const [hours, minutes] = scheduledTime.split(':').map(Number);
            targetTime.setHours(hours, minutes, 0, 0);
            if (targetTime.getTime() <= now.getTime()) {
                // If time has passed today, schedule for tomorrow
                targetTime.setDate(targetTime.getDate() + 1);
            }
        }
        const delay = targetTime.getTime() - now.getTime();
        currentScheduledTime = targetTime.getTime();
        sendLog(wc, `⏳ 예약 업로드 설정됨: ${targetTime.toLocaleString('ko-KR')} 시작 예정`);
        wc.send('upload:status', 'scheduled');
        wc.send('upload:scheduled-time', currentScheduledTime);
        await new Promise((resolve) => {
            uploadTimer = setTimeout(() => {
                resolve();
            }, delay);
        });
        uploadTimer = null;
        currentScheduledTime = null;
        if (shouldStopUpload) {
            isUploading = false;
            return;
        }
        sendLog(wc, '⏰ 예약된 시간이 되어 업로드를 시작합니다.');
    }
    wc.send('upload:status', 'started');
    let browserContext = null;
    const tempDir = path.join(app.getPath('temp'), 'band_upload_temp');
    try {
        // 임시 폴더 생성
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        sendLog(wc, '🌐 브라우저를 시작합니다...');
        // 기존 네이버 로그인 세션 확인 (영속 프로필/미러)
        if (!hasStoredSession()) {
            throw new Error('네이버 로그인 정보가 없습니다. 먼저 밴드에 로그인해 주세요.');
        }
        // 카탈로그 설정에서 로컬 이미지 경로 읽기
        const CATALOG_CONFIG_PATH = path.join(app.getPath('userData'), 'catalog_config.json');
        let localImagePath = '';
        if (fs.existsSync(CATALOG_CONFIG_PATH)) {
            try {
                const catalogConfig = JSON.parse(fs.readFileSync(CATALOG_CONFIG_PATH, 'utf-8'));
                localImagePath = catalogConfig.localImagePath || '';
            }
            catch (e) { }
        }
        if (!localImagePath) {
            sendLog(wc, '❌ AI 분석 봇 설정에서 "로컬 이미지 저장소" 경로를 먼저 설정해주세요.');
            isUploading = false;
            wc.send('upload:status', 'finished');
            return;
        }
        // 공유 영속 컨텍스트 재사용 (동시 세션 감지 회피 + 롤링 쿠키 유지)
        browserContext = await getSharedContext();
        let page = await browserContext.newPage();
        for (let i = 0; i < rows.length; i++) {
            if (shouldStopUpload) {
                sendLog(wc, '🛑 사용자에 의해 업로드가 중지되었습니다.');
                break;
            }
            const row = rows[i];
            sendLog(wc, `\n▶ [행 ${row.rowIndex}] "${row.productName}" 업로드 시작...`);
            // 1. 로컬 이미지 폴더 탐색
            const localFilePaths = [];
            const prodCode = String(row.productCode).replace(/[^0-9]/g, ''); // 숫자만 추출 (예: "(1)" -> "1")
            if (prodCode) {
                const prodFolder = path.join(localImagePath, 'band', prodCode);
                if (fs.existsSync(prodFolder)) {
                    const files = fs.readdirSync(prodFolder);
                    for (let f = 1; f <= 6; f++) {
                        // 1.jpg, 2.jpg, ... 등 순서대로 찾기
                        const found = files.find(file => file.startsWith(`${f}.`));
                        if (found) {
                            localFilePaths.push(path.join(prodFolder, found));
                        }
                    }
                }
            }
            if (shouldStopUpload)
                break;
            if (localFilePaths.length === 0) {
                sendLog(wc, `⚠️ 첨부할 이미지가 없어 스킵합니다. (상품코드: ${prodCode})`);
                continue;
            }
            // 2. 밴드 글쓰기 접근부터 게시 완료까지 타임아웃 적용 (최대 3분)
            let timeoutId = null;
            try {
                await Promise.race([
                    (async () => {
                        sendLog(wc, `📝 밴드 글쓰기 창 열기...`);
                        let safeBandUrl = settings.bandUrl || '';
                        if (!safeBandUrl) {
                            throw new Error('설정에 밴드 고유 URL이 입력되지 않았습니다. 밴드 설정에서 URL을 확인해주세요.');
                        }
                        if (safeBandUrl.includes('/post')) {
                            safeBandUrl = safeBandUrl.split('/post')[0];
                        }
                        const currentUrl = page.url();
                        if (!currentUrl.includes(safeBandUrl)) {
                            await page.goto(safeBandUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
                        }
                        else {
                            // 이미 페이지에 있다면 스크롤이나 요소 갱신을 위해 짧게 대기
                            await page.waitForTimeout(500).catch(() => { });
                        }
                        // 여러 글쓰기 진입점 시도
                        try {
                            const writeSelector = 'button._btnPostWrite, button._btnOpenWriteLayer, .postWriteForm .clickArea';
                            await page.waitForSelector(writeSelector, { state: 'visible', timeout: 20000 });
                            await page.locator(writeSelector).first().click({ timeout: 10000 });
                        }
                        catch (e) {
                            throw new Error('밴드 글쓰기 버튼을 찾을 수 없습니다. URL이나 권한을 확인해주세요.');
                        }
                        // 3. 텍스트 입력
                        const editorSelector = ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) .cke_editable, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) [contenteditable="true"], .writeBoard [contenteditable="true"], [contenteditable="true"]';
                        let editor = null;
                        try {
                            await page.waitForSelector(editorSelector, { state: 'visible', timeout: 15000 });
                            editor = page.locator(editorSelector).first();
                        }
                        catch (e) { }
                        if (editor) {
                            await editor.click().catch(() => { });
                            // 요청된 텍스트 양식에 맞춰 작성
                            // [상품명] (코드가 이미 포함되어 있으므로 상품명만 작성)
                            // [경매시작가격]
                            // 
                            // [상세설명(aiDescription)]
                            let finalText = `${row.productName}\n`;
                            if (row.startingBid) {
                                finalText += `경매시작가격 ${row.startingBid}\n\n`;
                            }
                            else {
                                finalText += `\n`;
                            }
                            // aiDescription (불필요한 중복 제품명 제거)
                            let desc = row.description;
                            // 기존 템플릿의 '▪ 제품명 : ...' 줄이 있다면 제거
                            const descLines = desc.split('\n');
                            const filteredDesc = descLines.filter(line => !line.startsWith('▪ 제품명')).join('\n');
                            finalText += filteredDesc.trim();
                            if (row.startingBid) {
                                finalText += `\n(댓글은 ${row.startingBid}000원이면 ${row.startingBid}라고 뒤에 0 세자리를 제외하고 적어주세요)`;
                            }
                            await page.keyboard.insertText(finalText).catch(() => { });
                            // 강제로 입력 이벤트를 발생시켜 '게시' 버튼을 활성화하기 위해 스페이스 후 백스페이스 입력
                            await page.keyboard.press('Space').catch(() => { });
                            await page.keyboard.press('Backspace').catch(() => { });
                            await page.waitForTimeout(1000).catch(() => { });
                        }
                        else {
                            sendLog(wc, `⚠️ 글쓰기 에디터를 찾지 못했습니다.`);
                        }
                        // 4. 이미지 첨부
                        if (localFilePaths.length > 0) {
                            sendLog(wc, `🖼️ 이미지 첨부 중...`);
                            const fileChooserPromise = page.waitForEvent('filechooser');
                            const photoSelector = ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) .photo:not(.disabled), :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) ._btnAttachPhoto, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button[data-action="photo"], :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) label[data-action="photo"], :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has-text("사진/동영상"), :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.btnPhoto, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) label.btnPhoto, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.uIco-photo, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has(.uIco-photo), :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button[title*="사진"], :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button[aria-label*="사진"], :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) label:has-text("사진"), :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) .writeToolBar button:first-child, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) .writeTools button:first-child, :is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) .cPostWriteTool button:first-child';
                            try {
                                await page.waitForSelector(photoSelector, { state: 'visible', timeout: 15000 });
                                // force click via evaluate to bypass Playwright's actionability/scroll loops if needed, but try standard click first
                                const el = page.locator(photoSelector).first();
                                await el.click({ timeout: 5000 }).catch(() => el.evaluate((b) => b.click()));
                            }
                            catch (e) { }
                            const fileChooser = await fileChooserPromise.catch(() => null);
                            if (fileChooser) {
                                await fileChooser.setFiles(localFilePaths).catch(() => { });
                                sendLog(wc, `⏳ 사진 업로드 완료 대기 중...`);
                                // "첨부하기" 버튼이 나타날 때까지 대기 (최대 60초)
                                const attachBtnLocators = [
                                    'button:has-text("첨부하기")',
                                    '.photoUploadWrap button:has-text("첨부하기")',
                                    'button.uBtn.-confirm:has-text("첨부하기")'
                                ];
                                let attachClicked = false;
                                for (let wait = 0; wait < 30; wait++) {
                                    if (shouldStopUpload)
                                        break;
                                    for (const sel of attachBtnLocators) {
                                        try {
                                            const el = page.locator(sel).first();
                                            if (await el.isVisible({ timeout: 500 })) {
                                                const disabled = await el.isDisabled().catch(() => false);
                                                if (!disabled) {
                                                    await el.evaluate((b) => b.click());
                                                    attachClicked = true;
                                                    break;
                                                }
                                            }
                                        }
                                        catch (e) { }
                                    }
                                    if (attachClicked)
                                        break;
                                    await page.waitForTimeout(2000).catch(() => { }); // 2초씩 대기 (최대 60초)
                                }
                                if (!attachClicked && !shouldStopUpload) {
                                    throw new Error(`"첨부하기" 버튼을 누르지 못했습니다. (사진 업로드 시간 초과 또는 오류)`);
                                }
                                else {
                                    sendLog(wc, `✅ 사진 첨부 완료!`);
                                    await page.waitForTimeout(1000).catch(() => { }); // 모달 닫히는 시간 최소화
                                }
                            }
                            else {
                                sendLog(wc, `⚠️ 파일 선택 창을 열지 못했습니다.`);
                            }
                        }
                        if (shouldStopUpload)
                            throw new Error('UserStopped');
                        // 5. 글쓰기 등록(게시)
                        sendLog(wc, `🚀 게시글 등록 대기 중 (이미지 서버 업로드 대기)...`);
                        await page.waitForTimeout(3000).catch(() => { }); // 이미지 서버 업로드 여유 시간 제공 (너무 빠른 클릭 방지)
                        const submitLocators = [
                            ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has-text("게시")',
                            ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has-text("예약")',
                            ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has-text("완료")',
                            ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.btnSubmit',
                            ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.uBtn.-submit',
                            'button:has-text("게시")', // Fallback
                            'button:has-text("예약")' // Fallback
                        ];
                        const getVisibleSubmitBtn = async () => {
                            for (const sel of submitLocators) {
                                const count = await page.locator(sel).count().catch(() => 0);
                                for (let i = 0; i < count; i++) {
                                    const loc = page.locator(sel).nth(i);
                                    if (await loc.isVisible().catch(() => false))
                                        return loc;
                                }
                            }
                            return null;
                        };
                        let submitClicked = false;
                        let hasAttemptedClick = false;
                        for (let wait = 0; wait < 60; wait++) { // 최대 60초 대기
                            if (shouldStopUpload)
                                break;
                            const activeBtn = await getVisibleSubmitBtn();
                            if (!activeBtn) {
                                if (hasAttemptedClick) {
                                    // 클릭을 한 번이라도 시도했는데 이제 버튼이 안 보인다면 창이 닫힌(성공한) 것으로 간주
                                    submitClicked = true;
                                    break;
                                }
                            }
                            else {
                                const disabledProp = await activeBtn.isDisabled().catch(() => false);
                                const classStr = await activeBtn.evaluate((b) => b.className || '').catch(() => '');
                                const isDisabledClass = classStr.includes('disabled');
                                if (!disabledProp && !isDisabledClass) {
                                    // 버튼 활성화 상태이므로 클릭 시도 (Playwright click 타임아웃/예외 방지를 위해 evaluate로 강제 클릭)
                                    try {
                                        await activeBtn.evaluate((b) => b.click());
                                    }
                                    catch (evalErr) {
                                        // 무시
                                    }
                                    hasAttemptedClick = true;
                                    // 누르고 나서 2초 대기 후 창이 닫혔는지 재확인
                                    await page.waitForTimeout(2000).catch(() => { });
                                    const stillVisibleBtn = await getVisibleSubmitBtn();
                                    if (!stillVisibleBtn) {
                                        submitClicked = true;
                                        break;
                                    }
                                    else {
                                        sendLog(wc, `⚠️ "게시" 버튼 클릭 시도 후 반응 대기 중...`);
                                    }
                                }
                            }
                            if (submitClicked)
                                break;
                            await page.waitForTimeout(1000).catch(() => { }); // 1초 대기하며 버튼 활성화 기다림
                        }
                        if (!submitClicked && !shouldStopUpload) {
                            throw new Error(`"게시" 버튼이 활성화되지 않거나 찾을 수 없어서 게시물을 등록하지 못했습니다. (업로드 시간 초과)`);
                        }
                        // 완료 체크 (글쓰기 폼이 닫혔는지 대기)
                        await page.waitForSelector(':is(.layer_wrap, .layerContainerView, .layerContainer)', { state: 'hidden', timeout: 30000 }).catch(() => { });
                        sendLog(wc, `게시글 등록 완료! 밴드 서버 처리 확인 중... (최대 40초 대기)`);
                        let newPostUrl = '';
                        let isPostVisible = false;
                        // 최대 40초간 새 게시물이 피드에 나타나는지 확인
                        for (let wait = 0; wait < 40; wait++) {
                            if (shouldStopUpload)
                                break;
                            try {
                                // 가장 최신 게시물의 링크 가져오기 (시간 영역에 링크가 걸려있음)
                                const postLink = page.locator('a[href*="/post/"]').first();
                                if (await postLink.isVisible({ timeout: 1000 }).catch(() => false)) {
                                    const href = await postLink.getAttribute('href').catch(() => null);
                                    if (href) {
                                        newPostUrl = href.startsWith('http') ? href : `https://band.us${href}`;
                                        isPostVisible = true;
                                        break; // 게시물이 피드에 나타났으므로 루프 탈출
                                    }
                                }
                            }
                            catch (e) { }
                            await page.waitForTimeout(1000).catch(() => { }); // 1초 대기 후 재확인
                        }
                        if (!isPostVisible) {
                            sendLog(wc, `⚠️ 게시물이 피드에 바로 나타나지 않았습니다. (서버 처리 지연 또는 예약글일 수 있습니다.)`);
                            await page.waitForTimeout(5000).catch(() => { }); // 혹시 모를 백그라운드 처리를 위해 5초 추가 대기
                        }
                        sendLog(wc, `✅ [행 ${row.rowIndex}] 업로드 완료!`);
                        wc.send('upload:row-success', { rowIndex: row.rowIndex, postUrl: newPostUrl });
                        try {
                            const auth = await getAuthClient();
                            if (auth && settings.googleSpreadsheetUrl) {
                                const match = settings.googleSpreadsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
                                if (match) {
                                    const spreadsheetId = match[1];
                                    const sheets = google.sheets({ version: 'v4', auth });
                                    const meta = await sheets.spreadsheets.get({ spreadsheetId });
                                    let sheetName = 'Sheet1';
                                    if (meta.data.sheets && meta.data.sheets.length > 0) {
                                        sheetName = await resolveSheetTitle(sheets, spreadsheetId, 'band');
                                    }
                                    const aColData = await sheets.spreadsheets.values.get({
                                        spreadsheetId,
                                        range: `'${sheetName}'!A:A`
                                    });
                                    const aColRows = aColData.data.values || [];
                                    let actualRowIndex = -1;
                                    const targetCode = String(row.productCode).replace(/[^0-9]/g, '');
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
                                            requestBody: { values: [[newPostUrl || '밴드등록']] }
                                        });
                                        sendLog(wc, `✅ [제품코드 ${row.productCode}] 구글 시트 E열(위치) 게시물 링크 반영 완료`);
                                    }
                                    else {
                                        sendLog(wc, `⚠️ [제품코드 ${row.productCode}] 구글 시트에서 제품을 찾을 수 없어 링크를 저장하지 못했습니다.`);
                                    }
                                }
                            }
                        }
                        catch (err) {
                            sendLog(wc, `⚠️ 구글 시트 동기화 실패: ${err.message}`);
                        }
                        // --- 타임아웃 내부 블록 끝 ---
                    })(),
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('업로드 시간 초과 (3분)')), 180000);
                    })
                ]);
            }
            catch (err) {
                if (err.message === 'UserStopped') {
                    break;
                }
                sendLog(wc, `❌ [행 ${row.rowIndex}] 업로드 실패: ${err.message} (문제를 확인하기 위해 10초 대기)`);
                wc.send('upload:status-fail', { rowIndex: row.rowIndex });
                // 문제 확인을 위해 즉시 닫지 않고 10초 대기
                await new Promise(resolve => setTimeout(resolve, 10000));
                // 에러가 났거나 타임아웃 발생 시, 꼬인 브라우저 상태를 초기화하기 위해 페이지를 닫고 새로 엽니다.
                if (page) {
                    await page.close().catch(() => { });
                }
                page = await browserContext.newPage();
            }
            finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            }
            // 6. 딜레이
            if (i < rows.length - 1 && !shouldStopUpload) {
                sendLog(wc, `⏳ 스팸 방지를 위해 ${settings.delaySeconds}초 대기 중...`);
                for (let wait = 0; wait < settings.delaySeconds; wait++) {
                    if (shouldStopUpload)
                        break;
                    await page.waitForTimeout(1000);
                }
            }
            // 로컬 원본 이미지는 삭제하지 않음 (보관용)
        }
        if (!shouldStopUpload) {
            sendLog(wc, '\n🎉 모든 선택 항목의 업로드가 완료되었습니다!');
        }
    }
    catch (err) {
        sendLog(wc, `❌ 치명적 오류 발생: ${err.message}`);
    }
    finally {
        isUploading = false;
        wc.send('upload:status', 'finished');
        if (browserContext) {
            // ★ 세션 자동 갱신 (영속 프로필 → 미러 동기화) 후 페이지만 닫음
            try {
                await saveStorageMirror();
                // 창이 너무 빨리 닫히는 것을 방지하기 위해 창 닫기 전 추가 여유 시간 확보
                await new Promise(resolve => setTimeout(resolve, 3000));
                const pages = browserContext.pages();
                // 이 업로드에서 연 페이지만 닫기 (공유 컨텍스트이므로 다른 작업 페이지 보호)
                for (const p of pages) {
                    if (p.isClosed())
                        continue;
                    const u = p.url();
                    if (u.includes('band.us') && !u.includes('auth.band.us')) {
                        await p.close().catch(() => { });
                    }
                }
                console.log('[UploaderBot] 업로드 완료 후 세션 상태 동기화 완료');
            }
            catch (e) { }
        }
    }
}
export async function deleteSpreadsheetRows(settings, rowsToDelete, targetTab = 'band') {
    try {
        const auth = await getAuthClient();
        if (!auth)
            throw new Error('구글 인증 오류: 토큰이 없습니다.');
        const match = settings.googleSpreadsheetUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!match)
            throw new Error('올바르지 않은 구글 스프레드시트 URL입니다.');
        const spreadsheetId = match[1];
        const sheets = google.sheets({ version: 'v4', auth });
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        let sheetId = 0;
        let sheetTitle = 'Sheet1';
        if (meta.data.sheets && meta.data.sheets.length > 0) {
            sheetTitle = await resolveSheetTitle(sheets, spreadsheetId, targetTab);
            const targetSheet = meta.data.sheets.find((s) => s.properties?.title === sheetTitle);
            if (targetSheet && targetSheet.properties?.sheetId != null) {
                sheetId = targetSheet.properties.sheetId;
            }
        }
        // 1. 시트 A열(제품코드)을 가져와 실제 행 인덱스를 찾기
        const aColData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetTitle}'!A:A`
        });
        const aColRows = aColData.data.values || [];
        const codesToDelete = new Set(rowsToDelete.map(r => String(r.productCode).replace(/[^0-9]/g, '')));
        const actualRowIndices = [];
        for (let i = 0; i < aColRows.length; i++) {
            const cellVal = aColRows[i][0];
            if (cellVal) {
                const codeStr = String(cellVal).replace(/[^0-9]/g, '');
                if (codeStr && codesToDelete.has(codeStr)) {
                    actualRowIndices.push(i + 1); // 1-indexed
                }
            }
        }
        if (actualRowIndices.length === 0) {
            throw new Error(`삭제할 상품을 스프레드시트('${sheetTitle}' 탭)에서 찾지 못했습니다.`);
        }
        // 내림차순 정렬 (인덱스 밀림 방지)
        actualRowIndices.sort((a, b) => b - a);
        const requests = actualRowIndices.map(rIndex => ({
            deleteDimension: {
                range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rIndex - 1,
                    endIndex: rIndex
                }
            }
        }));
        if (requests.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });
        }
        // 2. 로컬 이미지 폴더 강제 삭제
        const CATALOG_CONFIG_PATH = path.join(app.getPath('userData'), 'catalog_config.json');
        let localImagePath = '';
        if (fs.existsSync(CATALOG_CONFIG_PATH)) {
            try {
                const catalogConfig = JSON.parse(fs.readFileSync(CATALOG_CONFIG_PATH, 'utf-8'));
                localImagePath = catalogConfig.localImagePath || '';
            }
            catch (e) { }
        }
        if (localImagePath) {
            for (const row of rowsToDelete) {
                const prodCode = String(row.productCode).replace(/[^0-9]/g, '');
                if (prodCode) {
                    const possibleFolders = [];
                    if (targetTab === 'market') {
                        possibleFolders.push(path.join(localImagePath, 'openmarket', prodCode));
                    }
                    else {
                        possibleFolders.push(path.join(localImagePath, 'band', prodCode));
                    }
                    for (const prodFolder of possibleFolders) {
                        if (fs.existsSync(prodFolder)) {
                            try {
                                fs.rmSync(prodFolder, { recursive: true, force: true });
                            }
                            catch (e) {
                                console.error('로컬 폴더 삭제 실패:', e);
                            }
                        }
                    }
                }
            }
        }
        return { success: true, message: `${rowsToDelete.length}개의 상품을 구글 시트와 로컬에서 삭제했습니다.` };
    }
    catch (err) {
        console.error('삭제 오류:', err);
        return { success: false, message: `삭제 실패: ${err.message}` };
    }
}
let queuePollerTimer = null;
let wcRef = null;
export function setWebContentsRef(wc) {
    wcRef = wc;
}
export function startQueuePoller() {
    if (queuePollerTimer)
        return;
    queuePollerTimer = setInterval(async () => {
        if (isUploading)
            return; // 이미 다른 업로드가 진행 중이면 대기
        const queue = getUploadQueue();
        const now = Date.now();
        // 예약 시간이 지난 PENDING 항목 찾기
        const dueItems = queue.filter(item => item.status === 'PENDING' && item.scheduledTime <= now);
        if (dueItems.length === 0)
            return;
        console.log(`[Queue Poller] Found ${dueItems.length} due items.`);
        const settings = getUploadSettings();
        if (!settings || !settings.googleSpreadsheetUrl) {
            console.log('[Queue Poller] 구글 시트 URL 설정이 없어 업로드를 진행할 수 없습니다.');
            return;
        }
        try {
            // 진행 중으로 상태 변경
            dueItems.forEach(item => item.status = 'UPLOADING');
            saveUploadQueue(queue);
            const allRows = await fetchSpreadsheetData(settings.googleSpreadsheetUrl);
            const rowsToUpload = allRows.filter(row => dueItems.some(item => String(item.prodCode) === String(row.productCode)));
            // 오래된 데이터(rowIndex가 작은 값)부터 먼저 업로드하도록 오름차순 정렬
            rowsToUpload.sort((a, b) => a.rowIndex - b.rowIndex);
            if (rowsToUpload.length > 0) {
                if (wcRef)
                    sendLog(wcRef, `[백그라운드 대기열] ${rowsToUpload.length}개 상품 업로드를 시작합니다.`);
                // 백그라운드 업로드 시작
                await startAutoUpload({ settings, rows: rowsToUpload }, wcRef);
                // 업로드 성공 후 상태 업데이트 (실제 에러처리는 startAutoUpload 내부나 이후 검증이 필요하지만, 단순하게 DONE 처리)
                dueItems.forEach(item => item.status = 'DONE');
                saveUploadQueue(queue);
            }
            else {
                // 시트에서 데이터를 찾지 못한 경우
                dueItems.forEach(item => item.status = 'ERROR');
                saveUploadQueue(queue);
            }
        }
        catch (e) {
            console.error('[Queue Poller] 자동 업로드 에러:', e);
            dueItems.forEach(item => item.status = 'ERROR');
            saveUploadQueue(queue);
        }
    }, 1000); // 1초 주기 (정확한 타이밍 맞춤)
}
