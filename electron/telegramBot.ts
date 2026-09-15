import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app, WebContents, nativeImage } from 'electron'
import { analyzeProductWithAI } from './aiAnalyzer'
import { runPythonProcessor } from './pythonRunner'
import { uploadProductToGoogle, getNextProdCode } from './googleUploader'

const CONFIG_PATH = path.join(app.getPath('userData'), 'catalog_config.json')
const APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')

/**
 * 822 Link 설정 파일을 읽는 동기 함수 (app-settings.json과 병합)
 */
function readSettings(): Record<string, any> {
  let settings: Record<string, any> = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const catData = fs.readFileSync(CONFIG_PATH, 'utf-8')
      settings = { ...settings, ...JSON.parse(catData) }
    }
  } catch (error) {
    console.error('[Telegram] catalog_config.json 읽는 중 오류:', error)
  }
  
  try {
    if (fs.existsSync(APP_SETTINGS_PATH)) {
      const appData = fs.readFileSync(APP_SETTINGS_PATH, 'utf-8')
      settings = { ...settings, ...JSON.parse(appData) }
    }
  } catch (error) {
    console.error('[Telegram] app-settings.json 읽는 중 오류:', error)
  }
  return settings
}

let botInstance: TelegramBot | null = null

// 모바일-to-클라우드 다이렉트 연동을 위한 백엔드 세션 스토리지 구조
interface ActiveSession {
  chatId: number
  files: string[]
  timer: NodeJS.Timeout | null
  sizeData?: {
    width: string
    length: string
  }
  defect?: string
  condition?: string
  isPhotosReady?: boolean       // 사진 6장이 로컬 디스크에 물리적으로 완벽히 다운로드 완료되었는지 여부
  isInfoReady?: boolean         // 사이즈, 하자, 상태 정보가 모두 최종 수집 완료되었는지 여부
  isPipelineTriggered?: boolean // 파이프라인의 중복 구동 방지 락
  awaitingDefect?: boolean      // 하자 텍스트 입력 대기 상태 (chatStates에서 통합)
  uploadTargetOverride?: string // 사용자별 업로드 타겟 오버라이드 (예: 'dreamstudio')
  skipNukki?: boolean           // 누끼 패스 여부
}

// 허용된 텔레그램 사용자 설정 구조
interface AllowedTelegramUser {
  id: number
  label: string
  uploadTarget: string // '822shop' | 'dreamstudio'
  language?: string    // 'ko' | 'th'
}

let activeSession: ActiveSession | null = null
let mainWindowWebContents: WebContents | null = null

/**
 * [화이트리스트 검증]
 * config.json의 allowedTelegramUsers 배열에 해당 chatId가 포함되어 있는지 확인합니다.
 * 배열이 비어있거나 미설정이면 기존처럼 모든 사용자를 허용합니다. (하위 호환)
 */
function isAllowedUser(chatId: number): boolean {
  const settings = readSettings()
  const allowed = settings.allowedTelegramUsers as AllowedTelegramUser[] | undefined
  // 화이트리스트가 비어있으면 모든 사용자 허용 (기존 동작 호환)
  if (!Array.isArray(allowed) || allowed.length === 0) return true
  return allowed.some(user => user.id === chatId)
}

/**
 * [세션 잠금 검증]
 * 다른 사용자가 이미 업로드 세션을 사용 중인지 확인합니다.
 * 한 번에 한 명만 사용하는 규칙을 코드로 강제합니다.
 */
function isSessionLockedByOther(chatId: number): boolean {
  return activeSession !== null && activeSession.chatId !== chatId
}

/**
 * [사용자별 업로드 타겟 결정]
 * 화이트리스트에 등록된 사용자의 전용 업로드 타겟을 반환합니다.
 * 미등록 사용자이거나 타겟이 지정되지 않은 경우 config의 기본값을 사용합니다.
 */
function getUploadTargetForUser(chatId: number): string | undefined {
  const settings = readSettings()
  const allowed = settings.allowedTelegramUsers as AllowedTelegramUser[] | undefined
  if (!Array.isArray(allowed)) return undefined
  const user = allowed.find(u => u.id === chatId)
  return user?.uploadTarget || undefined
}

/**
 * [사용자별 언어 결정]
 */
function getUserLanguage(chatId: number): 'ko' | 'th' {
  const settings = readSettings()
  const allowed = settings.allowedTelegramUsers as AllowedTelegramUser[] | undefined
  if (!Array.isArray(allowed)) return 'ko'
  const user = allowed.find(u => u.id === chatId)
  return (user?.language as 'ko' | 'th') || 'ko'
}

/**
 * [다국어 지원 헬퍼]
 */
