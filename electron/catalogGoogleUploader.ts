// @ts-nocheck
/**
 * [catalogGoogleUploader.ts]
 * 822-link의 googleUploader.ts를 기반으로 한 구글 Drive + Sheets API 모듈
 *
 * - 822-link와 동일한 OAuth2 인증 (client_secret.json + token.json 공유)
 * - 스프레드시트 컬럼 양식 822-link와 100% 동일 (A~AK열)
 * - 누끼/합성 컬럼은 빈 값으로 기입
 */
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { URL } from 'url';
import { google } from 'googleapis';
const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
];
// OAuth2 클라이언트 캐싱
let cachedOAuth2Client = null;
/**
 * client_secret.json 경로를 찾는 함수
 * 822-link와 동일한 경로를 공유합니다.
 */
function getCredentialsPath() {
    const possiblePaths = [
        'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\client_secret.json',
        path.join(app.getAppPath(), 'client_secret.json'),
        path.join(app.getPath('userData'), 'client_secret.json')
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p))
            return p;
    }
    return '';
}
/** token.json 경로 - 822-link와 동일 경로 공유 */
function getTokenPath() {
    return 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\token.json';
}
/**
 * OAuth2 인증 처리
 * 이미 인증된 token.json이 있으면 재사용, 없으면 브라우저 로그인 창 표시
 */
export async function getAuthClient(onProgress) {
    const log = onProgress || ((msg) => console.log(msg));
    if (cachedOAuth2Client) {
        return cachedOAuth2Client;
    }
    const credentialsPath = getCredentialsPath();
    if (!credentialsPath) {
        throw new Error('client_secret.json 파일을 찾을 수 없습니다.');
    }
    const content = fs.readFileSync(credentialsPath, 'utf8');
    const credentials = JSON.parse(content);
    const { client_secret, client_id } = credentials.installed || credentials.web;
    const redirectUri = 'http://localhost';
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
    const tokenPath = getTokenPath();
    // 기존 토큰이 있으면 재사용 시도
    if (fs.existsSync(tokenPath)) {
        try {
            const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            oAuth2Client.setCredentials(token);
            const tokenInfo = await oAuth2Client.getAccessToken();
            if (tokenInfo.token) {
                cachedOAuth2Client = oAuth2Client;
                return oAuth2Client;
            }
        }
        catch (err) {
            console.warn('[CatalogGoogle] 저장된 토큰 만료. 재인증 진행.');
        }
    }
    // 토큰이 없으면 브라우저 로그인 창 표시
    return new Promise((resolve, reject) => {
        onProgress?.('[인증] 구글 로그인이 필요합니다.');
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });
        const authWindow = new BrowserWindow({
            width: 600, height: 800,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
            title: 'Google 계정으로 로그인',
            autoHideMenuBar: true
        });
        authWindow.loadURL(authUrl);
        authWindow.show();
        const handleNavigation = async (urlStr) => {
            try {
                const parsedUrl = new URL(urlStr);
                if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
                    const code = parsedUrl.searchParams.get('code');
                    const error = parsedUrl.searchParams.get('error');
                    if (error) {
                        authWindow.close();
                        return reject(new Error('구글 로그인 취소: ' + error));
                    }
                    if (code) {
                        onProgress?.('⚠️ 기존 토큰 만료됨. OAuth 브라우저 로그인 대기 중...');
                        oAuth2Client.getToken(code)
                            .then(res => {
                            oAuth2Client.setCredentials(res.tokens);
                            fs.writeFileSync(tokenPath, JSON.stringify(res.tokens));
                            onProgress?.('✅ 브라우저 로그인 완료! (로컬 서버 종료)');
                            authWindow.close();
                            cachedOAuth2Client = oAuth2Client;
                            return resolve(oAuth2Client);
                        })
                            .catch(err => { authWindow.close(); reject(err); });
                    }
                }
            }
            catch { /* 일반적인 구글 내부 이동 무시 */ }
        };
        authWindow.webContents.on('will-redirect', (_event, url) => handleNavigation(url));
        authWindow.webContents.on('did-navigate', (_event, url) => handleNavigation(url));
        authWindow.on('closed', () => reject(new Error('로그인 창이 닫혀서 인증이 취소되었습니다.')));
    });
}
// URL 파서 유틸리티
function parseDriveFolderId(url) {
    if (!url)
        return '';
    const match = url.match(/[?&]id=([a-zA-Z0-9-_]+)/) || url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    return match?.[1] || url.trim();
}
function parseSpreadsheetId(url) {
    if (!url)
        return '';
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] || url.trim();
}
/**
 * 하나의 스프레드시트에서 용도에 맞는 시트탭(이름)을 찾습니다.
 * - band:  탭 이름에 '밴드'가 있으면 그 탭, 없으면 첫 번째 탭
 * - market: 탭 이름에 '오픈마켓'이 있으면 그 탭, 없으면 두 번째 탭
 */
