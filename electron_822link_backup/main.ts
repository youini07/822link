/**
 * 822 Link - Electron 메인 프로세스
 * 
 * 왜 이렇게 설계했는가:
 * - BrowserWindow를 하나만 생성하여 메모리를 절약
 * - preload 스크립트를 통해 렌더러와 안전하게 IPC 통신
 * - 개발 모드에서는 Vite 개발 서버 URL을, 프로덕션에서는 빌드된 HTML을 로드
 */
import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron'
import path from 'path'
import { URL } from 'url'
import fs from 'fs'
import { exec } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import { uploadProductToGoogle, getSpreadsheetDataByProdCode, fetchSpreadsheetList, updateSpreadsheetPID, deleteProductEntirely, getNextProdCode } from './googleUploader'
import { analyzeProductWithAI } from './aiAnalyzer'
import { runPythonProcessor } from './pythonRunner'
import { initTelegramBot } from './telegramBot'
import { registerBunjangHandlers } from './handlers/bunjangHandlers'
import { uploadToBunjang } from './automation/bunjangUploader'
import { registerFruitsHandlers } from './handlers/fruitsHandlers'
import { chromium } from 'playwright-extra'

// 렌더러 프로세스에서 로컬 이미지를 보안 위반(SOP) 없이 안전하게 썸네일로 불러오기 위해
// 'media' 프로토콜을 사전 등록합니다.
// 주의: standard를 true로 하면 URL 파서가 드라이브 문자 C:의 콜론을 포트 구분자로 오인하므로 의도적으로 제외합니다.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true } }
])

// 개발 모드 및 특정 백신(Kaspersky 등) 환경에서 발생하는 SSL 인증서 교체(MITM) 오류 방지
app.commandLine.appendSwitch('ignore-certificate-errors')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// 개발 모드 여부 판별
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let fileWatcher: FSWatcher | null = null

/**
 * 실시간 폴더 감시 정지
 */
function stopWatching() {
  if (fileWatcher) {
    fileWatcher.close()
    fileWatcher = null
  }
}

/**
 * 지정된 경로의 로컬 폴더를 감시하기 시작
 */
