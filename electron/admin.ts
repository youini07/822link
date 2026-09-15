// @ts-nocheck
import { app, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as dgram from 'dgram';
import * as https from 'https';
import { EventEmitter } from 'events';
import { updateAuctionResultsBatch } from './catalogGoogleUploader.js';
import { sendTelegramAlert } from './catalogTelegramBot.js';
import { getSharedContext, closeSharedContext, saveStorageMirror, hasStoredSession, checkBandSessionViaPage, getProfileDir, } from './bandSession.js';
export class AdminManager {
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
    members = new Map();
    browserInstances = new Map();
    storagePath = path.join(app.getPath('userData'), 'naver-storage-state.json');
    settingsPath = path.join(app.getPath('userData'), 'band-settings.json');
    tasksPath = path.join(app.getPath('userData'), 'snipe-tasks.json');
    settlementThumbsRoot = path.join(app.getPath('userData'), 'settlement_thumbs');
    getMembersPath(username) { return path.join(app.getPath('userData'), `members_${username || 'default'}.json`); }
    onTaskUpdate;
    // Global Observer State
    activeGlobalObservers = new Set(); // Set of startPostUrl
    globalEvents = new EventEmitter();
    timeOffset = 0;
    timeSyncStatus = { method: 'None', offset: 0, ping: 0, lastSynced: 0 };
    getTimeSyncStatus() { return this.timeSyncStatus; }
    lastLaunchTime = 0;
    getServerTimeOffset() {
        return this.timeOffset;
    }
    // NaN 방어: timeOffset이 NaN이면 보정 없이 로컬 시간 반환
    getServerTime() {
        if (Number.isNaN(this.timeOffset))
            return Date.now();
        return Date.now() + this.timeOffset;
    }
    // === Cloudflare HTTPS 초 변경 찰나 동기화 (1순위) ===
    // 왜 Cloudflare인가:
    // 1. 태국에 CDN 서버가 있어 RTT가 15~18ms로 극도로 빠름
    // 2. HTTPS(443)라 UDP 차단 방화벽 무관 (NTP UDP 123은 태국에서 차단됨)
    // 3. cdn-cgi/trace의 ts= 필드에서 Unix timestamp를 반환 (초 단위)
    // 4. 빠른 RTT + 20ms 폴링 → 초가 바뀌는 '찰나'를 ±35ms 정밀도로 포착
    // 5. Cloudflare 서버도 NTP 동기화 → 네이버 서버와 시계 일치
    // Cloudflare cdn-cgi/trace에서 ts= 필드를 가져오는 헬퍼
    getCloudflareTs() {
        return new Promise((resolve, reject) => {
            const start = performance.now();
            const req = https.get('https://1.1.1.1/cdn-cgi/trace', (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    const rtt = performance.now() - start;
                    const tsMatch = body.match(/ts=(\d+\.?\d*)/);
                    if (tsMatch) {
                        resolve({ ts: parseFloat(tsMatch[1]), rtt, localTime: Date.now() });
                    }
                    else {
                        reject(new Error('Cloudflare ts 필드 없음'));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
        });
    }
    // Cloudflare 초 변경 찰나 동기화 (±35ms 정밀도)
    async syncViaCloudflare() {
        try {
            console.log('[TimeSync/CF] Cloudflare HTTPS 초 변경 찰나 동기화 시작...');
            // 1. 초기 요청: 현재 '초' 파악 + 커넥션 워밍업
            const initial = await this.getCloudflareTs();
            const initialSecond = Math.floor(initial.ts);
            console.log(`[TimeSync/CF] 현재 서버 초: ${initialSecond}, RTT: ${initial.rtt.toFixed(1)}ms`);
            // 2. 20ms 간격으로 초가 바뀌는 '찰나' 포착 (6회 반복하여 중앙값 채택)
            const offsets = [];
            let bestRtt = Infinity;
            for (let round = 0; round < 6; round++) {
                // 현재 초 파악
                const prev = await this.getCloudflareTs();
                const prevSec = Math.floor(prev.ts);
                // 초가 바뀔 때까지 20ms 간격 폴링
                for (let i = 0; i < 60; i++) { // 최대 ~1.2초 대기
                    await new Promise(r => setTimeout(r, 20));
                    try {
                        const result = await this.getCloudflareTs();
                        const curSec = Math.floor(result.ts);
                        if (curSec !== prevSec) {
                            // 초가 바뀐 순간! 이 시점에서 서버의 실제 시간은 XX:XX:XX.000
                            const latency = result.rtt / 2;
                            const exactServerTimeMs = curSec * 1000 + latency;
                            const offset = exactServerTimeMs - result.localTime;
                            offsets.push(offset);
                            if (result.rtt < bestRtt)
                                bestRtt = result.rtt;
                            console.log(`[TimeSync/CF] 라운드${round + 1}: Offset=${offset.toFixed(1)}ms (RTT: ${result.rtt.toFixed(1)}ms)`);
                            break;
                        }
                    }
                    catch (e) {
                        // 개별 요청 실패는 무시하고 다음 시도
                    }
                }
            }
            if (offsets.length < 3) {
                console.log('[TimeSync/CF] 충분한 샘플 수집 실패');
                return false;
            }
            // 3. 중앙값 채택 (이상치에 강건한 통계)
            const sorted = [...offsets].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const stddev = Math.sqrt(offsets.reduce((sum, o) => sum + (o - median) ** 2, 0) / offsets.length);
            this.timeOffset = Math.round(median);
            // NaN 최종 방어
            if (Number.isNaN(this.timeOffset)) {
                this.timeOffset = 0;
                return false;
            }
            this.timeSyncStatus = {
                method: 'NTP', // UI에서 NTP로 표시 (초정밀 동기화라는 의미)
                offset: this.timeOffset,
                ping: bestRtt,
                lastSynced: Date.now()
            };
            console.log(`[TimeSync] ✅ Cloudflare 정밀 동기화 완료! Offset: ${this.timeOffset}ms, 최소RTT: ${bestRtt.toFixed(1)}ms, 표준편차: ${stddev.toFixed(1)}ms (${offsets.length}샘플)`);
            return true;
        }
        catch (e) {
            console.error('[TimeSync/CF] 실패:', e.message);
            return false;
        }
    }
    // === NTP UDP 직접 쿼리 (2순위 폴백) ===
    // UDP 123 포트가 열려있는 환경에서만 동작. 태국 ISP는 대부분 차단함.
    ntpQuery(server, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const client = dgram.createSocket('udp4');
            const ntpData = Buffer.alloc(48);
            ntpData[0] = 0x1B;
            const t1 = Date.now();
            const timer = setTimeout(() => { client.close(); reject(new Error(`NTP 타임아웃: ${server}`)); }, timeout);
            client.send(ntpData, 0, 48, 123, server, (err) => {
                if (err) {
                    clearTimeout(timer);
                    client.close();
                    reject(err);
                }
            });
            client.on('message', (msg) => {
                clearTimeout(timer);
                const t4 = Date.now();
                const intPart = msg.readUInt32BE(40);
                const fracPart = msg.readUInt32BE(44);
                const ntpTimeMs = (intPart - 2208988800) * 1000 + (fracPart / 4294967296) * 1000;
                const offset = ntpTimeMs - (t1 + t4) / 2;
                client.close();
                resolve({ offset: Math.round(offset * 10) / 10, rtt: t4 - t1 });
            });
            client.on('error', (err) => { clearTimeout(timer); client.close(); reject(err); });
        });
    }
    async syncViaNTP() {
        const servers = ['time.cloudflare.com', 'pool.ntp.org', 'time.google.com'];
        const allSamples = [];
        for (const server of servers) {
            for (let i = 0; i < 3; i++) {
                try {
                    const result = await this.ntpQuery(server, 2000);
                    allSamples.push({ ...result, server });
                    console.log(`[TimeSync/NTP] ${server} 샘플${i + 1}: Offset=${result.offset.toFixed(1)}ms, RTT=${result.rtt}ms`);
                }
                catch (e) {
                    console.log(`[TimeSync/NTP] ${server} 샘플${i + 1}: 실패 - ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 100));
            }
        }
        if (allSamples.length === 0)
            return false;
        allSamples.sort((a, b) => a.rtt - b.rtt);
        const top3 = allSamples.slice(0, Math.min(3, allSamples.length));
        const avgOffset = top3.reduce((sum, s) => sum + s.offset, 0) / top3.length;
        this.timeOffset = Math.round(avgOffset);
        this.timeSyncStatus = { method: 'NTP', offset: this.timeOffset, ping: allSamples[0].rtt, lastSynced: Date.now() };
        console.log(`[TimeSync] ✅ NTP 동기화 완료! Offset: ${this.timeOffset}ms`);
        return true;
    }
    // === naver.com Date 헤더 폴백 (3순위) ===
    async syncViaDateHeader() {
        try {
            console.log('[TimeSync/Web] naver.com Date 헤더 폴백...');
            const headRequest = (url) => {
                return new Promise((resolve, reject) => {
                    const start = performance.now();
                    const req = https.request(url, { method: 'HEAD' }, (res) => {
                        res.resume();
                        res.on('end', () => resolve({ dateStr: res.headers['date'], rtt: performance.now() - start }));
                    });
                    req.on('error', reject);
                    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
                    req.end();
                });
            };
            const initial = await headRequest('https://www.naver.com');
            if (!initial.dateStr)
                return false;
            const initialSeconds = new Date(initial.dateStr).getSeconds();
            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 50));
                const result = await headRequest('https://www.naver.com');
                if (!result.dateStr)
                    continue;
                if (new Date(result.dateStr).getSeconds() !== initialSeconds) {
                    const latency = result.rtt / 2;
                    this.timeOffset = (new Date(result.dateStr).getTime() + latency) - Date.now();
                    if (Number.isNaN(this.timeOffset)) {
                        this.timeOffset = 0;
                        return false;
                    }
                    this.timeSyncStatus = { method: 'Web', offset: this.timeOffset, ping: result.rtt, lastSynced: Date.now() };
                    console.log(`[TimeSync] ⚠️ 웹 폴백 동기화 완료. Offset: ${this.timeOffset.toFixed(1)}ms`);
                    return true;
                }
            }
            return false;
        }
        catch (e) {
            console.error('[TimeSync/Web] 실패:', e);
            return false;
        }
    }
    // === 메인 동기화: Cloudflare(1순위) → NTP(2순위) → 웹(3순위) → 로컬 ===
    async syncServerTime() {
        console.log('[TimeSync] 시간 동기화 시작...');
        // 1차: Cloudflare HTTPS 초 변경 찰나 (±35ms, 방화벽 무관)
        const cfOk = await this.syncViaCloudflare().catch(() => false);
        if (cfOk)
            return;
        // 2차: NTP UDP (±10ms, 방화벽 차단 가능)
        const ntpOk = await this.syncViaNTP().catch(() => false);
        if (ntpOk)
            return;
        // 3차: naver.com Date 헤더 (±500ms, 최후의 수단)
        const webOk = await this.syncViaDateHeader().catch(() => false);
        if (webOk)
            return;
        // 전부 실패
        console.log('[TimeSync] ❌ 모든 동기화 실패. 로컬 시간 기준으로 동작합니다.');
        this.timeOffset = 0;
        this.timeSyncStatus = { method: 'None', offset: 0, ping: 0, lastSynced: 0 };
    }
    loadTasks() {
        let loaded = false;
        if (fs.existsSync(this.tasksPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tasksPath, 'utf8'));
                if (Array.isArray(data)) {
                    data.forEach((t) => {
                        this.tasks.set(t.id, t);
                    });
                    loaded = true;
                }
            }
            catch (e) {
                console.error('[AdminTask] 기본 저장 데이터 로드 실패, 백업 복구 시도:', e);
            }
        }
        // 만약 로드에 실패했거나 파일이 없다면 백업 파일 확인
        if (!loaded && fs.existsSync(this.tasksPath + '.bak')) {
            try {
                const data = JSON.parse(fs.readFileSync(this.tasksPath + '.bak', 'utf8'));
                if (Array.isArray(data) && data.length > 0) {
                    data.forEach((t) => {
                        this.tasks.set(t.id, t);
                    });
                    console.log('[AdminTask] 백업 파일에서 안전하게 데이터를 복구했습니다.');
                }
            }
            catch (e) {
                console.error('[AdminTask] 백업 파일 복구 실패:', e);
            }
        }
    }
    async initBrowser() {
        this.loadSettings();
        await this.syncServerTime();
        setInterval(() => this.syncServerTime(), 3600 * 1000); // Re-sync every hour
        console.log('Sniper Manager: Scheduler started. Session profile at:', getProfileDir());
        this.startScheduler();
        // 주기 로그인 세션 감시 시작 (L1+L2 하이브리드, 5분 주기 + 백오프)
        this.startSessionWatcher();
    }
    loadSettings() {
        if (fs.existsSync(this.settingsPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
                data.forEach((s) => this.bandSettings.set(s.id, s));
            }
            catch (e) { }
        }
        // members loaded dynamically
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
        try {
            const dataStr = JSON.stringify(Array.from(this.tasks.values()), null, 2);
            fs.writeFileSync(this.tasksPath, dataStr);
            // 안전을 위해 백업본도 항상 유지
            fs.writeFileSync(this.tasksPath + '.bak', dataStr);
        }
        catch (e) {
            console.error('[AdminTask] 파일 저장 중 오류 발생:', e);
        }
    }
    getBandSettings() { return Array.from(this.bandSettings.values()); }
    saveBandSetting(setting) { this.bandSettings.set(setting.id, setting); this.saveSettings(); }
    deleteBandSetting(id) { this.bandSettings.delete(id); this.saveSettings(); }
    getMembers(username) {
        const p = this.getMembersPath(username);
        if (!fs.existsSync(p))
            return [];
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return [];
        }
    }
    saveMember(username, member) {
        const p = this.getMembersPath(username);
        const members = this.getMembers(username);
        const idx = members.findIndex(m => m.nickname === member.nickname);
        if (idx >= 0)
            members[idx] = member;
        else
            members.push(member);
        fs.writeFileSync(p, JSON.stringify(members, null, 2));
    }
    deleteMember(username, nickname) {
        const p = this.getMembersPath(username);
        const members = this.getMembers(username).filter(m => m.nickname !== nickname);
        fs.writeFileSync(p, JSON.stringify(members, null, 2));
    }
    // ============================================================
    // 로그인 세션 체크 (L1 + L2 하이브리드)
    // L1: 브라우저 실행 없이 저장된 쿠키 존재 여부 즉시 판별 (0초, 무통신)
    // L2: 실제 페이지가 밴드 홈에 접속해 자기 자신의 get_profile 응답을 확인 (확정 판별)
    //     - ID/PW 전송 없음, 위조 요청 없음 → 보호조치 위험 최소화
    //     - 네트워크 오류는 'unknown' 처리 → 만료 오판 방지
    // ============================================================
    lastLoginStatus = null;
    sessionCheckInProgress = false;
    consecutiveFailures = 0;
    onLoginStatus;
    /** [L1] 저장된 세션 존재 여부만 즉시 확인 */
    checkStoredSessionQuick() {
        const ok = hasStoredSession();
        return { status: ok ? this.lastLoginStatus?.status ?? 'unknown' : 'expired', checkedAt: Date.now() };
    }
    /** [L1+L2] 하이브리드 세션 체크 */
    async checkLoginStatusDetailed() {
        if (this.sessionCheckInProgress) {
            return this.lastLoginStatus ?? { status: 'unknown', checkedAt: Date.now() };
        }
        this.sessionCheckInProgress = true;
        try {
            // L0/L1: 저장된 세션이 아예 없으면 미로그인 확정
            if (!hasStoredSession()) {
                const result = { status: 'expired', checkedAt: Date.now() };
                this.updateLoginStatus(result);
                return result;
            }
            // 컨텍스트가 살아있으면 최신 롤링 쿠키를 미러에 동기화
            await saveStorageMirror();
            // L2: 페이지 기반 확정 판별
            const detail = await checkBandSessionViaPage();
            const result = { ...detail, checkedAt: Date.now() };
            if (result.status === 'ok') {
                this.consecutiveFailures = 0;
            }
            else if (result.status === 'unknown') {
                // 네트워크 문제 등 → 만료로 오판하지 않고 이전 상태 유지
                this.consecutiveFailures++;
                const prev = this.lastLoginStatus?.status;
                result.status = prev === 'expired' ? 'expired' : 'unknown';
            }
            else {
                this.consecutiveFailures = 0;
            }
            this.updateLoginStatus(result);
            return result;
        }
        finally {
            this.sessionCheckInProgress = false;
        }
    }
    updateLoginStatus(result) {
        const changed = this.lastLoginStatus?.status !== result.status;
        this.lastLoginStatus = result;
        console.log(`[SessionCheck] ${result.status}${result.nickname ? ` (${result.nickname})` : ''}`);
        if (changed && this.onLoginStatus)
            this.onLoginStatus(result);
        else if (this.onLoginStatus)
            this.onLoginStatus(result);
    }
    /** UI 호환용 boolean */
    async checkNaverLoginStatus() {
        try {
            if (!hasStoredSession())
                return false;
            const detail = await this.checkLoginStatusDetailed();
            return detail.status === 'ok';
        }
        catch {
            return false;
        }
    }
    /**
     * 주기 세션 감시 시작 (기본 5분 + 지터)
     * - 실패 반복 시 지수 백오프로 요청 빈도 자동 축소 (비정상 트래픽 회피)
     * - 경매 작업 진행 중에는 체크 건너뜀 (간섭 방지)
     */
    startSessionWatcher() {
        const baseInterval = 5 * 60 * 1000;
        let firstTick = true;
        const tick = async () => {
            try {
                // 작업 진행 중이면 건너뜀
                const busy = Array.from(this.tasks.values()).some(t => ['WARMUP_60', 'WARMUP_30', 'SNIPING', 'OBSERVING', 'CLOSING'].includes(t.status));
                if (busy)
                    return;
                await this.checkLoginStatusDetailed();
            }
            catch (e) {
                console.error('[SessionWatcher] 체크 실패:', e.message);
            }
        };
        const schedule = () => {
            // 첫 체크는 앱 시작 45초 후 (초기 배지 갱신), 이후 5분 주기 + 백오프
            const delay = firstTick ? 45 * 1000 : baseInterval * Math.min(2 ** this.consecutiveFailures, 4) + Math.random() * 30 * 1000;
            firstTick = false;
            setTimeout(async () => {
                await tick();
                schedule();
            }, delay);
        };
        schedule();
        console.log('[SessionWatcher] 주기 세션 감시 시작 (첫 체크 45초 후, 이후 5분 주기 + 백오프)');
    }
    /** 마지막 확인 결과 조회 (UI 초기 표시용) */
    getLastLoginStatus() {
        return this.lastLoginStatus;
    }
    async openBrowser(url = 'https://auth.band.us/login_page') {
        console.log(`Opening browser at ${url}...`);
        const now = Date.now();
        const targetLaunchTime = Math.max(now, (this.lastLaunchTime || 0) + 2000);
        this.lastLaunchTime = targetLaunchTime;
        const delayNeeded = targetLaunchTime - now;
        if (delayNeeded > 0) {
            await new Promise(r => setTimeout(r, delayNeeded));
        }
        // 공유 영속 컨텍스트 사용: 로그인 시 재발급된 롤링 쿠키가 즉시 프로필에 저장되어
        // 세션이 일반 브라우저처럼 유지됨 (스냅샷 리플레이 방식 폐지)
        const context = await getSharedContext();
        // 기존 밴드 탭 재사용 (버튼 연타 시 탭/창이 무한 증가하는 것 방지)
        const pages = context.pages();
        let page = pages.find(p => p.url().includes('band.us')) || pages[pages.length - 1];
        if (!page)
            page = await context.newPage();
        await page.bringToFront().catch(() => { });
        // 안전 내비게이션: 실패해도 빈 about:blank 창이 방치되지 않도록 1회 재시도
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                break;
            }
            catch (navErr) {
                console.warn(`[BandSession] 페이지 이동 실패 (시도 ${attempt + 1}/2): ${navErr.message}`);
                if (attempt === 0)
                    await new Promise(r => setTimeout(r, 1500));
            }
        }
        // 밴드 홈 등 로그인 성공 화면에 진입하면 미러 파일을 확실히 최신화한다.
        // ★ 사용자가 창을 닫아 컨텍스트가 죽기 전에 반드시 저장해야 하므로
        //   성공할 때까지 짧은 간격으로 재시도하고, 성공 시 즉시 UI에 로그인 상태를 푸시한다.
        let mirrorSynced = false;
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame() || mirrorSynced)
                return;
            const url = frame.url();
            if (!url.includes('band.us') || url.includes('login_page') || url.includes('nid.naver.com'))
                return;
            const trySync = async () => {
                for (let i = 0; i < 10; i++) {
                    const ok = await saveStorageMirror();
                    if (ok) {
                        mirrorSynced = true;
                        console.log('[BandSession] 로그인 후 미러 동기화 완료.');
                        // 로그인 성공 확정 → 즉시 세션 체크 후 UI로 푸시 (재로그인 불필요)
                        try {
                            const detail = await this.checkLoginStatusDetailed();
                            if (this.onLoginStatus)
                                this.onLoginStatus(detail);
                        }
                        catch { }
                        return;
                    }
                    await new Promise(r => setTimeout(r, 700));
                }
                console.warn('[BandSession] 미러 동기화 실패: 컨텍스트가 조기 종료됨');
            };
            trySync();
        });
    }
    addTask(task) {
        this.tasks.set(task.id, task);
        this.saveTasks();
        this.emitUpdate(task);
        if (!task.postTitle && task.url) {
            this.fetchPostTitle(task);
        }
    }
    removeAdminTask(id) {
        this.tasks.delete(id);
        this.saveTasks();
    }
    removeTask(taskId) {
        this.tasks.delete(taskId);
        this.saveTasks();
        // 강제 종료: 해당 태스크가 실행 중(브라우저 창이 열림)이라면 즉시 닫음
        const browserInstance = this.browserInstances.get(taskId);
        if (browserInstance) {
            console.log(`[AdminManager] 강제 종료 요청 수신 (Task: ${taskId}) - 브라우저 인스턴스를 즉시 닫습니다.`);
            browserInstance.close().catch(() => { });
            this.browserInstances.delete(taskId);
        }
    }
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
            // 공유 영속 컨텍스트 재사용 (브라우저 매번 새로 띄우지 않음 → 동시 세션 감지 회피)
            const context = await getSharedContext();
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
            await saveStorageMirror();
            await page.close();
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
    async collectPostThumbnail(postContainer, page, postUrl) {
        try {
            const bandIdMatch = postUrl.match(/band\/(\d+)/);
            const postIdMatch = postUrl.match(/post\/(\d+)/);
            if (!bandIdMatch || !postIdMatch)
                return undefined;
            const bandId = bandIdMatch[1];
            const postId = postIdMatch[1];
            const thumbDir = path.join(this.settlementThumbsRoot, bandId);
            const thumbPath = path.join(thumbDir, `${postId}.jpg`);
            const imgSrc = await postContainer.evaluate((container) => {
                const selectors = [
                    '.txtBody img',
                    '.postBody img',
                    '.cContentBody img',
                    '.photoWrap img',
                    '.postPhotoWrap img',
                    'img[src*="phinf"]'
                ];
                for (const sel of selectors) {
                    const img = container.querySelector(sel);
                    if (img && img.src && !img.src.includes('profile') && !img.src.includes('icon')) {
                        return img.src;
                    }
                }
                return null;
            }).catch(() => null);
            if (!imgSrc) {
                console.log(`[Thumbnail] 이미지 태그를 찾을 수 없음: ${postUrl}`);
                return undefined;
            }
            if (fs.existsSync(thumbPath)) {
                return { path: thumbPath, url: imgSrc };
            }
            let imageBuffer = null;
            try {
                const response = await fetch(imgSrc);
                if (response.ok) {
                    imageBuffer = await response.arrayBuffer();
                }
            }
            catch (e) {
                console.log(`[Thumbnail] Node fetch 실패: ${e.message}`);
            }
            if (!imageBuffer || imageBuffer.byteLength === 0)
                return undefined;
            const buffer = Buffer.from(imageBuffer);
            const image = nativeImage.createFromBuffer(buffer);
            if (image.isEmpty())
                return undefined;
            const resized = image.resize({ width: 300 });
            const jpegBuffer = resized.toJPEG(80);
            if (!fs.existsSync(thumbDir)) {
                fs.mkdirSync(thumbDir, { recursive: true });
            }
            fs.writeFileSync(thumbPath, jpegBuffer);
            console.log(`[Thumbnail] 이미지 다운로드 완료: ${thumbPath}`);
            return { path: thumbPath, url: imgSrc };
        }
        catch (e) {
            return undefined;
        }
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
                    const commentBtn = postContainer.locator('._commentCountBtn, ._commentCountLayerBtn, ._commentMainBtn, .commentBtn').first();
                    if (await commentBtn.count() > 0) {
                        await commentBtn.click().catch(() => { }); // 접기
                        await page.waitForTimeout(100);
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
            const { authors, texts, isNewestFirst } = await postContainer.evaluate((container, sel) => {
                const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
                const authorsList = [];
                const textsList = [];
                wraps.forEach(node => {
                    const authorNode = node.querySelector('.name, ._commentWriterName, strong.text');
                    if (!authorNode)
                        return;
                    const textNode = node.querySelector('p.txt, ._commentContent') || node;
                    authorsList.push(authorNode.innerText.trim());
                    textsList.push(textNode ? textNode.innerText.trim() : '');
                });
                const containerText = container.innerText || '';
                return { authors: authorsList, texts: textsList, isNewestFirst: containerText.includes('최신순') };
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
                const tieResult = this.checkTieBreak(authors, texts, myName, isNewestFirst);
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
                    task.resultMsg = `입찰 한도액 초과로 포기`;
                    this.emitUpdate(task);
                    break;
                }
                // Place new bid
                const input = postContainer.locator(inputSelector).first();
                try {
                    await input.focus({ timeout: 2000 });
                    // React 상태 업데이트 지연을 방지하기 위해 순차 입력 시도
                    await input.fill('');
                    await input.pressSequentially(nextBid.toString(), { delay: 10, timeout: 2000 }).catch(async () => {
                        await input.fill(nextBid.toString(), { timeout: 2000 });
                    });
                    let sent = false;
                    for (let attempt = 0; attempt < 4; attempt++) {
                        if (attempt > 0)
                            await page.waitForTimeout(100);
                        // 전송/등록 텍스트를 가진 버튼을 찾아서 클릭 (더욱 강력한 클릭)
                        await page.keyboard.press('Control+Enter').catch(() => { });
                        // 입력창이 비워졌는지 확인 (전송 성공 여부)
                        const textLeft = await input.evaluate((el) => {
                            return el.value || el.textContent || '';
                        }).catch(() => '');
                        if (!textLeft || !textLeft.includes(nextBid.toString().replace(/['"]/g, ''))) {
                            sent = true;
                            break;
                        }
                        console.log(`[Retry] React update was too slow. Retrying Enter key (${attempt + 1}/4)...`);
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
                    task.resultMsg = `마감시간 초과로 댓글 권한 막힘 (입찰 등록 실패)`;
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
            const { authors: finalAuthors, texts: finalTexts, isNewestFirst: finalIsNewestFirst } = await this.extractAuthorsAndTexts(postContainer);
            const bids = [];
            for (let i = 0; i < finalTexts.length; i++) {
                const amount = this.parseBidAmount(finalTexts[i]);
                if (amount !== null && i < finalAuthors.length && finalAuthors[i]) {
                    bids.push({ author: finalAuthors[i].replace(/\s/g, ''), amount });
                }
            }
            if (bids.length > 0) {
                const tieResult = this.checkTieBreak(finalAuthors, finalTexts, myNameFinal, finalIsNewestFirst);
                finalHighest = tieResult.highest;
                finalIsTied = tieResult.isTied;
                finalAmIFirst = tieResult.amIFirst;
                const topBidders = bids.filter(b => b.amount === finalHighest);
                if (topBidders.length > 0) {
                    winnerName = topBidders[0].author;
                }
            }
            else {
                finalAmIFirst = false;
                finalHighest = 0;
            }
        }
        catch (e) { }
        if (!finalAmIFirst) {
            let reason = '금액 부족';
            if (finalIsTied)
                reason = '동점 선입찰자 패배';
            if (task.resultMsg === '입찰 한도액 초과로 포기')
                reason = '입찰 한도액 초과로 포기';
            if (task.resultMsg === '마감시간 초과로 댓글 권한 막힘 (입찰 등록 실패)')
                reason = '마감시간 초과로 댓글 권한 막힘 (입찰 등록 실패)';
            task.status = 'FAILED';
            task.resultMsg = `[낙찰 실패] 최종 낙찰자: ${winnerName} (상대최고가: ${finalHighest}) / 사유: ${reason}`;
        }
        else {
            task.status = 'SUCCESS';
            task.resultMsg = `[낙찰 성공] 방어 성공! 최종 낙찰자: ${winnerName} (내 최종가: ${currentOurBid})`;
        }
        this.emitUpdate(task);
        await browser.close();
        this.browserInstances.delete(task.id);
    }
    parseBidAmount(text) {
        if (text.includes('낙찰입니다'))
            return null; // 봇이 작성한 낙찰 댓글 무시
        let cleanText = text.replace(/@[^\s]+\s*/g, '');
        cleanText = cleanText.replace(/[요원만원천낙찰입찰갑니다콜,.\sㅋㅎ!~?]/g, '');
        if (/^\d+$/.test(cleanText))
            return parseInt(cleanText, 10);
        return null;
    }
    checkTieBreak(authors, texts, myName, isNewestFirst = false) {
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
        const firstTopBidder = isNewestFirst ? topBidders[topBidders.length - 1] : topBidders[0];
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
            // 텍스트 렌더링 완료까지 대기
            await page.waitForFunction((sel) => {
                const container = document.querySelector(sel);
                if (!container)
                    return false;
                return container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]').length > 0;
            }, containerSelector, { timeout: 2000 }).catch(() => { });
        }
    }
    async extractAuthorsAndTexts(postContainer) {
        return await postContainer.evaluate((container) => {
            const wraps = container.querySelectorAll('.cComment, .commentItem, [class*="comment_item"]');
            const authorsList = [];
            const textsList = [];
            const timestamps = [];
            const now = Date.now();
            wraps.forEach(node => {
                const authorNode = node.querySelector('.name, ._commentWriterName, strong.text');
                if (!authorNode)
                    return;
                const textNode = node.querySelector('p.txt, ._commentContent') || node;
                authorsList.push(authorNode.innerText.trim());
                textsList.push(textNode ? textNode.innerText.trim() : '');
                const timeNode = node.querySelector('time');
                let timestamp = 0;
                if (timeNode) {
                    const datetime = timeNode.getAttribute('datetime') || timeNode.getAttribute('data-timestamp');
                    if (datetime) {
                        timestamp = new Date(datetime).getTime();
                        if (isNaN(timestamp))
                            timestamp = parseInt(datetime, 10);
                    }
                    else {
                        const timeText = timeNode.innerText.trim();
                        if (timeText.includes('방금')) {
                            timestamp = now;
                        }
                        else if (timeText.includes('분 전')) {
                            const m = parseInt(timeText.replace(/[^0-9]/g, ''), 10) || 0;
                            timestamp = now - m * 60 * 1000;
                        }
                        else if (timeText.includes('시간 전')) {
                            const h = parseInt(timeText.replace(/[^0-9]/g, ''), 10) || 0;
                            timestamp = now - h * 60 * 60 * 1000;
                        }
                        else {
                            timestamp = new Date(timeText).getTime();
                        }
                    }
                }
                timestamps.push(isNaN(timestamp) ? 0 : timestamp);
            });
            const containerText = container.innerText || '';
            return { authors: authorsList, texts: textsList, timestamps, isNewestFirst: containerText.includes('최신순') };
        });
    }
    async loadAllComments(postContainer, page) {
        try {
            const moreCommentSelectors = [
                'a._viewCommentMore',
                'button._moreComment',
                'a._moreCommentBtn',
                '.viewPrevComment',
                '[class*="prevComment"]',
                '.moreComment'
            ];
            const selectorString = moreCommentSelectors.join(', ');
            for (let attempt = 0; attempt < 1; attempt++) {
                const moreBtn = postContainer.locator(selectorString).first();
                if (await moreBtn.count() === 0)
                    break;
                try {
                    await moreBtn.click({ timeout: 1000 });
                    await page.waitForTimeout(200);
                    console.log(`[LoadComments] 이전 댓글 1회 로드 완료`);
                }
                catch {
                    break;
                }
            }
        }
        catch (e) {
        }
    }
    startScheduler() {
        setInterval(() => {
            const now = this.getServerTime();
            for (const [id, task] of this.tasks.entries()) {
                const targetTime = task.targetTime || 0;
                if (targetTime === 0)
                    continue;
                const timeRemaining = targetTime - now;
                // ★ 리스크 2-C: 마감 5분 전(300000ms) 선제 검증 및 세션 자동 갱신
                if (timeRemaining <= 300000 && timeRemaining > 299000 && task.status === 'WAITING' && !task.sessionChecked) {
                    task.sessionChecked = true;
                    console.log(`[Scheduler] 마감 5분 전 세션 선제 검증 시작 (Task: ${task.id})`);
                    this.verifySessionBeforeClose().then(isOk => {
                        if (!isOk) {
                            const msg = `🚨 긴급 경고 🚨\n경매 마감(Task: ${task.id}) 5분 전인데 밴드 로그인이 풀렸습니다!\n즉시 관리자 프로그램에서 네이버 로그인을 다시 해주세요!`;
                            console.error(msg);
                            sendTelegramAlert(msg);
                            task.resultMsg = '로그인 만료 (5분 전 경고)';
                            this.emitUpdate(task);
                        }
                        else {
                            console.log(`[Scheduler] 5분 전 세션 검증 완료: 정상 유지 중`);
                        }
                    }).catch(e => {
                        console.error('[Scheduler] 세션 검증 중 에러:', e);
                    });
                }
                // 예약 메시지 확인 로직
                if (task.status === 'WAITING' && task.bandSettingId) {
                    const bandSetting = this.getBandSettings().find(s => s.id === task.bandSettingId);
                    if (bandSetting?.scheduledMessages && bandSetting.scheduledMessages.length > 0) {
                        if (!task.sentScheduledMessages)
                            task.sentScheduledMessages = [];
                        for (const msg of bandSetting.scheduledMessages) {
                            const triggerTimeMs = msg.timeOffsetMinutes * 60000;
                            // 시간이 도달했고 발송 기록이 없는 경우 (오차 1분 내외에서만 발송, 지나쳤으면 발송 안함)
                            if (timeRemaining <= triggerTimeMs && timeRemaining > triggerTimeMs - 60000 && !task.sentScheduledMessages.includes(msg.id)) {
                                task.sentScheduledMessages.push(msg.id);
                                console.log(`[Scheduler] 예약 메시지 발송 조건 충족 (Task: ${task.id}, Msg: ${msg.message})`);
                                this.postScheduledMessage(task, msg.message).catch(e => {
                                    console.error('[Scheduler] 예약 메시지 발송 실패:', e);
                                });
                                this.emitUpdate(task);
                            }
                        }
                    }
                }
                // 일반 경매 마감 태스크는 시간이 지났더라도(음수) 무조건 실행되도록 > 0 조건 제거
                if (timeRemaining <= 60000 && task.status === 'WAITING') {
                    console.log(`[Scheduler] Launching admin task ${task.id} (${timeRemaining}ms before target)`);
                    this.executeAdminTask(task).catch(e => {
                        console.error('[Scheduler] Error executing admin task:', e);
                    });
                }
            }
        }, 1000);
    }
    // ★ 세션 선제 검증 헬퍼 (하이브리드 체크 재사용)
    async verifySessionBeforeClose() {
        if (!hasStoredSession())
            return false;
        try {
            const detail = await this.checkLoginStatusDetailed();
            // unknown(네트워크 오류 등)은 만료로 오판하지 않음
            if (detail.status === 'unknown') {
                console.log('[verifySessionBeforeClose] 확인 불가(네트워크 등) — 만료로 판정하지 않음');
                return true;
            }
            if (detail.status === 'ok') {
                console.log('[Scheduler] 5분 전 세션 검증: 정상 유지 중');
                return true;
            }
            return false;
        }
        catch (e) {
            console.error('[verifySessionBeforeClose] 검증 중 에러:', e);
            return true; // 에러 시 오판 방지 (경고 스팸 회피)
        }
    }
    async postScheduledMessage(task, msgContent) {
        if (!task.urls || task.urls.length === 0)
            return;
        // Extract Band URL from the first task URL
        const match = task.urls[0].match(/(band\.us\/band\/\d+)/);
        if (!match)
            return;
        const bandUrl = `https://${match[1]}`;
        const logPath = path.join(app.getPath('userData'), 'scheduler_debug.log');
        const log = (msg) => {
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            console.log(msg);
            try {
                fs.appendFileSync(logPath, line);
            }
            catch (e) { }
        };
        log(`Starting postScheduledMessage (NEW POST) for task ${task.id} on Band ${bandUrl}: ${msgContent}`);
        let context = null;
        let page = null;
        try {
            log(`Calling getSharedContext...`);
            context = await getSharedContext();
            log(`getSharedContext returned.`);
            log(`Calling context.newPage()...`);
            page = await context.newPage();
            log(`context.newPage() returned.`);
            log(`Calling page.goto(${bandUrl})...`);
            await page.goto(bandUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            log(`page.goto completed. Waiting for write button...`);
            const writeSelector = 'button._btnPostWrite, button._btnOpenWriteLayer, .postWriteForm .clickArea';
            await page.waitForSelector(writeSelector, { state: 'visible', timeout: 20000 });
            await page.locator(writeSelector).first().click({ timeout: 10000 });
            log(`Write button clicked.`);
            const editorSelector = ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) [contenteditable="true"], .writeBoard [contenteditable="true"], [contenteditable="true"]';
            await page.waitForSelector(editorSelector, { state: 'visible', timeout: 20000 });
            const editor = page.locator(editorSelector).first();
            await editor.click();
            await editor.fill(msgContent).catch(async () => {
                await editor.evaluate((el, txt) => { el.innerText = txt; }, msgContent);
            });
            // 값 인식(게시 버튼 활성화)을 위해 키보드 이벤트 발생 (사용자 아이디어 반영)
            await editor.press('End').catch(() => { });
            await editor.press('Space').catch(() => { });
            await editor.press('Backspace').catch(() => { });
            log(`Editor filled with content and events triggered.`);
            await page.waitForTimeout(1000);
            const submitLocators = [
                ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button:has-text("게시")',
                ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.btnSubmit',
                ':is(.layer_wrap, .layerContainerView, .layerContainer, .postWriteForm, .modalWrite) button.uBtn.-submit',
                'button:has-text("게시")'
            ];
            let submitClicked = false;
            for (const sel of submitLocators) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible()) {
                    await btn.click();
                    submitClicked = true;
                    break;
                }
            }
            if (submitClicked) {
                log(`Submit button clicked. Waiting for network request and modal to close...`);
                await page.waitForTimeout(5000);
                await page.waitForSelector(':is(.layer_wrap, .layerContainerView, .layerContainer)', { state: 'hidden', timeout: 15000 }).catch(() => { });
                log(`Post successfully submitted!`);
            }
            else {
                log(`Could not find submit button!`);
            }
        }
        catch (e) {
            log(`Scheduled message error: ${e.stack || e.message}`);
        }
        finally {
            if (page && !page.isClosed()) {
                log(`Closing page...`);
                await page.close().catch(() => { });
                log(`Page closed.`);
            }
            if (context) {
                try {
                    const pages = context.pages();
                    const hasActivePages = pages.some(p => {
                        const u = p.url();
                        return u.includes('band.us') || u.includes('nid.naver.com');
                    });
                    if (!hasActivePages) {
                        log(`No active pages found, closing shared context...`);
                        await closeSharedContext();
                        log(`Shared context closed.`);
                    }
                    else {
                        log(`Active pages remain, keeping shared context open.`);
                    }
                }
                catch (e) { }
            }
            log(`Finished postScheduledMessage for task ${task.id}`);
        }
    }
    async executeAdminTask(task) {
        console.log(`[AdminTask] Starting range admin task for ${task.urls?.length || 0} posts`);
        task.status = 'CLOSING';
        task.results = [];
        this.emitUpdate(task);
        if (!task.urls || task.urls.length === 0) {
            task.status = 'FAILED';
            task.resultMsg = '처리할 URL이 없습니다.';
            this.emitUpdate(task);
            return;
        }
        try {
            // 공유 영속 컨텍스트 사용 (동시 다발 컨텍스트로 인한 비정상 동시 접속 감지 회피)
            const context = await getSharedContext();
            const page = await context.newPage();
            this.browserInstances.set(task.id, page);
            // 1. 밴드 권한 설정으로 미리 이동하여 대기
            let permissionChanged = false;
            const bandSetting = task.bandSettingId ? this.bandSettings.get(task.bandSettingId) : undefined;
            if (bandSetting?.deadlineType !== 'OBSERVER') {
                try {
                    const bandMatch = task.urls[0].match(/band\.us\/band\/(\d+)/);
                    if (bandMatch && bandMatch[1]) {
                        const settingUrl = `https://band.us/band/${bandMatch[1]}/setting/member-permission`;
                        await page.goto(settingUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(2000);
                        console.log('[AdminTask] 권한 설정 페이지 스크롤 탐색 시작...');
                        let foundSettings = false;
                        let changeBtn = page.locator('.sSettingItem, li').filter({ hasText: '댓글 쓰기' }).locator('button._btnChange, button:has-text("변경")').first();
                        for (let i = 0; i < 15; i++) {
                            if (await changeBtn.count() > 0 && await changeBtn.isVisible()) {
                                foundSettings = true;
                                break;
                            }
                            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                            await page.waitForTimeout(500);
                        }
                        if (foundSettings) {
                            await changeBtn.scrollIntoViewIfNeeded().catch(() => { });
                            await changeBtn.click({ timeout: 2000 });
                            await page.waitForTimeout(1000);
                            // 클릭 후 라디오 체크
                            const leaderOnlyBtn = page.locator('label', { hasText: '리더만' }).first();
                            if (await leaderOnlyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                                await leaderOnlyBtn.click().catch(() => { });
                            }
                            // [수정] isVisible 확인 없이 무조건 대기 및 강제 클릭 수행
                            console.log('[AdminTask] 권한 설정 팝업 대기 중...');
                            const timeRemaining = (task.targetTime || 0) - this.getServerTime();
                            if (timeRemaining > 0) {
                                await page.waitForTimeout(timeRemaining);
                            }
                            // 1차 강제 클릭 (모달 띄워놓고 클릭 안되는 현상 원천 차단)
                            await page.evaluate(() => {
                                const btns = Array.from(document.querySelectorAll('button'));
                                const confirm = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '저장') && b.offsetParent !== null);
                                if (confirm)
                                    confirm.click();
                            }).catch(() => { });
                            console.log('[AdminTask] 1차 밴드 댓글 권한 리더만 가능하도록 변경 시도 완료.');
                            // ★★★ 서버 통신이 완료될 때까지 충분히 대기 (매우 중요) ★★★
                            // HTTP 요청이 밴드 서버에 전달되기 전에 page.close()나 page.goto()가 발생하면
                            // 요청이 Abort(취소)되어 권한 변경이 실패하는 현상 방지
                            await Promise.all([
                                page.waitForResponse(res => res.url().includes('setting') || res.status() === 200).catch(() => { }),
                                page.waitForTimeout(3000)
                            ]);
                            // 2중 확인 장치
                            let settingItem = page.locator('.sSettingItem, li').filter({ hasText: '댓글 쓰기' }).first();
                            let itemText = await settingItem.innerText().catch(() => '');
                            if (!itemText.includes('리더')) {
                                console.log('[AdminTask] 1차 권한 확인 실패. 재시도합니다...');
                                // 혹시 아직도 모달이 떠있어서 changeBtn이 클릭 안될 수 있으므로 모달 닫기 시도
                                await page.evaluate(() => {
                                    const btns = Array.from(document.querySelectorAll('button'));
                                    const closeBtn = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '취소') && b.offsetParent !== null);
                                    if (closeBtn)
                                        closeBtn.click();
                                }).catch(() => { });
                                await page.waitForTimeout(1000);
                                if (await changeBtn.isVisible().catch(() => false)) {
                                    await changeBtn.click({ timeout: 2000 }).catch(() => { });
                                    await page.waitForTimeout(1000);
                                    const leaderOnlyBtn2 = page.locator('label', { hasText: '리더만' }).first();
                                    if (await leaderOnlyBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        await leaderOnlyBtn2.click().catch(() => { });
                                    }
                                    await page.evaluate(() => {
                                        const btns = Array.from(document.querySelectorAll('button'));
                                        const confirm2 = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '저장') && b.offsetParent !== null);
                                        if (confirm2)
                                            confirm2.click();
                                    }).catch(() => { });
                                    // 재시도 시에도 충분한 통신 대기
                                    await page.waitForTimeout(3000);
                                }
                                itemText = await settingItem.innerText().catch(() => '');
                            }
                            if (itemText.includes('리더')) {
                                console.log('[AdminTask] 권한이 관리자 전용으로 정상 변경된 것을 2중 확인 완료했습니다.');
                            }
                            else {
                                console.log(`[AdminTask] 2중 권한 변경 확인 실패 (현재 텍스트: ${itemText}). 수동 확인이 필요할 수 있습니다.`);
                            }
                            permissionChanged = true;
                        }
                    }
                }
                catch (e) {
                    console.log('[AdminTask] 권한 변경 중 오류 발생:', e.message);
                }
            } // end if !== 'OBSERVER'
            if (!permissionChanged) {
                const timeRemaining = (task.targetTime || 0) - this.getServerTime();
                if (timeRemaining > 0) {
                    console.log(`[AdminTask] Waiting ${timeRemaining}ms for target time...`);
                    await page.waitForTimeout(timeRemaining);
                }
            }
            // 2. 개별 게시물 다이렉트 접속 루프 (Direct URL Processing)
            let processUrls = [...task.urls];
            let isTopDown = false;
            if (bandSetting?.deadlineType === 'OBSERVER' && bandSetting?.observerOrder === 'REVERSE') {
                isTopDown = true;
            }
            // 사용자의 설정(위에서 아래로 vs 아래서 위로)에 따른 순서 배정
            if (isTopDown) {
                processUrls.reverse(); // 최신글(61)부터 오래된글(12) 순서 (Top-Down)
            }
            for (const url of processUrls) {
                console.log(`[AdminTask] Processing post directly: ${url}`);
                try {
                    // 해당 게시물 URL로 직접 접속 (가상 스크롤 문제 원천 차단)
                    await page.goto(url, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(2000); // 렌더링 대기
                    // URL 변경(리다이렉트) 여부 체크 (삭제된 게시글 접근 시 피드로 이동하는 현상 방지)
                    if (!page.url().includes('/post/')) {
                        console.log(`[AdminTask] 게시글이 삭제되었거나 피드로 리다이렉트 됨 스킵: ${url} -> ${page.url()}`);
                        continue;
                    }
                    // 단일 게시물 화면이므로 첫 번째 포스트 컨테이너가 타겟
                    let reloadedContainer = page.locator('._postMainWrap, .cContentsCard, .postMain').first();
                    try {
                        // SPA 렌더링 지연(로딩)을 고려하여 최대 8초간 컨테이너가 나타나길 대기
                        await reloadedContainer.waitFor({ state: 'attached', timeout: 8000 });
                    }
                    catch (e) {
                        console.log(`[AdminTask] 게시물 컨테이너를 찾을 수 없음 (삭제됨 또는 로딩 지연) 스킵: ${url}`);
                        continue;
                    }
                    // [추가 방어 로직] 렌더링 완료 후 최종 상태 검증
                    const expectedPostMatch = url.match(/post\/(\d+)/);
                    const expectedPostId = expectedPostMatch ? expectedPostMatch[1] : null;
                    if (!page.url().includes('/post/')) {
                        console.log(`[AdminTask] 렌더링 후 피드로 리다이렉트 됨 스킵: ${url} -> ${page.url()}`);
                        continue;
                    }
                    if (expectedPostId && !page.url().includes(expectedPostId)) {
                        console.log(`[AdminTask] 다른 게시글로 리다이렉트 됨 스킵: 요청=${expectedPostId}, 현재=${page.url()}`);
                        continue;
                    }
                    // 존재하지 않는 게시글 모달 텍스트 확인 (URL이 안바뀌고 모달만 뜨는 경우 대비)
                    const hasErrorText = await page.evaluate(() => {
                        const text = document.body.innerText || '';
                        return text.includes('존재하지 않는 게시글') || text.includes('삭제된 게시글') || text.includes('게시글을 찾을 수 없습니다');
                    });
                    if (hasErrorText) {
                        console.log(`[AdminTask] 삭제/존재하지 않는 게시글 에러 감지 됨 스킵: ${url}`);
                        continue;
                    }
                    // 댓글 접어두기 / 펼치기 (상태에 따라 동작)
                    const commentBtn = reloadedContainer.locator('._commentCountBtn, ._commentCountLayerBtn, ._commentMainBtn, .commentBtn').first();
                    if (await commentBtn.count() > 0) {
                        const isExpanded = await reloadedContainer.locator('textarea, [contenteditable="true"]').first().isVisible();
                        if (isExpanded) {
                            // 이미 펼쳐져 있다면: 접었다가 다시 펴기 (새로고침 효과)
                            await commentBtn.evaluate(b => b.click()).catch(() => { });
                            await page.waitForTimeout(1000);
                            await commentBtn.evaluate(b => b.click()).catch(() => { });
                        }
                        else {
                            // 닫혀 있다면: 한 번만 눌러서 펴기
                            await commentBtn.evaluate(b => b.click()).catch(() => { });
                        }
                        await page.waitForTimeout(1000); // 렌더링 대기
                        // 최후의 안전장치: 여전히 안 열려있으면 한 번 더 강제 클릭
                        const isStillHidden = !(await reloadedContainer.locator('textarea, [contenteditable="true"]').first().isVisible());
                        if (isStillHidden) {
                            await commentBtn.evaluate(b => b.click()).catch(() => { });
                            await page.waitForTimeout(1000);
                        }
                    }
                    let postTitle = '제목 없음';
                    try {
                        const titleNode = reloadedContainer.locator('.txtBody').first();
                        const fullText = await titleNode.innerText();
                        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                        if (lines.length > 0)
                            postTitle = lines[0].substring(0, 50);
                    }
                    catch (e) { }
                    if (bandSetting?.deadlineType === 'OBSERVER') {
                        console.log(`[AdminTask] 순차 마감(OBSERVER) 5초 카운트다운 시작: ${url}`);
                        let highestSoFar = -1;
                        let lastHighestTime = Date.now();
                        let hasReloadedInSilence = false; // 침묵 기간 중 새로고침을 했는지 여부
                        while (true) {
                            await page.waitForTimeout(1000); // 1초 대기 (밴드 자체 실시간 웹소켓 업데이트 기대)
                            await this.loadAllComments(reloadedContainer, page);
                            const { texts } = await this.extractAuthorsAndTexts(reloadedContainer);
                            let loopHighest = 0;
                            for (let i = 0; i < texts.length; i++) {
                                const amount = this.parseBidAmount(texts[i]);
                                if (amount !== null && amount > loopHighest)
                                    loopHighest = amount;
                            }
                            if (loopHighest > highestSoFar) {
                                highestSoFar = loopHighest;
                                lastHighestTime = Date.now();
                                hasReloadedInSilence = false; // 새로운 입찰이 나오면 새로고침 플래그 초기화
                                console.log(`[AdminTask] 새 상위 입찰 발견(${loopHighest}), 5초 카운트다운 리셋!`);
                            }
                            const elapsedSilence = Date.now() - lastHighestTime;
                            // 3초 경과 시점에 보험용으로 딱 한 번만 새로고침 진행 (잦은 API 호출 방지)
                            if (elapsedSilence >= 3000 && !hasReloadedInSilence) {
                                console.log(`[AdminTask] 3초간 입찰 없음. 최신화(새로고침) 1회 시도...`);
                                await page.reload({ waitUntil: 'domcontentloaded' });
                                await page.waitForTimeout(1500); // 렌더링 대기
                                reloadedContainer = page.locator('._postMainWrap, .cContentsCard, .postMain').first();
                                await reloadedContainer.waitFor({ state: 'attached', timeout: 5000 }).catch(() => { });
                                hasReloadedInSilence = true;
                                continue; // 새로고침 했으니 바로 다시 체크
                            }
                            if (elapsedSilence >= 5000) {
                                console.log(`[AdminTask] 5초간 입찰 없음 확인. 최종 마감 진행.`);
                                break;
                            }
                        }
                    }
                    else {
                        await this.loadAllComments(reloadedContainer, page);
                    }
                    const { authors, texts, timestamps, isNewestFirst } = await this.extractAuthorsAndTexts(reloadedContainer);
                    const alreadyPosted = texts.some(t => t.includes('낙찰입니다'));
                    let currentHighest = 0;
                    let winnerName = '';
                    // 1. 유효 입찰자 목록(Set) 구성 (신규 입찰 제한 시간 적용)
                    const eligibleBidders = new Set();
                    const targetTime = task.targetTime || 0;
                    const limitMin = bandSetting?.newBidLimitMinutes || 0;
                    const limitTime = limitMin > 0 && targetTime > 0 ? targetTime - (limitMin - 1) * 60000 : 0;
                    if (limitTime > 0) {
                        // limitTime 이전에 한 번이라도 댓글을 단 사람을 유효 입찰자로 등록
                        for (let i = 0; i < authors.length; i++) {
                            // timestamp가 0이면(파싱 실패) 안전을 위해 일단 유효 입찰자로 인정
                            if (timestamps[i] === 0 || timestamps[i] <= limitTime) {
                                eligibleBidders.add(authors[i]);
                            }
                        }
                    }
                    const bids = [];
                    for (let i = 0; i < texts.length; i++) {
                        const amount = this.parseBidAmount(texts[i]);
                        if (amount !== null && i < authors.length && authors[i]) {
                            const author = authors[i];
                            // limitTime이 적용중이고, 이 작가가 유효 입찰자가 아니라면(기존 입찰 내역 없음) 무시
                            if (limitTime > 0 && !eligibleBidders.has(author)) {
                                console.log(`[AdminTask] 신규 입찰 제한(limitTime: ${new Date(limitTime).toLocaleTimeString()})으로 인해 제외됨: ${author}`);
                                continue;
                            }
                            bids.push({ author, amount, index: i });
                        }
                    }
                    if (bids.length > 0) {
                        currentHighest = bids.reduce((max, b) => Math.max(max, b.amount), 0);
                        const topBidders = bids.filter(b => b.amount === currentHighest);
                        // 최신순이면 배열 뒷부분이 첫 댓글, 과거순이면 배열 앞부분이 첫 댓글 (동점자 시 최우선 입찰자 선정)
                        const firstTopBidder = isNewestFirst ? topBidders[topBidders.length - 1] : topBidders[0];
                        winnerName = firstTopBidder.author.replace(/\s/g, '');
                    }
                    let thumbnailPath;
                    let thumbnailUrl;
                    if (currentHighest > 0 && winnerName) {
                        const thumbRes = await this.collectPostThumbnail(reloadedContainer, page, url);
                        if (thumbRes) {
                            thumbnailPath = thumbRes.path;
                            thumbnailUrl = thumbRes.url;
                        }
                    }
                    task.results.push({
                        url,
                        postTitle,
                        thumbnailUrl,
                        thumbnailPath,
                        winnerName: winnerName || '유찰(입찰자 없음)',
                        winningBid: currentHighest
                    });
                    if (currentHighest > 0 && winnerName && !alreadyPosted) {
                        try {
                            console.log(`[AdminTask] 낙찰자(${winnerName}) 태그 시도 중...`);
                            let successClick = false;
                            const winnerNameEl = reloadedContainer.locator('.cComment, .commentItem').filter({ hasText: winnerName }).locator('.name, ._commentWriterName, strong.text').first();
                            if (await winnerNameEl.count() > 0) {
                                await winnerNameEl.scrollIntoViewIfNeeded().catch(() => { });
                                if (await winnerNameEl.isVisible()) {
                                    await winnerNameEl.click();
                                    await page.waitForTimeout(500);
                                    // 클릭 후 입력창에 태그가 자동 삽입되었으므로 맨 끝에 스페이스와 텍스트 추가
                                    const input = reloadedContainer.locator('textarea, [contenteditable="true"]').first();
                                    await input.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => { });
                                    await input.evaluate(el => el.focus()).catch(() => { }); // 강제 포커스
                                    // End 키로 커서를 맨 끝으로 (혹시 모를 상황 대비)
                                    await page.keyboard.press('End').catch(() => { });
                                    const winMsg = ` ${currentHighest} 낙찰입니다.`;
                                    await input.pressSequentially(winMsg, { delay: 10 }).catch(async () => {
                                        // 실패 시 evaluate로 강제 주입
                                        await input.evaluate((el, text) => {
                                            const textArea = el;
                                            textArea.value = textArea.value + text;
                                            el.dispatchEvent(new Event('input', { bubbles: true }));
                                        }, winMsg);
                                    });
                                    successClick = true;
                                }
                            }
                            if (!successClick) {
                                const inputArea = reloadedContainer.locator('textarea, [contenteditable="true"]').first();
                                await inputArea.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => { });
                                await inputArea.fill(`@${winnerName} ${currentHighest} 낙찰입니다.`, { force: true }).catch(async () => {
                                    // 만약 force:true 도 실패한다면 evaluate로 강제 주입
                                    await inputArea.evaluate((el, text) => {
                                        el.value = text;
                                        el.dispatchEvent(new Event('input', { bubbles: true }));
                                    }, `@${winnerName} ${currentHighest} 낙찰입니다.`);
                                });
                                await page.waitForTimeout(500);
                            }
                            await page.keyboard.press('Control+Enter').catch(() => { });
                            // 밴드스나이퍼 완벽 로직 적용 (evaluate 및 정확한 클래스)
                            await reloadedContainer.evaluate((container) => {
                                const btn = container.querySelector('button._btnSubmitComment, .uBtn.-submit, .submit, ._btnSubmit, .btnSend, .btn_send');
                                if (btn)
                                    btn.click();
                            }).catch(() => { });
                            // 네트워크 전송(렌더링)을 위한 안전 대기 추가
                            await page.waitForTimeout(500);
                            console.log(`[AdminTask] Posted winning comment on ${url}`);
                        }
                        catch (e) {
                            console.log(`[AdminTask] Failed to post comment on ${url}.`, e.message);
                        }
                    }
                    this.emitUpdate(task);
                }
                catch (postErr) {
                    console.error(`[AdminTask] 오류 발생 (${url}):`, postErr);
                }
            }
            // 마지막 게시물까지 작성 완료 후 3초 대기 (네트워크/UI 지연 방지)
            await page.waitForTimeout(3000);
            // 3. 댓글 권한 원상 복구 ('전체' 또는 '모든 멤버')
            if (task.restoreCommentPermission) {
                try {
                    const bandMatch = task.urls[0].match(/band\.us\/band\/(\d+)/);
                    if (bandMatch && bandMatch[1]) {
                        const settingUrl = `https://band.us/band/${bandMatch[1]}/setting/member-permission`;
                        await page.goto(settingUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(2000);
                        let changeBtn = page.locator('.sSettingItem, li').filter({ hasText: '댓글 쓰기' }).locator('button._btnChange, button:has-text("변경")').first();
                        let foundSettings = false;
                        for (let i = 0; i < 15; i++) {
                            if (await changeBtn.count() > 0 && await changeBtn.isVisible()) {
                                foundSettings = true;
                                break;
                            }
                            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                            await page.waitForTimeout(500);
                        }
                        if (foundSettings) {
                            await changeBtn.scrollIntoViewIfNeeded().catch(() => { });
                            await changeBtn.click({ timeout: 2000 }).catch(() => { });
                            await page.waitForTimeout(1000);
                            // '모든 멤버' 또는 '전체' 권한으로 변경
                            const everyoneBtn = page.locator('label').filter({ hasText: /(모든 멤버|전체 멤버|전체)/ }).first();
                            if (await everyoneBtn.count() > 0) {
                                await everyoneBtn.click().catch(() => { });
                                await page.waitForTimeout(500);
                                // 1차 강제 클릭
                                await page.evaluate(() => {
                                    const btns = Array.from(document.querySelectorAll('button'));
                                    const confirm = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '저장') && b.offsetParent !== null);
                                    if (confirm)
                                        confirm.click();
                                }).catch(() => { });
                                console.log('[AdminTask] 권한 모든 멤버로 변경 시도 완료.');
                                
                                // 네트워크 통신 대기 (매우 중요)
                                await Promise.all([
                                    page.waitForResponse((res: any) => res.url().includes('setting') || res.status() === 200).catch(() => { }),
                                    page.waitForTimeout(3000)
                                ]);

                                // 2중 확인 장치
                                let settingItem = page.locator('.sSettingItem, li').filter({ hasText: '댓글 쓰기' }).first();
                                let itemText = await settingItem.innerText().catch(() => '');
                                if (!itemText.includes('모든 멤버') && !itemText.includes('전체')) {
                                    console.log('[AdminTask] 권한 복구 1차 확인 실패. 재시도합니다...');
                                    // 모달 닫기
                                    await page.evaluate(() => {
                                        const btns = Array.from(document.querySelectorAll('button'));
                                        const closeBtn = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '취소') && b.offsetParent !== null);
                                        if (closeBtn) closeBtn.click();
                                    }).catch(() => { });
                                    await page.waitForTimeout(1000);
                                    
                                    if (await changeBtn.isVisible().catch(() => false)) {
                                        await changeBtn.click({ timeout: 2000 }).catch(() => { });
                                        await page.waitForTimeout(1000);
                                        const everyoneBtn2 = page.locator('label').filter({ hasText: /(모든 멤버|전체 멤버|전체)/ }).first();
                                        if (await everyoneBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
                                            await everyoneBtn2.click().catch(() => { });
                                        }
                                        await page.evaluate(() => {
                                            const btns = Array.from(document.querySelectorAll('button'));
                                            const confirm2 = btns.find(b => (b.innerText.trim() === '확인' || b.innerText.trim() === '저장') && b.offsetParent !== null);
                                            if (confirm2) confirm2.click();
                                        }).catch(() => { });
                                        await page.waitForTimeout(3000);
                                    }
                                    itemText = await settingItem.innerText().catch(() => '');
                                }
                                
                                if (itemText.includes('모든 멤버') || itemText.includes('전체')) {
                                    console.log('[AdminTask] 권한 원래대로(전체) 복구 완료 및 2중 확인 완료!');
                                } else {
                                    console.log(`[AdminTask] 2중 권한 복구 확인 실패 (현재 텍스트: ${itemText}). 수동 확인이 필요할 수 있습니다.`);
                                }
                            }
                        }
                    }
                }
                catch (revertErr) {
                    console.error('[AdminTask] 권한 복구 실패:', revertErr);
                }
            }
            else {
                console.log('[AdminTask] 권한 복구 옵션이 꺼져 있어 그대로 닫아둡니다.');
            }
            // 4. 구글 시트 일괄 업데이트 (종료 후 한 번에 기록)
            if (task.results.length > 0) {
                try {
                    const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
                    if (fs.existsSync(configPath)) {
                        const catalogConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                        if (catalogConfig.googleSpreadsheetUrl) {
                            console.log(`[AdminTask] 구글 시트 일괄 업데이트 시작...`);
                            const batchResults = task.results.map(r => ({
                                postUrl: r.url,
                                winnerName: r.winnerName,
                                winningBid: r.winningBid
                            }));
                            await updateAuctionResultsBatch(catalogConfig.googleSpreadsheetUrl, batchResults);
                            console.log(`[AdminTask] 구글 시트 일괄 업데이트 완료.`);
                        }
                    }
                }
                catch (sheetErr) {
                    console.error('[AdminTask] 구글 시트 업데이트 실패:', sheetErr);
                }
            }
            task.status = 'SUCCESS';
            task.resultMsg = `총 ${task.results.length}건 처리 완료`;
            this.emitUpdate(task);
        }
        catch (e) {
            console.error('[AdminTask] Error:', e);
            task.status = 'FAILED';
            task.resultMsg = `에러: ${e.message}`;
            this.emitUpdate(task);
        }
        finally {
            const taskPage = this.browserInstances.get(task.id);
            if (taskPage) {
                try {
                    await taskPage.close();
                }
                catch { }
            }
            this.browserInstances.delete(task.id);
            await saveStorageMirror();
            // 실행 중인 다른 태스크가 없다면 브라우저를 완전히 닫아서 about:blank 창이 남는 것을 방지
            if (this.browserInstances.size === 0) {
                // 하지만 '자동 정산 채팅'이 활성화되어 있을 경우, 프론트엔드가 즉시 채팅 봇을 호출할 수 있음.
                // 따라서 1.5초 대기 후 채팅 봇이 동작 중이 아닐 때만 닫도록 안전장치 추가.
                setTimeout(async () => {
                    const { bandChatBot } = await import('./bandChatBot.js');
                    if (!bandChatBot.isChatting()) {
                        try {
                            await closeSharedContext();
                        }
                        catch { }
                    }
                }, 1500);
            }
        }
    }
}
export const adminManager = new AdminManager();
