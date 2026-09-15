// @ts-nocheck
/**
 * [marketGoogleSheets.ts]
 * 822-link의 getSpreadsheetDataByProdCode / updateSpreadsheetPID를
 * Band Admin 시트 컬럼 양식에 맞게 이식한 모듈
 *
 * Band Admin 컬럼: G=성별, I=가격(경매시작가), M=카테고리, N=제품명,
 *                  O=사이즈, Q=상품상태, S=밴드용설명, T=마켓용설명,
 *                  X=해시태그, AD=번개장터 PID, AF=후르츠 PID
 */
import { google } from 'googleapis';
import { getAuthClient, resolveSheetTitle } from './catalogGoogleUploader.js';
function parseSpreadsheetId(url) {
    if (!url)
        return '';
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] || url.trim();
}
/** 오픈마켓탭 우선 조회 (탭 이름에 '오픈마켓'이 있으면 그 탭, 없으면 두 번째 탭) */
async function resolveMarketSheetName(sheets, spreadsheetId) {
    try {
        return await resolveSheetTitle(sheets, spreadsheetId, 'market');
    }
    catch {
        return 'Sheet1';
    }
}
/** 제품코드로 시트 행 데이터 읽기 */
export async function getMarketProductData(spreadsheetUrl, prodCode) {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.');
        const sheetName = await resolveMarketSheetName(sheets, spreadsheetId);
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A:AH`
        });
        const rows = sheetData.data.values;
        if (!rows || rows.length < 2)
            throw new Error('스프레드시트에 데이터가 없습니다.');
        const targetRow = rows.find(row => row[0]?.toString() === prodCode.toString());
        if (!targetRow)
            throw new Error(`제품 코드 [${prodCode}]에 해당하는 데이터를 스프레드시트에서 찾을 수 없습니다.`);
        const at = (idx) => (targetRow[idx] !== undefined && targetRow[idx] !== null ? String(targetRow[idx]) : '');
        return {
            success: true,
            data: {
                prodCode: at(0),
                status: at(5),
                gender: at(6) || '남성', // G열: 성별 (빈값이면 남성)
                price: at(9), // J열: 판매가격 (사장님 직접 입력)
                brand: at(10), // K열
                category: at(12), // M열
                title: at(13), // N열
                size: at(14), // O열
                realSize: at(15), // P열
                condition: at(16), // Q열
                defect: at(17), // R열
                bandDescription: at(18), // S열
                marketDescription: at(19), // T열
                hashtags: at(23), // X열
                bunjangPid: at(29), // AD열
                fruitsPid: at(31), // AF열
                joongnaPid: at(32) // AG열
            }
        };
    }
    catch (err) {
        console.error('[marketGoogleSheets] getMarketProductData Error:', err);
        return { success: false, error: err.message };
    }
}
/** 지정 열에 PID 기록 */
export async function updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, columnLetter, value) {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId)
            throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.');
        const sheetName = await resolveMarketSheetName(sheets, spreadsheetId);
        const aColData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A:A`
        });
        const rows = aColData.data.values;
        if (!rows)
            throw new Error('시트 데이터를 읽을 수 없습니다.');
        let rowIndex = -1;
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i] && rows[i][0]?.toString() === prodCode.toString()) {
                rowIndex = i + 1;
                break;
            }
        }
        if (rowIndex === -1)
            throw new Error(`제품 코드 [${prodCode}]를 시트에서 찾을 수 없습니다.`);
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName}'!${columnLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] }
        });
        return { success: true };
    }
    catch (err) {
        console.error('[marketGoogleSheets] updateMarketSpreadsheetPID Error:', err);
        return { success: false, error: err.message };
    }
}
