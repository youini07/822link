// @ts-nocheck
import { chromium } from 'playwright';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
let sharedContext = null;
let launchingPromise = null;
// headless 프로필 체크 중임을 표시 (가시 브라우저 실행과의 프로필 동시 접근 충돌 방지)
let profileCheckLock = false;
export function getProfileDir() {
    return path.join(app.getPath('userData'), 'band-profile');
}
export function getMirrorPath() {
    return path.join(app.getPath('userData'), 'naver-storage-state.json');
}
function getLegacyAltPath() {
    return path.join(app.getPath('appData'), 'Band Admin', 'naver-storage-state.json');
}
// 최초 1회: 기존 스냅샷 파일의 쿠키를 새 영속 프로필로 이관
async function migrateLegacyCookies(context) {
    const markerPath = path.join(getProfileDir(), '.session-migrated');
    try {
        if (fs.existsSync(markerPath))
            return;
        const candidates = [getMirrorPath(), getLegacyAltPath()];
        const src = candidates.find(p => fs.existsSync(p));
        if (src) {
            const data = JSON.parse(fs.readFileSync(src, 'utf8'));
            if (Array.isArray(data.cookies) && data.cookies.length > 0) {
                await context.addCookies(data.cookies);
                console.log(`[BandSession] 기존 세션 쿠키 ${data.cookies.length}개를 영속 프로필로 이관 완료`);
            }
        }
        fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
    }
    catch (e) {
        console.error('[BandSession] 세션 이관 실패:', e.message);
    }
}
/**
 * 공유 영속 컨텍스트 획득 (지연 생성, 싱글턴)
 * - 헤드리스 금지: 네이버의 헤드리스 탐지 회피 + 사용자 관찰 가능
 */
