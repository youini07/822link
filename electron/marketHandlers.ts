// @ts-nocheck
/**
 * [marketHandlers.ts]
 * 822-link의 bunjangHandlers.ts / fruitsHandlers.ts를 Band Admin용으로 이식한 모듈
 *
 * - 번개장터: CDP(9222) attach 웹 자동화
 * - 후르츠패밀리: LDPlayer + uiautomator2 파이썬 자동화
 * - 이미지: catalog_config.json의 localImagePath/{제품코드}/ 폴더에서 수집
 */
import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { uploadToBunjang, cancelActiveBunjangUpload, connectBunjangBrowser, checkBunjangSession, bumpBunjangProduct } from './marketBunjangUploader.js';
import { runFruitsUploader, cancelActiveFruitsProcess, runFruitsBumper } from './fruitsRunner.js';
import { getMarketProductData, updateMarketSpreadsheetPID } from './marketGoogleSheets.js';
import { uploadToJoongna, cancelActiveJoongnaUpload, checkJoongnaSession, bumpJoongnaProduct } from './marketJoongnaUploader.js';
let isBunjangCancelled = false;
let isFruitsCancelled = false;
let isJooagnaCancelled = false;
/** catalog_config.json에서 로컬 이미지 루트 경로 읽기 */
function getLocalImagePath() {
    try {
        const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            return config.localImagePath || '';
        }
    }
    catch (e) {
        console.error('[marketHandlers] 설정 읽기 실패:', e);
    }
    return '';
}
/**
 * 제품코드 폴더에서 업로드용 이미지 경로 수집
 * - 번개장터: 최대 12장, 후르츠: 최대 7장
 */
