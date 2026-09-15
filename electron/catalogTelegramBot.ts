// @ts-nocheck
/**
 * [catalogTelegramBot.ts]
 * bandadmin 전용 텔레그램 봇 - 822-link의 병렬 상태 머신 구조 채택
 *
 * Track A: 사진 6장 수집 (비동기 다운로드)
 * Track B: 실측사이즈, 하자, 상태 정보 입력 (사용자 입력)
 * 두 트랙 모두 완료 시 → AI 분석 → 구글 시트 기입 파이프라인 자동 시동
 */
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { app, nativeImage } from 'electron';
import { analyzeProductWithAI } from './catalogAiAnalyzer.js';
import { uploadProductToGoogle, getNextProdCode } from './catalogGoogleUploader.js';
import { runBackgroundMarketUpload } from './marketHandlers.js';
import { Jimp } from 'jimp';
import { parseKoreanDateStr } from './dateParser.js';
import { addToUploadQueue } from './catalogUploaderBot.js';
import { runPythonProcessor } from './pythonRunner.js';
import os from 'os';
const CONFIG_PATH = path.join(app.getPath('userData'), 'catalog_config.json');
const APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json');
/** 설정 파일 읽기 */
function readSettings() {
    let settings = {};
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            settings = { ...settings, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
        }
    }
    catch (error) {
        console.error('[CatalogTelegram] catalog_config.json 읽기 오류:', error);
    }
    
    try {
        if (fs.existsSync(APP_SETTINGS_PATH)) {
            settings = { ...settings, ...JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf-8')) };
        }
    }
    catch (error) {
        console.error('[CatalogTelegram] app-settings.json 읽는 중 오류:', error);
    }
    return settings;
}
/** 설정 파일 저장 */
export function saveSettings(settings) {
    try {
        const existing = readSettings();
        const merged = { ...existing, ...settings };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    }
    catch (error) {
        console.error('[CatalogBot] 설정 파일 저장 오류:', error);
    }
}
/** 822-link의 config.json에서 Gemini API Key 읽기 */
function getGeminiKeyFrom822Link() {
    try {
        // 822-link Electron 앱의 userData 경로에서 config.json을 읽음
        const possiblePaths = [
            path.join(app.getPath('appData'), '822 Link', 'config.json'),
            path.join(app.getPath('appData'), '822-link', 'config.json'),
        ];
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                const config = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (config.geminiKey)
                    return config.geminiKey;
            }
        }
    }
    catch { /* 실패 시 무시 */ }
    return '';
}
let botInstance = null;
let mainWindowWebContents = null;
let globalAdminManager = null;
let activeSession = null;
// 예약 시간 입력 대기 상태 관리
const queueScheduleSessions = new Map();
const auctionSessionMap = new Map();
// -----------------------------
/** 프론트엔드에 실시간 로그 전송 */
function sendLog(msg) {
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
        mainWindowWebContents.send('catalog:log', msg);
    }
}
/**
 * 텔레그램 봇 초기화
 */