export async function getSharedContext() {
    if (sharedContext) {
        const browser = sharedContext.browser();
        if (!browser || !browser.isConnected()) {
            sharedContext = null;
            launchingPromise = null;
        }
        else {
            return sharedContext;
        }
    }
    if (launchingPromise)
        return launchingPromise;
    // headless 프로필 체크가 진행 중이면 충돌 방지를 위해 대기
    const lockStart = Date.now();
    while (profileCheckLock) {
        if (Date.now() - lockStart > 20000)
            break; // 최대 20초 대기 후 진행
        await new Promise(r => setTimeout(r, 300));
    }
    const profileDir = getProfileDir();
    if (!fs.existsSync(profileDir))
        fs.mkdirSync(profileDir, { recursive: true });
    console.log('[BandSession] 공유 영속 브라우저 컨텍스트 시작...');
    // 호출 출처 추적 (누가 가시 브라우저를 띄우는지 진단용)
    console.log('[BandSession] 호출 스택:', new Error('trace').stack);
    launchingPromise = (async () => {
        let context;
        // 비정상 종료로 남은 잠금 파일(Lock) 제거 시도 (세션 유실/Chromium 폴백 원인)
        try {
            const lockFiles = ['SingletonLock', 'SingletonCookie', 'lockfile'];
            for (const lf of lockFiles) {
                const lfPath = path.join(profileDir, lf);
                if (fs.existsSync(lfPath))
                    fs.unlinkSync(lfPath);
            }
        }
        catch (e) {
            console.warn('[BandSession] 잠금 파일 삭제 실패 (브라우저가 이미 백그라운드에 켜져 있을 수 있음):', e.message);
        }
        try {
            context = await chromium.launchPersistentContext(profileDir, {
                headless: false,
                channel: 'chrome',
                chromiumSandbox: true,
                viewport: null,
                args: [
                    '--window-size=1280,900',
                    '--window-position=40,40',
                    '--disable-blink-features=AutomationControlled',
                    '--test-type',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--hide-crash-restore-window',
                    '--disable-session-crashed-bubble',
                    '--disable-infobars',
                ],
                permissions: ['clipboard-read', 'clipboard-write'],
            });
        }
        catch (e) {
            // Chrome 채널 미설치 시 기본 Chromium으로 폴백
            console.warn('[BandSession] Chrome 채널 실행 실패, 기본 Chromium으로 시도:', e.message);
            context = await chromium.launchPersistentContext(profileDir, {
                headless: false,
                viewport: null,
                chromiumSandbox: true,
                args: [
                    '--window-size=1280,900',
                    '--window-position=40,40',
                    '--no-first-run',
                    '--hide-crash-restore-window',
                    '--disable-session-crashed-bubble',
                    '--disable-infobars',
                ],
                permissions: ['clipboard-read', 'clipboard-write'],
            });
        }
        sharedContext = context;
        context.on('close', () => {
            sharedContext = null;
            launchingPromise = null;
            console.log('[BandSession] 공유 컨텍스트 종료됨');
        });
        await migrateLegacyCookies(context);
        launchingPromise = null;
        return context;
    })();
    return launchingPromise;
}
/** 영속 프로필 → 미러 파일(naver-storage-state.json) 동기화 (실제 저장 성공 여부 반환) */
export async function saveStorageMirror() {
    const ctx = sharedContext;
    if (!ctx)
        return false;
    try {
        const browser = ctx.browser();
        if (!browser || !browser.isConnected())
            return false;
        const state = await ctx.storageState();
        // 쿠키 반영 지연(Race Condition) 방지: 핵심 로그인 쿠키가 없으면 저장을 보류하고 false 반환 (호출부에서 재시도)
        const hasSession = state.cookies.some(c => ['band_session', 'NEO_SES', 'NID_SES'].includes(c.name));
        if (!hasSession) {
            console.warn('[BandSession] 핵심 로그인 쿠키가 아직 반영되지 않음. 저장을 보류합니다.');
            return false;
        }
        const mirrorPath = getMirrorPath();
        const tempPath = mirrorPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tempPath, mirrorPath);
        return true;
    }
    catch (e) {
        console.warn('[BandSession] 미러 저장 실패:', e.message);
        return false;
    }
}
/** 저장된 세션 존재 여부 (브라우저 실행 없이 즉시 판별) */
export function hasStoredSession() {
    if (fs.existsSync(getProfileDir()) && fs.readdirSync(getProfileDir()).length > 0) {
        // 마이그레이션 마커 또는 프로필 DB 존재 = 세션 정보 있음
        return true;
    }
    return fs.existsSync(getMirrorPath()) || fs.existsSync(getLegacyAltPath());
}
/** 공유 컨텍스트가 이미 실행 중일 때만 반환 (없으면 null → 브라우저를 새로 띄우지 않음) */
export function getRunningSharedContext() {
    if (sharedContext) {
        const browser = sharedContext.browser();
        if (!browser || !browser.isConnected()) {
            sharedContext = null;
            launchingPromise = null;
            return null;
        }
        return sharedContext;
    }
    return null;
}
// get_profile 응답 수동 청취 + 판정 (컨텍스트 내부에서 실행)
async function checkInContext(context) {
    let apiNickname;
    let apiResultCode = null;
    const onResponse = async (res) => {
        try {
            if (!res.url().includes('/get_profile'))
                return;
            const json = await res.json();
            if (json && typeof json.result_code === 'number') {
                apiResultCode = json.result_code;
                if (json.result_code === 1 && json.result_data?.name) {
                    apiNickname = json.result_data.name;
                }
            }
        }
        catch { }
    };
    const page = await context.newPage();
    try {
        page.on('response', onResponse);
        // goto 실패 시 1회 재시도 (일시적 네트워크 지연을 unknown으로 오판하지 않기 위함)
        try {
            await page.goto('https://band.us/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        catch (e) {
            console.warn(`[BandSession] 접속 재시도: ${e.message}`);
            await page.goto('https://band.us/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        await page.waitForTimeout(4000);
        const currentUrl = page.url();
        // 로그아웃 상태면 /home, /about, login_page 등으로 리다이렉트됨
        if (/(login_page|nid\.naver\.com|auth\.band\.us|\/home|\/about)/.test(currentUrl)) {
            return { status: 'expired' };
        }
        if (apiResultCode === 1)
            return { status: 'ok', nickname: apiNickname };
        if (apiResultCode !== null)
            return { status: 'expired' }; // API 호출됐는데 실패 = 세션 무효
        // API 응답을 못 잡은 경우 보조 판별
        const domStatus = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            if (text.includes('Access Denied') || text.includes('Captcha'))
                return 'unknown';
            return 'ok'; // URL이 밴드 피드에 잘 머물러 있다면 로그인 상태로 간주
        }).catch(() => 'unknown');
        return { status: domStatus };
    }
    catch (e) {
        console.error('[BandSession] 세션 확인 중 오류:', e.message);
        return { status: 'unknown' };
    }
    finally {
        try {
            await page.close();
        }
        catch { }
    }
}
/**
 * [L2-임시] 공유 컨텍스트가 꺼져 있을 때: 미러 스냅샷으로 보이지 않는(headless)
 * 임시 브라우저를 만들어 세션 확인 (읽기 전용 — 메인 프로필·미러를 갱신하지 않음)
 */
export async function checkBandSessionTemp() {
    let browser = null;
    try {
        const mirror = getMirrorPath();
        const altPath = getLegacyAltPath();
        const src = fs.existsSync(mirror) ? mirror : altPath;
        if (!src || !fs.existsSync(src))
            return { status: 'expired' };
        try {
            const stateContent = fs.readFileSync(src, 'utf8');
            JSON.parse(stateContent); // validate JSON
        }
        catch (e) {
            console.warn('[BandSession] 미러 JSON 파싱 실패 (손상됨), 삭제 처리:', e.message);
            try {
                fs.unlinkSync(src);
            }
            catch { }
            return { status: 'expired' };
        }
        browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: ['--disable-blink-features=AutomationControlled', '--test-type', '--no-first-run', '--hide-crash-restore-window']
        });
        const context = await browser.newContext({ storageState: src });
        return await checkInContext(context);
    }
    catch (e) {
        console.error('[BandSession] 임시(headless) 세션 확인 실패:', e.message);
        return { status: 'unknown' };
    }
    finally {
        if (browser) {
            try {
                await browser.close();
            }
            catch { }
        }
    }
}
/**
 * [L2-프로필] 공유 컨텍스트(창)가 꺼져 있을 때: 영속 프로필을 headless로 직접 띄워
 * 디스크에 저장된 "최신" 쿠키로 세션을 확인한다.
 * (기존 미러 스냅샷 방식과 달리 롤링 쿠키가 밀려 있어도 만료 오판이 없음 → 창을 닫아도 세션 유지)
 */