function collectImagePaths(localImagePath, prodCode, maxCount) {
    const outputDir = path.join(localImagePath, 'openmarket', prodCode);
    if (!localImagePath || !fs.existsSync(outputDir)) {
        throw new Error(`이미지 폴더를 찾을 수 없습니다: ${outputDir}`);
    }
    const allFiles = fs.readdirSync(outputDir);
    // 1.jpg, 2.jpg ... 숫자순 정렬
    allFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const imagePaths = [];
    for (const f of allFiles) {
        if (imagePaths.length >= maxCount)
            break;
        const lowerF = f.toLowerCase();
        if (!lowerF.endsWith('.jpg') && !lowerF.endsWith('.jpeg') && !lowerF.endsWith('.png') && !lowerF.endsWith('.webp'))
            continue;
        if (lowerF.startsWith('thumb'))
            continue; // 썸네일 제외
        imagePaths.push(path.join(outputDir, f));
    }
    if (imagePaths.length === 0) {
        throw new Error('업로드할 이미지 파일을 찾을 수 없습니다.');
    }
    return imagePaths;
}
/** 판매가격(J열)을 숫자로 변환. 비어 있으면 에러 */
function parseSalePrice(rawPrice, prodCode) {
    const priceStr = String(rawPrice).replace(/[^0-9]/g, '');
    const price = parseInt(priceStr, 10) || 0;
    if (price <= 0) {
        throw new Error(`판매가격(J열)이 입력되지 않았습니다. 시트에 판매가격을 입력한 뒤 다시 시도하세요. (제품코드: ${prodCode})`);
    }
    return price;
}
export function registerMarketHandlers() {
    // UI 로그 전송 헬퍼
    const sendMarketLog = (event, msg) => {
        event.sender.send('market:log', msg);
    };
    // === 공통: 작업 강제 중단 ===
    ipcMain.handle('market:cancelAll', async () => {
        console.log('[Market] 작업 강제 중단 요청 수신');
        isBunjangCancelled = true;
        isFruitsCancelled = true;
        isJooagnaCancelled = true;
        cancelActiveBunjangUpload();
        cancelActiveFruitsProcess();
        cancelActiveJoongnaUpload();
        return true;
    });
    // 번개장터 로그인 세션 확인용
    ipcMain.handle('bunjang:checkSession', async () => {
        try {
            await checkBunjangSession();
            return { success: true };
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    });
    // === 번개장터 다중 업로드 ===
    ipcMain.handle('bunjang:uploadMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        let successCount = 0;
        let failCount = 0;
        isBunjangCancelled = false;
        for (const prodCode of prodCodes) {
            if (isBunjangCancelled) {
                console.log('[Bunjang Upload] 작업 중단됨. 남은 대기열 취소.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'uploading' });
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data) {
                    throw new Error(sheetRes.error || '시트 데이터 읽기 실패');
                }
                const data = sheetRes.data;
                // 마켓용 설명(T열) 우선, 없으면 밴드용(S열) 폴백
                const description = data.marketDescription || data.bandDescription || '';
                const pid = await uploadToBunjang({
                    imagePaths: collectImagePaths(getLocalImagePath(), prodCode, 12),
                    title: `${data.title || ''} (No-${prodCode})`,
                    categories: (data.category || '').split('>').map((c) => c.trim()).filter(Boolean),
                    price: parseSalePrice(data.price, prodCode),
                    description,
                    condition: data.condition || '사용감 적음',
                    isExchangeable: false,
                    size: data.size || '',
                    hashtags: data.hashtags
                });
                if (pid) {
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AD', pid);
                }
                event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'success' });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            catch (err) {
                console.error(`[Bunjang Upload] ${prodCode} 실패:`, err);
                event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 번개장터 다중 삭제 ===
    ipcMain.handle('bunjang:deleteMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        let successCount = 0;
        let failCount = 0;
        let browser = null;
        try {
            // 디버깅 크롬이 없으면 자동으로 띄운 뒤 연결
            browser = await connectBunjangBrowser();
        }
        catch (err) {
            console.error('[Bunjang Delete] 공용 브라우저 연결 실패:', err);
        }
        isBunjangCancelled = false;
        for (const prodCode of prodCodes) {
            if (isBunjangCancelled) {
                console.log('[Bunjang Delete] 작업 중단됨.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'deleting' });
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data)
                    throw new Error(sheetRes.error || '데이터 읽기 실패');
                const bunjangPid = sheetRes.data.bunjangPid;
                if (!bunjangPid || bunjangPid.trim() === '')
                    throw new Error('번개장터 PID가 존재하지 않습니다.');
                if (bunjangPid.startsWith('d')) {
                    event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'delete_success' });
                    successCount++;
                    continue;
                }
                const { deleteFromBunjang } = await import('./marketBunjangUploader.js');
                const deletedPid = await deleteFromBunjang(bunjangPid, browser);
                if (deletedPid) {
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AD', 'd' + deletedPid);
                }
                event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'delete_success' });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            catch (err) {
                console.error(`[Bunjang Delete] ${prodCode} 실패:`, err);
                event.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'delete_failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 후르츠패밀리 다중 업로드 (LDPlayer) ===
    ipcMain.handle('fruits:uploadMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        isFruitsCancelled = false;
        let successCount = 0;
        let failCount = 0;
        for (const prodCode of prodCodes) {
            if (isFruitsCancelled) {
                console.log('[Fruits Upload] 작업 중단됨. 남은 대기열 취소.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'uploading' });
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data) {
                    throw new Error(sheetRes.error || '데이터 읽기 실패');
                }
                const data = sheetRes.data;
                const description = data.marketDescription || data.bandDescription || '';
                const imagePaths = collectImagePaths(getLocalImagePath(), prodCode, 7); // Fruits는 main 포함 7장 제한
                sendMarketLog(event, `🖼️ [후르츠] ${prodCode} 이미지 ${imagePaths.length}장 수집 완료 (PC 로컬)`);
                const productData = {
                    prodCode,
                    title: `${data.title || ''} (No-${prodCode})`,
                    price: parseSalePrice(data.price, prodCode),
                    description,
                    category: data.category || '',
                    gender: data.gender || '남성',
                    size: data.size || '',
                    condition: data.condition || '',
                    imagePaths
                };
                const res = await runFruitsUploader(productData);
                if (res.success && res.pid) {
                    // 성공 시 AF열에 PID 기록
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AF', res.pid);
                    event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'success' });
                    successCount++;
                }
                else {
                    throw new Error(res.error || '알 수 없는 파이썬 에러');
                }
            }
            catch (err) {
                console.error(`[Fruits Upload] ${prodCode} 실패:`, err);
                event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 후르츠패밀리 다중 삭제 ===
    ipcMain.handle('fruits:deleteMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        console.log(`[Fruits Delete] 요청 수신: ${prodCodes.length}개 상품`);
        isFruitsCancelled = false;
        let successCount = 0;
        let failCount = 0;
        for (const prodCode of prodCodes) {
            if (isFruitsCancelled) {
                console.log('[Fruits Delete] 작업 중단됨.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'deleting' });
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data)
                    throw new Error(sheetRes.error || '데이터 읽기 실패');
                const fruitsPid = sheetRes.data.fruitsPid;
                if (!fruitsPid || fruitsPid.trim() === '')
                    throw new Error('후르츠패밀리 PID가 존재하지 않습니다.');
                if (fruitsPid.startsWith('d')) {
                    event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'delete_success' });
                    successCount++;
                    continue;
                }
                const { runFruitsDeleter } = await import('./fruitsRunner.js');
                const deleteRes = await runFruitsDeleter(fruitsPid);
                if (deleteRes.success && deleteRes.pid) {
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AF', 'd_' + deleteRes.pid.replace('f_', ''));
                    event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'delete_success' });
                    successCount++;
                }
                else {
                    throw new Error(deleteRes.error || '알 수 없는 파이썬 에러');
                }
            }
            catch (err) {
                console.error(`[Fruits Delete] ${prodCode} 실패:`, err);
                event.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'delete_failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 중고나라 세션 체크 ===
    ipcMain.handle('joongna:checkSession', async () => {
        try {
            await checkJoongnaSession();
            return { success: true };
        }
        catch (error) {
            return { success: false, message: error.message };
        }
    });
    // === 중고나라 다중 업로드 (Phase 1: 이미지 첨부) ===
    ipcMain.handle('joongna:uploadMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        let successCount = 0;
        let failCount = 0;
        isJooagnaCancelled = false;
        // 중고나라는 Phase 1에서 이미지 첨부 후 사용자가 직접 확인하는 방식이므로
        // 한 번에 하나씩 순차 처리합니다.
        for (const prodCode of prodCodes) {
            if (isJooagnaCancelled) {
                console.log('[Joongna Upload] 작업 중단됨.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'uploading' });
            sendMarketLog(event, `📦 [중고나라] ${prodCode} 업로드 시작`);
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data) {
                    throw new Error(sheetRes.error || '시트 데이터 읽기 실패');
                }
                const data = sheetRes.data;
                const description = data.marketDescription || data.bandDescription || '';
                const imagePaths = collectImagePaths(getLocalImagePath(), prodCode, 10); // 중고나라 최대 10장
                sendMarketLog(event, `🖼️ [중고나라] ${prodCode} 이미지 ${imagePaths.length}장 수집 완료`);
                const joognaPid = await uploadToJoongna({
                    imagePaths,
                    title: `${data.title || ''} (No-${prodCode})`,
                    price: parseSalePrice(data.price, prodCode),
                    description,
                    condition: data.condition || '',
                });
                // 업로드 성공 시 AG열에 중고나라 상품 ID 저장
                if (joognaPid) {
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AG', joognaPid);
                    sendMarketLog(event, `✅ [중고나라] ${prodCode} 판매등록 완료! (ID: ${joognaPid})`);
                }
                else {
                    sendMarketLog(event, `⚠️ [중고나라] ${prodCode} 등록됐지만 ID 저장 실패 (수동 확인 필요)`);
                }
                event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'success' });
                successCount++;
                // 다음 상품 처리 전 잠시 대기
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            catch (err) {
                console.error(`[Joongna Upload] ${prodCode} 실패:`, err);
                sendMarketLog(event, `❌ [중고나라] ${prodCode} 실패: ${err.message}`);
                event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 중고나라 다중 삭제 ===
    ipcMain.handle('joongna:deleteMulti', async (event, payload) => {
        const { prodCodes, spreadsheetUrl } = payload;
        isJooagnaCancelled = false;
        let successCount = 0;
        let failCount = 0;
        for (const prodCode of prodCodes) {
            if (isJooagnaCancelled) {
                console.log('[Joongna Delete] 작업 중단됨.');
                break;
            }
            event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'deleting' });
            try {
                const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
                if (!sheetRes.success || !sheetRes.data)
                    throw new Error(sheetRes.error || '데이터 읽기 실패');
                const joongnaPid = sheetRes.data.joongnaPid;
                if (!joongnaPid || joongnaPid.trim() === '')
                    throw new Error('중고나라 PID가 존재하지 않습니다.');
                if (joongnaPid.startsWith('d')) {
                    event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'delete_success' });
                    successCount++;
                    continue;
                }
                const { deleteFromJoongna } = await import('./marketJoongnaUploader.js');
                const deletedPid = await deleteFromJoongna(joongnaPid);
                if (deletedPid) {
                    // 삭제 성공 시 AG열에 'd_' 접두어를 붙여 저장
                    await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AG', 'd' + deletedPid);
                    sendMarketLog(event, `🗑️ [중고나라] ${prodCode} 삭제 완료! (ID: ${deletedPid})`);
                    event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'delete_success' });
                    successCount++;
                }
                else {
                    throw new Error('알 수 없는 오류로 삭제 실패');
                }
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            catch (err) {
                console.error(`[Joongna Delete] ${prodCode} 실패:`, err);
                sendMarketLog(event, `❌ [중고나라] ${prodCode} 삭제 실패: ${err.message}`);
                event.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'delete_failed', error: err.message });
                failCount++;
            }
        }
        return { success: true, summary: { success: successCount, failed: failCount } };
    });
    // === 일괄 상단업(UP) ===
    ipcMain.handle('bulk-up-products', async (event, items) => {
        console.log(`[Bulk UP] ${items.length}개의 상단업 작업 시작`);
        // 플랫폼별 남은 횟수가 있는지(제한에 안 걸렸는지) 관리하는 플래그
        const limitStatus = {
            bunjang: false,
            joongna: false,
            fruits: false
        };
        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;
        for (const item of items) {
            const { platform, pid } = item;
            if (!pid)
                continue;
            try {
                if (platform === 'bunjang') {
                    if (limitStatus.bunjang) {
                        skipCount++;
                        continue;
                    }
                    sendMarketLog(event, `🚀 [번개장터] 상단업 시도: ${pid}`);
                    const res = await bumpBunjangProduct(pid);
                    if (res.limitReached) {
                        sendMarketLog(event, `⚠️ [번개장터] 상단업 한도 초과 감지! (이후 번개장터 상품 스킵)`);
                        limitStatus.bunjang = true;
                        skipCount++;
                    }
                    else if (res.success) {
                        successCount++;
                        sendMarketLog(event, `✅ [번개장터] 상단업 성공: ${pid}`);
                    }
                    else {
                        failCount++;
                        console.warn(`[번개장터] 상단업 실패(표시 생략): ${res.error}`);
                    }
                }
                else if (platform === 'joongna') {
                    if (limitStatus.joongna) {
                        skipCount++;
                        continue;
                    }
                    sendMarketLog(event, `🚀 [중고나라] 상단업 시도: ${pid}`);
                    const res = await bumpJoongnaProduct(pid);
                    if (res.limitReached) {
                        sendMarketLog(event, `⚠️ [중고나라] 상단업 한도 초과 감지! (이후 중고나라 상품 스킵)`);
                        limitStatus.joongna = true;
                        skipCount++;
                    }
                    else if (res.success) {
                        successCount++;
                        sendMarketLog(event, `✅ [중고나라] 상단업 성공: ${pid}`);
                    }
                    else {
                        failCount++;
                        console.warn(`[중고나라] 상단업 실패(표시 생략): ${res.error}`);
                    }
                }
                else if (platform === 'fruits') {
                    if (limitStatus.fruits) {
                        skipCount++;
                        continue;
                    }
                    sendMarketLog(event, `🚀 [후르츠패밀리] 상단업 시도: ${pid}`);
                    const res = await runFruitsBumper(pid);
                    if (res.limitReached) {
                        sendMarketLog(event, `⚠️ [후르츠패밀리] 상단업 한도 초과 감지! (이후 후르츠 상품 스킵)`);
                        limitStatus.fruits = true;
                        skipCount++;
                    }
                    else if (res.success) {
                        successCount++;
                        sendMarketLog(event, `✅ [후르츠패밀리] 상단업 성공: ${pid}`);
                    }
                    else {
                        failCount++;
                        console.warn(`[후르츠패밀리] 상단업 실패(표시 생략): ${res.error}`);
                    }
                }
            }
            catch (err) {
                console.error(`[Bulk UP Error] ${platform} ${pid}:`, err);
                failCount++;
            }
            // 플랫폼간 전환 시 약간의 대기
            await new Promise(r => setTimeout(r, 1500));
        }
        const summary = `일괄 상단업 완료! (성공: ${successCount}, 실패: ${failCount}, 한도초과 스킵: ${skipCount})`;
        sendMarketLog(event, `🎉 ${summary}`);
        return { success: true, summary };
    });
}
/**
 * 텔레그램 봇 등 백그라운드에서 특정 상품코드에 대해 모든 마켓 업로드를 트리거합니다.
 */
