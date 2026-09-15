// @ts-nocheck
/**
 * [fruitsRunner.ts]
 * 822-link의 mobileRunner.ts를 Band Admin용으로 이식한 모듈
 *
 * - LDPlayer(adb 127.0.0.1:5555) + uiautomator2 기반 후르츠패밀리 자동화 파이썬 스크립트 실행
 * - stdin으로 JSON 전달, stdout의 RESULT_JSON: 을 파싱하여 결과 수신
 */
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
const execAsync = promisify(exec);
let activeProcess = null;
function getPythonScriptPath(scriptName) {
    // 개발 환경: 프로젝트 루트/python, 패키징: resources/python
    if (app.isPackaged) {
        const packagedPath = path.join(process.resourcesPath, 'python', scriptName);
        if (fs.existsSync(packagedPath))
            return packagedPath;
    }
    return path.join(app.getAppPath(), 'python', scriptName);
}
export function cancelActiveFruitsProcess() {
    if (activeProcess) {
        console.log('[fruitsRunner] 파이썬 프로세스 강제 종료 시도...');
        try {
            activeProcess.kill();
        }
        catch (e) {
            console.error('프로세스 종료 중 에러:', e);
        }
        activeProcess = null;
    }
}
export async function ensureLDPlayerRunning() {
    try {
        const { stdout } = await execAsync('tasklist | findstr dnplayer.exe').catch(() => ({ stdout: '' }));
        if (!stdout.includes('dnplayer.exe')) {
            console.log('[fruitsRunner] LDPlayer가 실행 중이지 않습니다. 자동으로 실행합니다...');
            // 일반적인 설치 경로 확인
            const paths = [
                'C:\\LDPlayer\\LDPlayer9\\dnplayer.exe',
                'C:\\LDPlayer9\\dnplayer.exe',
                'D:\\LDPlayer\\LDPlayer9\\dnplayer.exe'
            ];
            let targetPath = '';
            for (const p of paths) {
                if (fs.existsSync(p)) {
                    targetPath = p;
                    break;
                }
            }
            if (targetPath) {
                // exec로 start 명령어를 쓰면 Node.js 백그라운드 특성을 상속받아 창이 숨겨지는 버그가 있음
                // spawn + detached 옵션으로 완전히 독립된 GUI 프로세스로 띄움
                const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
                child.unref();
                console.log('[fruitsRunner] LDPlayer 실행 완료. 부팅을 위해 35초 대기합니다...');
                await new Promise(resolve => setTimeout(resolve, 35000));
            }
            else {
                console.log('[fruitsRunner] LDPlayer 설치 경로를 찾을 수 없습니다.');
            }
        }
        else {
            console.log('[fruitsRunner] LDPlayer가 이미 실행 중입니다.');
        }
    }
    catch (e) {
        console.error('[fruitsRunner] LDPlayer 실행 확인 중 에러:', e);
    }
}
export async function runFruitsUploader(productData) {
    await ensureLDPlayerRunning();
    return new Promise((resolve) => {
        const pythonExecutable = process.platform === 'win32' ? 'py' : 'python';
        let scriptPath;
        try {
            scriptPath = getPythonScriptPath('fruits_uploader.py');
        }
        catch (e) {
            return resolve({ success: false, error: e.message });
        }
        console.log(`[fruitsRunner] 스크립트 실행: ${scriptPath}`);
        const proc = spawn(pythonExecutable, [scriptPath], { cwd: path.dirname(scriptPath) });
        activeProcess = proc;
        let outputData = '';
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            console.log(text);
            outputData += text;
        });
        proc.stderr.on('data', (data) => {
            console.error(`[Fruits U2 Error] ${data}`);
        });
        proc.on('close', (code) => {
            activeProcess = null;
            if (code !== 0) {
                return resolve({ success: false, error: `Python 프로세스가 코드 ${code}로 종료되었습니다.` });
            }
            const match = outputData.match(/RESULT_JSON:(.*)/);
            if (match && match[1]) {
                try {
                    const result = JSON.parse(match[1].trim());
                    resolve(result);
                }
                catch (e) {
                    resolve({ success: false, error: 'Python 결과 파싱 실패' });
                }
            }
            else {
                resolve({ success: false, error: 'Python 스크립트에서 RESULT_JSON을 찾을 수 없습니다.' });
            }
        });
        proc.on('error', (err) => {
            activeProcess = null;
            resolve({ success: false, error: `프로세스 실행 실패: ${err.message} (시스템에 Python 및 uiautomator2 설치 필요)` });
        });
        proc.stdin.write(JSON.stringify(productData));
        proc.stdin.end();
    });
}
export async function runFruitsDeleter(pid) {
    await ensureLDPlayerRunning();
    return new Promise((resolve) => {
        const pythonExecutable = process.platform === 'win32' ? 'py' : 'python';
        let scriptPath;
        try {
            scriptPath = getPythonScriptPath('fruits_deleter.py');
        }
        catch (e) {
            return resolve({ success: false, error: e.message });
        }
        const proc = spawn(pythonExecutable, [scriptPath, pid], { cwd: path.dirname(scriptPath) });
        activeProcess = proc;
        let outputData = '';
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            console.log(text);
            outputData += text;
        });
        proc.stderr.on('data', (data) => {
            console.error(`[Fruits Deleter Error] ${data}`);
        });
        proc.on('close', (code) => {
            activeProcess = null;
            if (code !== 0) {
                return resolve({ success: false, error: `Python 프로세스가 코드 ${code}로 종료되었습니다.` });
            }
            const match = outputData.match(/###RESULT_START###\s*(\{.*\})\s*###RESULT_END###/);
            if (match && match[1]) {
                try {
                    const result = JSON.parse(match[1]);
                    resolve(result);
                }
                catch (e) {
                    resolve({ success: false, error: 'Python 결과 파싱 실패' });
                }
            }
            else {
                resolve({ success: false, error: 'Python 스크립트에서 결과를 찾을 수 없습니다.' });
            }
        });
        proc.on('error', (err) => {
            activeProcess = null;
            resolve({ success: false, error: `프로세스 실행 실패: ${err.message}` });
        });
    });
}
export async function runFruitsBumper(pid) {
    await ensureLDPlayerRunning();
    return new Promise((resolve) => {
        const pythonExecutable = process.platform === 'win32' ? 'py' : 'python';
        let scriptPath;
        try {
            scriptPath = getPythonScriptPath('fruits_bumper.py');
        }
        catch (e) {
            return resolve({ success: false, error: e.message });
        }
        const proc = spawn(pythonExecutable, [scriptPath, pid], { cwd: path.dirname(scriptPath) });
        activeProcess = proc;
        let outputData = '';
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            console.log(text);
            outputData += text;
        });
        proc.stderr.on('data', (data) => {
            console.error(`[Fruits Bumper Error] ${data}`);
        });
        proc.on('close', (code) => {
            activeProcess = null;
            if (code !== 0) {
                return resolve({ success: false, error: `Python 프로세스가 코드 ${code}로 종료되었습니다.` });
            }
            const match = outputData.match(/###RESULT_START###\s*(\{.*\})\s*###RESULT_END###/);
            if (match && match[1]) {
                try {
                    const result = JSON.parse(match[1]);
                    resolve(result);
                }
                catch (e) {
                    resolve({ success: false, error: 'Python 결과 파싱 실패' });
                }
            }
            else {
                resolve({ success: false, error: 'Python 스크립트에서 결과를 찾을 수 없습니다.' });
            }
        });
        proc.on('error', (err) => {
            activeProcess = null;
            resolve({ success: false, error: `프로세스 실행 실패: ${err.message}` });
        });
    });
}
