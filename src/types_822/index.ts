/**
 * 822 Link - 전역 타입 정의
 * 
 * 왜 별도 파일로 분리했는가:
 * - 프로젝트 전체에서 사용되는 타입을 한 곳에서 관리하여 일관성 유지
 * - Electron IPC 통신 시 타입 안전성을 보장
 */

// ──── 라이선스 인증 관련 ────

/** 로그인한 사용자 정보 */
export interface User {
  id: string
  email: string
  displayName: string
  /** 라이선스 만료일 (ISO 8601 형식) */
  expiresAt: string
}

/** 인증 API 응답 */
export interface AuthResponse {
  success: boolean
  user?: User
  error?: string
}

// ──── 업로드 큐 관련 (Phase 2 준비) ────

/** 이미지 수집 출처 */
export type UploadSource = 'local' | 'telegram' | 'drag-drop'

/** 업로드 상태 */
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed'

/** 업로드 큐 아이템 */
export interface QueueItem {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  source: UploadSource
  status: UploadStatus
  progress: number
  /** 구글 드라이브 Public URL (업로드 완료 후) */
  publicUrl?: string
  errorMessage?: string
  createdAt: string
}

// ──── 상품 데이터 관련 ────

/** 상품 정보 (카탈로그 데이터) */
export interface Product {
  code: string
  brand: string
  name: string
  upperCategory: string
  category: string
  size: string
  price: number
  originalPrice?: number
  condition?: string
  description?: string
  /** 구글 드라이브 이미지 URL 목록 */
  imageUrls: string[]
  thumbnailUrl?: string
  createdAt: string
}

// ──── 설정 관련 ────

/** 앱 설정값 */
export interface AppSettings {
  /** 구글 드라이브 연동 여부 */
  googleConnected: boolean
  /** 텔레그램 봇 토큰 */
  telegramBotToken?: string
  /** 텔레그램 채팅 ID */
  telegramChatId?: string
  /** Gemini API 키 */
  geminiApiKey?: string
  /** 로컬 이미지 감지 폴더 경로 */
  watchFolderPath?: string
  /** 이미지 합성 ON/OFF */
  imageCompositionEnabled: boolean
}

// ──── Electron IPC 타입 ────

/** 렌더러에서 사용 가능한 Electron API 타입 */
export interface ElectronAPI {
  auth: {
    login: (credentials: { email: string; password: string }) => Promise<AuthResponse>
    register: (userData: { email: string; password: string; displayName?: string }) => Promise<AuthResponse>
    logout: () => Promise<{ success: boolean }>
    restoreSession: () => Promise<AuthResponse>
  }
  app: {
    getVersion: () => Promise<string>
  }
  settings: {
    selectFolder: () => Promise<{ success: boolean; path: string | null }>
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<{ success: boolean }>
  }
  google: {
    fetchSpreadsheetList: (spreadsheetUrl: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    getNextProdCode: (spreadsheetUrl: string) => Promise<string>
    uploadProduct: (payload: {
      aiTitle: string
      aiBrand: string
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
      nukkiFilePath?: string
      synthesisFilePath?: string
      googleDriveUrl: string
      googleSpreadsheetUrl: string
      predefinedProdCode?: string
      target?: string
    }) => Promise<{ success: boolean; driveFolderPath?: string; error?: string; prodCode?: string }>
    deleteProductEntirely: (prodCode: string, target?: string) => Promise<{ success: boolean; error?: string }>
  }
  bunjang: {
    openDebugBrowser: () => Promise<{ success: boolean; error?: string }>
    uploadProduct: (payload: {
      imagePaths: string[]
      title: string
      categories: string[]
      price: number
      description: string
      isNew?: boolean
      isExchangeable?: boolean
    }) => Promise<{ success: boolean; error?: string }>
    uploadByCode: (payload: { prodCode: string; spreadsheetUrl: string }) => Promise<{ success: boolean; error?: string }>
    uploadMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string }) => Promise<{ success: boolean; summary?: any; error?: string }>
    deleteMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string }) => Promise<{ success: boolean; summary?: any; error?: string }>
    cancelUpload: () => Promise<void>
    onProgress: (callback: (event: any, data: { prodCode: string, status: string, error?: string }) => void) => () => void
  }
  file: {
    delete: (filePaths: string[]) => Promise<{ success: boolean }>
    trash: (filePath: string) => Promise<{ success: boolean }>
    archive: (payload: {
      prodCode: string
      localFilePaths: string[]
      nukkiFilePath?: string
      synthesisFilePath?: string
      target?: string
    }) => Promise<{ success: boolean }>
  }
  ai: {
    analyze: (payload: {
      imagePaths: string[]
      apiKey: string
      prompt: string
      target?: string
    }) => Promise<{ success: boolean; data?: any; error?: string }>
  }
  fruits: {
    uploadMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string }) => Promise<{ success: boolean; summary?: any; error?: string }>
    deleteMulti: (payload: { prodCodes: string[]; spreadsheetUrl: string }) => Promise<{ success: boolean; summary?: any; error?: string }>
    cancelUpload: () => Promise<void>
  }
  python: {
    processImages: (payload: {
      imagePaths: string[]
      outputDir: string
      brand: string
      title: string
      prodCode: string
      copyright?: string
    }) => Promise<{ success: boolean; nukkiPath?: string; synthesisPath?: string; error?: string }>
  }
  on: (channel: string, callback: (...args: any[]) => void) => void
  removeListener: (channel: string) => void
}

// 전역 Window 타입 확장 (Electron preload에서 주입된 API)
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
