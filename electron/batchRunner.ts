import { ipcMain, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import iconv from 'iconv-lite';

export function registerBatchHandlers(mainWindow: BrowserWindow | null) {
  const runBatch = (batchPath: string, channel: string, workingDir?: string, encoding = 'euc-kr') => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send(channel, `[SYSTEM] 시작: ${batchPath}\n`);

    const env = { ...process.env };
    let commandStr = `"${batchPath}"`;
    
    if (encoding === 'utf8') {
      env.PYTHONUTF8 = '1';
      env.PYTHONIOENCODING = 'utf-8';
    }
    
    const batProcess = spawn(commandStr, [], {
      shell: true,
      cwd: workingDir || process.cwd(),
      env
    });

    // pause 명령어로 인해 멈추는 현상을 방지하기 위해 1초마다 엔터키(Enter) 자동 전송
    const autoEnter = setInterval(() => {
      if (batProcess.stdin && !batProcess.killed) {
        batProcess.stdin.write('\r\n');
      }
    }, 1000);

    batProcess.stdout.pipe(iconv.decodeStream(encoding)).on('data', (data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    });

    batProcess.stderr.pipe(iconv.decodeStream(encoding)).on('data', (data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, `[ERROR] ${data}`);
      }
    });

    batProcess.on('close', (code) => {
      clearInterval(autoEnter);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, `[SYSTEM] 종료됨 (코드: ${code})\n`);
      }
    });
  };

  ipcMain.handle('batch:run-autosheet', async () => {
    const batPath = path.join(process.cwd(), '업로드및오토시트.bat');
    // 업로드및오토시트.bat은 내부적으로 chcp 65001을 사용하고 UTF-8 이모지를 출력하므로 utf8 디코딩
    runBatch(batPath, 'batch:output', undefined, 'utf8');
    return true;
  });

  ipcMain.handle('batch:run-data-reflect', async () => {
    const batPath = 'C:\\Users\\youin\\OneDrive\\바탕 화면\\822shop\\데이터반영.bat';
    const workingDir = 'C:\\Users\\youin\\OneDrive\\바탕 화면\\822shop';
    // 데이터반영.bat은 CP949(euc-kr) 포맷이며 내부 한글 출력이 있으므로 euc-kr 디코딩
    runBatch(batPath, 'batch:output', workingDir, 'euc-kr');
    return true;
  });
}