export async function resolveSheetTitle(sheets, spreadsheetId, prefer = 'band') {
    const info = await sheets.spreadsheets.get({ spreadsheetId });
    const titles = (info.data.sheets || [])
        .map((s) => s.properties?.title)
        .filter(Boolean);
    if (titles.length === 0)
        return 'Sheet1';
    if (prefer === 'market') {
        const found = titles.find(t => t.includes('오픈마켓') || t.includes('오픈 마켓') || t.toLowerCase().includes('openmarket') || t.toLowerCase().includes('market'));
        if (found)
            return found;
        return titles[1] || titles[0];
    }
    const found = titles.find(t => t.includes('밴드') || t.toLowerCase().includes('band'));
    if (found)
        return found;
    return titles[0];
}
// 안전한 문자열 변환 헬퍼
const safeString = (val) => {
    if (val === null || val === undefined)
        return '';
    if (typeof val === 'object') {
        const possibleStr = val.string_value || val.value || val.Name || '';
        if (possibleStr && typeof possibleStr === 'string')
            return possibleStr;
        return JSON.stringify(val);
    }
    return String(val);
};
/**
 * 스프레드시트 A열에서 다음 제품 코드를 채번
 */
export async function getNextProdCode(spreadsheetUrl, onProgress, prefer = 'band') {
    try {
        const authClient = await getAuthClient(onProgress);
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 스프레드시트 주소입니다.');
        let sheetName = 'Sheet1';
        try {
            sheetName = await resolveSheetTitle(sheets, spreadsheetId, prefer);
        }
        catch { /* 기본값 사용 */ }
        let nextProdCode = '1';
        const aColData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A:A`
        });
        const rows = aColData.data.values;
        if (rows && rows.length > 1) {
            let maxNum = 0;
            for (let i = 1; i < rows.length; i++) {
                const num = parseInt(rows[i][0], 10);
                if (!isNaN(num) && num > maxNum)
                    maxNum = num;
            }
            nextProdCode = (maxNum + 1).toString();
        }
        return nextProdCode;
    }
    catch (err) {
        console.error('[CatalogGoogle] 코드 채번 실패:', err);
        return Date.now().toString().slice(-4);
    }
}
/**
 * 구글 드라이브에 이미지 업로드 + 스프레드시트에 상품 데이터 행 추가
 * 822-link와 동일한 컬럼 양식 (A~AK)
 */
export async function uploadProductToGoogle(payload, onProgress) {
    try {
        const auth = await getAuthClient(onProgress);
        const drive = google.drive({ version: 'v3', auth: auth });
        const sheets = google.sheets({ version: 'v4', auth: auth });
        const spreadsheetId = parseSpreadsheetId(payload.googleSpreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 스프레드시트 주소입니다.');
        onProgress(`[구글연동] 인증 완료.`);
        // 1. 시트 이름 및 코드 채번 (밴드탭/오픈마켓탭 구분)
        let sheetName = 'Sheet1';
        let targetSheetId = 0;
        try {
            sheetName = await resolveSheetTitle(sheets, spreadsheetId, payload.sheetTab || 'band');
            const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
            const matched = sheetInfo.data.sheets?.find((s) => s.properties?.title === sheetName);
            if (matched?.properties) {
                targetSheetId = matched.properties.sheetId || 0;
            }
        }
        catch { /* 기본값 사용 */ }
        let nextProdCode = payload.predefinedProdCode || '1';
        if (!payload.predefinedProdCode) {
            try {
                const aColData = await sheets.spreadsheets.values.get({
                    spreadsheetId, range: `'${sheetName}'!A:A`
                });
                const rows = aColData.data.values;
                if (rows && rows.length > 1) {
                    let maxNum = 0;
                    for (let i = 1; i < rows.length; i++) {
                        const num = parseInt(rows[i][0], 10);
                        if (!isNaN(num) && num > maxNum)
                            maxNum = num;
                    }
                    nextProdCode = (maxNum + 1).toString();
                }
            }
            catch { /* 기본값 사용 */ }
        }
        onProgress(`[구글연동] 제품 코드 채번: ${nextProdCode}`);
        // 구글 드라이브 대신 LOCAL 텍스트 기입
        const combinedOriginLinks = 'LOCAL';
        // 4. SKU 프리픽스 생성 (822-link와 동일 로직)
        const generateSkuPrefix = (genderText, categoryText) => {
            let gCode = (genderText.includes('여성') || genderText.includes('Women')) ? 'W' : 'M';
            if (categoryText.includes('원피스'))
                gCode = 'W';
            let subCat = categoryText.includes(' > ') ? categoryText.split(' > ').pop()?.trim() || categoryText : categoryText.trim();
            subCat = subCat.replace(/\s+\/\s+/g, '/').replace(/\s+/g, ' ').trim();
            const prefixMap = {
                "반팔티": "TS", "긴팔티": "TL", "맨투맨/스웨트셔츠": "TM", "후드티": "TH", "셔츠/남방": "TC", "니트/스웨터": "TK", "슬리브리스(나시)": "TN",
                "바람막이/윈드브레이커": "OW", "바람막이": "OW", "져지": "OJ", "자켓": "OJ", "가디건": "OC", "코트": "OT", "패딩/푸퍼": "OP", "점퍼/블루종": "OB", "조끼/베스트": "OV", "플리스/뽀글이": "OF",
                "데님/청바지": "BD", "면바지/치노팬츠": "BC", "슬랙스": "BS", "트레이닝팬츠/스웨트팬츠": "BT", "반바지/쇼츠": "BH", "스커트/치마 (여성)": "BK",
                "미니 원피스": "DM", "미디/롱 원피스": "DL", "투피스 세트": "DT",
                "스니커즈/운동화": "SS", "구두/로퍼": "SL", "부츠/워커": "SB", "샌들/슬리퍼": "SD",
                "백팩": "GB", "크로스백": "GC", "숄더백": "GS", "토트백": "GT", "에코백": "GE", "클러치/파우치": "GP",
                "캡": "AH", "비니": "AH", "버킷햇": "AH", "모자": "AH", "목걸이/팔찌/반지": "AJ", "안경/선글라스": "AG", "지갑/벨트": "AW", "넥타이": "AT", "머플러/스카프": "AM"
            };
            return `${gCode}${prefixMap[subCat] || "XX"}-`;
        };
        const skuPrefix = generateSkuPrefix(payload.aiGender || "", payload.aiCategory || "");
        const dateStr = `'${new Date().getMonth() + 1}. ${new Date().getDate()}`;
        // 홈페이지서버이미지 (AC열) 생성
        const numericCode = nextProdCode.replace(/[^0-9]/g, '');
        const staticImagesArr = payload.localFilePaths
            .filter(p => p)
            .map((p, index) => {
            const fileExt = path.extname(p) || '.jpg';
            return `"/static/images/${numericCode}/${index + 1}${fileExt}"`;
        });
        const staticImagesStr = `[${staticImagesArr.join(', ')}]`;
        // 5. 822-link와 동일한 컬럼 양식으로 스프레드시트 행 추가 (A~AK)
        const rowValues = [
            safeString(nextProdCode), // A: 제품코드
            safeString(skuPrefix), // B: 관리코드
            dateStr, // C: 등록일
            "", // D: 구분
            "", // E: 위치 (초기값 비움, 나중에 '밴드등록' 처리)
            "onsale", // F: 상태
            safeString(payload.aiGender || "남성"), // G: 성별 (모호시 남성)
            safeString(payload.aiOriginalPrice || ""), // H: 출고가
            safeString(payload.defaultStartingBid || ""), // I: 시작가격 (오픈마켓일 땐 빈값)
            safeString(payload.price || ""), // J: 실제판매가격
            safeString(payload.aiBrand), // K: 브랜드
            safeString(payload.authenticity || ""), // L: 정가품 (성별은 G열로 이동)
            safeString(payload.aiCategory), // M: 카테고리
            safeString(payload.aiTitle), // N: 제품명
            safeString(payload.aiSize), // O: 사이즈
            safeString(payload.aiRealSize || ""), // P: 실측사이즈
            safeString(payload.aiCondition || "사용감 적음"), // Q: 상품상태
            safeString(payload.aiDefect || ""), // R: 제품결함
            safeString(payload.aiDescription), // S: 제품설명
            safeString(payload.aiMarketDescription || payload.aiSns || ""), // T: 마켓용 제품설명 (번개장터/후르츠)
            safeString(combinedOriginLinks), // U: 이미지
            "", // V: 전면누끼 (미사용)
            "", // W: 전체합성 (미사용)
            safeString(payload.aiHashtags), // X: 해시태그
            safeString(payload.aiStyle), // Y: style
            "", // Z: 예상도착일
            "", // AA: 아카이브
            safeString(payload.aiSeason), // AB: season
            staticImagesStr, // AC: 홈페이지서버이미지
            "", // AD: 번개장터
            "", // AE: 당근마켓
            "", // AF: 후르츠
            "", // AG: 중고나라
            safeString(payload.aiNameEN || ""), // AH: 영문제품명
            safeString(payload.aiNameTH || ""), // AI: 태국어제품명
            safeString(payload.aiDescEN || ""), // AJ: 영문제품설명
            safeString(payload.aiDescTH || "") // AK: 태국어제품설명
        ];
        onProgress(`[스프레드시트] 데이터 행 추가 중...`);
        const appendRes = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${sheetName}'!A:AK`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [rowValues] }
        });
        // 셀 줄바꿈(WRAP) 해제 및 추가된 행 높이 고정(21px)
        try {
            const requests = [{
                    repeatCell: {
                        range: { sheetId: targetSheetId },
                        cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
                        fields: 'userEnteredFormat.wrapStrategy'
                    }
                }];
            const updatedRange = appendRes.data.updates?.updatedRange;
            if (updatedRange) {
                // e.g. "'Sheet1'!A6:AK6"
                const rowMatch = updatedRange.match(/[a-zA-Z]+(\d+)/);
                if (rowMatch) {
                    const rowIndex = parseInt(rowMatch[1], 10) - 1; // 0-indexed
                    requests.push({
                        updateDimensionProperties: {
                            range: {
                                sheetId: targetSheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndex,
                                endIndex: rowIndex + 1
                            },
                            properties: {
                                pixelSize: 21
                            },
                            fields: 'pixelSize'
                        }
                    });
                }
            }
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });
        }
        catch (e) {
            console.error('[CatalogGoogle] 셀 스타일 설정 실패:', e);
        }
        onProgress(`✅ 스프레드시트 기입 완료! (제품코드: ${nextProdCode})`);
        return { success: true, prodCode: nextProdCode };
    }
    catch (err) {
        console.error('[CatalogGoogle Error]', err);
        return { success: false, error: err.message || String(err) };
    }
}
/**
 * 대시보드에서 단일 낙찰 결과를 즉시 시트에 반영 (단건)
 */