export async function runBackgroundMarketUpload(prodCode, spreadsheetUrl, webContents) {
    const mockEvent = { sender: webContents };
    // 1. 번개장터 업로드
    try {
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] 🚀 [자동업로드] 번개장터 등록 시작 (코드: ${prodCode})`);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'uploading' });
        const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
        if (sheetRes.success && sheetRes.data) {
            const data = sheetRes.data;
            const description = data.marketDescription || data.bandDescription || '';
            const pid = await uploadToBunjang({
                imagePaths: collectImagePaths(getLocalImagePath(), prodCode, 12),
                title: `${data.title || ''} (No-${prodCode})`,
                categories: (data.category || '').split('>').map((c) => c.trim()).filter(Boolean),
                price: parseSalePrice(data.price, prodCode),
                description,
                condition: data.condition || '사용감 적음',
                isExchangeable: false,
                size: data.size || '',
                hashtags: data.hashtags
            });
            if (pid) {
                await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AD', pid);
                mockEvent.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'success' });
                webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ✅ [자동업로드] 번개장터 완료`);
            }
        }
    }
    catch (err) {
        console.error(`[Auto Bunjang] ${prodCode} 실패:`, err);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'bunjang', status: 'failed', error: err.message });
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [자동업로드] 번개장터 실패: ${err.message}`);
    }
    // 2. 후르츠 업로드
    try {
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] 🚀 [자동업로드] 후르츠 등록 시작 (코드: ${prodCode})`);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'uploading' });
        const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
        if (sheetRes.success && sheetRes.data) {
            const data = sheetRes.data;
            const res = await runFruitsUploader({
                prodCode,
                title: `${data.title || ''} (No-${prodCode})`,
                price: parseSalePrice(data.price, prodCode),
                description: data.marketDescription || data.bandDescription || '',
                category: data.category || '',
                gender: data.gender || '남성',
                size: data.size || '',
                condition: data.condition || '',
                imagePaths: collectImagePaths(getLocalImagePath(), prodCode, 7)
            });
            if (res.success && res.pid) {
                await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AF', res.pid);
                mockEvent.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'success' });
                webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ✅ [자동업로드] 후르츠 완료`);
            }
            else {
                throw new Error(res.error || '후르츠 업로드 실패');
            }
        }
    }
    catch (err) {
        console.error(`[Auto Fruits] ${prodCode} 실패:`, err);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'fruits', status: 'failed', error: err.message });
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [자동업로드] 후르츠 실패: ${err.message}`);
    }
    // 3. 중고나라 업로드
    try {
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] 🚀 [자동업로드] 중고나라 등록 시작 (코드: ${prodCode})`);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'uploading' });
        const sheetRes = await getMarketProductData(spreadsheetUrl, prodCode);
        if (sheetRes.success && sheetRes.data) {
            const data = sheetRes.data;
            const pid = await uploadToJoongna({
                imagePaths: collectImagePaths(getLocalImagePath(), prodCode, 10),
                title: `${data.title || ''} (No-${prodCode})`,
                price: parseSalePrice(data.price, prodCode),
                description: data.marketDescription || data.bandDescription || '',
                condition: data.condition || '사용감 적음'
            });
            if (pid) {
                await updateMarketSpreadsheetPID(spreadsheetUrl, prodCode, 'AG', pid);
                mockEvent.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'success' });
                webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ✅ [자동업로드] 중고나라 완료`);
            }
        }
    }
    catch (err) {
        console.error(`[Auto Joongna] ${prodCode} 실패:`, err);
        mockEvent.sender.send('market:progress', { prodCode, platform: 'joongna', status: 'failed', error: err.message });
        webContents.send('market:log', `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [자동업로드] 중고나라 실패: ${err.message}`);
    }
}
