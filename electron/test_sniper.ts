// @ts-nocheck
import { chromium } from 'playwright';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as dgram from 'dgram';
import { EventEmitter } from 'events';
export class SniperManager {
    async robustSubmit(page, input, postContainer, bidValue) {
        const bidStr = bidValue.toString().replace(/['"]/g, '');
        let sent = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            let textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
            if (!textLeft.includes(bidStr)) {
                await input.focus({ timeout: 1000 }).catch(() => { });
                await input.fill(bidStr, { timeout: 1000 }).catch(async () => {
                    await input.pressSequentially(bidStr, { delay: 0, timeout: 1000 }).catch(() => { });
                });
                await page.waitForTimeout(50);
                textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                if (!textLeft.includes(bidStr)) {
                    console.log(`[RobustSubmit] Re-fill failed on attempt ${attempt + 1}`);
                    continue;
                }
            }
            await input.press('Control+Enter').catch(() => { });
            await page.waitForTimeout(50);
            await postContainer.evaluate((container) => {
                const btn = container.querySelector('button._btnSubmitComment, .uBtn.-submit, .submit, ._btnSubmit, .btnSend, .btn_send');
                if (btn)
                    btn.click();
            }).catch(() => { });
            await page.waitForTimeout(100);
            textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
            if (!textLeft.includes(bidStr)) {
                sent = true;
                break;
            }
            console.log(`[RobustSubmit] React update was too slow. Retrying submit (${attempt + 1}/5)...`);
        }
        return sent;
    }
    tasks = new Map();
    bandSettings = new Map();
    browserInstances = new Map();
    storagePath = path.join(app.getPath('userData'), 'naver-storage-state.json');
    settingsPath = path.join(app.getPath('userData'), 'band-settings.json');
    tasksPath = path.join(app.getPath('userData'), 'snipe-tasks.json');
    onTaskUpdate;
    // Global Observer State
    activeGlobalObservers = new Set(); // Set of startPostUrl
    globalEvents = new EventEmitter();
    timeOffset = 0;
    lastLaunchTime = 0;
    getServerTimeOffset() {
        return this.timeOffset;
    }
    getServerTime() {
        return Date.now() + this.timeOffset;
    }
    getNtpTime(server = 'time.google.com', port = 123, timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            const client = dgram.createSocket('udp4');
            const ntpData = Buffer.alloc(48);
            ntpData[0] = 0x1B;
            const timeout = setTimeout(() => {
                client.close();
                reject(new Error('NTP Timeout'));
            }, timeoutMs);
            const start = performance.now();
            client.on('message', (msg) => {
                clearTimeout(timeout);
                const end = performance.now();
                client.close();
                const offset = 40;
                let intpart = 0;
                let fractpart = 0;
                for (let i = 0; i <= 3; i++)
                    intpart = 256 * intpart + msg[offset + i];
                for (let i = 4; i <= 7; i++)
                    fractpart = 256 * fractpart + msg[offset + i];
                const ms = (intpart * 1000 + (fractpart * 1000) / 0x100000000) - 2208988800000;
                const latency = (end - start) / 2;
                const serverTime = ms;
                const timeOffset = serverTime + latency - Date.now();
                resolve({ timeOffset, latency, serverTime });
            });
            client.on('error', (err) => { clearTimeout(timeout); client.close(); reject(err); });
            client.send(ntpData, port, server, (err) => { if (err) {
                clearTimeout(timeout);
                client.close();
                reject(err);
            } });
        });
    }
    async syncServerTime() {
        try {
            console.log('[TimeSync] 플랜 A: NTP(초정밀) 동기화 시작...');
            try {
                const ntpResult = await this.getNtpTime('time.google.com');
                this.timeOffset = ntpResult.timeOffset;
                console.log(`[TimeSync] 플랜 A (NTP) 성공! 오차 보정값(Offset): ${this.timeOffset.toFixed(2)}ms, Ping: ${(ntpResult.latency * 2).toFixed(2)}ms`);
                return;
            }
            catch (ntpErr) {
                console.log('[TimeSync] 플랜 A (NTP) 실패:', ntpErr.message, '-> 플랜 B (Tick-Sync) 자동 전환');
            }
            console.log('[TimeSync] 플랜 B: 정밀 틱(Tick) 동기화 시작...');
            const initialResponse = await fetch('https://band.us', { method: 'GET' }).catch(() => null);
            if (!initialResponse) {
                console.log('[TimeSync] 초기 연결 실패');
                return;
            }
            const lastDateStr = initialResponse.headers.get('date');
            if (!lastDateStr) {
                console.log('[TimeSync] 초기 date 헤더 획득 실패 (동기화 중단)');
                return;
            }
            let attempts = 0;
            while (attempts < 50) {
                attempts++;
                const start = performance.now();
                const response = await fetch('https://band.us', { method: 'GET' }).catch(() => null);
                if (!response) {
                    await new Promise(r => setTimeout(r, 50));
                    continue;
                }
                const end = performance.now();
                const currentDateStr = response.headers.get('date');
                if (currentDateStr && currentDateStr !== lastDateStr) {
                    const serverTime = new Date(currentDateStr).getTime();
                    const latency = (end - start) / 2;
                    this.timeOffset = serverTime - (Date.now() - latency);
                    console.log(`[TimeSync] 플랜 B (Tick-Sync) 성공! 오차 보정값(Offset): ${this.timeOffset.toFixed(2)}ms, Ping: ${(latency * 2).toFixed(2)}ms (시도 횟수: ${attempts})`);
                    return;
                }
                await new Promise(r => setTimeout(r, 50));
            }
            console.log('[TimeSync] 플랜 B (Tick-Sync) 타임아웃, 기존 방식 적용.');
        }
        catch (e) {
            console.error('[TimeSync] Failed to sync server time:', e);
        }
    }
    async initBrowser() {
        this.loadSettings();
        await this.syncServerTime();
        setInterval(() => this.syncServerTime(), 3600 * 1000); // Re-sync every hour
        console.log('Sniper Manager: Scheduler started. Auth state stored at:', this.storagePath);
        this.startScheduler();
    }
    loadSettings() {
        if (fs.existsSync(this.settingsPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
                data.forEach((s) => this.bandSettings.set(s.id, s));
            }
            catch (e) { }
        }
        if (fs.existsSync(this.tasksPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tasksPath, 'utf8'));
                data.forEach((t) => {
                    // Reset active tasks to WAITING so they can restart correctly after reboot
                    if (['WARMUP_60', 'WARMUP_30', 'SNIPING', 'OBSERVING'].includes(t.status)) {
                        t.status = 'WAITING';
                    }
                    this.tasks.set(t.id, t);
                });
            }
            catch (e) { }
        }
    }
    saveSettings() {
        fs.writeFileSync(this.settingsPath, JSON.stringify(Array.from(this.bandSettings.values()), null, 2));
    }
    saveTasks() {
        fs.writeFileSync(this.tasksPath, JSON.stringify(Array.from(this.tasks.values()), null, 2));
    }
    getBandSettings() { return Array.from(this.bandSettings.values()); }
    saveBandSetting(setting) { this.bandSettings.set(setting.id, setting); this.saveSettings(); }
    deleteBandSetting(id) { this.bandSettings.delete(id); this.saveSettings(); }
    async openBrowser(url = 'https://auth.band.us/login_page') {
        console.log(`Opening browser at ${url}...`);
        const now = Date.now();
        const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
        this.lastLaunchTime = targetLaunchTime;
        const delayNeeded = targetLaunchTime - now;
        if (delayNeeded > 0) {
            await new Promise(r => setTimeout(r, delayNeeded));
        }
        const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--start-maximized'] });
        const context = fs.existsSync(this.storagePath) ? await browser.newContext({ storageState: this.storagePath }) : await browser.newContext();
        const page = await context.newPage();
        await page.goto(url);
        // 로그인 성공 후 밴드 홈/피드로 이동 시 안전하게 세션 1회 자동 저장 (네이버 로그인 중복 감지 방지)
        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame()) {
                const url = frame.url();
                if (url.includes('band.us') && !url.includes('login_page') && !url.includes('nid.naver.com')) {
                    // 페이지 로딩 후 3초 뒤에 한 번만 저장
                    setTimeout(async () => {
                        try {
                            await context.storageState({ path: this.storagePath });
                            console.log('Session saved successfully.');
                        }
                        catch (e) { }
                    }, 3000);
                }
            }
        });
        context.on('page', p => {
            p.on('close', async () => {
                const pages = context.pages();
                if (pages.length <= 1) {
                    try {
                        await context.storageState({ path: this.storagePath });
                    }
                    catch (e) { }
                    await browser.close();
                }
            });
        });
    }
    addTask(task) {
        this.tasks.set(task.id, task);
        this.saveTasks();
        this.emitUpdate(task);
        if (!task.postTitle) {
            this.fetchPostTitle(task);
        }
    }
    removeTask(taskId) { this.tasks.delete(taskId); this.saveTasks(); }
    updateTask(taskId, partial) {
        const task = this.tasks.get(taskId);
        if (task) {
            Object.assign(task, partial);
            this.tasks.set(taskId, task);
            this.saveTasks();
            this.emitUpdate(task);
        }
    }
    getTasks() { return Array.from(this.tasks.values()); }
    async fetchPostTitle(task) {
        try {
            const now = Date.now();
            const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
            this.lastLaunchTime = targetLaunchTime;
            const delayNeeded = targetLaunchTime - now;
            if (delayNeeded > 0) {
                await new Promise(r => setTimeout(r, delayNeeded));
            }
            const browser = await chromium.launch({ headless: true, channel: 'chrome' });
            const context = fs.existsSync(this.storagePath)
                ? await browser.newContext({ storageState: this.storagePath })
                : await browser.newContext();
            const page = await context.newPage();
            await page.goto(task.url, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.txtBody', { timeout: 5000 }).catch(() => { });
            const text = await page.evaluate(() => {
                const body = document.querySelector('.txtBody');
                return body ? body.textContent : null;
            });
            if (text) {
                let cleanText = text.replace(/[\r\n]+/g, ' ').trim();
                task.postTitle = cleanText.length > 15 ? cleanText.slice(0, 15) + '...' : cleanText;
                this.emitUpdate(task);
            }
            await browser.close();
        }
        catch (e) {
            console.error(`Failed to fetch title for task ${task.id}:`, e);
        }
    }
    emitUpdate(task) {
        console.log(`[Task ${task.id}] Status: ${task.status} | Msg: ${task.resultMsg || ''}`);
        this.saveTasks();
        if (this.onTaskUpdate)
            this.onTaskUpdate(task);
    }
    async runRaceLoop(task, page, browser, ourHighestBid, inputSelector, containerSelector, maxEndTime) {
        let currentOurBid = ourHighestBid;
        const bandSetting = task.bandSettingId ? this.bandSettings.get(task.bandSettingId) : undefined;
        let isFirstLoop = true;
        const postContainer = page.locator(containerSelector);
        while (true) {
            if (maxEndTime && this.getServerTime() > maxEndTime) {
                break; // 20초 연장 방어 종료
            }
            if (isFirstLoop) {
                isFirstLoop = false;
                await page.waitForTimeout(100);
            }
            else {
                // 지속적인 서버 통신을 방지하고 여유를 주기 위해 0.5초 대기
                await page.waitForTimeout(500);
            }
            await this.waitForCommentsAPI(page, containerSelector, async () => {
                if (task.strategy === 'FEED') {
                    const commentBtn = postContainer.locator('._commentCountBtn').first();
                    if (await commentBtn.count() > 0) {
                        await commentBtn.click().catch(() => { }); // 접기
                        await page.waitForTimeout(50); // 짧은 딜레이로 접기/펴기 연속 클릭 보장
                        await commentBtn.click().catch(() => { }); // 펴기
                    }
                    else {
                        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                    }
                }
                else {
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            });
            await page.waitForTimeout(100);
            // 이전 댓글 숨겨진 경우 모두 로드 (경쟁자가 많을 경우 대비)
            await this.loadAllComments(postContainer, page).catch(() => { });
            // Check input exists inside container
            let inputExists = await postContainer.locator(inputSelector).count() > 0;
            if (!inputExists) {
                console.log('[Sniper] No input box found in container, admin might have closed it.');
                break; // 댓글창 닫힘 (관리자가 닫음)
            }
            const adminId = bandSetting?.adminId || '';
            const { authors, texts } = await postContainer.evaluate((container, sel) => {
                const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
                const authorsList = [];
                const textsList = [];
                wraps.forEach(node => {
                    const authorNode = node.querySelector('.name, ._commentWriterName, strong.text');
                    // ★ authorNode가 없는 노드는 건너뛰기 (배열 정합성 보장)
                    if (!authorNode)
                        return;
                    const textNode = node.querySelector('p.txt, ._commentContent') || node;
                    authorsList.push(authorNode.innerText.trim());
                    textsList.push(textNode ? textNode.innerText.trim() : '');
                });
                return { authors: authorsList, texts: textsList };
            }, inputSelector);
            // Check admin
            if (adminId && authors.some(a => a.replace(/\s/g, '').includes(adminId.replace(/\s/g, '')))) {
                task.status = 'SUCCESS';
                task.resultMsg = `레이스 종료: 관리자 마감 확인 (최종가: ${currentOurBid})`;
                this.emitUpdate(task);
                break;
            }
            let highest = 0;
            for (let j = texts.length - 1; j >= 0; j--) {
                const parsed = this.parseBidAmount(texts[j]);
                if (parsed !== null)
                    highest = Math.max(highest, parsed);
            }
            // ★ 동점 감지: 최고가가 같고 상대가 먼저면 추월당한 것
            const myName = bandSetting?.myNickname || '';
            let isOutbid = highest > currentOurBid;
            // 안전장치: myNickname이 설정되어 있고, maxBid가 있을 때만 동점 체크
            if (!isOutbid && myName && highest === currentOurBid && highest > 0) {
                const tieResult = this.checkTieBreak(authors, texts, myName);
                if (tieResult.isTied && !tieResult.amIFirst) {
                    isOutbid = true;
                    console.log(`[TieBreak-RaceLoop] 동점 추월 감지! ${highest} → +${task.increment} 재입찰 필요`);
                }
            }
            if (isOutbid) {
                // We are outbid!
                const nextBid = highest + task.increment;
                if (task.maxBid !== undefined && nextBid > task.maxBid) {
                    task.status = 'ABORTED';
                    task.resultMsg = `레이스 포기: 한도(${task.maxBid}) 초과 (현재최고가: ${highest})`;
                    this.emitUpdate(task);
                    break;
                }
                // Place new bid
                const input = postContainer.locator(inputSelector).first();
                try {
                    await input.focus({ timeout: 2000 });
                    // React 상태 업데이트 지연을 방지하기 위해 순차 입력 시도
                    // 사전 검증 (Pre-verify)
                    const bidStrVal_1 = nextBid.toString().replace(/['"]/g, '');
                    let filled_1 = false;
                    for (let i = 0; i < 3; i++) {
                        await input.fill(bidStrVal_1, { timeout: 1000 }).catch(() => { });
                        let currentText = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                        if (currentText.includes(bidStrVal_1)) {
                            filled_1 = true;
                            break;
                        }
                        await page.waitForTimeout(50).catch(() => { });
                    }
                    if (!filled_1)
                        throw new Error('입력창에 금액을 입력할 수 없습니다.');
                    let sent_1 = false;
                    for (let attempt = 0; attempt < 5; attempt++) {
                        await input.press('Control+Enter').catch(() => { });
                        await postContainer.evaluate((container) => {
                            const btn = container.querySelector('.submit, ._btnSubmit, .btnSubmit, .btnCommentSubmit, .uBtn.-submit');
                            if (btn)
                                btn.click();
                        }).catch(() => { });
                        await page.waitForTimeout(100).catch(() => { });
                        let textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                        if (!textLeft.includes(bidStrVal_1)) {
                            sent_1 = true;
                            break;
                        }
                        console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/5)...`);
                    }
                    const submitTime = this.getServerTime();
                    task.submitTimeLog = submitTime;
                    await page.waitForTimeout(100); // 전송 대기 (800ms -> 300ms 최적화)
                    currentOurBid = nextBid;
                    task.resultMsg = `방어 입찰 완료: ${nextBid} (전송: ${new Date(submitTime).toISOString().slice(11, 23)})`;
                    this.emitUpdate(task);
                }
                catch (e) {
                    console.error("Submit failed:", e);
                    task.status = 'FAILED';
                    task.resultMsg = `방어 입찰 실패: ${e.name === 'TimeoutError' ? '댓글창 닫힘' : e.message}`;
                    this.emitUpdate(task);
                    break; // Exit loop, we can't bid
                }
            }
        }
        // Final check
        // ★ Final Check: 동점 감지 포함한 최종 판정
        let finalHighest = currentOurBid;
        let finalIsTied = false;
        let finalAmIFirst = true;
        const myNameFinal = bandSetting?.myNickname || '';
        let winnerName = myNameFinal || '알 수 없음';
        try {
            const { authors: finalAuthors, texts: finalTexts } = await this.extractAuthorsAndTexts(postContainer);
            const bids = [];
            for (let i = 0; i < finalTexts.length; i++) {
                const amount = this.parseBidAmount(finalTexts[i]);
                if (amount !== null && i < finalAuthors.length && finalAuthors[i]) {
                    bids.push({ author: finalAuthors[i].replace(/\s/g, ''), amount });
                }
            }
            if (bids.length > 0) {
                const highestInList = bids.reduce((max, b) => Math.max(max, b.amount), 0);
                finalHighest = Math.max(currentOurBid, highestInList);
                const topBidders = bids.filter(b => b.amount === finalHighest);
                if (topBidders.length > 0) {
                    winnerName = topBidders[0].author;
                }
                if (myNameFinal && finalHighest === currentOurBid && finalHighest > 0) {
                    const tieResult = this.checkTieBreak(finalAuthors, finalTexts, myNameFinal);
                    finalIsTied = tieResult.isTied;
                    finalAmIFirst = tieResult.amIFirst;
                }
            }
        }
        catch (e) { }
        if (finalHighest > currentOurBid || (finalIsTied && !finalAmIFirst)) {
            if (task.status !== 'ABORTED' && (!task.resultMsg || !task.resultMsg.includes('실패'))) {
                task.status = 'FAILED';
                const reason = finalIsTied ? '(동점 선입찰자 패배)' : '';
                task.resultMsg = `[낙찰 실패] 내 입찰: ${currentOurBid}, 상대 최고가: ${finalHighest} (낙찰자: ${winnerName}) ${reason}`;
            }
        }
        else {
            if (task.status !== 'ABORTED' && task.status !== 'FAILED') {
                task.status = 'SUCCESS';
                task.resultMsg = `[낙찰 성공] 최종가: ${currentOurBid} 방어 성공! (낙찰자: ${winnerName})`;
            }
        }
        this.emitUpdate(task);
        await browser.close();
        this.browserInstances.delete(task.id);
    }
    parseBidAmount(text) {
        let cleanText = text.replace(/@[^\s]+\s*/g, '');
        cleanText = cleanText.replace(/[요원만원천낙찰입찰갑니다콜,.\sㅋㅎ!~?]/g, '');
        if (/^\d+$/.test(cleanText))
            return parseInt(cleanText, 10);
        return null;
    }
    /**
     * 동점 판별 함수 (Tie-Break Detection)
     *
     * 왜 필요한가: 동일한 동일한 입찰가를 여러 명이 제시했을 때,
     * "먼저 입찰한 사람이 낙찰"되는 규칙을 처리하기 위함.
     *
     * 댓글 순서(위→아래) = 시간순(빠른→늦은)이므로,
     * 같은 금액 중 가장 위에 있는 사람이 선입찰자.
     */
    checkTieBreak(authors, texts, myName) {
        // 1) (작성자, 금액) 쌍 추출 — authors와 texts의 인덱스가 1:1 대응
        const bids = [];
        for (let i = 0; i < texts.length; i++) {
            const amount = this.parseBidAmount(texts[i]);
            if (amount !== null && i < authors.length && authors[i]) {
                bids.push({ author: authors[i], amount });
            }
        }
        // 2) 최고가 산출
        const highest = bids.reduce((max, b) => Math.max(max, b.amount), 0);
        if (highest === 0)
            return { highest: 0, isTied: false, amIFirst: true };
        // 3) 최고가 동점자 필터 (댓글 순서 유지 = 시간순)
        const topBidders = bids.filter(b => b.amount === highest);
        // 4) 동점 아닌 경우 (최고가 입찰자가 1명뿐)
        if (topBidders.length <= 1) {
            const isMe = topBidders[0]?.author.replace(/\s/g, '').includes(myName.replace(/\s/g, ''));
            return { highest, isTied: false, amIFirst: isMe };
        }
        // 5) 동점인 경우: 먼저 등장한 댓글 = 먼저 입찰한 사람 = 낙찰 우선권
        const firstTopBidder = topBidders[0];
        const amIFirst = firstTopBidder.author.replace(/\s/g, '').includes(myName.replace(/\s/g, ''));
        console.log(`[TieBreak] 동점 감지! 최고가:${highest}, 동점자:${topBidders.length}명, 선입찰자:'${firstTopBidder.author}', 내가 먼저?:${amIFirst}`);
        return { highest, isTied: true, amIFirst };
    }
    /**
     * 댓글에서 작성자 + 텍스트를 한 번에 추출하는 헬퍼
     * (evaluate 호출 1회로 속도 최적화)
     *
     * ★ 중요: authorNode가 있는 댓글만 추출하여 authors/texts 배열이
     * 항상 같은 길이를 유지하도록 보장 (배열 불일치 버그 방지)
     */
    /**
     * 댓글 새로고침(또는 접기/펴기) 후 API 응답을 기다리고,
     * 댓글이 있으면 DOM 렌더링까지 기다리는 핵심 최적화 헬퍼
     */
    async waitForCommentsAPI(page, containerSelector, actionCallback) {
        let fetchedCommentsCount = -1;
        const t0 = this.getServerTime();
        // API 응답 대기 (최대 4초)
        const responsePromise = page.waitForResponse(res => res.url().includes('get_comments') && res.status() === 200, { timeout: 4000 }).then(async (res) => {
            try {
                const json = await res.json();
                fetchedCommentsCount = json.result_data?.items?.length || 0;
            }
            catch (e) { }
            return res;
        }).catch(() => null);
        // 액션 실행 (새로고침 또는 클릭)
        await actionCallback();
        // API 응답이 올 때까지 대기
        await responsePromise;
        const t1 = this.getServerTime();
        if (fetchedCommentsCount === 0) {
            console.log(`[Sniper API] 댓글 0개 확인 (API 지연: ${t1 - t0}ms). DOM 렌더링 대기 생략!`);
        }
        else {
            console.log(`[Sniper API] 댓글 ${fetchedCommentsCount > 0 ? fetchedCommentsCount : '?'}개 확인 (API 지연: ${t1 - t0}ms). DOM 렌더링 대기 중...`);
            // 텍스트 렌더링 완료까지 대기 (고정 100ms)
            await page.waitForTimeout(100);
            const t2 = this.getServerTime();
            console.log(`[Sniper API] DOM 렌더링 완료 (DOM 렌더링 소요: ${t2 - t1}ms, 총 소요시간: ${t2 - t0}ms)`);
        }
    }
    async extractAuthorsAndTexts(postContainer) {
        return await postContainer.evaluate((container) => {
            const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
            const authorsList = [];
            const textsList = [];
            wraps.forEach(node => {
                const authorNode = node.querySelector('.name, ._commentWriterName, strong.text');
                // ★ authorNode가 없는 노드는 건너뛰기 (배열 정합성 보장)
                if (!authorNode)
                    return;
                const textNode = node.querySelector('p.txt, ._commentContent') || node;
                authorsList.push(authorNode.innerText.trim());
                textsList.push(textNode ? textNode.innerText.trim() : '');
            });
            return { authors: authorsList, texts: textsList };
        });
    }
    /**
     * 피드 뷰에서 "이전 댓글 보기" 등 버튼을 클릭하여 숨겨진 댓글을 모두 로드
     *
     * 왜 필요한가: Band 피드에서 fold/unfold 시 최근 2-3개 댓글만 표시되고,
     * 나머지는 "이전 댓글 N개" 버튼 뒤에 숨겨짐.
     * 이를 클릭하지 않으면 전체 최고가를 정확히 파악할 수 없음.
     */
    async loadAllComments(postContainer, page) {
        try {
            // Band에서 사용하는 "이전 댓글 보기" 관련 버튼 셀렉터
            const moreCommentSelectors = [
                'a._viewCommentMore', // "이전 댓글 N개"
                'button._moreComment', // "더보기" 
                'a._moreCommentBtn', // 댓글 더보기
                '.viewPrevComment', // 이전 댓글 보기
                '[class*="prevComment"]', // 이전 댓글 관련
            ];
            const selectorString = moreCommentSelectors.join(', ');
            // 대표님 피드백 반영: 실전 경매에서는 최신 3~4개에 최고가가 몰리므로 1회만 클릭하여 속도 우선
            for (let attempt = 0; attempt < 1; attempt++) {
                const moreBtn = postContainer.locator(selectorString).first();
                if (await moreBtn.count() === 0)
                    break;
                try {
                    await moreBtn.click({ timeout: 1000 });
                    await page.waitForTimeout(200); // 렌더링 대기
                    console.log(`[LoadComments] 이전 댓글 1회 로드 완료`);
                }
                catch {
                    break; // 클릭 실패 시 중단
                }
            }
        }
        catch (e) {
            // 무시: 버튼이 없거나 이미 모든 댓글이 로드된 상태
        }
    }
    startScheduler() {
        setInterval(() => {
            const now = this.getServerTime();
            for (const [id, task] of this.tasks.entries()) {
                const bandSetting = task.bandSettingId ? this.bandSettings.get(task.bandSettingId) : undefined;
                if (!bandSetting || !task.targetTime)
                    continue;
                const timeRemaining = task.targetTime - now;
                if (bandSetting.deadlineType === 'OBSERVER') {
                    if (timeRemaining <= 60000 && timeRemaining > 0 && task.status === 'WAITING' && !task.triggerUrl) {
                        task.status = 'WARMUP_60';
                        this.emitUpdate(task);
                        this.calculateTriggerUrl(task, bandSetting).catch(e => {
                            console.error(`Task ${id} trigger calc failed:`, e);
                            task.status = 'FAILED';
                            task.resultMsg = '트리거 주소 계산 실패';
                            this.emitUpdate(task);
                        });
                    }
                    if (timeRemaining <= 0 && (task.status === 'WARMUP_60' || task.status === 'WAITING')) {
                        // triggerUrl 계산이 아직 안 끝났으면 대기 (스케줄러가 1초마다 재확인)
                        if (!task.triggerUrl) {
                            // 30초 이상 지났는데도 triggerUrl이 없으면 실패 처리
                            if (timeRemaining < -30000) {
                                task.status = 'FAILED';
                                task.resultMsg = '트리거 URL 계산 시간 초과 (30초)';
                                this.emitUpdate(task);
                            }
                            continue; // triggerUrl 계산 완료까지 대기
                        }
                        task.status = 'OBSERVING';
                        this.emitUpdate(task);
                        if (task.startPostUrl) {
                            this.startGlobalObserver(task.startPostUrl, bandSetting).catch(e => console.error('Global Observer failed', e));
                        }
                        this.waitForTriggerAndSnipe(task, bandSetting).catch(e => {
                            console.error(`Task ${id} snipe failed:`, e);
                            task.status = 'FAILED';
                            task.resultMsg = e.message;
                            this.emitUpdate(task);
                        });
                    }
                }
                else {
                    // TIME based
                    if (timeRemaining <= 125000 && timeRemaining > 0 && task.status === 'WAITING') {
                        task.status = 'WARMUP_60';
                        this.emitUpdate(task);
                        this.executeFeedSnipe(task).catch(e => {
                            console.error(`Task ${id} workflow failed:`, e);
                            task.status = 'FAILED';
                            task.resultMsg = e.message;
                            this.emitUpdate(task);
                        });
                    }
                }
            }
        }, 1000);
    }
    // --- Observer Mode Logic ---
    async calculateTriggerUrl(task, bandSetting) {
        const now = Date.now();
        const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
        this.lastLaunchTime = targetLaunchTime;
        const delayNeeded = targetLaunchTime - now;
        if (delayNeeded > 0) {
            await new Promise(r => setTimeout(r, delayNeeded));
        }
        const browser = await chromium.launch({ headless: false, args: ['--window-size=1280,800'] });
        const context = await browser.newContext({ storageState: this.storagePath });
        const page = await context.newPage();
        await page.goto(task.url, { waitUntil: 'domcontentloaded' });
        const distance = task.observerDistance || 2;
        const directionBtnSelector = bandSetting.observerOrder === 'REVERSE' ? 'a._prevPost' : 'a._nextPost';
        const bandIdMatch = task.url.match(/\/band\/(\d+)/);
        const bandId = bandIdMatch ? bandIdMatch[1] : null;
        for (let i = 0; i < distance; i++) {
            await page.waitForSelector(directionBtnSelector, { timeout: 10000 });
            await page.click(directionBtnSelector);
            await page.waitForTimeout(2000);
            // 광고/추천 페이지 방어: URL에 /page/가 있거나, 현재 밴드 ID와 다르면 건너뜀
            let currentUrl = page.url();
            let retryAd = 0;
            while (retryAd < 5 && (currentUrl.includes('/page/') || (bandId && !currentUrl.includes(`/band/${bandId}`)))) {
                console.log(`[광고/페이지 감지] 타겟 밴드가 아닙니다. 건너뜁니다: ${currentUrl}`);
                await page.waitForSelector(directionBtnSelector, { timeout: 5000 }).catch(() => { });
                await page.click(directionBtnSelector).catch(() => { });
                await page.waitForTimeout(2000);
                currentUrl = page.url();
                retryAd++;
            }
        }
        const rawUrl = page.url();
        const cleanUrl = rawUrl.split('?')[0];
        task.triggerUrl = cleanUrl;
        console.log(`[Task ${task.id}] Calculated Trigger URL: ${cleanUrl}`);
        this.emitUpdate(task);
        await browser.close();
    }
    /**
     * Global Observer: 관리자 활동을 끈질기게 추적하는 감시자
     *
     * 왜 재시작 로직이 필요한가:
     * - 관리자가 30초~1분 자리를 비울 때 Band 페이지가 불안정해질 수 있음
     * - 네트워크 끊김, 세션 만료 등으로 page.evaluate()가 에러를 던질 수 있음
     * - 이때 Observer가 죽으면 스나이핑 태스크가 영원히 대기하게 됨
     *
     * 해결: 개별 에러는 무시하고 계속, 브라우저 크래시 시 마지막 위치에서 자동 재시작
     */
    async startGlobalObserver(startPostUrl, bandSetting) {
        const cleanStartUrl = startPostUrl.split('?')[0];
        if (this.activeGlobalObservers.has(cleanStartUrl))
            return;
        this.activeGlobalObservers.add(cleanStartUrl);
        console.log(`[Global Observer] Started tracking at: ${cleanStartUrl}`);
        const MAX_RETRIES = 5;
        let retryCount = 0;
        let lastTrackedUrl = cleanStartUrl; // 마지막 추적 위치 기억 (재시작 시 이어서 추적)
        while (retryCount < MAX_RETRIES) {
            let browser = null;
            try {
                // 브라우저 실행 간격 조절 (중복 실행 방지)
                const now = Date.now();
                const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
                this.lastLaunchTime = targetLaunchTime;
                const delayNeeded = targetLaunchTime - now;
                if (delayNeeded > 0) {
                    await new Promise(r => setTimeout(r, delayNeeded));
                }
                browser = await chromium.launch({ headless: false, args: ['--window-size=1280,800'] });
                const context = await browser.newContext({ storageState: this.storagePath });
                const page = await context.newPage();
                await page.goto(lastTrackedUrl, { waitUntil: 'domcontentloaded' });
                const directionBtnSelector = bandSetting.observerOrder === 'REVERSE' ? 'a._nextPost' : 'a._prevPost';
                const bandIdMatch = cleanStartUrl.match(/\/band\/(\d+)/);
                const bandId = bandIdMatch ? bandIdMatch[1] : null;
                while (true) {
                    try {
                        await page.waitForTimeout(1500);
                        // 광고/추천 페이지 방어 로직
                        const currentUrl = page.url();
                        if (currentUrl.includes('/page/') || (bandId && !currentUrl.includes(`/band/${bandId}`))) {
                            console.log(`[Global Observer] 광고/추천 페이지 감지됨. 건너뜁니다: ${currentUrl}`);
                            const hasNext = await page.$(directionBtnSelector);
                            if (hasNext) {
                                await page.click(directionBtnSelector);
                                await page.waitForTimeout(2000);
                                lastTrackedUrl = page.url().split('?')[0];
                                continue; // 루프 재시작하여 정상 게시물인지 다시 확인
                            }
                            else {
                                console.log('[Global Observer] Reached the end while skipping ad.');
                                break; // 더 이상 갈 곳이 없으면 종료
                            }
                        }
                        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                        await page.evaluate(() => {
                            const input = document.querySelector('.commentWrite, .cCommentWrite, .comment_write, textarea');
                            if (input)
                                input.scrollIntoView({ block: 'center' });
                        }).catch(() => { });
                        await page.waitForSelector('.cComment, .sCommentList', { timeout: 5000 }).catch(() => { });
                        const commentsAuthors = await page.evaluate(() => {
                            const modal = document.querySelector('.layerContainerView, [class*="Modal"], [class*="modal_layer"], .bandPostView');
                            const targetContainer = modal || document;
                            const wraps = targetContainer.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
                            const authors = [];
                            wraps.forEach(node => {
                                const authorNode = node.querySelector('.name, ._commentWriterName, strong.text');
                                if (authorNode)
                                    authors.push(authorNode.innerText.trim());
                            });
                            return authors;
                        });
                        const cleanCurrentUrl = page.url().split('?')[0];
                        lastTrackedUrl = cleanCurrentUrl; // ★ 현재 위치 기억 (재시작 시 이어서 추적)
                        const hasBidders = commentsAuthors.length > 0;
                        let shouldMoveToNext = false;
                        let isAdminDetected = false;
                        if (!hasBidders) {
                            console.log(`[Global Observer] Empty post. Skipping: ${cleanCurrentUrl}`);
                            shouldMoveToNext = true;
                        }
                        else if (bandSetting.adminId && commentsAuthors.some(a => a.replace(/\s/g, '').includes(bandSetting.adminId.replace(/\s/g, '')))) {
                            console.log(`[Global Observer] Admin detected! Clearing: ${cleanCurrentUrl}`);
                            shouldMoveToNext = true;
                            isAdminDetected = true;
                        }
                        if (shouldMoveToNext) {
                            if (isAdminDetected) {
                                console.log('[Global Observer] Waiting 1.5s before triggering to minimize race exposure...');
                                await page.waitForTimeout(1500);
                            }
                            this.globalEvents.emit('cleared', cleanCurrentUrl);
                            const hasNext = await page.$(directionBtnSelector);
                            if (!hasNext) {
                                console.log('[Global Observer] Reached the end. Terminating.');
                                this.activeGlobalObservers.delete(cleanStartUrl);
                                await browser.close();
                                return; // 정상 종료 (모든 게시물 처리 완료)
                            }
                            await page.click(directionBtnSelector);
                            await page.waitForTimeout(2000);
                        }
                        else {
                            await page.waitForTimeout(5000);
                        }
                        // 루프가 정상 작동했으므로 재시도 카운트 리셋
                        retryCount = 0;
                    }
                    catch (loopError) {
                        // ★ 개별 루프 에러: 페이지가 아직 살아있으면 계속 시도
                        console.error(`[Global Observer] Loop error (recovering...):`, loopError.message);
                        try {
                            // 페이지가 살아있는지 확인 (간단한 evaluate 테스트)
                            await page.evaluate(() => true);
                            // 페이지 살아있음 → 3초 대기 후 다시 시도
                            console.log('[Global Observer] Page still alive. Retrying in 3s...');
                            await page.waitForTimeout(3000);
                        }
                        catch {
                            // 페이지도 죽음 → 브라우저 재시작 필요
                            console.log('[Global Observer] Page/Browser dead. Will restart...');
                            break; // inner while 탈출 → 외부 retry 루프에서 재시작
                        }
                    }
                }
                // inner while이 break로 탈출 → 브라우저 정리
                try {
                    await browser.close();
                }
                catch { }
            }
            catch (outerError) {
                // 브라우저 실행 자체가 실패한 경우
                console.error(`[Global Observer] Browser crash:`, outerError.message);
                try {
                    if (browser)
                        await browser.close();
                }
                catch { }
            }
            retryCount++;
            console.log(`[Global Observer] 🔄 Restarting... (${retryCount}/${MAX_RETRIES}) from: ${lastTrackedUrl}`);
            await new Promise(r => setTimeout(r, 3000)); // 3초 대기 후 재시작
        }
        // ★ 최대 재시도 초과 → 관련 태스크에 사망 알림
        console.error(`[Global Observer] ❌ Max retries (${MAX_RETRIES}) exceeded. Observer terminated.`);
        this.activeGlobalObservers.delete(cleanStartUrl);
        this.globalEvents.emit('observer_died', cleanStartUrl);
    }
    async waitForTriggerAndSnipe(task, bandSetting) {
        if (!task.triggerUrl)
            throw new Error('트리거 URL이 계산되지 않았습니다.');
        const now = Date.now();
        const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
        this.lastLaunchTime = targetLaunchTime;
        const delayNeeded = targetLaunchTime - now;
        if (delayNeeded > 0) {
            await new Promise(r => setTimeout(r, delayNeeded));
        }
        const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled', '--window-size=1200,900'] });
        this.browserInstances.set(task.id, browser);
        const context = await browser.newContext({ storageState: this.storagePath });
        const targetPage = await context.newPage();
        const bandIdMatch = task.url.match(/band.us\/band\/(\d+)/);
        const bandId = bandIdMatch ? bandIdMatch[1] : null;
        const bandMainUrl = bandId ? `https://band.us/band/${bandId}` : task.url;
        await targetPage.goto(bandMainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        let postLink = targetPage.locator(`a[href="${task.url.replace('https://band.us', '')}"]`, { hasText: '게시물' }).first();
        if (await postLink.count() === 0) {
            postLink = targetPage.locator(`a[href="${task.url}"]`).first();
        }
        console.log(`[Task ${task.id}] Snipe Team 스크롤 탐색 시작...`);
        for (let i = 0; i < 30; i++) {
            if (await postLink.count() > 0)
                break;
            await targetPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await targetPage.waitForTimeout(1000);
        }
        if (await postLink.count() === 0) {
            throw new Error('게시물을 피드에서 찾을 수 없습니다.');
        }
        const containerSelector = await targetPage.evaluate((urlPath) => {
            const a = document.querySelector(`a[href$="${urlPath}"]`);
            let curr = a;
            while (curr && curr.tagName !== 'BODY') {
                if (curr.querySelector('._commentCountBtn')) {
                    if (!curr.id)
                        curr.id = 'target_post_container_' + Date.now();
                    return '#' + curr.id;
                }
                curr = curr.parentElement;
            }
            return null;
        }, task.url.replace('https://band.us', ''));
        if (!containerSelector) {
            throw new Error('컨테이너를 식별할 수 없습니다.');
        }
        const postContainer = targetPage.locator(containerSelector);
        await postContainer.scrollIntoViewIfNeeded();
        const commentBtn = postContainer.locator('._commentCountBtn').first();
        if (await commentBtn.count() > 0) {
            await commentBtn.click().catch(() => { });
            await targetPage.waitForTimeout(500);
        }
        console.log(`[Task ${task.id}] Snipe Team waiting for signal on: ${task.triggerUrl}`);
        await new Promise((resolve, reject) => {
            const clearedListener = (clearedUrl) => {
                if (clearedUrl === task.triggerUrl) {
                    cleanup();
                    resolve();
                }
            };
            const diedListener = (startUrl) => {
                if (task.startPostUrl && startUrl === task.startPostUrl.split('?')[0]) {
                    cleanup();
                    reject(new Error('감시자(Observer)가 비정상 종료되었습니다. (최대 재시도 초과)'));
                }
            };
            const cleanup = () => {
                this.globalEvents.off('cleared', clearedListener);
                this.globalEvents.off('observer_died', diedListener);
            };
            this.globalEvents.on('cleared', clearedListener);
            this.globalEvents.on('observer_died', diedListener);
        });
        console.log(`[Task ${task.id}] Received FIRE order!`);
        task.status = 'SNIPING';
        this.emitUpdate(task);
        console.log(`[Sniper OBSERVER] FIRE! 접기/펴기 콤보 시전!`);
        await commentBtn.click().catch(() => { }); // 접기
        await targetPage.waitForTimeout(100);
        await this.waitForCommentsAPI(targetPage, containerSelector, async () => {
            await commentBtn.click().catch(() => { }); // 다시 펴기 (최신 네트워크 요청 발송)
        });
        await targetPage.waitForTimeout(100);
        await this.loadAllComments(postContainer, targetPage);
        const inputSelector = 'textarea, [contenteditable="true"]';
        try {
            await postContainer.locator(inputSelector).first().waitFor({ state: 'attached', timeout: 2000 });
        }
        catch {
            throw new Error('댓글창을 찾을 수 없습니다. (비로그인 상태 확인)');
        }
        const commentsText = await postContainer.evaluate((container) => {
            const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
            const texts = [];
            wraps.forEach(node => {
                const textNode = node.querySelector('p.txt, ._commentContent') || node;
                if (textNode)
                    texts.push(textNode.innerText.trim());
            });
            return texts;
        });
        let currentHighest = 0;
        for (let j = commentsText.length - 1; j >= 0; j--) {
            const parsed = this.parseBidAmount(commentsText[j]);
            if (parsed !== null)
                currentHighest = Math.max(currentHighest, parsed);
        }
        let nextBid = currentHighest === 0 ? task.startBid : currentHighest + task.increment;
        if (task.maxBid !== undefined && nextBid > task.maxBid) {
            task.status = 'ABORTED';
            task.resultMsg = `포기: 상한선(${task.maxBid}) 초과`;
            this.emitUpdate(task);
            await browser.close();
            this.browserInstances.delete(task.id);
            return;
        }
        try {
            const input = postContainer.locator(inputSelector).first();
            await input.focus({ timeout: 2000 });
            // 사전 검증 (Pre-verify)
            const bidStrVal_2 = nextBid.toString().replace(/['"]/g, '');
            let filled_2 = false;
            for (let i = 0; i < 3; i++) {
                await input.fill(bidStrVal_2, { timeout: 1000 }).catch(() => { });
                let currentText = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                if (currentText.includes(bidStrVal_2)) {
                    filled_2 = true;
                    break;
                }
                await targetPage.waitForTimeout(50).catch(() => { });
            }
            if (!filled_2)
                throw new Error('입력창에 금액을 입력할 수 없습니다.');
            let sent_2 = false;
            for (let attempt = 0; attempt < 5; attempt++) {
                await input.press('Control+Enter').catch(() => { });
                await postContainer.evaluate((container) => {
                    const btn = container.querySelector('.submit, ._btnSubmit, .btnSubmit, .btnCommentSubmit, .uBtn.-submit');
                    if (btn)
                        btn.click();
                }).catch(() => { });
                await targetPage.waitForTimeout(100).catch(() => { });
                let textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                if (!textLeft.includes(bidStrVal_2)) {
                    sent_2 = true;
                    break;
                }
                console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/5)...`);
            }
            const submitTime = this.getServerTime();
            task.submitTimeLog = submitTime;
            await targetPage.waitForTimeout(100);
            task.status = 'SUCCESS';
            task.resultMsg = `[낙찰 성공] 방어 성공! (전송: ${new Date(submitTime).toISOString().slice(11, 23)}) 완료 -> 방어 돌입🏁`;
            this.emitUpdate(task);
            // ★ 동점 감지 로직 추가
            const bandSettingForTie = bandSetting;
            const myNameForTie = bandSettingForTie?.myNickname || '';
            if (myNameForTie) {
                // OBSERVER의 경우 피드 구조이므로 새로고침(reload)이 아니라 접기/펴기로 재요청해야 함
                await this.waitForCommentsAPI(targetPage, containerSelector, async () => {
                    await commentBtn.click().catch(() => { }); // 접기
                    await targetPage.waitForTimeout(100);
                    await commentBtn.click().catch(() => { }); // 펴기
                });
                await targetPage.waitForTimeout(100);
                const { authors: tieAuthors, texts: tieTexts } = await this.extractAuthorsAndTexts(postContainer);
                const tieResult = this.checkTieBreak(tieAuthors, tieTexts, myNameForTie);
                if (tieResult.isTied && !tieResult.amIFirst) {
                    const emergencyBid = tieResult.highest + task.increment;
                    if (task.maxBid === undefined || emergencyBid <= task.maxBid) {
                        console.log(`[TieBreak-Emergency] 동점 추월! ${tieResult.highest} → ${emergencyBid} 재입찰`);
                        const emergencyInput = postContainer.locator(inputSelector).first();
                        try {
                            await emergencyInput.focus({ timeout: 2000 });
                            // 사전 검증 (Pre-verify)
                            const bidStrVal_3 = emergencyBid.toString().replace(/['"]/g, '');
                            let filled_3 = false;
                            for (let i = 0; i < 3; i++) {
                                await emergencyInput.fill(bidStrVal_3, { timeout: 1000 }).catch(() => { });
                                let currentText = await emergencyInput.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                                if (currentText.includes(bidStrVal_3)) {
                                    filled_3 = true;
                                    break;
                                }
                                await targetPage.waitForTimeout(50).catch(() => { });
                            }
                            if (!filled_3)
                                throw new Error('입력창에 금액을 입력할 수 없습니다.');
                            let sent_3 = false;
                            for (let attempt = 0; attempt < 5; attempt++) {
                                await emergencyInput.press('Control+Enter').catch(() => { });
                                await postContainer.evaluate((container) => {
                                    const btn = container.querySelector('.submit, ._btnSubmit, .btnSubmit, .btnCommentSubmit, .uBtn.-submit');
                                    if (btn)
                                        btn.click();
                                }).catch(() => { });
                                await targetPage.waitForTimeout(100).catch(() => { });
                                let textLeft = await emergencyInput.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                                if (!textLeft.includes(bidStrVal_3)) {
                                    sent_3 = true;
                                    break;
                                }
                                console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/5)...`);
                            }
                            const submitTime = this.getServerTime();
                            task.submitTimeLog = submitTime;
                            await targetPage.waitForTimeout(100);
                            nextBid = emergencyBid;
                            task.resultMsg = `[동점 추월] ${tieResult.highest} 동점 → ${emergencyBid} 재입찰!`;
                            this.emitUpdate(task);
                        }
                        catch (e) {
                            console.error('[TieBreak-Emergency] Submit failed:', e);
                            throw new Error(`동점 재입찰 전송 실패: ${e.name === 'TimeoutError' ? '댓글창이 닫혔습니다.' : e.message}`);
                        }
                    }
                    else {
                        console.log(`[TieBreak] 동점이지만 재입찰(${emergencyBid})이 상한선(${task.maxBid}) 초과 → 포기`);
                    }
                }
            }
            // 끝까지 달리기 (순차낙찰은 시간이 없으므로 maxEndTime 없이 실행)
            await this.runRaceLoop(task, targetPage, browser, nextBid, inputSelector, containerSelector, undefined);
            return;
        }
        catch (err) {
            task.status = 'FAILED';
            task.resultMsg = err.message;
            this.emitUpdate(task);
            await browser.close();
            this.browserInstances.delete(task.id);
        }
    }
    // --- Time Based Workflow (Feed Fold/Unfold Architecture) ---
    async executeFeedSnipe(task) {
        if (!fs.existsSync(this.storagePath)) {
            throw new Error('네이버 로그인이 필요합니다. (인증 정보 없음)');
        }
        if (!task.targetTime)
            return;
        const now = Date.now();
        const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
        this.lastLaunchTime = targetLaunchTime;
        const delayNeeded = targetLaunchTime - now;
        if (delayNeeded > 0) {
            await new Promise(r => setTimeout(r, delayNeeded));
        }
        const browser = await chromium.launch({
            headless: false,
            args: ['--disable-blink-features=AutomationControlled', '--window-size=1200,900']
        });
        this.browserInstances.set(task.id, browser);
        const context = await browser.newContext({ storageState: this.storagePath });
        const page = await context.newPage();
        const bandIdMatch = task.url.match(/band.us\/band\/(\d+)/);
        const bandId = bandIdMatch ? bandIdMatch[1] : null;
        const bandMainUrl = bandId ? `https://band.us/band/${bandId}` : task.url;
        // 네비게이션 시도 타임아웃
        const navigationPromise = page.goto(bandMainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // WARMUP 60s
        const waitUntill = async (targetTime) => {
            while (this.getServerTime() < targetTime) {
                await new Promise(r => setTimeout(r, 100));
            }
        };
        try {
            await navigationPromise;
            console.log(`[Task ${task.id}] 피드 진입 완료: ${bandMainUrl}`);
            const warmup60Time = task.targetTime - 60000;
            await waitUntill(warmup60Time);
            task.status = 'WARMUP_60';
            this.emitUpdate(task);
            // 스크롤 탐색
            let postLink = page.locator(`a[href="${task.url.replace('https://band.us', '')}"]`, { hasText: '게시물' }).first();
            if (await postLink.count() === 0) {
                postLink = page.locator(`a[href="${task.url}"]`).first();
            }
            console.log(`[Task ${task.id}] 스크롤 탐색 시작...`);
            for (let i = 0; i < 30; i++) {
                if (await postLink.count() > 0)
                    break;
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1000);
            }
            if (await postLink.count() === 0) {
                throw new Error('게시물을 피드에서 찾을 수 없습니다.');
            }
            // 해당 게시물의 컨테이너 ID 식별
            const containerSelector = await page.evaluate((urlPath) => {
                const a = document.querySelector(`a[href$="${urlPath}"]`);
                let curr = a;
                while (curr && curr.tagName !== 'BODY') {
                    if (curr.querySelector('._commentCountBtn')) {
                        if (!curr.id)
                            curr.id = 'target_post_container_' + Date.now();
                        return '#' + curr.id;
                    }
                    curr = curr.parentElement;
                }
                return null;
            }, task.url.replace('https://band.us', ''));
            if (!containerSelector) {
                throw new Error('컨테이너를 식별할 수 없습니다.');
            }
            const postContainer = page.locator(containerSelector);
            await postContainer.scrollIntoViewIfNeeded();
            // 댓글 접어두기
            const commentBtn = postContainer.locator('._commentCountBtn').first();
            if (await commentBtn.count() > 0) {
                await commentBtn.click().catch(() => { });
                await page.waitForTimeout(500);
            }
            const warmup30Time = task.targetTime - 25000;
            await waitUntill(warmup30Time);
            task.status = 'WARMUP_30';
            this.emitUpdate(task);
            // ★ FINAL SNIPE: 마감 2.8초 전 본게임 타격 준비 시작
            const snipeTime = task.targetTime - 2800;
            await waitUntill(snipeTime);
            console.log(`[Sniper FEED] 마감 2.8초 전: 본게임 타격 접기/펴기 콤보 시전!`);
            await commentBtn.click().catch(() => { }); // 접기 (또는 펴기)
            await page.waitForTimeout(50); // 짧은 딜레이로 접기/펴기 연속 클릭 보장
            await this.waitForCommentsAPI(page, containerSelector, async () => {
                await commentBtn.click().catch(() => { }); // 다시 펴기 (최신 네트워크 요청 발송)
            });
            await page.waitForTimeout(100);
            await this.loadAllComments(postContainer, page);
            const inputSelector = 'textarea, [contenteditable="true"]';
            try {
                await postContainer.locator(inputSelector).first().waitFor({ state: 'attached', timeout: 2000 });
            }
            catch {
                throw new Error('댓글창을 찾을 수 없습니다. (비로그인 또는 관리자 닫힘)');
            }
            const commentsText = await postContainer.evaluate((container) => {
                const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
                const texts = [];
                wraps.forEach(node => {
                    const textNode = node.querySelector('p.txt, ._commentContent') || node;
                    if (textNode)
                        texts.push(textNode.innerText.trim());
                });
                return texts;
            });
            let currentHighest = 0;
            for (let j = commentsText.length - 1; j >= 0; j--) {
                const parsed = this.parseBidAmount(commentsText[j]);
                if (parsed !== null) {
                    currentHighest = Math.max(currentHighest, parsed);
                }
            }
            console.log(`[Sniper FEED FINAL] 최종 최고가 산정: ${currentHighest}`);
            let nextBid = currentHighest === 0 ? task.startBid : currentHighest + task.increment;
            if (task.maxBid !== undefined && nextBid > task.maxBid) {
                task.status = 'ABORTED';
                task.resultMsg = `포기: 계산된 입찰가(${nextBid})가 상한선(${task.maxBid})을 초과함`;
                this.emitUpdate(task);
                await browser.close();
                this.browserInstances.delete(task.id);
                return;
            }
            const input = postContainer.locator(inputSelector).first();
            try {
                await input.focus({ timeout: 2000 });
                // React 상태 업데이트 지연을 방지하기 위해 순차 입력 시도
                // 사전 검증 (Pre-verify)
                const bidStrVal_6 = nextBid.toString().replace(/['"]/g, '');
                let filled_6 = false;
                for (let i = 0; i < 3; i++) {
                    await input.fill(bidStrVal_6, { timeout: 1000 }).catch(() => { });
                    let currentText = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                    if (currentText.includes(bidStrVal_6)) {
                        filled_6 = true;
                        break;
                    }
                    await page.waitForTimeout(50).catch(() => { });
                }
                if (!filled_6)
                    throw new Error('입력창에 금액을 입력할 수 없습니다.');
                // (삭제됨) 인위적인 대기 없이 즉시 전송
                let sent_6 = false;
                for (let attempt = 0; attempt < 5; attempt++) {
                    await input.press('Control+Enter').catch(() => { });
                    await postContainer.evaluate((container) => {
                        const btn = container.querySelector('.submit, ._btnSubmit, .btnSubmit, .btnCommentSubmit, .uBtn.-submit');
                        if (btn)
                            btn.click();
                    }).catch(() => { });
                    await page.waitForTimeout(100).catch(() => { });
                    let textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                    if (!textLeft.includes(bidStrVal_6)) {
                        sent_6 = true;
                        break;
                    }
                    console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/5)...`);
                }
                const submitTime = this.getServerTime();
                task.submitTimeLog = submitTime;
                await page.waitForTimeout(100);
                if (task.isRaceMode) {
                    task.resultMsg = `입찰 성공 (${nextBid}) -> 레이스 돌입🏁 (전송: ${new Date(submitTime).toISOString().slice(11, 23)})`;
                    this.emitUpdate(task);
                }
                else {
                    task.resultMsg = `방어 입찰 완료: ${nextBid} (전송: ${new Date(submitTime).toISOString().slice(11, 23)})`;
                    this.emitUpdate(task);
                }
            }
            catch (e) {
                console.error("Submit failed:", e);
                throw new Error(`입찰 전송 실패: ${e.name === 'TimeoutError' ? '댓글창이 닫혔습니다.' : e.message}`);
            }
            const bandSetting = task.bandSettingId ? this.bandSettings.get(task.bandSettingId) : undefined;
            const myNameForTie = bandSetting?.myNickname || '';
            if (myNameForTie && currentHighest > 0) {
                const tieResult = this.checkTieBreak([], commentsText, myNameForTie);
                if (tieResult.isTied && !tieResult.amIFirst) {
                    const emergencyBid = currentHighest + task.increment;
                    if (task.maxBid === undefined || emergencyBid <= task.maxBid) {
                        try {
                            await input.focus({ timeout: 2000 });
                            // React 상태 업데이트 지연을 방지하기 위해 순차 입력 시도
                            // 사전 검증 (Pre-verify)
                            const bidStrVal_7 = emergencyBid.toString().replace(/['"]/g, '');
                            let filled_7 = false;
                            for (let i = 0; i < 3; i++) {
                                await input.fill(bidStrVal_7, { timeout: 1000 }).catch(() => { });
                                let currentText = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                                if (currentText.includes(bidStrVal_7)) {
                                    filled_7 = true;
                                    break;
                                }
                                await page.waitForTimeout(50).catch(() => { });
                            }
                            if (!filled_7)
                                throw new Error('입력창에 금액을 입력할 수 없습니다.');
                            let sent_7 = false;
                            for (let attempt = 0; attempt < 5; attempt++) {
                                await input.press('Control+Enter').catch(() => { });
                                await postContainer.evaluate((container) => {
                                    const btn = container.querySelector('.submit, ._btnSubmit, .btnSubmit, .btnCommentSubmit, .uBtn.-submit');
                                    if (btn)
                                        btn.click();
                                }).catch(() => { });
                                await page.waitForTimeout(100).catch(() => { });
                                let textLeft = await input.evaluate((el) => el.value || el.textContent || '').catch(() => '');
                                if (!textLeft.includes(bidStrVal_7)) {
                                    sent_7 = true;
                                    break;
                                }
                                console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/5)...`);
                            }
                            const submitTime = this.getServerTime();
                            task.submitTimeLog = submitTime;
                            await page.waitForTimeout(100);
                            nextBid = emergencyBid;
                        }
                        catch (e) {
                            console.error('[TieBreak-Emergency] Submit failed:', e);
                        }
                    }
                }
            }
            const maxEndTime = task.isRaceMode ? undefined : task.targetTime + 20000;
            await this.runRaceLoop(task, page, browser, nextBid, inputSelector, containerSelector, maxEndTime);
            return;
        }
        catch (err) {
            task.status = 'FAILED';
            task.resultMsg = err.message;
            this.emitUpdate(task);
            await browser.close();
            this.browserInstances.delete(task.id);
        }
    }
}
export const sniperManager = new SniperManager();