export async function updateSingleAuctionResult(spreadsheetUrl, postUrl, winnerName, winningBid) {
    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 스프레드시트 주소입니다.');
        // 시트 메타데이터에서 밴드탭 식별
        const sheetName = await resolveSheetTitle(sheets, spreadsheetId, 'band');
        // E열(위치)을 읽어서 일치하는 postUrl 찾기
        const eColData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!E:E`
        });
        const rows = eColData.data.values;
        if (!rows)
            return { success: false, error: '시트 데이터를 읽을 수 없습니다.' };
        let rowIndex = -1;
        // 역순으로 탐색하여 가장 최근에 등록된 행을 찾음 (중복 등록 방어)
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i] && rows[i][0] && rows[i][0].includes(postUrl)) {
                rowIndex = i + 1; // 스프레드시트는 1부터 시작
                break;
            }
        }
        if (rowIndex === -1) {
            return { success: false, error: `게시물 URL(${postUrl})을 시트에서 찾을 수 없습니다.` };
        }
        // D열(낙찰자), F열(상태), J열(실제판매가격)
        const isCancel = winnerName === '유찰(입찰자 없음)' || !winnerName;
        const finalWinner = isCancel ? '' : winnerName;
        const finalBid = isCancel ? '' : winningBid;
        const finalStatus = isCancel ? 'onsale' : 'sold';
        const data = [
            {
                range: `'${sheetName}'!D${rowIndex}`,
                values: [[finalWinner]]
            },
            {
                range: `'${sheetName}'!F${rowIndex}`,
                values: [[finalStatus]]
            },
            {
                range: `'${sheetName}'!J${rowIndex}`,
                values: [[finalBid]]
            }
        ];
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: data
            }
        });
        return { success: true, updatedRow: rowIndex };
    }
    catch (err) {
        console.error('[GoogleSheet Update Error]', err);
        return { success: false, error: err.message || String(err) };
    }
}
/**
 * 한 번에 여러 건의 낙찰 결과를 시트에 반영 (배치)
 */
export async function updateAuctionResultsBatch(spreadsheetUrl, results) {
    try {
        if (results.length === 0)
            return { success: true };
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 스프레드시트 주소입니다.');
        const sheetName = await resolveSheetTitle(sheets, spreadsheetId, 'band');
        const eColData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!E:E`
        });
        const rows = eColData.data.values;
        if (!rows)
            return { success: false, error: '시트 데이터를 읽을 수 없습니다.' };
        const data = [];
        for (const res of results) {
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] && rows[i][0] && rows[i][0].includes(res.postUrl)) {
                    rowIndex = i + 1;
                    break;
                }
            }
            if (rowIndex !== -1) {
                const isCancel = res.winnerName === '유찰(입찰자 없음)' || !res.winnerName;
                const finalWinner = isCancel ? '' : res.winnerName;
                const finalBid = isCancel ? '' : res.winningBid;
                const finalStatus = isCancel ? 'onsale' : 'sold';
                data.push({ range: `'${sheetName}'!D${rowIndex}`, values: [[finalWinner]] }, { range: `'${sheetName}'!F${rowIndex}`, values: [[finalStatus]] }, { range: `'${sheetName}'!J${rowIndex}`, values: [[finalBid]] });
            }
        }
        if (data.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: data
                }
            });
        }
        return { success: true };
    }
    catch (err) {
        console.error('[GoogleSheet Batch Update Error]', err);
        return { success: false, error: err.message || String(err) };
    }
}