const I18N: Record<string, Record<'ko' | 'th', string>> = {
  start_msg: {
    ko: '👋 안녕하세요! 822-Link 원스톱 자동 업로드 봇입니다.\n\n1. `/upload` 명령어를 전송해 세션을 열어주세요.\n2. 준비하신 사진 6장 (전면, 측면, 후면, 목택, 허리택, 디테일)을 순서대로 전송해주세요.\n3. 6장 전송이 끝나면 실측사이즈 `55,42,30` (총장,가슴,허리)을 쉼표로 보내주세요.\n4. 하자와 상태 선택을 마치면 대시보드를 켜두지 않아도 백그라운드에서 자동 기입 완료됩니다!',
    th: '👋 สวัสดี! ฉันคือบอทอัปโหลด 822-Link อัตโนมัติ\n\n1. พิมพ์ `/upload` เพื่อเริ่ม\n2. ส่งรูปภาพ 6 รูปตามลำดับ (ด้านหน้า, ด้านข้าง, ด้านหลัง, ป้ายคอ, ป้ายเอว, รายละเอียด)\n3. เมื่อส่งครบ 6 รูป ให้พิมพ์ขนาด `55,42,30` (ความยาว, หน้าอก, เอว)\n4. เลือกตำหนิและสภาพสินค้า จากนั้นระบบจะอัปโหลดอัตโนมัติ!'
  },
  auth_ok: { ko: '\n✅ 봇 사용 권한이 확인되었습니다.', th: '\n✅ ยืนยันสิทธิ์การใช้งานบอทแล้ว' },
  auth_fail: { ko: '\n⛔ 현재 봇 사용 권한이 없습니다. 관리자에게 위 ID를 전달해주세요.', th: '\n⛔ คุณยังไม่ได้รับสิทธิ์ให้ใช้งานบอท กรุณาส่ง ID นี้ให้ผู้ดูแลระบบ' },
  err_unauthorized: { ko: '⛔ 이 봇은 등록된 사용자만 이용할 수 있습니다.\n`/start` 명령어로 본인의 텔레그램 ID를 확인한 후 관리자에게 등록을 요청해주세요.', th: '⛔ บอทนี้ใช้ได้เฉพาะผู้ใช้ที่ลงทะเบียนแล้ว\nพิมพ์ `/start` เพื่อดู ID ของคุณและส่งให้แอดมิน' },
  err_locked: { ko: '⏳ 현재 다른 작업자가 업로드 중입니다.\n작업이 완료된 후 다시 시도해주세요.', th: '⏳ ขณะนี้มีคนอื่นกำลังอัปโหลดอยู่\nกรุณารอสักครู่แล้วลองอีกครั้ง' },
  upload_start: { ko: '🎉 업로드 세션이 활성화되었습니다!\n📦 업로드 대상:', th: '🎉 เริ่มเซสชันอัปโหลดแล้ว!\n📦 เป้าหมาย:' },
  upload_start2: { ko: '준비된 사진 6장을 순서대로 [파일/문서] 또는 [사진] 형태로 한 번에 묶어서 보내주세요.', th: 'กรุณาส่งรูปภาพ 6 รูปที่เตรียมไว้ (แนะนำให้ส่งแบบรวมในครั้งเดียว)' },
  photo_detect: { ko: '⚡ 사진 전송을 감지하여 새 업로드 세션을 시작합니다.', th: '⚡ ตรวจพบรูปภาพ! เริ่มเซสชันอัปโหลดใหม่' },
  photo_ready: { ko: '✅ [트랙A 완료] 사진 6장 다운로드 완료!', th: '✅ โหลดรูปภาพครบ 6 รูปแล้ว!' },
  photo_wait: { ko: '⏳ (사진 대기 중...)', th: '⏳ (กำลังรอรูปภาพ...)' },
  photo_ask_size: { ko: '🚀 사진 수집 완료', th: '🚀 รับรูปภาพครบแล้ว' },
  photo_ask_size2: { ko: '이제 실측사이즈를 `가슴(허리)단면,총장` 쉼표 형식으로 전송해주세요!\n(예: `65, 44`)', th: 'กรุณาส่งขนาดตามรูปแบบ `หน้าอก,ความยาว` คั่นด้วยลูกน้ำ!\n(เช่น `65, 44`)' },
  size_ok: { ko: '✅ 실측사이즈 수집 성공!\n가슴(허리)단면:', th: '✅ รับขนาดสำเร็จ!\nหน้าอก:' },
  size_ok2: { ko: '총장:', th: 'ความยาว:' },
  defect_ask_btn: { ko: '제품 결함(하자) 유무를 선택해주세요.', th: 'กรุณาเลือกตำหนิ (Defect)' },
  defect_no_btn: { ko: '✅ 하자 없음', th: '✅ ไม่มีตำหนิ' },
  defect_yes_btn: { ko: '⚠️ 하자 있음 (직접 입력)', th: '⚠️ มีตำหนิ (พิมพ์แจ้ง)' },
  defect_saved_no: { ko: '✅ 결함 정보 저장 완료 (하자 없음)!', th: '✅ บันทึกแล้ว (ไม่มีตำหนิ)!' },
  defect_saved_yes: { ko: '✅ 결함 정보 저장 완료!', th: '✅ บันทึกตำหนิแล้ว!' },
  defect_type_ask: { ko: '어떤 하자가 있는지 짧게 타이핑하여 보내주세요. (예: 왼쪽 소매 미세오염)', th: 'โปรดพิมพ์แจ้งตำหนิสั้นๆ (เช่น รอยเปื้อนที่แขนซ้าย)' },
  cond_ask: { ko: '마지막으로 의류의 상품 상태를 골라주세요:', th: 'ขั้นตอนสุดท้าย: เลือกสภาพสินค้า' },
  cond_btn1: { ko: '새 상품(미사용)', th: 'ของใหม่' },
  cond_btn2: { ko: '사용감 없음', th: 'สภาพดีมาก' },
  cond_btn3: { ko: '사용감 적음', th: 'สภาพดี' },
  cond_btn4: { ko: '사용감 많음', th: 'สภาพใช้งาน' },
  cond_btn5: { ko: '고장/파손 상품', th: 'สินค้าชำรุด' },
  pipeline_start: { ko: '🚀 [최종 교차 시동] 텍스트 정보와 사진 6장이 모두 완벽히 준비되었습니다!\n\nAI 분석 및 자동 업로드 파이프라인을 백그라운드에서 웅장하게 가동합니다. 대화창을 나가셔도 됩니다!', th: '🚀 ข้อมูลและรูปภาพครบถ้วน!\n\nระบบกำลังวิเคราะห์ AI และอัปโหลดอัตโนมัติในพื้นหลัง คุณสามารถออกจากแชทได้เลย!' },
  success: { ko: '✨ 업로드 파이프라인이 모두 성공적으로 완료되었습니다!', th: '✨ การอัปโหลดเสร็จสมบูรณ์!' },
  fail: { ko: '❌ 오류 발생: ', th: '❌ เกิดข้อผิดพลาด: ' },
  err_format: { ko: '⚠️ 실측사이즈 형식이 올바르지 않습니다. (예: 55,42)', th: '⚠️ รูปแบบขนาดไม่ถูกต้อง (เช่น 55,42)' },
  err_folder: { ko: '❌ 데스크탑 앱의 "이미지 감시 폴더 경로"가 설정에 입력되지 않았습니다.', th: '❌ ไม่ได้ตั้งค่าโฟลเดอร์รูปภาพในแอปคอมพิวเตอร์' }
}

function t(key: string, lang: 'ko' | 'th'): string {
  return I18N[key]?.[lang] || I18N[key]?.ko || key
}

