// @ts-nocheck
import './logger.js';
import './logger.js';
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminManager } from './admin.js';
import { closeSharedContext } from './bandSession.js';
import { saveSettings as saveCatalogSettings, initTelegramBot, isBotRunning as isCatalogBotRunning, getSettings as getCatalogSettings } from './telegramBot.js';
import { getUploadSettings, saveUploadSettings, fetchSpreadsheetData, startAutoUpload, stopAutoUpload, deleteSpreadsheetRows, getUploadStatus, startQueuePoller, setWebContentsRef, getUploadQueue } from './catalogUploaderBot.js';
import { deleteBandPost, deleteBulkBandPosts, stopBulkBandPosts } from './bandPostDeleter.js';
import { bandChatBot } from './bandChatBot.js';
import { updateSingleAuctionResult } from './catalogGoogleUploader.js';
import { deleteProductEntirely, uploadPurchasedImages, getNextProdCode, uploadProductToGoogle } from './googleUploader.js';
import { registerMarketHandlers } from './marketHandlers.js';
import { registerBatchHandlers } from './batchRunner.js';
import { initFileWatcher } from './fileWatcher.js';
import { analyzeProductWithAI } from './aiAnalyzer.js';
import { runPythonProcessor } from './pythonRunner.js';
import * as fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, '../build/icon.png'),
        autoHideMenuBar: true,
        title: '822LINK',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    // Bind sniper updates to frontend
    adminManager.onTaskUpdate = (task) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('snipe-task-update', task);
        }
    };
    // Bind login session status updates to frontend
    adminManager.onLoginStatus = (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('naver-login-status', status);
        }
    };
    // Start catalog telegram bot automatically on application startup
    if (mainWindow) {
        initTelegramBot(mainWindow.webContents);
        setWebContentsRef(mainWindow.webContents);
        startQueuePoller();
        
        // Start local file watcher
        initFileWatcher(mainWindow);
    }
    // Register marketplace (Bunjang/Fruits) upload handlers
    registerMarketHandlers(mainWindow);
    
    // Register AI analysis handler
    ipcMain.handle('ai:analyze', async (event, payload) => {
        const { imagePaths, apiKey, prompt, target } = payload;
        return await analyzeProductWithAI(imagePaths, apiKey, prompt, target);
    });
    
    // Register Google upload handlers (Local UI)
    ipcMain.handle('google:get-next-prod-code', async (event, spreadsheetUrl) => {
        return await getNextProdCode(spreadsheetUrl);
    });

    ipcMain.handle('google:upload-product', async (event, payload) => {
        return await uploadProductToGoogle(payload, (log) => {
            console.log(log);
            // 프론트엔드의 터미널(batch:output)로도 로그 전송
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('batch:output', log + '\n');
            }
        });
    });
    
    // 파이썬 이미지 프로세싱 핸들러 (로컬 대시보드에서 누끼/합성 진행 시 호출)
    ipcMain.handle('python:process-images', async (event, payload) => {
        const { imagePaths, outputDir, brand, title, prodCode, copyright, skipNukki } = payload;
        // outputDir가 'temp_will_be_handled_in_main'와 같이 가짜로 넘어오면 기본 로컬 이미지 저장소 사용
        let finalOutputDir = outputDir;
        if (outputDir === 'temp_will_be_handled_in_main') {
            const settingsData = fs.readFileSync(path.join(app.getPath('userData'), 'app-settings.json'), 'utf8');
            const settings = JSON.parse(settingsData);
            finalOutputDir = settings.localImageSavePath || 'c:\\Users\\youin\\OneDrive\\바탕 화면\\822링크\\static\\images';
        }
        return await runPythonProcessor(imagePaths, finalOutputDir, brand, title, prodCode, copyright, skipNukki);
    });

    // Register batch handlers for frontend execution
    registerBatchHandlers(mainWindow);
}
app.whenReady().then(async () => {
    protocol.handle('media', (request) => {
        try {
            const urlObj = new URL(request.url);
            const hex = urlObj.searchParams.get('p');
            if (hex) {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                }
                const decodedPath = new TextDecoder().decode(bytes);
                const fileUrl = require('url').pathToFileURL(decodedPath).href;
                return net.fetch(fileUrl);
            }
        } catch (err) {
            console.error('[Protocol] Failed to handle media request:', err);
        }
        return new Response('Not Found', { status: 404 });
    });

    createWindow();
    // Auto Updater 설정
    autoUpdater.autoDownload = false; // 자동 다운로드 방지 (사용자가 UI에서 다운로드 버튼을 누를 때만 진행되도록)
    autoUpdater.on('update-available', () => {
        console.log('Update available.');
    });
    autoUpdater.on('update-downloaded', () => {
        console.log('Update downloaded.');
        // 여기서 네이티브 팝업(dialog)을 띄우지 않고, React UI가 처리하도록 둡니다.
    });
    // Windows time sync removed because internal Naver time sync is now perfect.
    console.log('[TimeSync] Using internal Naver time sync. OS time sync skipped.');
    // Init browser in background
    await adminManager.initBrowser();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
// 공유 브라우저 컨텍스트 정리 (세션 프로필 무결성 보장)
app.on('will-quit', async () => {
    await closeSharedContext();
});
// IPC handlers
const SETTINGS_FILE_PATH = path.join(app.getPath('userData'), 'app-settings.json');
function loadAppSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
    return {};
}
function saveAppSettings(settings: any) {
    try {
        fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}
let currentSettings = loadAppSettings();

ipcMain.handle('settings:get', (event, key) => {
    if (!key) return currentSettings;
    return currentSettings[key];
});

ipcMain.handle('settings:set', (event, { key, value }) => {
    if (key) {
        currentSettings[key] = value;
        saveAppSettings(currentSettings);
        
        // 프론트엔드 대시보드 마운트 시 명시적 워처(watcher) 갱신 요청 처리
        if (key === 'localWatchPath' || key === 'localImageWatchPath') {
            if (mainWindow) {
                initFileWatcher(mainWindow);
            }
        }
    }
    return true;
});

ipcMain.handle('settings:select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('open-naver-login', async (_, url) => {
    await adminManager.openBrowser(url);
    return true;
});
ipcMain.handle('check-for-updates', async () => {
    const result = await autoUpdater.checkForUpdates();
    return {
        updateInfo: result?.updateInfo,
        currentVersion: app.getVersion()
    };
});
ipcMain.handle('download-update', async () => {
    return await autoUpdater.downloadUpdate();
});
ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
});
ipcMain.handle('add-admin-task', (event, task) => {
    adminManager.addTask(task);
    return true;
});
ipcMain.handle('remove-admin-task', (event, taskId) => {
    adminManager.removeAdminTask(taskId);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('snipe-task-removed', taskId);
    }
    return true;
});
ipcMain.handle('update-admin-task', (event, taskId, partial) => {
    adminManager.updateTask(taskId, partial);
    return true;
});
ipcMain.handle('get-time-sync-status', () => adminManager.getTimeSyncStatus());
ipcMain.handle('get-server-time-offset', () => adminManager.getServerTimeOffset());
ipcMain.handle('show-message-box', async (event, msg) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        dialog.showMessageBox(win, { type: 'info', message: msg, title: '822LINK' });
    }
});
ipcMain.handle('check-naver-login', async () => {
    try {
        return await adminManager.checkLoginStatusDetailed();
    }
    catch (e) {
        return { status: 'unknown', checkedAt: Date.now(), error: e.message };
    }
});
// 마지막 확인 결과 즉시 조회 (네트워크 요청 없음)
ipcMain.handle('get-last-naver-login-status', () => {
    return adminManager.getLastLoginStatus();
});
// 전역 유료 권한 저장소
global.premiumFeatures = {
    autoSettlementEnabled: false
};
ipcMain.handle('set-premium-features', (event, features) => {
    if (features) {
        Object.assign(global.premiumFeatures, features);
    }
    return true;
});
ipcMain.handle('get-admin-tasks', () => {
    return adminManager.getTasks();
});
// Band Settings Handlers
ipcMain.handle('get-band-settings', () => {
    return adminManager.getBandSettings();
});
ipcMain.on('save-band-setting', (event, setting) => {
    adminManager.saveBandSetting(setting);
    if (mainWindow) {
        mainWindow.webContents.send('band-settings-updated', adminManager.getBandSettings());
    }
});
ipcMain.on('delete-band-setting', (event, id) => {
    adminManager.deleteBandSetting(id);
    if (mainWindow) {
        mainWindow.webContents.send('band-settings-updated', adminManager.getBandSettings());
    }
});
// Member & Keep Management
ipcMain.handle('get-members', (event, username) => {
    return adminManager.getMembers(username);
});
ipcMain.handle('save-member', (event, username, member) => {
    adminManager.saveMember(username, member);
    return true;
});
ipcMain.handle('delete-member', (event, username, nickname) => {
    adminManager.deleteMember(username, nickname);
    return true;
});
// --- Catalog System IPC ---
ipcMain.handle('get-catalog-settings', () => {
    return getCatalogSettings();
});
ipcMain.handle('save-catalog-settings', (event, settings) => {
    saveCatalogSettings(settings);
    if (mainWindow) {
        initTelegramBot(mainWindow.webContents); // Restart bot with new settings
    }
    return true;
});
ipcMain.handle('get-catalog-bot-status', () => {
    return isCatalogBotRunning();
});
ipcMain.handle('select-image-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            title: '이미지 저장 폴더 선택'
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
    }
    return null;
});
// --- Auto Uploader Bot IPC ---
ipcMain.handle('get-upload-settings', () => {
    return getUploadSettings();
});
ipcMain.handle('open-external', async (event, url) => {
    if (url) {
        await shell.openExternal(url);
    }
});
ipcMain.handle('save-upload-settings', (event, settings) => {
    saveUploadSettings(settings);
    return true;
});
ipcMain.handle('fetch-spreadsheet-data', (event, url, prefer) => {
    return fetchSpreadsheetData(url, prefer || 'band');
});
ipcMain.handle('start-auto-upload', (event, data) => {
    if (mainWindow) {
        return startAutoUpload(data, mainWindow.webContents);
    }
    return { success: false, message: 'No window available' };
});
ipcMain.handle('stop-auto-upload', () => {
    stopAutoUpload();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upload:status', 'stopped');
        mainWindow.webContents.send('upload:scheduled-time', null);
    }
    return true;
});
ipcMain.handle('delete-spreadsheet-rows', (event, settings, rows, targetTab) => {
    return deleteSpreadsheetRows(settings, rows, targetTab);
});
ipcMain.handle('delete-band-post', async (event, postUrl, rowIndex, productCode, settings) => {
    if (mainWindow) {
        try {
            await deleteBandPost(postUrl, rowIndex, productCode, settings, mainWindow.webContents);
            return { success: true };
        }
        catch (err) {
            return { success: false, message: err.message };
        }
    }
    return { success: false, message: 'No main window available' };
});
ipcMain.handle('delete-bulk-band-posts', async (event, requests, settings) => {
    if (mainWindow) {
        try {
            await deleteBulkBandPosts(requests, settings, mainWindow.webContents);
            return { success: true };
        }
        catch (err) {
            return { success: false, message: err.message };
        }
    }
    return { success: false, message: 'No main window available' };
});
ipcMain.handle('stop-bulk-band-posts', () => {
    stopBulkBandPosts();
    return true;
});
ipcMain.handle('get-upload-status', () => {
    return getUploadStatus();
});
ipcMain.handle('get-upload-queue', () => {
    return getUploadQueue();
});
// --- Chat Bot IPC ---
// 단건 정산 채팅 전송 (기존 유지)
ipcMain.handle('send-settlement-chat', async (event, req) => {
    let logCallback = undefined;
    if (mainWindow && !mainWindow.isDestroyed()) {
        logCallback = (msg) => {
            mainWindow?.webContents.send('chat-bot-log', msg);
        };
    }
    return await bandChatBot.sendSettlementChat(req, logCallback);
});
// 일괄 정산 채팅 전송 — 브라우저를 한 번만 열고 여러 고객을 순차 처리
ipcMain.handle('send-bulk-settlement-chat', async (event, requests) => {
    let logCallback = undefined;
    let progressCallback = undefined;
    if (mainWindow && !mainWindow.isDestroyed()) {
        logCallback = (msg) => {
            mainWindow?.webContents.send('chat-bot-log', msg);
        };
        progressCallback = (progress) => {
            mainWindow?.webContents.send('chat-bot-progress', progress);
        };
    }
    return await bandChatBot.sendBulkSettlementChat(requests, logCallback, progressCallback);
});
// 일괄 전송 중지 요청
ipcMain.handle('stop-settlement-chat', () => {
    bandChatBot.stopChat();
    return true;
});
// 현재 일괄 전송 진행 중인지 확인
ipcMain.handle('get-settlement-chat-status', () => {
    return { isSending: bandChatBot.isChatting() };
});
ipcMain.handle('get-test-images', () => {
    try {
        const thumbDir = path.join(app.getPath('userData'), 'settlement_thumbs');
        if (!fs.existsSync(thumbDir))
            return [];
        // 재귀적으로 파일 찾기 헬퍼
        const findImages = (dir, fileList = []) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    findImages(fullPath, fileList);
                }
                else if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
                    fileList.push(fullPath);
                }
            }
            return fileList;
        };
        const allImages = findImages(thumbDir);
        // 무작위로 섞어서 최대 5개 반환
        return allImages.sort(() => 0.5 - Math.random()).slice(0, 5);
    }
    catch (e) {
        console.error('get-test-images error:', e);
        return [];
    }
});
ipcMain.handle('update-google-sheet-winner', async (event, bandSettingId, postUrl, winnerName, winningBid) => {
    try {
        const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
        if (!fs.existsSync(configPath)) {
            return { success: false, error: 'catalog_config.json 파일을 찾을 수 없습니다.' };
        }
        const configStr = fs.readFileSync(configPath, 'utf-8');
        const catalogConfig = JSON.parse(configStr);
        if (!catalogConfig.googleSpreadsheetUrl) {
            return { success: false, error: '구글 시트 URL이 설정되어 있지 않습니다.' };
        }
        return await updateSingleAuctionResult(catalogConfig.googleSpreadsheetUrl, postUrl, winnerName, winningBid);
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('google:delete-product-entirely', async (event, { prodCode, target }) => {
    try {
        const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
        if (!fs.existsSync(configPath)) {
            return { success: false, error: 'catalog_config.json 설정 파일이 없습니다.' };
        }
        const configStr = fs.readFileSync(configPath, 'utf-8');
        const catalogConfig = JSON.parse(configStr);

        // app-settings.json도 읽어서 우선 적용 (telegramBot과 통일)
        const appSettingsPath = path.join(app.getPath('userData'), 'app-settings.json');
        let appConfig = {};
        if (fs.existsSync(appSettingsPath)) {
            try { appConfig = JSON.parse(fs.readFileSync(appSettingsPath, 'utf-8')); } catch(e){}
        }
        
        const mergedConfig = { ...catalogConfig, ...appConfig };

        let sheetUrl = mergedConfig.googleSpreadsheetUrl;
        let driveUrl = mergedConfig.googleDriveUrl;

        // target이 'dreamstudio'인 경우 대체 URL 사용 (설정에 존재한다면)
        if (target === 'dreamstudio') {
            if (mergedConfig.googleSpreadsheetUrl_dreamstudio) sheetUrl = mergedConfig.googleSpreadsheetUrl_dreamstudio;
            if (mergedConfig.googleDriveUrl_dreamstudio) driveUrl = mergedConfig.googleDriveUrl_dreamstudio;
        }

        if (!sheetUrl || !driveUrl) {
            return { success: false, error: '스프레드시트 또는 드라이브 URL이 설정되어 있지 않습니다.' };
        }

        const localPaths = [];
        const mainImageSavePath = mergedConfig.localImageSavePath || mergedConfig.localSavePath;
        if (mainImageSavePath) {
            localPaths.push(mainImageSavePath);
            localPaths.push(path.join(mainImageSavePath, 'Composites'));
        }
        if (mergedConfig.localThumbnailSavePath) {
            localPaths.push(mergedConfig.localThumbnailSavePath);
        }
        
        // 추가적으로 822shop 하드코딩 경로도 탐색 (만약 사용자가 여기에 저장한다면)
        const desktopPath = app.getPath('desktop');
        localPaths.push(path.join(desktopPath, '822shop', 'static', 'images'));
        localPaths.push(path.join(desktopPath, '822shop', 'static', 'images', 'Composites'));
        localPaths.push(path.join(desktopPath, '822shop', 'static', 'thumbnails'));

        return await deleteProductEntirely(prodCode, sheetUrl, driveUrl, localPaths);
    } catch (err) {
        console.error('google:delete-product-entirely error:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('google:upload-purchased-images', async (event, targetDriveUrl) => {
    try {
        const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
        if (!fs.existsSync(configPath)) {
            return { success: false, error: '설정 파일이 없습니다.' };
        }
        const configStr = fs.readFileSync(configPath, 'utf-8');
        const catalogConfig = JSON.parse(configStr);

        const folderPath = catalogConfig.purchasedItemImageFolder;
        if (!folderPath) {
            return { success: false, error: '사입품목 이미지 저장폴더가 설정되지 않았습니다. 설정 페이지에서 지정해주세요.' };
        }

        const onProgress = (msg) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('batch:output', msg + '\n');
            }
        };

        return await uploadPurchasedImages(folderPath, targetDriveUrl, onProgress);
    } catch (err) {
        console.error('google:upload-purchased-images error:', err);
        return { success: false, error: err.message };
    }
});