function startWatching(watchPath: string) {
  stopWatching()

  if (!watchPath || !fs.existsSync(watchPath)) {
    console.log(`[Watcher] 감시할 폴더가 존재하지 않거나 경로가 비어있습니다: ${watchPath}`)
    return
  }

  console.log(`[Watcher] 로컬 폴더 감시 시작: ${watchPath}`)
  const filesMap = new Map<string, any>()

  fileWatcher = chokidar.watch(watchPath, {
    ignored: /(^|[\/\\])\../, // 숨김 파일 무시
    persistent: true,
    depth: 0, // 최상위 폴더 바로 밑의 파일만 감시
  })

  // 파일 정보 추출 도우미
  const getFileInfo = (filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) return null

      const ext = path.extname(filePath).toLowerCase()
      // 범용 이미지 파일 판별
      let typeText = '일반 파일'
      if (['.jpg', '.jpeg'].includes(ext)) typeText = 'JPEG 이미지'
      else if (ext === '.png') typeText = 'PNG 이미지'
      else if (ext === '.gif') typeText = 'GIF 이미지'
      else if (ext === '.webp') typeText = 'WebP 이미지'

      // 수정한 날짜 보기 좋게 표현하기 위해 날짜 문자열도 동시 전송
      const dateObj = new Date(stats.mtimeMs)
      const dateString = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`

      return {
        id: filePath, // 절대경로를 고유 ID로 설정
        name: path.basename(filePath),
        path: filePath,
        status: 'pending',
        platform: '대기 중',
        size: stats.size,
        date: dateString,
        type: typeText,
        timestamp: stats.birthtimeMs && stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs, // 원천 타임스탬프 추가
      }
    } catch (e) {
      return null
    }
  }

  fileWatcher
    .on('add', (filePath: string) => {
      const fileInfo = getFileInfo(filePath)
      if (fileInfo) {
        filesMap.set(filePath, fileInfo)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:added', fileInfo)
        }
      }
    })
    .on('unlink', (filePath: string) => {
      filesMap.delete(filePath)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:removed', filePath)
      }
    })
    .on('change', (filePath: string) => {
      const fileInfo = getFileInfo(filePath)
      if (fileInfo) {
        filesMap.set(filePath, fileInfo)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file:changed', fileInfo)
        }
      }
    })
    .on('ready', () => {
      const initialFiles = Array.from(filesMap.values())
      console.log(`[Watcher] 초기 스캔 완료. 발견된 파일 수: ${initialFiles.length}`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file:initial', initialFiles)
      }
    })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    // 타이틀바를 커스텀하여 라이트 테마 느낌을 극대화
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f3f3',
      symbolColor: '#202020',
      height: 36,
    },
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 보안: nodeIntegration은 꺼두고 contextBridge로만 API 노출
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // React 앱 내에서 <webview> 태그 사용 허가 (번개장터 임베딩 용도)
    },
    // 앱 로딩 중 깜빡임 방지
    show: false,
  })

  // 앱이 준비되면 부드럽게 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    
    // 초기 감시 대상 폴더 시작
    try {
      const settings = readSettings()
      if (settings.localWatchPath) {
        startWatching(settings.localWatchPath)
      }

      // 텔레그램 봇 초기화
      initTelegramBot(mainWindow!.webContents)
    } catch (e) {
      console.error('[Watcher] 초기 감시 시작 실패:', e)
    }
  })

  // 개발 모드: Vite 개발 서버 / 프로덕션: 빌드된 HTML
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
    // 개발 시 DevTools 자동 열기
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    stopWatching()
    mainWindow = null
  })
}

// ──────────────────────────────────────────────
// IPC 핸들러: 렌더러 프로세스와의 통신 채널
// ──────────────────────────────────────────────
registerBunjangHandlers()
registerFruitsHandlers()


// 프로토타입용 메모리 기반 사용자 데이터베이스 (테스트용)
const usersDb = new Map<string, { id: string; email: string; password: string; displayName: string; expiresAt: string }>([
  [
    'test@822link.com',
    {
      id: 'dev-user-001',
      email: 'test@822link.com',
      password: 'test1234',
      displayName: '테스트 사용자',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30일 만료 기간
    }
  ]
])

/**
 * 라이선스 로그인 핸들러
 * - 렌더러에서 이메일/비밀번호를 받아 메모리 DB에서 인증 요청 처리
 * - 성공 시 라이선스 만료일 검증 후 결과 반환
 */
ipcMain.handle('auth:login', async (_event, { email, password }) => {
  try {
    const user = usersDb.get(email)
    if (user && user.password === password) {
      // 라이선스 만료 여부 확인
      const isExpired = new Date(user.expiresAt).getTime() < Date.now()
      if (isExpired) {
        return { success: false, error: '라이선스가 만료되었습니다. 관리자에게 문의하세요.' }
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          expiresAt: user.expiresAt,
        },
      }
    }
    return { success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  } catch (error) {
    return { success: false, error: '로그인 도중 에러가 발생했습니다.' }
  }
})

/**
 * 계정 생성 (회원가입) 핸들러
 * - 렌더러에서 이메일, 비밀번호, 닉네임을 받아 임시 계정 등록
 * - 프로토타입 편의상 7일 무료 평가판 라이선스 자동 발급
 */
ipcMain.handle('auth:register', async (_event, { email, password, displayName }) => {
  try {
    if (!email || !password) {
      return { success: false, error: '이메일과 비밀번호를 입력해주세요.' }
    }
    if (usersDb.has(email)) {
      return { success: false, error: '이미 가입된 이메일 주소입니다.' }
    }

    const newUserId = `user-${Date.now()}`
    const newUser = {
      id: newUserId,
      email,
      password,
      displayName: displayName || email.split('@')[0],
      // 가입 시 7일 무료 체험 라이선스 부여
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }

    usersDb.set(email, newUser)

    return {
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        displayName: newUser.displayName,
        expiresAt: newUser.expiresAt,
      },
    }
  } catch (error) {
    return { success: false, error: '계정 생성 중 에러가 발생했습니다.' }
  }
})

/**
 * 세션 복구 핸들러 (자동 로그인)
 * - 현재는 로컬 기반 툴이므로 기본 테스트 유저로 항상 성공하도록 모킹
 */
ipcMain.handle('auth:restore-session', async () => {
  const user = usersDb.get('test@822link.com')
  if (user) {
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        expiresAt: user.expiresAt,
      }
    }
  }
  return { success: false }
})

/**
 * 로그아웃 핸들러
 * - 저장된 토큰 및 세션 정보 삭제
 */
ipcMain.handle('auth:logout', async () => {
  // TODO: 로컬 DB에서 저장된 토큰 삭제
  return { success: true }
})

/**
 * AI 분석 핸들러 (Gemini Vision)
 */
ipcMain.handle('ai:analyze', async (_event, payload: { imagePaths: string[], apiKey: string, prompt: string, target?: string }) => {
  try {
    const result = await analyzeProductWithAI(payload.imagePaths, payload.apiKey, payload.prompt, payload.target)
    return result
  } catch (error: any) {
    console.error('[AI Analyze Handler Error]', error)
    return { success: false, error: error.message || String(error) }
  }
})

/**
 * 파이썬 이미지 처리 (누끼 및 합성)
 */
ipcMain.handle('python:process-images', async (_event, payload: { imagePaths: string[], outputDir: string, brand: string, title: string, prodCode: string, copyright?: string, skipNukki?: boolean }) => {
  try {
    const os = require('os')
    const path = require('path')
    const finalOutputDir = path.join(os.tmpdir(), '822-link-temp')
    const result = await runPythonProcessor(
      payload.imagePaths,
      finalOutputDir,
      payload.brand,
      payload.title,
      payload.prodCode,
      payload.copyright,
      payload.skipNukki
    )
    return result
  } catch (error: any) {
    console.error('[Python Runner Handler Error]', error)
    return { success: false, error: error.message || String(error) }
  }
})

ipcMain.handle('google:upload-product', async (_event, payload) => {
  try {
    const result = await uploadProductToGoogle(payload, (progressLog) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('google:upload-progress', {
          groupId: `group_${payload.localFilePaths[0]}`, // 드라이브 썸네일 기준 그룹 식별자 복구
          log: progressLog
        })
      }
    })
    return result
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ──────────────────────────────────────────────
// 로컬 설정(Settings) 파일 영속화 및 폴더 선택 기능
// ──────────────────────────────────────────────

// 사용자 데이터 폴더 내 config.json으로 설정 저장
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

function readSettings(): Record<string, any> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('설정 파일을 읽는 중 오류:', error)
  }
  return {}
}

function writeSettings(settings: Record<string, any>): boolean {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('설정 파일 쓰기 중 오류:', error)
    return false
  }
}

ipcMain.handle('google:delete-product-entirely', async (_event, payload: { prodCode: string, target?: string }) => {
  try {
    const config = readSettings()
    const target = payload.target || '822shop'
    const spreadsheetUrl = target === 'dreamstudio' ? config.googleSpreadsheetUrl_dreamstudio : config.googleSpreadsheetUrl_822shop
    const driveUrl = target === 'dreamstudio' ? config.googleDriveUrl_dreamstudio : config.googleDriveUrl_822shop
    
    if (!spreadsheetUrl || !driveUrl) {
      throw new Error('시트 또는 드라이브 주소 설정이 누락되었습니다.')
    }
    
    // 1. 클라우드 연동 삭제
    const result = await deleteProductEntirely(payload.prodCode, spreadsheetUrl, driveUrl)
    if (!result.success) throw new Error(result.error)
    
    // 2. 로컬 리소스 삭제
    const staticBaseDir = target === 'dreamstudio' 
      ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static' 
      : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static'
      
    const staticImagesDir = path.join(staticBaseDir, 'images', payload.prodCode)
    const compositeFile = path.join(staticBaseDir, 'images', 'Composites', `${payload.prodCode}.jpg`)
    const thumbFile = path.join(staticBaseDir, 'thumbnails', `${payload.prodCode}.jpg`)

    if (fs.existsSync(staticImagesDir)) {
      fs.rmSync(staticImagesDir, { recursive: true, force: true })
    }
    if (fs.existsSync(compositeFile)) {
      fs.rmSync(compositeFile, { force: true })
    }
    if (fs.existsSync(thumbFile)) {
      fs.rmSync(thumbFile, { force: true })
    }
    
    return { success: true }
  } catch (error: any) {
    console.error('[delete-product-entirely error]', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('file:delete', async (_event, filePaths: string[]) => {
  for (const p of filePaths) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p)
      } catch (err) {
        console.error('[File Cleanup] 삭제 실패:', p, err)
      }
    }
  }
  return { success: true }
})

// ──── Google 스프레드시트 ────
ipcMain.handle('google:fetchSpreadsheetList', async (_event, spreadsheetUrl: string) => {
  return await fetchSpreadsheetList(spreadsheetUrl)
})

ipcMain.handle('google:get-next-prod-code', async (_event, spreadsheetUrl: string) => {
  return await getNextProdCode(spreadsheetUrl)
})

// ──── 번개장터 크롬 디버깅 ────
ipcMain.handle('bunjang:openDebugBrowser', async () => {
  try {
    const os = require('os')
    const userDataDir = path.join(os.homedir(), 'bunjang_chrome_profile')
    // Windows 크롬 실행 명령어 (로그인 유지를 위해 별도 프로필 사용)
    const cmd = `start chrome --remote-debugging-port=9222 --user-data-dir="${userDataDir}" "https://bunjang.co.kr"`
    
    exec(cmd, (error) => {
      if (error) console.error('[Chrome Launch Error]', error)
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('file:trash', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      await shell.trashItem(filePath)
    }
    return { success: true }
  } catch (err) {
    console.error('휴지통으로 이동 실패:', err)
    return { success: false }
  }
})

ipcMain.handle('bunjang:upload-by-code', async (_event, payload: { prodCode: string; spreadsheetUrl: string, target?: string }) => {
  const { prodCode, spreadsheetUrl, target } = payload
  try {
    // 1. 스프레드시트에서 행 데이터 로드
    const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
    if (!sheetRes.success || !sheetRes.data) {
      throw new Error(sheetRes.error || '스프레드시트 데이터를 불러올 수 없습니다.')
    }
    const data = sheetRes.data

    // 2. 가격 유효성 검증
    const priceStr = String(data.price).replace(/[^0-9]/g, '')
    const price = parseInt(priceStr, 10)
    if (isNaN(price) || price < 100) {
      throw new Error('스프레드시트 H열의 가격이 올바르지 않습니다. (100원 이상 숫자)')
    }

    // 3. 로컬 이미지 폴더 스캔
    const staticBaseDir = target === 'dreamstudio'
      ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static'
      : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static'
    const outputDir = path.join(staticBaseDir, 'images', prodCode)
    if (!fs.existsSync(outputDir)) {
      throw new Error(`이미지 폴더를 찾을 수 없습니다: ${outputDir}`)
    }

    const imagePaths: string[] = []
    
    // 대표 이미지(통합 폴더 구조에선 폴더 밖에 prodCode.jpg로 존재)를 최우선으로 찾기
    const possibleMains = [path.join(staticBaseDir, 'images', 'Composites', `${prodCode}.jpg`), path.join(staticBaseDir, 'images', `${prodCode}.jpg`), path.join(staticBaseDir, 'images', `${prodCode}.png`)]
    for (const p of possibleMains) {
      if (fs.existsSync(p)) {
        imagePaths.push(p)
        break
      }
    }

    // 나머지 원본 이미지 모두 수집 (이름순 정렬)
    const allFiles = fs.readdirSync(outputDir)
    allFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    
    for (const f of allFiles) {
      if (imagePaths.length >= 12) break // 번개장터는 최대 12장
      const lowerF = f.toLowerCase()
      // 이미지 확장자만 취급, 단 main과 c(합성본)로 시작하는 자동 생성 파일은 대표 이미지 외엔 제외
      if (!lowerF.endsWith('.jpg') && !lowerF.endsWith('.jpeg') && !lowerF.endsWith('.png')) continue
      if (lowerF.startsWith('c' + prodCode.toLowerCase()) || lowerF.startsWith('main')) continue
      
      const fullPath = path.join(outputDir, f)
      if (!imagePaths.includes(fullPath)) {
        imagePaths.push(fullPath)
      }
    }

    if (imagePaths.length === 0) {
      throw new Error('업로드할 이미지 파일을 찾을 수 없습니다.')
    }

    // 사이즈 텍스트 조합
    const sizeInfo: string[] = []
    if (data.size && data.size.trim() !== '') {
      sizeInfo.push(`[표기 사이즈] ${data.size.trim()}`)
    }
    if (data.realSize && data.realSize.trim() !== '') {
      sizeInfo.push(`[실측 사이즈] ${data.realSize.trim()}`)
    }
    const sizeString = sizeInfo.length > 0 ? sizeInfo.join('\n') + '\n\n' : ''

    // 4. 번개장터 업로드 봇 구동
    await uploadToBunjang({
      imagePaths,
      title: data.title,
      categories: data.category ? data.category.split('>').map((s: string) => s.trim()) : [],
      price,
      condition: data.condition || '사용감 적음',
      description: `${sizeString}${data.description}\n\n${data.hashtags}`,
      hashtags: data.hashtags,
      isExchangeable: false
    })

    return { success: true }
  } catch (err: any) {
    console.error('[Bunjang Upload By Code] 에러:', err)
    return { success: false, error: err.message }
  }
})



ipcMain.handle('file:archive', async (_event, payload: {
  prodCode: string
  localFilePaths: string[]
  nukkiFilePath?: string
  synthesisFilePath?: string
  target?: string
}) => {
  const { prodCode, localFilePaths, nukkiFilePath, synthesisFilePath, target } = payload
  
  try {
    const staticBaseDir = target === 'dreamstudio'
      ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static'
      : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static'
    const outputDir = path.join(staticBaseDir, 'images', prodCode)
    const thumbnailDir = path.join(staticBaseDir, 'thumbnails')
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    if (!fs.existsSync(thumbnailDir)) {
      fs.mkdirSync(thumbnailDir, { recursive: true })
    }

    // 1. 원본 여러 장 복사 (1.jpg ~ 6.jpg 로 변경)
    let thumbSourcePath = ''
    for (let i = 0; i < localFilePaths.length; i++) {
      const p = localFilePaths[i]
      if (p && fs.existsSync(p)) {
        const fileExt = path.extname(p) || '.jpg'
        const destName = `${i + 1}${fileExt}`
        const targetPath = path.join(outputDir, destName)
        fs.copyFileSync(p, targetPath)
        if (i === 0) thumbSourcePath = targetPath
      }
    }

    // 2. 메인 카탈로그 이미지 (합성본) 복사 -> static/images/Composites/{상품코드}.jpg
    let mainImagePath = thumbSourcePath
    if (synthesisFilePath && fs.existsSync(synthesisFilePath)) {
      const compositesDir = path.join(staticBaseDir, 'images', 'Composites')
      if (!fs.existsSync(compositesDir)) {
        fs.mkdirSync(compositesDir, { recursive: true })
      }
      mainImagePath = path.join(compositesDir, `${prodCode}.jpg`)
      fs.copyFileSync(synthesisFilePath, mainImagePath)
    }

    // 3. 누끼 복사 (main{prodCode}.png)
    if (nukkiFilePath && fs.existsSync(nukkiFilePath)) {
      const ext = path.extname(nukkiFilePath).toLowerCase() || '.png'
      const targetPath = path.join(outputDir, `main${prodCode}${ext}`)
      fs.copyFileSync(nukkiFilePath, targetPath)
    }

    // 4. Electron nativeImage를 사용하여 800x674 썸네일 강제 생성 및 저장
    if (mainImagePath && fs.existsSync(mainImagePath)) {
      try {
        const { nativeImage } = require('electron')
        const img = nativeImage.createFromPath(mainImagePath)
        const fullSize = img.getSize()
        
        // 메인 합성 이미지(1080x1920)의 상단부(1080x960)를 잘라냅니다.
        let topHalfImg = img
        if (fullSize.width === 1080 && fullSize.height === 1920) {
           topHalfImg = img.crop({ x: 0, y: 0, width: 1080, height: 960 })
        }
        
        const size = topHalfImg.getSize()
        const targetRatio = 800 / 674
        const currentRatio = size.width / size.height
        
        let croppedImg = topHalfImg
        if (currentRatio < targetRatio) {
          const cropHeight = Math.floor(size.width / targetRatio)
          croppedImg = topHalfImg.crop({ x: 0, y: 0, width: size.width, height: cropHeight })
        } else if (currentRatio > targetRatio) {
          const cropWidth = Math.floor(size.height * targetRatio)
          const xOffset = Math.floor((size.width - cropWidth) / 2)
          croppedImg = topHalfImg.crop({ x: xOffset, y: 0, width: cropWidth, height: size.height })
        }
        
        const resized = croppedImg.resize({ width: 800, height: 674, quality: 'good' })
        const thumbDest = path.join(thumbnailDir, `${prodCode}.jpg`)
        fs.writeFileSync(thumbDest, resized.toJPEG(85))
      } catch (thumbErr) {
        console.error('[File Archive] 썸네일 생성 실패:', thumbErr)
      }
    }

    return { success: true }
  } catch (err) {
    console.error('[File Archive] 실패:', err)
    return { success: false }
  }
})

ipcMain.handle('settings:get', async (_event, key: string) => {
  const settings = readSettings()
  return settings[key] || null
})

ipcMain.handle('settings:set', async (_event, { key, value }) => {
  const settings = readSettings()
  settings[key] = value
  const success = writeSettings(settings)
  
  // 감시 대상 폴더 경로가 실시간으로 변경된 경우 watcher 재시작
  if (success && key === 'localWatchPath') {
    startWatching(value)
  }
  
  return { success }
})

/** 감시 폴더 선택 다이얼로그 */
ipcMain.handle('settings:select-folder', async () => {
  if (!mainWindow) return { success: false, path: null }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '감시할 폴더 선택',
    buttonLabel: '폴더 선택',
    properties: ['openDirectory', 'createDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, path: null }
  }
  return { success: true, path: result.filePaths[0] }
})

// ──────────────────────────────────────────────
// Electron 앱 라이프사이클 및 중복 실행 방지 (Single Instance Lock)
// ──────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 이미 실행 중인 인스턴스가 있다면 새 인스턴스는 즉시 종료하여 중복 다중 창 차단
  app.quit()
} else {
  // 두 번째 인스턴스가 실행되려 할 때 기존 창을 활성화 (포커스)
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // 'media' 프로토콜 요청 핸들러 등록
    // 왜 fs.readFileSync를 쓰는가:
    //   Chromium의 URL 파서가 media://C:/path 에서 C: 를 host:port로 해석하여
    //   콜론을 제거하는 문제가 있어, net.fetch(file://...) 방식으로는
    //   윈도우 드라이브 경로를 올바르게 전달할 수 없습니다.
    //   따라서 경로를 hex 인코딩으로 전달받고, fs로 직접 읽어 응답합니다.
    protocol.handle('media', (request) => {
      try {
        // request.url 예시: "media://file?p=433a5c55736572732f..."  (hex 인코딩된 경로)
        const hexMatch = request.url.match(/[?&]p=([0-9a-fA-F]+)/)
        if (!hexMatch) {
          return new Response('Bad Request: missing path param', { status: 400 })
        }

        // hex 문자열 → 원래 UTF-8 경로로 디코딩
        const hexStr = hexMatch[1]
        const bytes = new Uint8Array(hexStr.length / 2)
        for (let i = 0; i < hexStr.length; i += 2) {
          bytes[i / 2] = parseInt(hexStr.substring(i, i + 2), 16)
        }
        const filePath = new TextDecoder().decode(bytes)
        
        // 파일 존재 확인 후 직접 읽기
        if (!fs.existsSync(filePath)) {
          console.error(`[Media Protocol] File not found: ${filePath}`)
          return new Response('Not Found', { status: 404 })
        }

        const data = fs.readFileSync(filePath)
        
        // 확장자 기반 MIME 타입 결정
        const ext = path.extname(filePath).toLowerCase()
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.png': 'image/png', '.gif': 'image/gif',
          '.webp': 'image/webp', '.bmp': 'image/bmp',
        }
        const mime = mimeMap[ext] || 'application/octet-stream'

        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': mime },
        })
      } catch (err) {
        console.error('[Media Protocol Error]', err)
        return new Response('Internal Server Error', { status: 500 })
      }
    })

    createWindow()

    // macOS: 독 아이콘 클릭 시 창이 없으면 새로 생성
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // 모든 창이 닫히면 앱 종료 (macOS 제외)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