/**
 * [initTelegramBot 설계 의도 - 병렬 상태 머신 도입]
 * 
 * - 타이밍 꼬임 및 재입력 문제 완전 해결 (1번 문제 최종 해결):
 *   기존의 직렬 처리 방식은 대용량 사진이 네트워크를 타고 저장되는 동안 사용자가 입력을 마치면
 *   이미지가 없다며 에러를 내거나 강제로 입력을 무시해 재입력을 요구하는 버그가 있었습니다.
 * 
 * - 해결 설계 (병렬 상태 머신):
 *   1. 사진 수집 트랙(Track A): 6장의 이미지가 다운로드 완료되는 즉시 `isPhotosReady = true`를 켭니다.
 *   2. 정보 입력 트랙(Track B): 다운로드 속도와 완전히 무관하게 사용자가 실측사이즈, 하자, 상태 입력을 
 *      언제든지 파바박 마칠 수 있도록 항상 열어두고 수집하여 `isInfoReady = true`를 켭니다.
 *   3. [교차 시점 시동]: 사진 6장과 텍스트 정보가 모두 들어맞는 그 순간(`checkAndRunPipeline`)
 *      자동으로 파이프라인 전산 엔진이 최종 웅장하게 시동됩니다.
 */
export function initTelegramBot(webContents: WebContents) {
  mainWindowWebContents = webContents

  const settings = readSettings()
  const token = settings.telegramToken
  const watchFolder = settings.localWatchPath

  if (!token) {
    console.log('[Telegram] 토큰이 설정되지 않아 봇을 시작하지 않습니다.')
    return
  }
  if (!watchFolder) {
    console.warn('[Telegram] 이미지 감시 폴더가 설정되지 않았습니다. 텔레그램 다운로드가 제한될 수 있습니다.')
  }

  if (botInstance) {
    botInstance.stopPolling()
    botInstance = null
  }

  try {
    botInstance = new TelegramBot(token, { polling: true })
    console.log('[Telegram] 봇 서버 시작됨.')

    // 텔레그램 명령어(/) 자동완성 목록 등록 API 호출
    botInstance.setMyCommands([
      { command: 'upload', description: '신규 제품 원스톱 자동 적재 세션 활성화 (u)' },
      { command: 'start', description: '822 Link 봇 매뉴얼 및 안내 시작' }
    ]).then(() => {
      console.log('[Telegram] 명령어 자동완성(/) 목록 등록 성공!')
    }).catch(err => {
      console.error('[Telegram] 명령어 자동완성(/) 등록 실패:', err)
    })

    // 1. /start 명령어 응답 — 본인의 텔레그램 ID를 안내하여 화이트리스트 등록을 돕습니다
    botInstance.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id
      const isAllowed = isAllowedUser(chatId)
      const lang = getUserLanguage(chatId)
      
      botInstance?.sendMessage(chatId, 
        t('start_msg', lang) +
        `\n\n💡 Telegram ID: \`${chatId}\`` +
        (isAllowed 
          ? t('auth_ok', lang)
          : t('auth_fail', lang))
      )
    })

    // 2. /upload 세션 시작 명령어 수신
    botInstance.onText(/\/(upload|u)/, (msg) => {
      const chatId = msg.chat.id
      const lang = getUserLanguage(chatId)
      
      // [Gate 1] 화이트리스트 검증 — 미등록 사용자 차단
      if (!isAllowedUser(chatId)) {
        botInstance?.sendMessage(chatId, t('err_unauthorized', lang))
        return
      }

      // [Gate 2] 세션 잠금 검증 — 다른 사람 작업 중이면 대기 안내
      if (isSessionLockedByOther(chatId)) {
        botInstance?.sendMessage(chatId, t('err_locked', lang))
        return
      }

      if (activeSession?.timer) {
        clearTimeout(activeSession.timer)
      }
      
      // 사용자별 업로드 타겟 결정 (화이트리스트에 지정된 값 우선 적용)
      const userTarget = getUploadTargetForUser(chatId)
      
      activeSession = {
        chatId,
        files: [],
        timer: null,
        isPhotosReady: false,
        isInfoReady: false,
        isPipelineTriggered: false,
        uploadTargetOverride: userTarget
      }

      const targetLabel = userTarget === 'dreamstudio' ? '🎨 Dreamstudio' : '🏪 822shop'
      botInstance?.sendMessage(chatId, `${t('upload_start', lang)} ${targetLabel}\n${t('upload_start2', lang)}`)
    })

    // 3. 파일/문서(Document) 수신
    botInstance.on('document', async (msg) => {
      const chatId = msg.chat.id
      const lang = getUserLanguage(chatId)
      
      // [Gate] 화이트리스트 + 세션 잠금 검증
      if (!isAllowedUser(chatId)) return
      if (isSessionLockedByOther(chatId)) {
        botInstance?.sendMessage(chatId, t('err_locked', lang))
        return
      }
      
      if (!activeSession || activeSession.chatId !== chatId) {
        if (activeSession?.timer) clearTimeout(activeSession.timer)
        const userTarget = getUploadTargetForUser(chatId)
        activeSession = { chatId, files: [], timer: null, isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false, uploadTargetOverride: userTarget }
        botInstance?.sendMessage(chatId, t('photo_detect', lang))
      }

      if (activeSession.isPhotosReady || activeSession.isPipelineTriggered) return

      const fileId = msg.document?.file_id
      if (!fileId) return

      const currentWatchFolder = readSettings().localWatchPath
      if (!currentWatchFolder || !fs.existsSync(currentWatchFolder)) {
        botInstance?.sendMessage(chatId, '❌ 데스크탑 앱의 "이미지 감시 폴더 경로"가 설정에 입력되지 않았습니다.')
        return
      }

      // [5번 해결] 원본 이미지 본명 그대로 100% 무손실 저장
      const originalName = msg.document?.file_name || 'file.jpg'
      const safeOriginalName = originalName.replace(/[\\/:*?"<>|]/g, '_')
      const savePath = path.join(currentWatchFolder, safeOriginalName)

      try {
        const fileStream = botInstance!.getFileStream(fileId)
        const writeStream = fs.createWriteStream(savePath)
        fileStream.pipe(writeStream)

        // 클로저 스코프 락
        const sessionPointer = activeSession

        writeStream.on('finish', () => {
          if (!sessionPointer || sessionPointer.isPipelineTriggered || sessionPointer.isPhotosReady) return
          
          if (!sessionPointer.files.includes(savePath)) {
            sessionPointer.files.push(savePath)
          }

          // 정확히 6장 도달 시 사진 트랙 A 즉시 완료 및 오름차순 자연 정렬로 정면 사수!
          if (sessionPointer.files.length === 6) {
            sessionPointer.isPhotosReady = true
            
            // [4번 해결] 파일명 기준 오름차순 정렬을 무조건 가동하여 정면(IMG_6008.JPG)을 files[0] 대표로 칼 고정!
            sessionPointer.files.sort((a, b) => {
              const fileA = path.basename(a)
              const fileB = path.basename(b)
              return fileA.localeCompare(fileB, undefined, { numeric: true, sensitivity: 'base' })
            })

            notifyPhotosReceived(chatId, sessionPointer)
            
            // 만약 정보 기입 트랙 B가 이미 끝나 대기 중이었다면 이 시점에 전산 시동!
            checkAndRunPipeline(sessionPointer)
          }
        })
      } catch (err) {
        console.error('[Telegram] 파일 다운로드 에러:', err)
      }
    })

    // 4. 일반 이미지(Photo) 수신
    botInstance.on('photo', async (msg) => {
      const chatId = msg.chat.id
      const lang = getUserLanguage(chatId)
      
      // [Gate] 화이트리스트 + 세션 잠금 검증
      if (!isAllowedUser(chatId)) return
      if (isSessionLockedByOther(chatId)) {
        botInstance?.sendMessage(chatId, '⏳ 현재 다른 작업자가 업로드 중입니다. 잠시 후 다시 시도해주세요.')
        return
      }
      
      if (!activeSession || activeSession.chatId !== chatId) {
        if (activeSession?.timer) clearTimeout(activeSession.timer)
        const userTarget = getUploadTargetForUser(chatId)
        activeSession = { chatId, files: [], timer: null, isPhotosReady: false, isInfoReady: false, isPipelineTriggered: false, uploadTargetOverride: userTarget }
        botInstance?.sendMessage(chatId, '⚡ 사진 전송을 감지하여 새 업로드 세션을 시작합니다.')
      }

      if (activeSession.isPhotosReady || activeSession.isPipelineTriggered) return

      const photos = msg.photo
      if (!photos || photos.length === 0) return
      const fileId = photos[photos.length - 1].file_id

      const currentWatchFolder = readSettings().localWatchPath
      if (!currentWatchFolder || !fs.existsSync(currentWatchFolder)) {
        botInstance?.sendMessage(chatId, t('err_folder', lang))
        return
      }

      const ext = '.jpg'
      const targetFileName = `telegram_${msg.message_id}${ext}`
      const savePath = path.join(currentWatchFolder, targetFileName)

      try {
        const fileStream = botInstance!.getFileStream(fileId)
        const writeStream = fs.createWriteStream(savePath)
        fileStream.pipe(writeStream)

        // 클로저 스코프 락
        const sessionPointer = activeSession

        writeStream.on('finish', () => {
          if (!sessionPointer || sessionPointer.isPipelineTriggered || sessionPointer.isPhotosReady) return
          
          if (!sessionPointer.files.includes(savePath)) {
            sessionPointer.files.push(savePath)
          }

          if (sessionPointer.files.length === 6) {
            sessionPointer.isPhotosReady = true
            
            // 정렬
            sessionPointer.files.sort((a, b) => {
              const fileA = path.basename(a)
              const fileB = path.basename(b)
              return fileA.localeCompare(fileB, undefined, { numeric: true, sensitivity: 'base' })
            })

            notifyPhotosReceived(chatId, sessionPointer)
            
            // 정보 트랙 B 완비 상태 체크 후 자동 시동
            checkAndRunPipeline(sessionPointer)
          }
        })
      } catch (err) {
        console.error('[Telegram] 사진 다운로드 에러:', err)
      }
    })

    // 5. 일반 텍스트 메시지 및 실측사이즈 연쇄 기입 핸들러
    botInstance.on('message', (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return

      const text = msg.text.trim()
      const chatId = msg.chat.id
      const lang = getUserLanguage(chatId)

      // [Gate] 화이트리스트 검증 — 미등록 사용자의 텍스트 메시지 무시
      if (!isAllowedUser(chatId)) return

      // 만약 파이프라인이 기동되어 실행 중이라면 새로운 메시지는 수집하지 않습니다.
      if (activeSession && activeSession.isPipelineTriggered) return

      // A. 하자(Defect) 정보 입력 차례인 경우 (awaitingDefect를 activeSession에 통합)
      if (activeSession?.awaitingDefect && activeSession.chatId === chatId) {
        activeSession.awaitingDefect = false
        const defectText = text.toLowerCase() === '없음' ? '' : text
        
        activeSession.defect = defectText
        botInstance?.sendMessage(chatId, t('defect_saved_yes', lang))
        
        // 프론트엔드 연동용 뷰 실시간 갱신 발송
        if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
          mainWindowWebContents.send('telegram:defect-update', defectText)
        }
        
        // 인라인 키보드로 상품 상태 선택 요청
        const conditionOptions = {
          reply_markup: {
            inline_keyboard: [
              [{ text: t('cond_btn1', lang), callback_data: "cond_새 상품(미사용)" }],
              [{ text: t('cond_btn2', lang), callback_data: "cond_사용감 없음" }],
              [{ text: t('cond_btn3', lang), callback_data: "cond_사용감 적음" }],
              [{ text: t('cond_btn4', lang), callback_data: "cond_사용감 많음" }],
              [{ text: t('cond_btn5', lang), callback_data: "cond_고장/파손 상품" }]
            ]
          }
        }
        botInstance?.sendMessage(chatId, t('cond_ask', lang), conditionOptions)
        return
      }

      // B. 실측사이즈 정규식 파싱 (예: 65,44 또는 65,44 패스)
      const sizePattern = /^(\d+(\.\d+)?)\s*,\s*(\d+(\.\d+)?)(?:\s*(패스|skip))?$/i
      const match = text.match(sizePattern)

      if (match) {
        const width = parseFloat(match[1]) // 가슴(허리)단면
        const length = parseFloat(match[3]) // 총장
        const isSkipNukki = !!match[5] // '패스' 또는 'skip' 입력 시 true

        // 텍스트를 이미지보다 먼저 입력하는 유연한 UX를 위해 activeSession을 즉시 자동 활성화 시킵니다!
        if (!activeSession || activeSession.chatId !== chatId) {
          // 다른 사용자 세션이 진행 중이면 사이즈 입력 무시
          if (isSessionLockedByOther(chatId)) return
          if (activeSession?.timer) clearTimeout(activeSession.timer)
          const userTarget = getUploadTargetForUser(chatId)
          activeSession = {
            chatId,
            files: [],
            timer: null,
            isPhotosReady: false,
            isInfoReady: false,
            isPipelineTriggered: false,
            uploadTargetOverride: userTarget
          }
        }

        activeSession.sizeData = {
          width: width > 0 ? width.toString() : '',
          length: length > 0 ? length.toString() : ''
        }
        activeSession.skipNukki = isSkipNukki
        
        const defectOptions = {
          reply_markup: {
            inline_keyboard: [
              [{ text: t('defect_no_btn', lang), callback_data: "defect_no" }],
              [{ text: t('defect_yes_btn', lang), callback_data: "defect_yes" }]
            ]
          }
        }
        botInstance?.sendMessage(chatId, `${t('size_ok', lang)} ${width || '-'}, ${t('size_ok2', lang)} ${length || '-'}\n\n${t('defect_ask_btn', lang)}`, defectOptions)

        // 프론트엔드 뷰어 실시간 갱신용 송부
        if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
          mainWindowWebContents.send('telegram:size-update', {
            width: width > 0 ? width.toString() : '',
            length: length > 0 ? length.toString() : ''
          })
        }
      } else {
        if (['업로드', '시작', 'upload', 'u'].includes(text.toLowerCase())) {
          msg.text = '/upload';
          (botInstance as any)?.emit('text', msg);
        }
      }
    })

    // 6. 인라인 키보드(상품 상태) 선택 시 최종 트리거 가동
    botInstance.on('callback_query', (query) => {
      const chatId = query.message?.chat.id
      const data = query.data
      const lang = chatId ? getUserLanguage(chatId) : 'ko'

      // [Gate] 화이트리스트 검증 — 미등록 사용자의 버튼 클릭 무시
      if (chatId && !isAllowedUser(chatId)) return

      if (chatId && data && data.startsWith('cond_')) {
        const conditionText = data.replace('cond_', '')
        
        if (!activeSession || activeSession.isPipelineTriggered) return

        activeSession.condition = conditionText
        activeSession.isInfoReady = true // [Track B 완료!] 모든 텍스트 정보 수집 완료

        // 프론트엔드 연동용 뷰 송부
        if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
          mainWindowWebContents.send('telegram:condition-update', conditionText)
        }

        const selectedBtnText = query.message?.reply_markup?.inline_keyboard
          .flat()
          .find(btn => btn.callback_data === data)?.text || conditionText

        botInstance?.answerCallbackQuery(query.id, { text: selectedBtnText })
        botInstance?.sendMessage(chatId, `✅ ${selectedBtnText}`)

        // 버튼 제거
        botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: query.message?.message_id
        })

        // [교차 조건 분석 및 시동!]
        checkAndRunPipeline(activeSession)
      } else if (chatId && data === 'defect_no') {
        if (!activeSession || activeSession.isPipelineTriggered) return
        activeSession.defect = ''
        
        botInstance?.answerCallbackQuery(query.id)
        botInstance?.sendMessage(chatId, t('defect_saved_no', lang))
        
        // 프론트엔드 업데이트
        if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
          mainWindowWebContents.send('telegram:defect-update', '')
        }
        
        // 버튼 제거
        botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: query.message?.message_id
        })

        // 상태 선택 메뉴 표시
        const conditionOptions = {
          reply_markup: {
            inline_keyboard: [
              [{ text: t('cond_btn1', lang), callback_data: "cond_새 상품(미사용)" }],
              [{ text: t('cond_btn2', lang), callback_data: "cond_사용감 없음" }],
              [{ text: t('cond_btn3', lang), callback_data: "cond_사용감 적음" }],
              [{ text: t('cond_btn4', lang), callback_data: "cond_사용감 많음" }],
              [{ text: t('cond_btn5', lang), callback_data: "cond_고장/파손 상품" }]
            ]
          }
        }
        botInstance?.sendMessage(chatId, t('cond_ask', lang), conditionOptions)
      } else if (chatId && data === 'defect_yes') {
        if (!activeSession || activeSession.isPipelineTriggered) return
        
        botInstance?.answerCallbackQuery(query.id)
        botInstance?.sendMessage(chatId, t('defect_type_ask', lang))
        
        // 버튼 제거
        botInstance?.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: query.message?.message_id
        })
        
        // awaitingDefect를 activeSession에 통합 관리
        if (activeSession) activeSession.awaitingDefect = true
      }
    })

  } catch (error) {
    console.error('[Telegram] 봇 초기화 에러:', error)
  }
}