export async function checkBandSessionProfile() {
    if (sharedContext || launchingPromise)
        return { status: 'unknown' };
    let context = null;
    try {
        const profileDir = getProfileDir();
        if (!fs.existsSync(profileDir) || fs.readdirSync(profileDir).length === 0) {
            return { status: 'expired' };
        }
        profileCheckLock = true;
        try {
            const lockFiles = ['SingletonLock', 'SingletonCookie', 'lockfile'];
            for (const lf of lockFiles) {
                const lfPath = path.join(profileDir, lf);
                if (fs.existsSync(lfPath))
                    fs.unlinkSync(lfPath);
            }
        }
        catch { }
        try {
            context = await chromium.launchPersistentContext(profileDir, {
                headless: true,
                channel: 'chrome',
                args: ['--disable-blink-features=AutomationControlled',
                    '--test-type', '--no-first-run', '--hide-crash-restore-window'],
            });
        }
        catch {
            context = await chromium.launchPersistentContext(profileDir, {
                headless: true,
                args: ['--disable-blink-features=AutomationControlled',
                    '--test-type', '--no-first-run', '--hide-crash-restore-window'],
            });
        }
        return await checkInContext(context);
    }
    catch (e) {
        console.error('[BandSession] 프로필 headless 세션 확인 실패:', e.message);
        return { status: 'unknown' };
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { }
        }
        profileCheckLock = false;
    }
}
/**
 * [L2 확정 판별]
 * - 공유 컨텍스트(창)가 살아 있으면: 최신 상태를 미러에 저장 후 headless 임시 브라우저로 확인
 * - 꺼져 있으면: 영속 프로필을 headless로 직접 확인 (미러 지연/만료 오판 원천 차단)
 * - 어떤 경우에도 눈에 보이는 새 창/탭을 띄우지 않음
 */
export async function checkBandSessionViaPage() {
    try {
        const running = getRunningSharedContext();
        if (running) {
            // 사용자가 로그인 중일 수 있으므로 최신 상태를 파일에 기록
            await saveStorageMirror();
        }
        if (launchingPromise) {
            // 로그인 창이 뜨는 중 → 판정 보류
            return { status: 'unknown' };
        }
        if (running) {
            // 창이 살아있으면 프로필이 잠겨 있으므로 미러 스냅샷으로 확인
            return await checkBandSessionTemp();
        }
        // 창이 꺼져 있으면 프로필의 최신 쿠키로 직접 확인
        return await checkBandSessionProfile();
    }
    catch (e) {
        console.error('[BandSession] 세션 확인 중 오류:', e.message);
        return { status: 'unknown' };
    }
}
/** 앱 종료 시 공유 컨텍스트 정리 */
export async function closeSharedContext() {
    if (sharedContext) {
        try {
            await sharedContext.close();
        }
        catch { }
        sharedContext = null;
        launchingPromise = null;
    }
    // 브라우저 종료 후 프로필 폴더에 남는 비정상 종료 마커 파일 정리
    // → 이후 headless 세션 체크 시 "페이지를 복원하시겠습니까?" 창이 뜨는 것을 방지
    try {
        const profileDir = getProfileDir();
        // Chromium의 "Preferences" 파일에서 exit_type을 "Normal"로 강제 설정
        const prefsPath = path.join(profileDir, 'Default', 'Preferences');
        if (fs.existsSync(prefsPath)) {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            if (prefs.profile) {
                prefs.profile.exit_type = 'Normal';
                prefs.profile.exited_cleanly = true;
                fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf-8');
            }
        }
        // 잠금 파일도 정리 (다음 실행 시 프로필 충돌 방지)
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'lockfile'];
        for (const lf of lockFiles) {
            const lfPath = path.join(profileDir, lf);
            if (fs.existsSync(lfPath)) {
                try {
                    fs.unlinkSync(lfPath);
                }
                catch { }
            }
        }
    }
    catch (e) {
        console.warn('[BandSession] 프로필 정리 중 경미한 오류 (무시 가능):', e.message);
    }
}