export function initCatalogTelegramBot(webContents, adminManager) {
    mainWindowWebContents = webContents;
    if (adminManager)
        globalAdminManager = adminManager;
    const settings = readSettings();
    const token = settings.telegramToken;
    if (!token) {
        console.log('[CatalogBot] 텔레그램 토큰 미설정. 봇 비활성.');
        return;
    }
    if (botInstance) {
        botInstance.stopPolling();
        botInstance = null;
    }
    try {
        botInstance = new TelegramBot(token, { polling: true });
        console.log('[CatalogBot] 봇 시작됨.');
        sendLog('✅ 텔레그램 봇이 연결되었습니다.');
        // 텔레그램 공식 명령어 메뉴는 영문만 허용되므로 영문 alias를 등록하고,
        // 한글 명령어(/밴드업로드, /오픈마켓업로드)는 메시지로 직접 입력하면 동작합니다.
        const commands = [
            { command: 'openmarket', description: '오픈마켓 상품 등록 (/오픈마켓업로드)' },
            { command: 'start', description: '봇 안내' },
            { command: 'cancel', description: '진행 중인 세션 취소' }
        ];
        if (settings.bandFeaturesEnabled !== false) {
            commands.unshift({ command: 'bandupload', description: '밴드 상품 등록 (/밴드업로드)' }, { command: 'auction', description: '경매 마감 예약' });
        }
        botInstance.setMyCommands(commands).catch(() => { });
        // 모든 메시지 수신 시 무조건 사용자 ID 갱신 및 경매 텍스트 입력 처리
        botInstance.on('message', (msg) => {
            const chatId = msg.chat?.id;
            if (!chatId)
                return;
            saveLastChatId(chatId);
            // 경매 세션 텍스트 입력 처리
            const aucSession = auctionSessionMap.get(chatId);
            if (aucSession && msg.text && !msg.text.startsWith('/')) {
                const text = msg.text.trim();
                if (aucSession.state === 'AWAITING_START_URL') {
                    if (!text.includes('band.us') || !text.includes('/post/')) {
                        botInstance?.sendMessage(chatId, '❌ 올바른 밴드 게시물 주소가 아닙니다. 다시 입력해주세요.');
                        return;
                    }
                    aucSession.startUrl = text;
                    aucSession.state = 'AWAITING_END_URL';
                    botInstance?.sendMessage(chatId, '✅ 시작 주소가 입력되었습니다.\n\n이어서 **마지막 게시물 주소**를 입력해주세요.');
                    return;
                }
                if (aucSession.state === 'AWAITING_END_URL') {
                    if (!text.includes('band.us') || !text.includes('/post/')) {
                        botInstance?.sendMessage(chatId, '❌ 올바른 밴드 게시물 주소가 아닙니다. 다시 입력해주세요.');
                        return;
                    }
                    aucSession.endUrl = text;
                    // 시작 주소와 끝 주소에서 번호 추출하여 유효성 검증
                    const startMatch = aucSession.startUrl.match(/\/post\/(\d+)/);
                    const endMatch = aucSession.endUrl.match(/\/post\/(\d+)/);
                    if (!startMatch || !endMatch) {
                        botInstance?.sendMessage(chatId, '❌ 주소에서 게시물 번호를 찾을 수 없습니다. 다시 처음부터 시도해주세요.');
                        aucSession.state = 'AWAITING_START_URL';
                        botInstance?.sendMessage(chatId, '시작 게시물 주소를 다시 입력해주세요.');
                        return;
                    }
                    const startNum = parseInt(startMatch[1], 10);
                    const endNum = parseInt(endMatch[1], 10);
                    if (startNum > endNum) {
                        botInstance?.sendMessage(chatId, '❌ 마지막 게시물 번호가 시작 번호보다 작습니다. 다시 입력해주세요.');
                        return;
                    }
                    aucSession.state = 'AWAITING_TIME';
                    const defaultTime = globalAdminManager?.getBandSettings().find(s => s.id === aucSession.selectedBandId)?.defaultCloseTime || '21:00:00';
                    botInstance?.sendMessage(chatId, `✅ 범위 설정 완료: ${startNum}번 ~ ${endNum}번\n\n마감 시간을 선택해주세요.`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `기본 설정 시간 (${defaultTime})`, callback_data: `auc_time_default` }],
                                [{ text: '직접 입력하기', callback_data: `auc_time_custom` }]
                            ]
                        }
                    });
                    return;
                }
                if (aucSession.state === 'AWAITING_CUSTOM_TIME') {
                    // HH:mm 또는 HH:mm:ss 형식 허용
                    const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
                    if (!match) {
                        botInstance?.sendMessage(chatId, '❌ 시간이 올바르지 않습니다. HH:mm 또는 HH:mm:ss 형식으로 입력해주세요. (예: 20:30)');
                        return;
                    }
                    let seconds = match[3] || '00';
                    aucSession.closeTime = `${match[1].padStart(2, '0')}:${match[2]}:${seconds}`;
                    aucSession.state = 'AWAITING_AUTO_SETTLEMENT';
                    botInstance?.sendMessage(chatId, `✅ 마감 시간 [${aucSession.closeTime}] 설정 완료.\n\n마감 후 자동으로 정산 메시지를 일괄 전송하시겠습니까?`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🟢 자동 전송', callback_data: 'auc_settle_on' }],
                                [{ text: '⚪ 수동 전송', callback_data: 'auc_settle_off' }]
                            ]
                        }
                    });
                    return;
                }
                if (aucSession.state === 'AWAITING_CANCEL_CONFIRM') {
                    if (text === '취소') {
                        const taskId = aucSession.cancelTaskId;
                        const task = globalAdminManager?.getTasks().find(t => t.id === taskId);
                        if (task && task.status === 'WAITING') {
                            globalAdminManager?.removeTask(taskId);
                            if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
                                mainWindowWebContents.send('snipe-task-removed', taskId);
                            }
                            botInstance?.sendMessage(chatId, `✅ 경매 마감 예약(Task: ${taskId})이 성공적으로 취소되었습니다.`);
                        }
                        else {
                            botInstance?.sendMessage(chatId, `❌ 이미 진행 중이거나 존재하지 않는 예약입니다.`);
                        }
                    }
                    else {
                        botInstance?.sendMessage(chatId, `🚫 예약 취소를 중단합니다.`);
                    }
                    auctionSessionMap.delete(chatId);
                    return;
                }
            }
        });
        // /start
        botInstance.onText(/\/start/, (msg) => {
            let welcomeMsg = '👋 안녕하세요! 822링크 상품 등록 봇입니다.\n\n';
            if (settings.bandFeaturesEnabled !== false) {
                welcomeMsg += '1. `/밴드업로드` — 밴드 경매용 상품 등록\n' +
                    '2. `/오픈마켓업로드` — 번개장터/후르츠패밀리용 상품 등록\n';
            }
            else {
                welcomeMsg += '1. `/오픈마켓업로드` — 번개장터/후르츠패밀리용 상품 등록\n';
            }
            welcomeMsg += '3. 사진 6장을 전송해주세요.\n' +
                '4. 실측사이즈를 `가슴(허리)단면,총장` 형식으로 보내주세요.\n' +
                '5. 정가품, 하자와 상품 상태를 선택하면 자동 등록됩니다!\n\n' +
                `💡 Telegram ID: \`${msg.chat.id}\``;
            botInstance?.sendMessage(msg.chat.id, welcomeMsg);
        });
        // /cancel
        botInstance.onText(/\/cancel/, (msg) => {
            if (activeSession && activeSession.chatId === msg.chat.id) {
                if (activeSession.timer)
                    clearTimeout(activeSession.timer);
                activeSession = null;
                botInstance?.sendMessage(msg.chat.id, '❌ 세션이 취소되었습니다.');
                sendLog('⚠️ 사용자가 세션을 취소했습니다.');
            }
        });
        // /auction
        botInstance.onText(/\/(auction|a)/, (msg) => {
            const chatId = msg.chat.id;
            if (settings.bandFeaturesEnabled === false) {
                botInstance?.sendMessage(chatId, '❌ 오픈마켓 전용 계정에서는 사용할 수 없는 명령어입니다.');
                return;
            }
            if (auctionSessionMap.has(chatId))
                auctionSessionMap.delete(chatId);
            const bands = globalAdminManager?.getBandSettings() || [];
            if (bands.length === 0) {
                botInstance?.sendMessage(chatId, '❌ 등록된 밴드 설정이 없습니다. 데스크톱 앱에서 먼저 밴드 설정을 추가해주세요.');
                return;
            }
            const keyboard = bands.map(b => ([{ text: b.name, callback_data: `auction_band_${b.id}` }]));
            auctionSessionMap.set(chatId, {
                chatId,
                state: 'AWAITING_BAND'
            });
            botInstance?.sendMessage(chatId, '📋 어느 밴드에 경매 마감을 등록하시겠습니까?', {
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        });
        // 콜백 쿼리 (인라인 버튼 클릭) 핸들러
        botInstance.on('callback_query', (query) => {
            const chatId = query.message?.chat.id;
            const data = query.data;
            if (!chatId || !data)
                return;
            botInstance?.answerCallbackQuery(query.id).catch(() => { });
            // 예약 취소 처리는 활성 세션이 없어도 동작해야 하므로 가장 먼저 처리
            if (data.startsWith('auc_cancel_')) {
                const taskId = data.replace('auc_cancel_', '');
                const task = globalAdminManager?.getTasks().find(t => t.id === taskId);
                if (task && task.status === 'WAITING') {
                    // 취소 확인 상태로 세션 등록 (오작동 방지 2단계 확인)
                    auctionSessionMap.set(chatId, {
                        chatId,
                        state: 'AWAITING_CANCEL_CONFIRM',
                        cancelTaskId: taskId
                    });
                    botInstance?.sendMessage(chatId, `⚠️ 예약 취소 확인\n\n정말로 이 예약(Task: ${taskId})을 취소하시겠습니까?\n취소하시려면 채팅창에 **취소** 라고 정확히 입력해주세요.`);
                }
                else {
                    botInstance?.sendMessage(chatId, `❌ 이미 진행 중이거나 존재하지 않는 예약입니다.`);
                }
                return;
            }
            const aucSession = auctionSessionMap.get(chatId);
            if (!aucSession)
                return;
            if (aucSession.state === 'AWAITING_BAND' && data.startsWith('auction_band_')) {
                const bandId = data.replace('auction_band_', '');
                const band = globalAdminManager?.getBandSettings().find(b => b.id === bandId);
                if (!band)
                    return;
                aucSession.selectedBandId = band.id;
                aucSession.state = 'AWAITING_START_URL';
                botInstance?.sendMessage(chatId, `✅ 선택된 밴드: ${band.name}\n\n경매 마감할 **첫 번째 게시물 주소**를 텍스트로 붙여넣기 해주세요.`);
                return;
            }
            if (aucSession.state === 'AWAITING_TIME') {
                if (data === 'auc_time_default') {
                    const defaultTime = globalAdminManager?.getBandSettings().find(s => s.id === aucSession.selectedBandId)?.defaultCloseTime || '21:00:00';
                    aucSession.closeTime = defaultTime;
                    aucSession.state = 'AWAITING_AUTO_SETTLEMENT';
                    botInstance?.sendMessage(chatId, `✅ 마감 시간 [${aucSession.closeTime}] 설정 완료.\n\n마감 후 자동으로 정산 메시지를 일괄 전송하시겠습니까?`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🟢 자동 전송', callback_data: 'auc_settle_on' }],
                                [{ text: '⚪ 수동 전송', callback_data: 'auc_settle_off' }]
                            ]
                        }
                    });
                }
                else if (data === 'auc_time_custom') {
                    aucSession.state = 'AWAITING_CUSTOM_TIME';
                    botInstance?.sendMessage(chatId, `시간을 입력해주세요. (형식: HH:mm 또는 HH:mm:ss)\n예: 20:30`);
                }
                return;
            }
            if (aucSession.state === 'AWAITING_AUTO_SETTLEMENT') {
                if (data === 'auc_settle_on' || data === 'auc_settle_off') {
                    if (data === 'auc_settle_on' && !global.premiumFeatures?.autoSettlementEnabled) {
                        botInstance?.sendMessage(chatId, '❌ 해당 기능은 유료 서비스입니다.\n사용을 원하시면 관리자에게 권한을 요청해주세요.');
                        // 강제로 수동 전송 모드로 전환
                        aucSession.autoSettlement = false;
                    }
                    else {
                        aucSession.autoSettlement = (data === 'auc_settle_on');
                    }
                    // 백그라운드 관리자 매니저에 예약 등록
                    if (globalAdminManager) {
                        // 시작 URL부터 끝 URL까지의 번호를 추출해서 배열 생성
                        const startMatch = aucSession.startUrl.match(/\/post\/(\d+)/);
                        const endMatch = aucSession.endUrl.match(/\/post\/(\d+)/);
                        const startNum = parseInt(startMatch[1], 10);
                        const endNum = parseInt(endMatch[1], 10);
                        const baseUrl = aucSession.startUrl.substring(0, aucSession.startUrl.lastIndexOf('/post/') + 6);
                        const urls = [];
                        for (let i = startNum; i <= endNum; i++) {
                            urls.push(`${baseUrl}${i}`);
                        }
                        const now = new Date();
                        const [hours, minutes, seconds = '00'] = aucSession.closeTime.split(':');
                        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours), parseInt(minutes), parseInt(seconds)).getTime();
                        const taskId = Math.random().toString(36).substring(7);
                        globalAdminManager.addTask({
                            id: taskId,
                            bandSettingId: aucSession.selectedBandId,
                            urls,
                            targetTime,
                            status: 'WAITING',
                            autoSendChat: aucSession.autoSettlement
                        });
                        botInstance?.sendMessage(chatId, `🎉 경매 마감 작업이 스케줄러에 등록되었습니다!\n\n- 게시물 수: ${urls.length}건\n- 마감 시간: ${aucSession.closeTime}\n- 자동 정산: ${aucSession.autoSettlement ? '🟢 자동 전송' : '⚪ 수동 전송'}\n\n데스크톱 앱의 '마감 예약 목록' 탭에서 진행 상황을 확인할 수 있습니다.\n\n⚠️ 예약된 마감을 취소하시려면 아래 버튼을 눌러주세요.`, {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '❌ 이 예약 취소하기', callback_data: `auc_cancel_${taskId}` }]
                                ]
                            }
                        });
                    }
                    else {
                        botInstance?.sendMessage(chatId, '❌ 시스템 오류: AdminManager가 연결되지 않았습니다.');
                    }
                    auctionSessionMap.delete(chatId);
                }
                return;
            }
        });
        // /밴드업로드 — 밴드 경매용 시트(밴드탭)에 기록
        botInstance.onText(/\/(밴드업로드|bandupload)/, (msg) => {
            const chatId = msg.chat.id;
            if (settings.bandFeaturesEnabled === false) {
                botInstance?.sendMessage(chatId, '❌ 오픈마켓 전용 계정에서는 사용할 수 없는 명령어입니다.');
                return;
            }
            if (activeSession?.timer)
                clearTimeout(activeSession.timer);
            activeSession = {
                chatId, files: [], timer: null,
                mode: 'band',
                isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false
            };
            promptUploadOptions(chatId, '🎉 밴드 업로드 세션 시작!');
            sendLog('📸 [밴드업로드] 새 세션이 시작되었습니다.');
        });
        // /오픈마켓업로드 — 오픈마켓(번개장터/후르츠)용 시트에 기록
        botInstance.onText(/\/(오픈마켓업로드|openmarket|om)/, (msg) => {
            const chatId = msg.chat.id;
            if (activeSession?.timer)
                clearTimeout(activeSession.timer);
            activeSession = {
                chatId, files: [], timer: null,
                mode: 'market',
                isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false
            };
            promptUploadOptions(chatId, '🛍️ 오픈마켓 업로드 세션 시작!', false, 'market');
            sendLog('📸 [오픈마켓업로드] 새 세션이 시작되었습니다.');
        });
        // 파일/문서 수신
        botInstance.on('document', async (msg) => {
            const chatId = msg.chat.id;
            if (!activeSession || activeSession.chatId !== chatId) {
                if (activeSession?.timer)
                    clearTimeout(activeSession.timer);
                activeSession = { chatId, files: [], timer: null, isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false };
                promptUploadOptions(chatId, '⚡ 사진이 감지되어 새 세션을 시작합니다!');
                sendLog('📸 사진 감지 → 새 세션 자동 시작');
            }
            if (activeSession.isPhotosReady || activeSession.isPipelineTriggered)
                return;
            const fileId = msg.document?.file_id;
            if (!fileId)
                return;
            const watchFolder = readSettings().localImagePath;
            if (!watchFolder || !fs.existsSync(watchFolder)) {
                botInstance?.sendMessage(chatId, '❌ 이미지 저장 폴더가 설정되지 않았습니다.');
                return;
            }
            const originalName = msg.document?.file_name || 'file.jpg';
            const safeOriginalName = originalName.replace(/[\\/:*?"<>|]/g, '_');
            const savePath = path.join(watchFolder, safeOriginalName);
            try {
                const fileStream = botInstance.getFileStream(fileId);
                const writeStream = fs.createWriteStream(savePath);
                fileStream.pipe(writeStream);
                const sessionPointer = activeSession;
                writeStream.on('finish', () => {
                    if (!sessionPointer || sessionPointer.isPipelineTriggered || sessionPointer.isPhotosReady)
                        return;
                    if (!sessionPointer.files.includes(savePath))
                        sessionPointer.files.push(savePath);
                    sendLog(`📥 사진 ${sessionPointer.files.length}/6 다운로드 완료: ${safeOriginalName}`);
                    if (sessionPointer.files.length === 6) {
                        sessionPointer.isPhotosReady = true;
                        sessionPointer.files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
                        botInstance?.sendMessage(chatId, '✅ 사진 6장 다운로드 완료!');
                        sendLog('✅ [Track A] 사진 6장 수집 완료!');
                        if (!sessionPointer.isInfoReady) {
                            botInstance?.sendMessage(chatId, '이제 실측사이즈를 `가슴(허리)단면,총장` 쉼표 형식으로 전송해주세요!\n(예: `65, 44`)');
                        }
                        checkAndRunPipeline(sessionPointer);
                    }
                });
            }
            catch (err) {
                console.error('[CatalogBot] 파일 다운로드 에러:', err);
            }
        });
        // 일반 사진 수신
        botInstance.on('photo', async (msg) => {
            const chatId = msg.chat.id;
            if (!activeSession || activeSession.chatId !== chatId) {
                if (activeSession?.timer)
                    clearTimeout(activeSession.timer);
                activeSession = { chatId, files: [], timer: null, isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false };
                promptUploadOptions(chatId, '⚡ 사진이 감지되어 새 세션을 시작합니다!');
                sendLog('📸 사진 감지 → 새 세션 자동 시작');
            }
            if (activeSession.isPhotosReady || activeSession.isPipelineTriggered)
                return;
            const photos = msg.photo;
            if (!photos || photos.length === 0)
                return;
            const fileId = photos[photos.length - 1].file_id;
            const watchFolder = readSettings().localWatchPath || readSettings().localImagePath;
            if (!watchFolder || !fs.existsSync(watchFolder)) {
                botInstance?.sendMessage(chatId, '❌ 이미지 저장 폴더가 설정되지 않았습니다.');
                return;
            }
            const savePath = path.join(watchFolder, `telegram_${msg.message_id}.jpg`);
            try {
                const fileStream = botInstance.getFileStream(fileId);
                const writeStream = fs.createWriteStream(savePath);
                fileStream.pipe(writeStream);
                const sessionPointer = activeSession;
                writeStream.on('finish', () => {
                    if (!sessionPointer || sessionPointer.isPipelineTriggered || sessionPointer.isPhotosReady)
                        return;
                    if (!sessionPointer.files.includes(savePath))
                        sessionPointer.files.push(savePath);
                    sendLog(`📥 사진 ${sessionPointer.files.length}/6 다운로드 완료`);
                    if (sessionPointer.files.length === 6) {
                        sessionPointer.isPhotosReady = true;
                        sessionPointer.files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
                        botInstance?.sendMessage(chatId, '✅ 사진 6장 다운로드 완료!');
                        sendLog('✅ [Track A] 사진 6장 수집 완료!');
                        if (!sessionPointer.isInfoReady) {
                            botInstance?.sendMessage(chatId, '이제 실측사이즈를 `가슴(허리)단면,총장` 쉼표 형식으로 전송해주세요!\n(예: `65, 44`)');
                        }
                        checkAndRunPipeline(sessionPointer);
                    }
                });
            }
            catch (err) {
                console.error('[CatalogBot] 사진 다운로드 에러:', err);
            }
        });
        // 텍스트 메시지 (실측사이즈 + 하자 입력)
        botInstance.on('message', (msg) => {
            if (!msg.text || msg.text.startsWith('/'))
                return;
            const text = msg.text.trim();
            const chatId = msg.chat.id;
            // 초기 예약 시간 입력 처리
            if (activeSession && activeSession.awaitingScheduleTime && activeSession.chatId === chatId) {
                const targetTime = parseKoreanDateStr(text);
                if (!targetTime) {
                    botInstance?.sendMessage(chatId, '❌ 날짜 형식을 인식할 수 없습니다.\n예: `오늘 20:00`, `내일 08:00`, `08/25 09:00`');
                    return;
                }
                if (targetTime <= Date.now()) {
                    botInstance?.sendMessage(chatId, '❌ 과거 시간으로 예약할 수 없습니다. 다시 입력해주세요.');
                    return;
                }
                activeSession.awaitingScheduleTime = false;
                activeSession.uploadOption = 'schedule';
                activeSession.scheduledTime = targetTime;
                const dateObj = new Date(targetTime);
                const timeStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
                saveSettings({ ...readSettings(), lastUploadOption: { mode: 'schedule', timeString: timeStr } });
                botInstance?.sendMessage(chatId, `✅ 예약 업로드가 선택되었습니다! (${timeStr})\n📦 이제 사진 6장을 전송해주세요.`);
                return;
            }
            // 오픈마켓 가격 입력 대기 처리
            if (activeSession && activeSession.awaitingPrice && activeSession.chatId === chatId) {
                const priceNum = parseInt(text.replace(/[^0-9]/g, ''), 10);
                if (isNaN(priceNum) || priceNum <= 0) {
                    botInstance?.sendMessage(chatId, '❌ 올바른 숫자가 아닙니다. 판매 가격을 숫자로 다시 입력해주세요. (예: 30000)');
                    return;
                }
                activeSession.price = priceNum.toString();
                activeSession.awaitingPrice = false;
                botInstance?.sendMessage(chatId, `✅ 가격(${priceNum.toLocaleString()}원) 저장 완료!\n📦 이제 사진 6장을 전송해주세요.`);
                return;
            }
            // 늦은 예약 시간 텍스트 처리 (이전 로직 지원 유지)
            if (queueScheduleSessions.has(chatId)) {
                const prodCode = queueScheduleSessions.get(chatId);
                const targetTime = parseKoreanDateStr(text);
                if (!targetTime) {
                    botInstance?.sendMessage(chatId, '❌ 날짜 형식을 인식할 수 없습니다.\n예: `오늘 20:00`, `내일 08:00`, `08/25 09:00`');
                    return;
                }
                // 과거 시간인지 체크
                if (targetTime <= Date.now()) {
                    botInstance?.sendMessage(chatId, '❌ 과거 시간으로 예약할 수 없습니다. 다시 입력해주세요.');
                    return;
                }
                // 큐에 등록
                addToUploadQueue(prodCode, targetTime);
                queueScheduleSessions.delete(chatId);
                // 설정 기억
                const settings = readSettings();
                const dateObj = new Date(targetTime);
                const timeStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
                saveSettings({
                    ...settings,
                    lastUploadOption: {
                        mode: 'schedule',
                        timeString: timeStr
                    }
                });
                botInstance?.sendMessage(chatId, `✅ 밴드 업로드 대기열 등록 완료!\n예약 시간: ${timeStr}`);
                sendLog(`⏰ [대기열 등록] ${prodCode} -> ${timeStr} 밴드 업로드 예정`);
                return;
            }
            if (activeSession && activeSession.isPipelineTriggered)
                return;
            // 하자 텍스트 입력 대기 중
            if (activeSession?.awaitingDefect && activeSession.chatId === chatId) {
                activeSession.awaitingDefect = false;
                activeSession.defect = text.toLowerCase() === '없음' ? '' : text;
                botInstance?.sendMessage(chatId, '✅ 결함 정보 저장 완료!');
                sendLog(`📝 하자 정보: ${activeSession.defect || '없음'}`);
                // 상품 상태 선택
                showConditionButtons(chatId);
                return;
            }
            // 실측사이즈 파싱 (예: 65,44)
            const sizePattern = /^(\d+(\.\d+)?)\s*,\s*(\d+(\.\d+)?)$/i;
            const match = text.match(sizePattern);
            if (match) {
                const width = parseFloat(match[1]);
                const length = parseFloat(match[3]);
                if (!activeSession || activeSession.chatId !== chatId) {
                    if (activeSession?.timer)
                        clearTimeout(activeSession.timer);
                    activeSession = { chatId, files: [], timer: null, isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false };
                }
                activeSession.sizeData = {
                    width: width > 0 ? width.toString() : '',
                    length: length > 0 ? length.toString() : ''
                };
                sendLog(`📏 실측사이즈: 가슴(허리)단면 ${width}, 총장 ${length}`);
                // 정가품 선택 버튼 표시
                botInstance?.sendMessage(chatId, `✅ 실측사이즈 수집!\n가슴(허리)단면: ${width}, 총장: ${length}\n\n정가품 여부를 선택해주세요.`, { reply_markup: { inline_keyboard: [
                            [{ text: '✅ 정품', callback_data: 'auth_정품' }],
                            [{ text: '❓ 정가품모름', callback_data: 'auth_정가품모름' }]
                        ] } });
            }
        });
        // 인라인 키보드 콜백
        botInstance.on('callback_query', (query) => {
            const chatId = query.message?.chat.id;
            const data = query.data;
            if (!chatId)
                return;
            // 초기 큐 설정 콜백 처리
            if (data?.startsWith('sess_queue_')) {
                const action = data.split('_')[2];
                botInstance?.answerCallbackQuery(query.id);
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
                if (!activeSession || activeSession.chatId !== chatId)
                    return;
                if (action === 'options') {
                    promptUploadOptions(chatId, '옵션을 변경합니다.', true);
                    return;
                }
                if (action === 'cancel') {
                    activeSession.uploadOption = 'cancel';
                    botInstance?.sendMessage(chatId, '✅ 시트 저장이 선택되었습니다! 📦 사진 6장을 전송해주세요.');
                    return;
                }
                if (action === 'now') {
                    activeSession.uploadOption = 'now';
                    saveSettings({ ...readSettings(), lastUploadOption: { mode: 'now' } });
                    botInstance?.sendMessage(chatId, '🚀 즉시 업로드가 선택되었습니다! 📦 사진 6장을 전송해주세요.');
                    return;
                }
                if (action === 'last') {
                    activeSession.uploadOption = 'last';
                    botInstance?.sendMessage(chatId, '🚀 이전 설정으로 진행합니다! 📦 사진 6장을 전송해주세요.');
                    return;
                }
                if (action === 'schedule') {
                    activeSession.awaitingScheduleTime = true;
                    botInstance?.sendMessage(chatId, '⏰ 예약할 날짜와 시간을 입력해주세요.\n(예: `오늘 20:00`, `내일 08:00`, `08/25 09:00`)');
                    return;
                }
                if (action === 'om') {
                    const type = data.split('_')[3];
                    if (type === 'immediate') {
                        activeSession.uploadOption = 'immediate';
                        activeSession.awaitingPrice = true;
                        botInstance?.sendMessage(chatId, '🚀 마켓 즉시 업로드가 선택되었습니다!\n💰 오픈마켓에 등록할 **판매가격**을 숫자로 입력해주세요. (예: 30000)');
                    }
                    else if (type === 'sheet') {
                        activeSession.uploadOption = 'sheet_only';
                        botInstance?.sendMessage(chatId, '💾 시트에만 업로드가 선택되었습니다!\n📦 이제 사진 6장을 전송해주세요.');
                    }
                    return;
                }
                return;
            }
            // 기존 대기열 콜백 처리 (이전 호환성 및 에러 대응)
            if (data?.startsWith('queue_')) {
                const action = data.split('_')[1];
                const prodCode = data.split('_')[2];
                botInstance?.answerCallbackQuery(query.id);
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
                if (action === 'options') {
                    const keyboard = [
                        [{ text: '⚡ 즉시 밴드 업로드', callback_data: `queue_now_${prodCode}` }],
                        [{ text: '⏰ 예약 밴드 업로드 (날짜/시간 지정)', callback_data: `queue_schedule_${prodCode}` }],
                        [{ text: '💾 시트에만 저장 (대기)', callback_data: 'queue_cancel' }]
                    ];
                    botInstance?.sendMessage(chatId, `어떤 방식으로 업로드하시겠습니까?`, {
                        reply_markup: { inline_keyboard: keyboard }
                    });
                    return;
                }
                if (action === 'cancel') {
                    botInstance?.sendMessage(chatId, '✅ 시트 저장이 완료되었습니다. 밴드 업로드는 생략합니다.');
                    return;
                }
                if (action === 'now') {
                    addToUploadQueue(prodCode, Date.now() - 1000); // 과거 시간으로 설정해 즉시 실행 유도
                    saveSettings({ ...readSettings(), lastUploadOption: { mode: 'now' } });
                    botInstance?.sendMessage(chatId, '🚀 즉시 밴드 업로드 대기열에 추가되었습니다!');
                    sendLog(`🚀 [즉시 업로드] ${prodCode} 대기열 등록`);
                    return;
                }
                if (action === 'schedule') {
                    queueScheduleSessions.set(chatId, prodCode);
                    botInstance?.sendMessage(chatId, '⏰ 예약할 날짜와 시간을 입력해주세요.\n(예: `오늘 20:00`, `내일 08:00`, `08/25 09:00`)');
                    return;
                }
                if (action === 'last') {
                    const settings = readSettings();
                    if (settings.lastUploadOption?.mode === 'now') {
                        addToUploadQueue(prodCode, Date.now() - 1000);
                        botInstance?.sendMessage(chatId, '🚀 이전 설정에 따라 즉시 밴드 업로드 대기열에 추가되었습니다!');
                        sendLog(`🚀 [즉시 업로드] ${prodCode} 대기열 등록`);
                    }
                    else if (settings.lastUploadOption?.mode === 'schedule' && settings.lastUploadOption.timeString) {
                        // 시간 파싱 (기존 문자열 재활용이 애매하므로 오늘 기준 해당 시간으로 하거나... 여기서는 날짜가 포함된 문자열을 파싱해야함)
                        // 사실 timeString은 사람 읽기 편한 값이고, 실제 기억할 땐 시간을 어떻게 할까? 
                        // "내일 08:00" 같은 상대적 텍스트를 기억하는 게 좋음.
                        // 일단 단순 구현: timeString이 "내일 08:00" 일 경우 그 문자열 자체를 파싱
                        const parsedTime = parseKoreanDateStr(settings.lastUploadOption.timeString);
                        let finalTime = parsedTime;
                        // 만약 이전 문자열 파싱 실패 시, 무조건 내일 08:00로 설정
                        if (!finalTime || finalTime <= Date.now()) {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(8, 0, 0, 0);
                            finalTime = tomorrow.getTime();
                        }
                        addToUploadQueue(prodCode, finalTime);
                        botInstance?.sendMessage(chatId, `⏰ 이전 설정에 따라 예약 밴드 업로드 대기열에 추가되었습니다!\n예약 시간: ${new Date(finalTime).toLocaleString('ko-KR')}`);
                        sendLog(`⏰ [대기열 등록] ${prodCode} -> ${new Date(finalTime).toLocaleString('ko-KR')}`);
                    }
                    return;
                }
                return;
            }
            if (!activeSession || activeSession.isPipelineTriggered)
                return;
            if (data?.startsWith('auth_')) {
                const authText = data.replace('auth_', '');
                activeSession.authenticity = authText;
                botInstance?.answerCallbackQuery(query.id);
                botInstance?.sendMessage(chatId, `✅ 정가품 여부: ${authText}`);
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
                sendLog(`🏷️ 정가품: ${authText}`);
                // 다음 단계: 하자 유무 선택
                botInstance?.sendMessage(chatId, `제품 결함(하자) 유무를 선택해주세요.`, { reply_markup: { inline_keyboard: [
                            [{ text: '✅ 하자 없음', callback_data: 'defect_no' }],
                            [{ text: '⚠️ 하자 있음 (직접 입력)', callback_data: 'defect_yes' }]
                        ] } });
            }
            else if (data === 'defect_no') {
                activeSession.defect = '';
                botInstance?.answerCallbackQuery(query.id);
                botInstance?.sendMessage(chatId, '✅ 결함 없음으로 저장!');
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
                sendLog('📝 하자: 없음');
                showConditionButtons(chatId);
            }
            else if (data === 'defect_yes') {
                if (activeSession)
                    activeSession.awaitingDefect = true;
                botInstance?.answerCallbackQuery(query.id);
                botInstance?.sendMessage(chatId, '어떤 하자가 있는지 짧게 타이핑해주세요.\n(예: 왼쪽 소매 미세오염)');
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
            }
            else if (data?.startsWith('cond_')) {
                const conditionText = data.replace('cond_', '');
                activeSession.condition = conditionText;
                activeSession.isInfoReady = true; // Track B 완료!
                const message = query.message;
                const selectedBtnText = message?.reply_markup?.inline_keyboard.flat().find((btn) => btn.callback_data === data)?.text || conditionText;
                botInstance?.answerCallbackQuery(query.id, { text: selectedBtnText });
                botInstance?.sendMessage(chatId, `✅ ${selectedBtnText}`);
                botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
                sendLog(`📝 상품상태: ${conditionText}`);
                sendLog('✅ [Track B] 모든 텍스트 정보 수집 완료!');
                checkAndRunPipeline(activeSession);
            }
        });
    }
    catch (error) {
        console.error('[CatalogBot] 봇 초기화 에러:', error);
        sendLog(`❌ 봇 초기화 실패: ${error}`);
    }
}
/** 업로드 방식 선택 인라인 키보드 표시 (오픈마켓 모드 분기 추가) */
function promptUploadOptions(chatId, prefixMsg, forceShowAll = false, mode = 'band') {
    let keyboard = [];
    if (mode === 'market') {
        keyboard.push([{ text: '🚀 마켓 즉시 업로드 (시트+마켓)', callback_data: `sess_queue_om_immediate` }]);
        keyboard.push([{ text: '💾 시트에만 업로드', callback_data: `sess_queue_om_sheet` }]);
        botInstance?.sendMessage(chatId, `${prefixMsg}\n\n어떤 방식으로 업로드하시겠습니까?`, {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }
    const settings = readSettings();
    const lastOption = settings.lastUploadOption;
    if (!forceShowAll && lastOption && lastOption.mode) {
        if (lastOption.mode === 'now') {
            keyboard.push([{ text: `🚀 이전 설정으로 진행 (즉시 업로드)`, callback_data: `sess_queue_last` }]);
        }
        else if (lastOption.mode === 'schedule') {
            keyboard.push([{ text: `🚀 이전 설정으로 진행 (${lastOption.timeString} 예약)`, callback_data: `sess_queue_last` }]);
        }
        keyboard.push([{ text: '🔄 옵션 변경', callback_data: `sess_queue_options` }]);
    }
    else {
        keyboard.push([{ text: '⚡ 즉시 밴드 업로드', callback_data: `sess_queue_now` }]);
        keyboard.push([{ text: '⏰ 예약 밴드 업로드 (날짜/시간 설정)', callback_data: `sess_queue_schedule` }]);
        keyboard.push([{ text: '💾 시트만 저장 (대기)', callback_data: `sess_queue_cancel` }]);
    }
    botInstance?.sendMessage(chatId, `${prefixMsg}\n\n먼저 밴드 업로드 방식을 선택해주세요.`, {
        reply_markup: { inline_keyboard: keyboard }
    });
}
/** 상품 상태 선택 인라인 키보드 표시 */
function showConditionButtons(chatId) {
    botInstance?.sendMessage(chatId, '마지막으로 상품 상태를 골라주세요:', {
        reply_markup: { inline_keyboard: [
                [{ text: '새 상품(미사용)', callback_data: 'cond_새 상품(미사용)' }],
                [{ text: '사용감 없음', callback_data: 'cond_사용감 없음' }],
                [{ text: '사용감 적음', callback_data: 'cond_사용감 적음' }],
                [{ text: '사용감 많음', callback_data: 'cond_사용감 많음' }],
                [{ text: '고장/파손 상품', callback_data: 'cond_고장/파손 상품' }]
            ] }
    });
}
/**
 * 두 트랙이 모두 완료되면 파이프라인 시동
 */
function checkAndRunPipeline(sessionData) {
    if (!sessionData || sessionData.isPipelineTriggered)
        return;
    if (sessionData.isPhotosReady && sessionData.isInfoReady) {
        sessionData.isPipelineTriggered = true;
        botInstance?.sendMessage(sessionData.chatId, '🚀 AI 분석 및 구글 시트 등록 파이프라인을 가동합니다!');
        sendLog('🚀 파이프라인 시동! AI 분석 + 구글 시트 등록 시작...');
        const snapshot = {
            chatId: sessionData.chatId,
            files: [...sessionData.files],
            mode: sessionData.mode || 'band',
            sizeData: sessionData.sizeData ? { ...sessionData.sizeData } : undefined,
            authenticity: sessionData.authenticity,
            defect: sessionData.defect,
            condition: sessionData.condition,
            price: sessionData.price
        };
        executePipeline(snapshot).then((prodCode) => {
            // 오픈마켓 상품 처리
            if (snapshot.mode === 'market') {
                const option = sessionData.uploadOption;
                if (option === 'immediate') {
                    botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n🚀 백그라운드에서 오픈마켓 즉시 업로드를 시작합니다.\n앱의 '마켓 업로드' 패널에서 진행 상황을 확인할 수 있습니다.`);
                    sendLog(`🚀 [즉시 업로드] ${prodCode} 오픈마켓 3종 업로드 시작`);
                    sendLog('✨ 파이프라인 완료! 상품 등록 성공');
                    // 백그라운드 오픈마켓 업로드 트리거
                    if (mainWindowWebContents) {
                        runBackgroundMarketUpload(prodCode, readSettings().googleSpreadsheetUrl, mainWindowWebContents).catch(err => {
                            console.error('[Background Market Upload Error]', err);
                        });
                    }
                }
                else {
                    botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n🛍️ 오픈마켓 시트에 저장되었습니다.\n앱에서 [번개장터 업로드]/[후르츠 업로드] 버튼으로 등록하세요.`);
                    sendLog(`✅ [오픈마켓 등록 완료] ${prodCode} (오픈마켓 시트 저장)`);
                    sendLog('✨ 파이프라인 완료! 상품 등록 성공');
                }
                return;
            }
            let option = sessionData.uploadOption;
            // 만약 세션에 옵션이 없다면 'last' 설정으로 폴백
            if (!option) {
                option = 'last';
            }
            if (option === 'cancel') {
                botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n💾 시트에만 저장되었습니다.`);
                sendLog(`✅ [등록 완료] ${prodCode} (시트만 저장)`);
            }
            else if (option === 'now') {
                addToUploadQueue(prodCode, Date.now() - 1000);
                botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n🚀 즉시 밴드 업로드 대기열에 추가되었습니다!`);
                sendLog(`🚀 [즉시 업로드] ${prodCode} 대기열 등록`);
            }
            else if (option === 'schedule' && sessionData.scheduledTime) {
                addToUploadQueue(prodCode, sessionData.scheduledTime);
                const dateObj = new Date(sessionData.scheduledTime);
                const timeStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
                botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n⏰ 예약 밴드 업로드 대기열에 추가되었습니다! (${timeStr})`);
                sendLog(`⏰ [대기열 등록] ${prodCode} -> ${timeStr}`);
            }
            else if (option === 'last') {
                const settings = readSettings();
                if (settings.lastUploadOption?.mode === 'now') {
                    addToUploadQueue(prodCode, Date.now() - 1000);
                    botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n🚀 이전 설정에 따라 즉시 업로드 대기열에 추가되었습니다!`);
                    sendLog(`🚀 [즉시 업로드] ${prodCode} 대기열 등록`);
                }
                else if (settings.lastUploadOption?.mode === 'schedule' && settings.lastUploadOption.timeString) {
                    const parsedTime = parseKoreanDateStr(settings.lastUploadOption.timeString);
                    let finalTime = parsedTime;
                    if (!finalTime || finalTime <= Date.now()) {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        tomorrow.setHours(8, 0, 0, 0);
                        finalTime = tomorrow.getTime();
                    }
                    addToUploadQueue(prodCode, finalTime);
                    botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n⏰ 이전 설정에 따라 예약 밴드 업로드 대기열에 추가되었습니다!\n예약 시간: ${new Date(finalTime).toLocaleString('ko-KR')}`);
                    sendLog(`⏰ [대기열 등록] ${prodCode} -> ${new Date(finalTime).toLocaleString('ko-KR')}`);
                }
                else {
                    botInstance?.sendMessage(sessionData.chatId, `✨ 상품 데이터 등록 성공! (코드: ${prodCode})\n💾 이전 설정이 없어 시트에만 저장되었습니다.`);
                    sendLog(`✅ [등록 완료] ${prodCode} (시트만 저장)`);
                }
            }
            sendLog('✨ 파이프라인 완료! 상품 등록 성공');
        }).catch(err => {
            botInstance?.sendMessage(sessionData.chatId, `❌ 오류: ${err.message}`);
            sendLog(`❌ 파이프라인 실패: ${err.message}`);
        });
        if (activeSession === sessionData)
            activeSession = null;
    }
    else if (sessionData.isInfoReady && !sessionData.isPhotosReady) {
        const cnt = sessionData.files.length;
        botInstance?.sendMessage(sessionData.chatId, `⏳ 정보 입력 완료! 사진 다운로드 중... (${cnt}/6)`);
        sendLog(`⏳ Track B 완료, Track A 대기 중 (${cnt}/6)`);
    }
}
/**
 * 핵심 파이프라인: AI 분석 → 구글 시트 기입
 */
async function executePipeline(sessionData) {
    const chatId = sessionData.chatId;
    const settings = readSettings();
    // Gemini API Key: 822-link에서 공유하여 읽기
    const geminiKey = settings.geminiApiKey || getGeminiKeyFrom822Link();
    const googleDriveUrl = settings.googleDriveUrl;
    // 밴드/오픈마켓 모두 같은 스프레드시트를 공유하고, 시트탭으로 구분합니다.
    const googleSpreadsheetUrl = settings.googleSpreadsheetUrl;
    if (!geminiKey)
        throw new Error('Gemini API Key가 설정되지 않았습니다.');
    if (!googleDriveUrl || !googleSpreadsheetUrl)
        throw new Error('구글 드라이브 또는 스프레드시트 URL이 설정되지 않았습니다.');
    // 1단계: AI 분석
    const log1 = '⚙️ [1/3] Gemini AI 제품 분석 중...';
    botInstance?.sendMessage(chatId, log1);
    sendLog(log1);
    const aiRes = await analyzeProductWithAI(sessionData.files, geminiKey, sessionData.defect);
    if (!aiRes.success || !aiRes.data)
        throw new Error(aiRes.error || 'AI 분석 실패');
    const aiData = aiRes.data;
    sendLog(`🧠 AI 분석 완료: ${aiData.Brand} / ${aiData.Category} / ${aiData.Name}`);
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
        mainWindowWebContents.send('ai-analysis-completed');
    }
    // 2단계: 실측사이즈 텍스트 병합 (cm 기준)
    const sizePartsForDesc = [];
    const sizePartsForSheet = [];
    if (sessionData.sizeData?.width) {
        const wVal = sessionData.sizeData.width;
        sizePartsForDesc.push(`가슴(허리)단면 : ${wVal}cm`);
        sizePartsForSheet.push(wVal);
    }
    if (sessionData.sizeData?.length) {
        const lVal = sessionData.sizeData.length;
        sizePartsForDesc.push(`총장 : ${lVal}cm`);
        sizePartsForSheet.push(lVal);
    }
    const defectText = aiData.Defect_KR || sessionData.defect || '하자가 없는 깨끗한 상품입니다.';
    const sheetRealSizeStr = sizePartsForSheet.join(',');
    const descRealSizeStr = sizePartsForDesc.join(' / ');
    const conditionText = sessionData.condition || '사용감 적음';
    // 3단계: 제품 코드 채번
    const log2 = '🔍 [2/3] 스프레드시트 코드 채번 중...';
    botInstance?.sendMessage(chatId, log2);
    sendLog(log2);
    let prodCode = Date.now().toString().slice(-4);
    try {
        const realCode = await getNextProdCode(googleSpreadsheetUrl, undefined, sessionData.mode === 'market' ? 'market' : 'band');
        if (realCode)
            prodCode = realCode;
    }
    catch { /* 폴백 사용 */ }
    sendLog(`🏷️ 제품코드: ${prodCode}`);
    // --- 파이썬 프로세서 호출 및 로컬 저장 로직 (원본 100% 복제) ---
    const currentTarget = settings.uploadTarget || '822shop';
    const defaultStaticBase = currentTarget === 'dreamstudio'
      ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static'
      : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static';
    const staticBaseDir = defaultStaticBase;
    // 설정에서 저장 경로를 읽어옴 (설정이 없으면 기존 catalog_app 경로를 폴백으로 사용)
    const imageSaveBase = settings.localImageSavePath || settings.localSavePath || path.join(defaultStaticBase, 'images');
    const thumbnailSaveBase = settings.localThumbnailSavePath || path.join(defaultStaticBase, 'thumbnails');
    const outputDir = path.join(imageSaveBase, prodCode);
    const thumbnailDir = thumbnailSaveBase;
    
    let nukkiPath = '';
    let synthesisPath = '';

    const copyrightText = settings.copyright || '© 822 Vintage. All rights reserved.';
    const tempOutputDir = path.join(os.tmpdir(), '822-link-temp');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    try {
        const pyRes = await runPythonProcessor(
            sessionData.files,
            tempOutputDir,
            aiData.Brand ? aiData.Brand.toUpperCase() : 'UNKNOWN',
            aiData.Name || aiData.Category || '상의',
            prodCode,
            copyrightText,
            false // 누끼 패스 여부
        );
        if (pyRes.success) {
            nukkiPath = pyRes.nukkiPath || '';
            synthesisPath = pyRes.synthesisPath || '';
        } else {
            console.error('[CatalogBot Python Run Failure]', pyRes.error);
        }
    } catch (pyErr) {
        console.error('[CatalogBot Python Run Error]', pyErr);
    }

    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
        }

        let thumbSourcePath = '';
        sessionData.files.forEach((filePath, index) => {
            if (fs.existsSync(filePath)) {
                const originalName = path.basename(filePath);
                const fileExt = path.extname(filePath) || '.jpg';
                const destName = `${index + 1}${fileExt}`;
                const destPath = path.join(outputDir, destName);
                try {
                    fs.copyFileSync(filePath, destPath);
                    fs.unlinkSync(filePath);
                    if (index === 0) thumbSourcePath = destPath;
                } catch (copyErr) {
                    console.error(`[Archive Error] 원본 복사 실패 (${originalName}):`, copyErr);
                }
            }
        });

        let mainImagePath = thumbSourcePath;
        if (synthesisPath && fs.existsSync(synthesisPath)) {
            const compositesDir = path.join(imageSaveBase, 'Composites');
            if (!fs.existsSync(compositesDir)) {
                fs.mkdirSync(compositesDir, { recursive: true });
            }
            mainImagePath = path.join(compositesDir, `${prodCode}.jpg`);
            try {
                fs.copyFileSync(synthesisPath, mainImagePath);
                fs.unlinkSync(synthesisPath);
            } catch (copyErr) {
                console.error('[Archive Error] 합성 복사 실패:', copyErr);
            }
        }

        if (nukkiPath && fs.existsSync(nukkiPath)) {
            const destNukki = path.join(outputDir, `main${prodCode}${path.extname(nukkiPath)}`);
            try {
                fs.copyFileSync(nukkiPath, destNukki);
                fs.unlinkSync(nukkiPath);
            } catch (copyErr) {
                console.error('[Archive Error] 누끼 복사 실패:', copyErr);
            }
        }

        if (mainImagePath && fs.existsSync(mainImagePath)) {
            try {
                const img = nativeImage.createFromPath(mainImagePath);
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
                const thumbDest = path.join(thumbnailDir, `${prodCode}.jpg`);
                fs.writeFileSync(thumbDest, resized.toJPEG(85));
            } catch (thumbErr) {
                console.error('[Archive Error] 썸네일 생성 실패:', thumbErr);
            }
        }
    } catch (archiveErr) {
        console.warn('[Archive Failed]', archiveErr);
    }
    const finalProductName = aiData.Name || '빈티지 의류';
    const authTextForDesc = (sessionData.authenticity === '정품') ? '정품입니다.' : '정가품모름.';
    let finalDescription = '';
    if (settings.descriptionTemplate) {
        // 템플릿 치환 로직
        finalDescription = settings.descriptionTemplate
            .replace(/{제품명}/g, finalProductName)
            .replace(/{브랜드명}/g, aiData.Brand || 'Unknown')
            .replace(/{실측사이즈}/g, descRealSizeStr)
            .replace(/{정가품여부}/g, authTextForDesc)
            .replace(/{하자여부}/g, defectText)
            .replace(/{사용감정도}/g, conditionText);
    }
    else {
        // 기본 포맷
        finalDescription += `▪ 제품명 : ${finalProductName}\n`;
        finalDescription += `▪ 브랜드명 : ${aiData.Brand || 'Unknown'}\n`;
        if (descRealSizeStr) {
            finalDescription += `▪ 실측사이즈 : ${descRealSizeStr}\n`;
        }
        finalDescription += `▪ 정가품여부 : ${authTextForDesc}\n`;
        finalDescription += `▪ 하자여부 : ${defectText}\n`;
        finalDescription += `▪ 사용감정도 : ${conditionText}`;
    }
    // 오픈마켓용 설명: 본격적인 제품 설명 전에 첫 줄에 실측사이즈(cm) 표기
    const marketDescription = descRealSizeStr
        ? `${descRealSizeStr}\n${aiData.Market_Description_KR || ''}`
        : (aiData.Market_Description_KR || '');
    // 4단계: 구글 시트 업로드
    const log3 = '🔗 [3/3] 구글 시트 기입 중...';
    botInstance?.sendMessage(chatId, log3);
    sendLog(log3);
    const uploadRes = await uploadProductToGoogle({
        aiTitle: finalProductName,
        aiBrand: aiData.Brand || 'Unknown',
        aiCategory: aiData.Category || '상의',
        aiSize: aiData.Size || 'Free',
        aiGender: aiData.Gender || '남성',
        authenticity: sessionData.authenticity || '정가품모름',
        aiRealSize: sheetRealSizeStr,
        aiDefect: aiData.Defect_KR || sessionData.defect || '',
        aiCondition: conditionText,
        aiDescription: finalDescription,
        aiMarketDescription: marketDescription,
        aiNameEN: aiData.Name_EN || '',
        aiNameTH: aiData.Name_TH || '',
        aiDescEN: aiData.Description_EN || '',
        aiDescTH: aiData.Description_TH || '',
        aiSns: aiData.SNS || '',
        aiHashtags: aiData.Hashtags || '',
        aiStyle: aiData.Style || '',
        aiSeason: aiData.Season || 'sl',
        aiOriginalPrice: String(aiData.OriginalPrice || ''),
        localFilePaths: sessionData.files,
        googleDriveUrl,
        googleSpreadsheetUrl,
        predefinedProdCode: prodCode,
        // 오픈마켓은 지정가 판매라 시작가격(I열)이 없음 → 사장님이 J열에 판매가격을 직접 입력 (즉시 업로드 시 받은 가격 우선 반영)
        defaultStartingBid: sessionData.mode === 'market' ? '' : (settings.defaultStartingBid || ''),
        price: sessionData.price,
        sheetTab: sessionData.mode === 'market' ? 'market' : 'band'
    }, (progressLog) => {
        sendLog(progressLog);
    });
    if (!uploadRes.success)
        throw new Error(uploadRes.error || '구글 업로드 실패');
    return prodCode;
}
/** 봇 상태 확인 */
export function isBotRunning() {
    return botInstance !== null;
}
/** 봇 중지 */
export function stopCatalogBot() {
    if (botInstance) {
        botInstance.stopPolling();
        botInstance = null;
        sendLog('🔴 텔레그램 봇이 중지되었습니다.');
    }
}
/** 현재 설정 반환 */
export function getCatalogSettings() {
    return readSettings();
}
/** 마지막 통신한 사용자(chatId) 저장 */
function saveLastChatId(chatId) {
    try {
        const settings = readSettings();
        if (settings.lastChatId !== chatId) {
            saveSettings({ ...settings, lastChatId: chatId });
        }
    }
    catch (e) {
        console.error('[CatalogBot] lastChatId 저장 실패', e);
    }
}
/**
 * 외부에서 텔레그램 경고 메시지를 보낼 때 사용하는 함수
 * (admin.ts 마감 스케줄러 등에서 활용)
 */
export async function sendTelegramAlert(message) {
    if (!botInstance) {
        console.warn('[CatalogBot] 봇이 실행 중이지 않아 경고를 보낼 수 없습니다:', message);
        return;
    }
    const settings = readSettings();
    if (settings.lastChatId) {
        try {
            await botInstance.sendMessage(settings.lastChatId, message);
            console.log(`[CatalogBot] 텔레그램 경고 전송 완료 (chatId: ${settings.lastChatId})`);
        }
        catch (e) {
            console.error('[CatalogBot] 텔레그램 경고 전송 실패:', e.message);
        }
    }
    else {
        console.warn('[CatalogBot] 저장된 lastChatId가 없어서 경고를 보낼 수 없습니다:', message);
    }
}
