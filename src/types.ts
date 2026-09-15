export interface ScheduledMessage {
  id: string;
  timeOffsetMinutes: number;
  message: string;
}

export interface BandSetting {
  id: string; // Unique ID for the band config
  name: string; // Display name
  deadlineType: 'TIME' | 'OBSERVER'; // 일시마감 vs 순차마감
  observerOrder?: 'CHRONO' | 'REVERSE'; // 등록순 vs 역순
  adminId?: string; // 관리자 아이디
  myNickname?: string; // 해당 밴드에서의 내 닉네임 (동점 판별용)
  bankAccount?: string; // 정산용 계좌정보
  newBidLimitMinutes?: number; // 신규 입찰 제한 시간 (분)
  settlementMessage?: string;
  defaultCloseTime?: string;
  initialStartingBid?: string;
  googleSpreadsheetUrl?: string; // 구글 시트 URL
  bandUrl?: string; // 밴드 고유 URL (예: https://band.us/band/1234567)
  scheduledMessages?: ScheduledMessage[];
  maxKeepDays?: number; // 최대 킵 기간 (일 단위)
}

export interface TaskResult {
  url: string;
  postTitle: string;
  thumbnailUrl?: string; // 썸네일 이미지
  thumbnailPath?: string; // 로컬 썸네일 파일 경로 (정산 채팅용)
  winnerName: string;
  winningBid: number;
  processedStatus?: 'KEEP' | 'SHIPPED'; // 처리 상태 (킵됨 / 배송됨)
  isPaid?: boolean; // 입금 확인 상태 (DB 저장용)
}

export interface AdminTask {
  id: string;
  urls: string[]; // 타겟 게시물 URL 배열 (시작~끝)
  bandSettingId?: string; // 참조하는 밴드 설정 (선택적)
  targetTime?: number; 
  status: 'WAITING' | 'CLOSING' | 'SUCCESS' | 'FAILED' | 'ABORTED';
  resultMsg?: string;
  results?: TaskResult[]; // 각 게시물별 낙찰 결과
  autoSendChat?: boolean;
  autoChatSent?: boolean;
  sessionChecked?: boolean; // 5분 전 세션 검증 여부
  restoreCommentPermission?: boolean; // 댓글 권한 원상 복구 여부
  sentScheduledMessages?: string[]; // 이미 발송된 예약 메시지 ID 목록
}

export interface SettlementItem {
  postTitle: string;
  winningBid: number;
  url: string;
}

export interface Settlement {
  winnerName: string;
  items: SettlementItem[];
  totalAmount: number;
}

export interface TimeSyncStatus {
  method: 'None' | 'Server Header' | 'Navyism' | 'NTP';
  offset: number;
  ping: number;
  lastSynced: number;
}

export interface PurchaseItem {
  id: string; // 고유 ID
  postTitle: string;
  thumbnailUrl?: string; // 썸네일 이미지
  winningBid: number; // 곱하기 전의 원본 입찰가 (예: 15)
  dateAdded: number; // 타임스탬프
  url: string;
  status?: 'KEEP' | 'SHIPPED'; // 배송 상태
}

export interface CatalogSettings {
  telegramToken: string;       // 텔레그램 봇 토큰
  geminiApiKey: string;        // Gemini AI API Key
  localImagePath: string;      // 로컬 이미지 저장 폴더 경로
  googleDriveUrl: string;      // 구글 드라이브 폴더 URL
  googleSpreadsheetUrl: string; // 구글 스프레드시트 URL
  defaultStartingBid?: string; // 기본 경매시작가격 (옵션)
}

export interface AuthResponse {
  token: string;
  role: 'admin' | 'user';
  expiresAt?: string;
  ai_analysis_enabled?: boolean;
  upload_bot_enabled?: boolean;
  auto_settlement_enabled?: boolean;
  gemini_api_key?: string;
}

export interface User {
  id: number;
  username: string;
  role: string;
  license_key: string;
  expires_at: string;
  created_at: string;
  ai_analysis_enabled?: boolean;
  upload_bot_enabled?: boolean;
  auto_settlement_enabled?: boolean;
  ai_usage_count?: number;
}

export interface UploadSettings {
  bandUrl: string;
  googleSpreadsheetUrl: string;
  delaySeconds: number;
}

export interface SpreadsheetRow {
  rowIndex: number;
  productCode: string;
  productName: string;
  description: string;
  imageLinks: string[];
  startingBid?: string;
  finalPrice?: string;
  winnerName?: string;
  status?: string;
  location?: string; // E열: 위치 (밴드등록)
  localThumbnailBase64?: string; // 로컬 이미지 썸네일 (Base64)
  registrationDate?: string; // 등록일
  bunjangPid?: string; // AD열: 번개장터 업로드 현황 (PID)
  fruitsPid?: string; // AF열: 후르츠패밀리 업로드 현황 (PID)
  joongnaPid?: string; // AG열: 중고나라 업로드 현황 (PID)
}

export interface UploadQueueItem {
  id: string; // 고유 ID (생성 시각 등)
  prodCode: string; // 상품 코드
  rowIndex?: number; // 스프레드시트 행 번호 (참고용)
  scheduledTime: number; // 타임스탬프 (업로드 예약 시간)
  status: 'PENDING' | 'UPLOADING' | 'DONE' | 'ERROR';
  createdAt: number;
}

export interface Member {
  nickname: string; // 닉네임 (고유값으로 사용)
  realName?: string; // 실명
  phone?: string; // 연락처
  address?: string; // 배송지 주소
  memo?: string; // 특이사항 메모
  shippingReservation?: boolean; // 배송 예약 상태
  items: PurchaseItem[];
}

declare global {
  interface Window {
    electron: any;
  }
}