/**
 * 6장의 이미지 수집이 완료되었음을 고지하고 실측 정보 입력을 대기시키는 헬퍼
 */
function notifyPhotosReceived(chatId: number, sessionPointer: ActiveSession) {
  const count = sessionPointer.files.length
  
  // 프론트엔드에도 6장 묶기 시각 피드백 발송 (실시간 감상용)
  if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
    mainWindowWebContents.send('telegram:auto-start', {
      repPath: sessionPointer.files[0],
      allPaths: [...sessionPointer.files]
    })
  }

  // 사용자가 아직 사이즈/결함/상태 등의 정보 기입 트랙 B를 완료하지 않은 경우에만 치수 입력을 독려합니다!
  if (!sessionPointer.isInfoReady) {
    const lang = getUserLanguage(chatId)
    botInstance?.sendMessage(chatId, `${t('photo_ask_size', lang)} (${count}).\n${t('photo_ask_size2', lang)}`)
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
      mainWindowWebContents.send('telegram:direct-log', `⏳ [입력 대기] 스마트폰(텔레그램)에서 실측 사이즈 및 상태 정보를 입력해주세요...`)
    }
  }
}

/**
 * [checkAndRunPipeline]
 * 
 * - 두 개의 비동기 병렬 트랙(사진 6장 완료 && 정보 기입 완료)이 모두 완성되는 교차 시점에만 
 *   단 1번 안전하게 파이프라인을 시동하여 타이밍 꼬임 및 누락 오류를 완전히 원천 해결합니다!
 */
