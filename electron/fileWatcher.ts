import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { getSettings as getCatalogSettings } from './telegramBot.js';

let watcher: chokidar.FSWatcher | null = null;

function getWatchPath() {
    // 1. app-settings.json 최우선 확인
    const appSettingsPath = path.join(app.getPath('userData'), 'app-settings.json');
    if (fs.existsSync(appSettingsPath)) {
        try {
            const appConfig = JSON.parse(fs.readFileSync(appSettingsPath, 'utf-8'));
            if (appConfig.localImageWatchPath) return appConfig.localImageWatchPath;
        } catch (e) {}
    }
    
    // 2. catalog_config.json 확인
    const configPath = path.join(app.getPath('userData'), 'catalog_config.json');
    if (fs.existsSync(configPath)) {
        try {
            const catalogConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (catalogConfig.localWatchPath) return catalogConfig.localWatchPath;
        } catch (e) {}
    }
    
    return '';
}

function createFileItem(filePath: string) {
    try {
        const stats = fs.statSync(filePath);
        return {
            id: filePath,
            name: path.basename(filePath),
            path: filePath,
            status: 'pending',
            platform: 'Local',
            size: stats.size,
            date: stats.birthtime.toLocaleString(),
            type: '이미지',
            timestamp: stats.birthtimeMs
        };
    } catch (err) {
        return null;
    }
}

export function initFileWatcher(mainWindow: BrowserWindow) {
    if (watcher) {
        watcher.close();
        watcher = null;
    }

    const watchPath = getWatchPath();
    if (!watchPath || !fs.existsSync(watchPath)) {
        console.warn('[FileWatcher] 감시 폴더가 설정되지 않았거나 존재하지 않습니다:', watchPath);
        return;
    }

    console.log('[FileWatcher] 폴더 감시 시작:', watchPath);

    watcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        depth: 0
    });

    const isImage = (p: string) => /\.(jpe?g|png|webp|bmp)$/i.test(p);

    watcher.on('ready', () => {
        try {
            const files = fs.readdirSync(watchPath).map(f => path.join(watchPath, f));
            const imageFiles = files.filter(isImage).map(createFileItem).filter(Boolean);
            mainWindow.webContents.send('file:initial', imageFiles);
        } catch (e) {
            console.error('[FileWatcher] 초기 파일 로드 실패:', e);
        }
    });

    watcher.on('add', (filePath) => {
        if (isImage(filePath)) {
            const item = createFileItem(filePath);
            if (item) mainWindow.webContents.send('file:added', item);
        }
    });

    watcher.on('unlink', (filePath) => {
        if (isImage(filePath)) {
            mainWindow.webContents.send('file:removed', filePath);
        }
    });

    watcher.on('change', (filePath) => {
        if (isImage(filePath)) {
            const item = createFileItem(filePath);
            if (item) mainWindow.webContents.send('file:changed', item);
        }
    });
}
