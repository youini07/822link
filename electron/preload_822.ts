/**
 * 822 Link - Preload 스크립트 (IPC 브릿지)
 * 
 * 왜 이렇게 설계했는가:
 * - contextBridge를 사용하여 렌더러 프로세스에 안전한 API만 노출
 * - 렌더러에서 직접 Node.js API에 접근하는 것을 차단 (보안 강화)
 * - 모든 메인 프로세스 통신은 이 브릿지를 통해서만 수행
 */
import { contextBridge, ipcRenderer } from 'electron'

// 렌더러 프로세스에서 window.electronAPI로 접근 가능한 API 정의
contextBridge.exposeInMainWorld('electronAPI', {
  // ──── 인증 관련 ────
  auth: {
    /** 라이선스 로그인 */
    login: (credentials: { email: string; password: string }) =>
      ipcRenderer.invoke('auth:login', credentials),
    /** 계정 생성 (회원가입) */
    register: (userData: { email: string; password: string; displayName?: string }) =>
      ipcRenderer.invoke('auth:register', userData),
    /** 로그아웃 */
    logout: () => ipcRenderer.invoke('auth:logout'),
    /** 저장된 세션 복구 (자동 로그인) */
    restoreSession: () => ipcRenderer.invoke('auth:restore-session'),
  },

  // ──── 앱 정보 ────
  app: {
    /** 앱 버전 조회 */
    getVersion: () => ipcRenderer.invoke('app:get-version'),
  },

  // ──── 설정 관련 (Phase 2에서 확장) ────
  settings: {
    /** 감시 폴더 선택 다이얼로그 호출 */
    selectFolder: () => ipcRenderer.invoke('settings:select-folder'),
    /** 설정값 조회 */
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    /** 설정값 저장 */
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  },

  // ──── Google 클라우드 업로드 관련 ────
  google: {
    /** 스프레드시트 다중업로드용 목록 불러오기 */
    fetchSpreadsheetList: (spreadsheetUrl: string) => ipcRenderer.invoke('google:fetchSpreadsheetList', spreadsheetUrl),
    /** 시트에서 다음 상품코드 채번 */
    getNextProdCode: (spreadsheetUrl: string) => ipcRenderer.invoke('google:get-next-prod-code', spreadsheetUrl),
    /** 제품 정보 및 이미지 드라이브/시트 실제 업로드 */
    uploadProduct: (payload: {
      predefinedProdCode?: string
      aiTitle: string
      aiCategory: string
      aiSize: string
      aiGender?: string
      aiRealSize?: string
      aiDefect?: string
      aiCondition?: string
      aiDescription: string
      aiNameEN?: string
      aiNameTH?: string
      aiDescEN?: string
      aiDescTH?: string
      aiSns: string
      aiHashtags: string
      aiStyle?: string
      aiSeason?: string
      aiOriginalPrice?: string
      localFilePaths: string[]
      googleDriveUrl: string
      googleSpreadsheetUrl: string
      target?: string
    }) => ipcRenderer.invoke('google:upload-product', payload),
    /** 제품 완벽 삭제 (시트 행 + 드라이브 폴더 + 로컬 파일 3종) */
    deleteProductEntirely: (prodCode: string, target?: string) => ipcRenderer.invoke('google:delete-product-entirely', { prodCode, target }),
      uploadPurchasedImages: (targetDriveUrl: string) => ipcRenderer.invoke('google:upload-purchased-images', targetDriveUrl),
  },

  // ──── 번개장터 자동화 관련 ────
  bunjang: {
    openDebugBrowser: () => ipcRenderer.invoke('bunjang:openDebugBrowser'),
    uploadProduct: (payload: {
      imagePaths: string[]
      title: string
      categories: string[]
      price: number
      description: string
      isNew?: boolean
      isExchangeable?: boolean
    }) => ipcRenderer.invoke('bunjang:upload', payload),
    uploadByCode: (payload: { prodCode: string; spreadsheetUrl: string }) => ipcRenderer.invoke('bunjang:upload-by-code', payload),
    uploadMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) => ipcRenderer.invoke('bunjang:uploadMulti', payload),
    deleteMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) => ipcRenderer.invoke('bunjang:deleteMulti', payload),
    cancelUpload: () => ipcRenderer.invoke('bunjang:cancelUpload'),
    updatePriceMulti: (payload: { prodCodes: string[]; newPrices: Record<string, string>; spreadsheetUrl: string; uploadTarget?: string }) => ipcRenderer.invoke('bunjang:updatePriceMulti', payload),
    autoUp: () => ipcRenderer.invoke('bunjang:autoUp'),
    onProgress: (callback: (event: any, data: { prodCode: string, status: string, error?: string }) => void) => {
      ipcRenderer.on('bunjang:progress', callback)
      return () => ipcRenderer.removeListener('bunjang:progress', callback)
    }
  },

  // ──── 로컬 파일 제어 ────
  file: {
    /** 임시 로컬 파일 삭제 (더이상 안씀, archive로 대체) */
    delete: (filePaths: string[]) => ipcRenderer.invoke('file:delete', filePaths),
    /** 단일 파일 휴지통으로 이동 */
    trash: (filePath: string) => ipcRenderer.invoke('file:trash', filePath),
    /** ai_output 폴더로 최종 결과물 아카이빙 */
    archive: (payload: {
      prodCode: string
      localFilePaths: string[]
      nukkiFilePath?: string
      synthesisFilePath?: string
      target?: string
    }) => ipcRenderer.invoke('file:archive', payload),
  },

  // ──── AI 분석 관련 ────
  ai: {
    /** 제품 이미지 분석 요청 */
    analyze: (payload: {
      imagePaths: string[]
      apiKey: string
      prompt: string
      target?: string
    }) => ipcRenderer.invoke('ai:analyze', payload),
  },

  // ──── 후르츠패밀리 (모바일) ────
  fruits: {
    uploadMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) =>
      ipcRenderer.invoke('fruits:uploadMulti', payload),
    deleteMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) =>
      ipcRenderer.invoke('fruits:deleteMulti', payload),
    cancelUpload: () => ipcRenderer.invoke('fruits:cancelUpload'),
  },

  // ──── 파이썬 프로세서 (누끼/합성) ────
  batch: {
    runAutoSheet: () => ipcRenderer.invoke('batch:run-autosheet'),
    runDataReflect: () => ipcRenderer.invoke('batch:run-data-reflect'),
  },

  python: {
    processImages: (payload: {
      imagePaths: string[]
      outputDir: string
      brand: string
      title: string
      prodCode: string
      copyright?: string
      skipNukki?: boolean
    }) => ipcRenderer.invoke('python:process-images', payload),
  },

  // ──── 이벤트 리스너 (메인 → 렌더러 단방향 알림) ────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'upload:progress',     // 업로드 진행률 알림
      'upload:complete',     // 업로드 완료 알림
      'upload:error',        // 업로드 오류 알림
      'telegram:new-image',  // 텔레그램 새 이미지 수신 알림
      'license:expiring',    // 라이선스 만료 임박 알림
      'file:initial',        // 초기 파일 스캔 결과 전송
      'file:added',          // 새 파일 감지
      'file:removed',        // 파일 삭제 감지
      'file:changed',        // 파일 변경 감지
      'google:upload-progress', // 실제 구글 클라우드 업로드 로그 수신
      'telegram:auto-start', // 텔레그램 자동 시작 트리거
      'telegram:size-update', // 텔레그램 실측사이즈 수신
      'telegram:defect-update', // 텔레그램 하자 수신
      'telegram:condition-update', // 텔레그램 상품 상태 수신
      'telegram:direct-log', // 텔레그램 다이렉트 전산 로그
      'telegram:direct-success', // 텔레그램 다이렉트 전산 성공
      'telegram:direct-error',
      'batch:output', // 텔레그램 다이렉트 전산 실패
    ]
    // 보안: 허용된 채널만 수신 가능
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  // 이벤트 리스너 해제
  removeListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },
})