function checkAndRunPipeline(sessionData: ActiveSession) {
  if (!sessionData || sessionData.isPipelineTriggered) return

  if (sessionData.isPhotosReady && sessionData.isInfoReady) {
    // 3중 안전 실행 잠금 (중복 실행 완전 차단)
    sessionData.isPipelineTriggered = true

    const lang = getUserLanguage(sessionData.chatId)
    botInstance?.sendMessage(sessionData.chatId, t('pipeline_start', lang))

    const sessionSnapshot = { 
      chatId: sessionData.chatId,
      files: [...sessionData.files],
      sizeData: sessionData.sizeData ? { ...sessionData.sizeData } : undefined,
      defect: sessionData.defect,
      condition: sessionData.condition
    }
    
    executeDirectPipeline(sessionSnapshot).then(() => {
      botInstance?.sendMessage(sessionData.chatId, t('success', lang))
    }).catch(err => {
      botInstance?.sendMessage(sessionData.chatId, `${t('fail', lang)}${err.message}`)
    })

    // 전역 세션 정리
    if (activeSession === sessionData) {
      activeSession = null
    }
  } else if (sessionData.isInfoReady && !sessionData.isPhotosReady) {
    // 정보 입력은 이미 끝났으나, 사진 다운로드가 아직 다 안 끝난 경우 친절 대기 안내 송부
    const currentCount = sessionData.files.length
    botInstance?.sendMessage(sessionData.chatId, `⏳ 텍스트 정보 입력 완료! 고용량 사진이 네트워크 다운로드 중입니다. (현재 완료: ${currentCount}/6장)\n6장이 모두 다운로드되는 즉시 전산 적재가 자동으로 시작되오니 편하게 기다려주세요!`)
  }
}

/**
 * [executeDirectPipeline 핵심 백엔드 전산 논스톱 엔진]
 */
async function executeDirectPipeline(sessionData: {
  chatId: number
  files: string[]
  sizeData?: { width: string; length: string }
  defect?: string
  condition?: string
}) {
  const chatId = sessionData.chatId
  const settings = readSettings()

  try {
    const geminiKey = settings.geminiKey
    
    // [핵심 수정] 사용자별 업로드 타겟 오버라이드를 최우선으로 적용합니다.
    // 화이트리스트에 지정된 uploadTarget이 있으면 그것을 사용하고,
    // 없으면 기존처럼 config.json의 uploadTarget 설정값을 따릅니다.
    const userTarget = getUploadTargetForUser(chatId)
    const currentTarget = userTarget || settings.uploadTarget || '822shop'
    const googleDriveUrl = currentTarget === 'dreamstudio'
      ? (settings.googleDriveUrl_dreamstudio || settings.googleDriveUrl)
      : settings.googleDriveUrl
    const googleSpreadsheetUrl = currentTarget === 'dreamstudio'
      ? (settings.googleSpreadsheetUrl_dreamstudio || settings.googleSpreadsheetUrl)
      : settings.googleSpreadsheetUrl
    
    console.log(`[Telegram] 사용자(${chatId}) 업로드 타겟: ${currentTarget} | Drive: ${googleDriveUrl?.slice(0, 40)}...`)
    
    // 텔레그램 봇으로 들어오는 모바일 원스톱 등록 시에는 명시적으로 끄지 않은 한 누끼와 합성 기능을 항상 기본적으로 활성화합니다!
    const enableRemoveBg = settings.enableRemoveBg !== false
    const enableSynthesis = settings.enableSynthesis !== false

    if (!geminiKey) throw new Error('Gemini API Key가 설정 화면에 비어 있습니다.')
    if (!googleDriveUrl || !googleSpreadsheetUrl) throw new Error(`구글 드라이브 또는 스프레드시트 URL이 설정 화면에 비어 있습니다. (타겟: ${currentTarget})`)
    if (!sessionData.files || sessionData.files.length === 0) throw new Error('분석할 이미지가 세션에 수집되지 않았습니다.')

    const lang = getUserLanguage(chatId)

    const log1 = `⚙️ [1단계/3] Gemini AI 멀티모달 제품 판별 및 카테고리/설명 생성 중...`
    botInstance?.sendMessage(chatId, log1)
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) mainWindowWebContents.send('telegram:direct-log', log1)

    // 1. AI Gemini 2.5 Flash Vision 직접 가동
    let finalPrompt = settings.aiPrompt || ''
    if (sessionData.defect && sessionData.defect.trim() !== '') {
      finalPrompt += `\n\n[중요 지시사항: 제품 결함 정보]\n제품에 다음과 같은 결함이 있습니다: "${sessionData.defect}"\n이 결함 내용이 외국어(예: 태국어)로 작성되었다면 반드시 정확한 한국어로 번역하여 'Defect_KR' 필드에 넣고, 제품 설명(Description)에도 이 한국어 결함 내용을 언급하되, 절대 포장하거나 과장하지 말고(예: "자연스러운 세월의 흔적" 등 사용 금지) 있는 그대로 매우 담백하고 명확하게 팩트만 기재해 주세요.`
    } else {
      finalPrompt += `\n\n[중요 지시사항: 제품 결함 정보]\n이 제품은 특별한 결함이나 하자가 없습니다.\n제품 설명(Description)에 반드시 "하자가 없는 깨끗한 상품입니다." 라는 멘트를 추가해주세요.`
    }

    const aiRes = await analyzeProductWithAI(sessionData.files, geminiKey, finalPrompt)
    if (!aiRes.success || !aiRes.data) {
      throw new Error(aiRes.error || 'AI 카탈로그 분석에 실패했습니다.')
    }

    const aiData = aiRes.data

    // 2. 실측사이즈 텍스트 병합 및 설명문 전처리
    // 실측 사이즈 텍스트 포맷: 가슴(허리)단면 : XX / 총장 : XX
    const sizePartsForDesc: string[] = []
    const sizePartsForSheet: string[] = []
    if (sessionData.sizeData?.width) {
      const wVal = parseFloat(sessionData.sizeData.width)
      const wCm = isNaN(wVal) ? '' : ` (${Math.round(wVal * 2.54)}cm)`
      sizePartsForDesc.push(`가슴(허리)단면 : ${sessionData.sizeData.width}"${wCm}`)
      sizePartsForSheet.push(sessionData.sizeData.width)
    }
    if (sessionData.sizeData?.length) {
      const lVal = parseFloat(sessionData.sizeData.length)
      const lCm = isNaN(lVal) ? '' : ` (${Math.round(lVal * 2.54)}cm)`
      sizePartsForDesc.push(`총장 : ${sessionData.sizeData.length}"${lCm}`)
      sizePartsForSheet.push(sessionData.sizeData.length)
    }
    
    // O열에 들어갈 '실측사이즈'는 '46, 28' 형식
    const sheetRealSizeStr = sizePartsForSheet.join(',')
    
    // 설명(R열)의 상단에 들어갈 실측 텍스트
    const descRealSizeStr = sizePartsForDesc.join(' / ')

    let descKr = aiData.Description_KR || ''
    let descEn = aiData.Description_EN || ''
    let descTh = aiData.Description_TH || ''

    const conditionText = sessionData.condition || '사용감 적음'
    
    // 한국어 설명
    let finalDescription = ''
    if (descRealSizeStr) {
      finalDescription += `${descRealSizeStr}\n`
    }
    finalDescription += `제품상태 : ${conditionText}\n\n`
    finalDescription += `${descKr}\n\n이 제품은 빈티지 제품으로 자연스러운 사용감이나 미세하자는 있을 수 있습니다. 구매에 참고해 주시길 바랍니다.`

    // 영어 설명
    if (descEn) {
      let enCond = conditionText === '새상품' ? 'New' : conditionText === '사용감 없음' ? 'Excellent' : 'Used'
      descEn = `Condition : ${enCond}\n\n${descEn}`
    }

    // 태국어 설명
    if (descTh) {
      let thCond = conditionText === '새상품' ? 'ของใหม่' : conditionText === '사용감 없음' ? 'สภาพดีมาก' : 'สินค้ามือสอง'
      descTh = `สภาพสินค้า : ${thCond}\n\n${descTh}`
    }

    // 3. 파이썬 그래픽 엔진 구동
    let nukkiPath = ''
    let synthesisPath = ''
    
    // 실시간으로 구글 스프레드시트 A열을 확인해 다음 정식 상품 코드를 채번합니다.
    let prodCodeSeed = Date.now().toString().slice(-4) // fallback
    try {
      const logSeed1 = `🔍 [코드시드] 스프레드시트의 실시간 정식 상품 코드를 조회 중...`
      botInstance?.sendMessage(chatId, logSeed1)
      if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) mainWindowWebContents.send('telegram:direct-log', logSeed1)
      
      const realNextCode = await getNextProdCode(googleSpreadsheetUrl)
      if (realNextCode) {
        prodCodeSeed = realNextCode
        const logSeed2 = `🏷️ [코드시드] 이번 상품 정식 코드는 [${prodCodeSeed}] 입니다.`
        botInstance?.sendMessage(chatId, logSeed2)
        if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) mainWindowWebContents.send('telegram:direct-log', logSeed2)
      }
    } catch (codeErr: any) {
      console.error('[Telegram Code Fetch Error]', codeErr)
    }

    const copyrightText = currentTarget === 'dreamstudio' ? 'dreamstudiovtg' : '822shop'

    if (enableRemoveBg || enableSynthesis) {
      const log2 = `🎨 [2단계/3] 파이썬 그래픽 프로세서 가동... 화보 합성 및 배경 누끼 처리 중...`
      botInstance?.sendMessage(chatId, log2)
      if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) mainWindowWebContents.send('telegram:direct-log', log2)
      
      const tempOutputDir = path.join(os.tmpdir(), '822-link-temp')
      try {
        if (!fs.existsSync(tempOutputDir)) {
          fs.mkdirSync(tempOutputDir, { recursive: true })
        }

        const pyRes = await runPythonProcessor(
          sessionData.files,
          tempOutputDir,
          aiData.Brand ? aiData.Brand.toUpperCase() : 'UNKNOWN',
          aiData.ShortName_EN || aiData.Name_EN || aiData.Category || '상의',
          prodCodeSeed,
          copyrightText,
          sessionData.skipNukki || false // 누끼 패스 여부 전달
        )
        if (pyRes.success) {
          nukkiPath = pyRes.nukkiPath || ''
          synthesisPath = pyRes.synthesisPath || ''
        } else {
          console.error('[Direct Python Run Failure]', pyRes.error)
        }
      } catch (pyErr: any) {
        console.error('[Direct Python Run Error]', pyErr)
      }
    }

    // 4. 구글 연동 다이렉트 전송
    const log3 = `🔗 [3단계/3] 구글 드라이브 폴더 적재 및 스프레드시트 대량등록 최종 기입 중...`
    botInstance?.sendMessage(chatId, log3)
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) mainWindowWebContents.send('telegram:direct-log', log3)

    const uploadRes = await uploadProductToGoogle({
      aiTitle: aiData.Name || '빈티지 의류',
      aiBrand: aiData.Brand || 'Unknown',
      aiCategory: aiData.Category || '상의',
      aiSize: aiData.Size || 'Free',
      aiGender: aiData.Gender || '공용',
      aiRealSize: sheetRealSizeStr,
      aiDefect: aiData.Defect_KR || sessionData.defect || '',
      aiCondition: sessionData.condition || '사용감 적음',
      aiDescription: finalDescription,
      aiNameEN: aiData.Name_EN || '',
      aiNameTH: aiData.Name_TH || '',
      aiDescEN: descEn,
      aiDescTH: descTh,
      aiSns: aiData.SNS || '',
      aiHashtags: aiData.Hashtags || '',
      aiStyle: aiData.Style || '',
      aiSeason: aiData.Season || 'sl',
      aiOriginalPrice: String(aiData.OriginalPrice || ''),
      localFilePaths: sessionData.files,
      nukkiFilePath: nukkiPath || undefined,
      synthesisFilePath: synthesisPath || undefined,
      googleDriveUrl,
      googleSpreadsheetUrl,
      predefinedProdCode: prodCodeSeed // 실시간 채번한 정식 코드를 전달!
    }, (progressLog) => {
      // 프론트엔드로도 백그라운드 실시간 콘솔 송부
      if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
        mainWindowWebContents.send('telegram:direct-log', progressLog)
      }
    })

    if (!uploadRes.success) {
      throw new Error(uploadRes.error || '구글 API 업로드 처리 중 치명적 오류 발생')
    }

    // 5. 로컬 원본 이미지 파일들 설정된 폴더로 최종 아카이빙(정리이동)
    const finalProdCode = uploadRes.prodCode || prodCodeSeed
    // 설정에서 저장 경로를 읽어옴 (설정이 없으면 기존 catalog_app 경로를 폴백으로 사용)
    const archiveSettings = readSettings()
    const defaultStaticBase = currentTarget === 'dreamstudio'
      ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static'
      : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static'
    const staticBaseDir = defaultStaticBase
    const imageSaveBase = archiveSettings.localImageSavePath || archiveSettings.localSavePath || path.join(defaultStaticBase, 'images')
    const thumbnailSaveBase = archiveSettings.localThumbnailSavePath || path.join(defaultStaticBase, 'thumbnails')
    const outputDir = path.join(imageSaveBase, finalProdCode)
    const thumbnailDir = thumbnailSaveBase

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true })
      }

      // [안전 복사 방식 적용] fs.renameSync 대신 fs.copyFileSync + fs.unlinkSync 구조
      // 사용자의 요청대로 기존 카탈로그 메이커 방식인 1.jpg ~ 6.jpg 로 이름을 변경하여 저장합니다.
      let thumbSourcePath = ''
      sessionData.files.forEach((filePath, index) => {
        if (fs.existsSync(filePath)) {
          const originalName = path.basename(filePath)
          const fileExt = path.extname(filePath) || '.jpg'
          const destName = `${index + 1}${fileExt}`
          const destPath = path.join(outputDir, destName)
          try {
            fs.copyFileSync(filePath, destPath)
            fs.unlinkSync(filePath) // 감시폴더 빈집 청소
            if (index === 0) thumbSourcePath = destPath // 첫 번째 사진을 임시 썸네일 소스로 지정
          } catch (copyErr) {
            console.error(`[Archive Error] 원본 복사 실패 (${originalName}):`, copyErr)
          }
        }
      })

      // 메인 카탈로그 이미지 (합성본) 복사 -> static/images/Composites/{상품코드}.jpg 로 저장
      // (만약 합성본이 없으면 첫번째 사진을 썸네일 소스로 사용, 있다면 합성본을 썸네일 소스로 사용)
      let mainImagePath = thumbSourcePath
      if (synthesisPath && fs.existsSync(synthesisPath)) {
        const compositesDir = path.join(imageSaveBase, 'Composites')
        if (!fs.existsSync(compositesDir)) {
          fs.mkdirSync(compositesDir, { recursive: true })
        }
        mainImagePath = path.join(compositesDir, `${finalProdCode}.jpg`)
        try {
          fs.copyFileSync(synthesisPath, mainImagePath)
          fs.unlinkSync(synthesisPath)
        } catch (copyErr) {
          console.error('[Archive Error] 합성 복사 실패:', copyErr)
        }
      }

      // 누끼 이미지 복사
      if (nukkiPath && fs.existsSync(nukkiPath)) {
        const destNukki = path.join(outputDir, `main${finalProdCode}${path.extname(nukkiPath)}`)
        try {
          fs.copyFileSync(nukkiPath, destNukki)
          fs.unlinkSync(nukkiPath)
        } catch (copyErr) {
          console.error('[Archive Error] 누끼 복사 실패:', copyErr)
        }
      }

      // Electron nativeImage를 사용해 800x674 썸네일 생성 및 저장 (위에서부터 크롭)
      if (mainImagePath && fs.existsSync(mainImagePath)) {
        try {
          const img = nativeImage.createFromPath(mainImagePath)
          const fullSize = img.getSize()
          
          // 먼저 합성이미지(1080x1920)인 경우 상단 누끼영역(1080x960)만 잘라냅니다.
          let topHalfImg = img
          if (fullSize.width === 1080 && fullSize.height === 1920) {
             topHalfImg = img.crop({ x: 0, y: 0, width: 1080, height: 960 })
          }
          
          const size = topHalfImg.getSize()
          const targetRatio = 800 / 674
          const currentRatio = size.width / size.height
          
          let croppedImg = topHalfImg
          if (currentRatio < targetRatio) {
            // 원본이 더 길쭉함 (세로로 김) -> 윗부분(y=0)부터 크롭 (텍스트 잘림 방지)
            const cropHeight = Math.floor(size.width / targetRatio)
            croppedImg = topHalfImg.crop({ x: 0, y: 0, width: size.width, height: cropHeight })
          } else if (currentRatio > targetRatio) {
            // 원본이 더 넓음 (가로로 김) -> 가운데 크롭
            const cropWidth = Math.floor(size.height * targetRatio)
            const xOffset = Math.floor((size.width - cropWidth) / 2)
            croppedImg = topHalfImg.crop({ x: xOffset, y: 0, width: cropWidth, height: size.height })
          }
          
          // 크롭된 이미지를 최종적으로 800x674로 리사이즈하여 찌그러짐 방지
          const resized = croppedImg.resize({ width: 800, height: 674, quality: 'good' })
          const thumbDest = path.join(thumbnailDir, `${finalProdCode}.jpg`)
          fs.writeFileSync(thumbDest, resized.toJPEG(85))
        } catch (thumbErr) {
          console.error('[Archive Error] 썸네일 생성 실패:', thumbErr)
        }
      }

    } catch (archiveErr: any) {
      console.warn('[Direct Archive Failed]', archiveErr)
      botInstance?.sendMessage(chatId, `⚠️ [경고] 로컬 static 폴더 저장 과정 중 오류가 발생했습니다: ${archiveErr.message}`)
    }

    // 6. 텔레그램으로 최종 대성공 통보!
    botInstance?.sendMessage(chatId, 
      `🎉 [전산 업로드 최종 성공!]\n\n` +
      `📦 제품 코드: ${finalProdCode}\n` +
      `🏷️ 제품 명: "${aiData.Name}"\n` +
      `📏 실측 사이즈: ${descRealSizeStr || '미기입'}\n` +
      `📊 구글 스프레드시트 기록 및 파일 적재가 완료되었습니다!\n\n` +
      `📁 구글 드라이브 폴더 주소:\n${uploadRes.driveFolderPath}`
    )

    // 프론트엔드 새로고침 알림
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
      mainWindowWebContents.send('telegram:direct-success', finalProdCode)
    }

  } catch (err: any) {
    console.error('[Direct Pipeline Error]', err)
    botInstance?.sendMessage(chatId, `❌ [다이렉트 전산 오류] 처리 도중 오류가 발생했습니다:\n${err.message}`)
    if (mainWindowWebContents && !mainWindowWebContents.isDestroyed()) {
      mainWindowWebContents.send('telegram:direct-error', err.message)
    }
  }
}

export function isBotRunning() {
  return botInstance !== null && botInstance.isPolling();
}

export function saveSettings(settings: Record<string, any>) {
  try {
    const existing = readSettings();
    const merged = { ...existing, ...settings };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  } catch (error) {
    console.error('[Telegram] ���� ���� ���� ����:', error);
  }
}

export function getSettings() {
  return readSettings();
}
