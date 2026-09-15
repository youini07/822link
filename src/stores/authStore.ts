/**
 * 822 Link - Zustand 인증 상태 관리 스토어
 * 
 * 왜 Zustand을 선택했는가:
 * - Context API보다 리렌더링 성능이 우수하고 보일러플레이트가 적음
 * - 컴포넌트 외부에서도 상태에 접근 가능 (IPC 이벤트 핸들러 등)
 * - devtools 지원으로 디버깅 용이
 */
import { create } from 'zustand'
import type { User } from '../types'

interface AuthState {
  /** 현재 로그인한 사용자 정보 (null이면 미인증 상태) */
  user: User | null
  /** 로그인 처리 중 여부 (로딩 스피너 표시용) */
  isLoading: boolean
  /** 세션 복구 시도 중 여부 (앱 시작 시 자동 로그인 체크) */
  isRestoring: boolean
  /** 에러 메시지 */
  error: string | null

  // ──── 액션 ────
  
  /** 라이선스 로그인 */
  login: (email: string, password: string) => Promise<boolean>
  /** 계정 생성 (회원가입) */
  register: (email: string, password: string, displayName?: string) => Promise<boolean>
  /** 로그아웃 */
  logout: () => Promise<void>
  /** 저장된 세션 복구 (자동 로그인) */
  restoreSession: () => Promise<void>
  /** 에러 메시지 초기화 */
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isRestoring: true, // 앱 시작 시 세션 복구를 시도하므로 초기값 true
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await window.electronAPI.auth.login({ email, password })
      if (response.success && response.user) {
        set({ user: response.user, isLoading: false })
        return true
      } else {
        set({ error: response.error || '로그인에 실패했습니다.', isLoading: false })
        return false
      }
    } catch {
      set({ error: '서버 연결에 실패했습니다.', isLoading: false })
      return false
    }
  },

  register: async (email: string, password: string, displayName?: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await window.electronAPI.auth.register({ email, password, displayName })
      if (response.success && response.user) {
        set({ user: response.user, isLoading: false })
        return true
      } else {
        set({ error: response.error || '계정 생성에 실패했습니다.', isLoading: false })
        return false
      }
    } catch {
      set({ error: '서버 연결에 실패했습니다.', isLoading: false })
      return false
    }
  },

  logout: async () => {
    await window.electronAPI.auth.logout()
    set({ user: null, error: null })
  },

  restoreSession: async () => {
    set({ isRestoring: true })
    try {
      const response = await window.electronAPI.auth.restoreSession()
      if (response.success && response.user) {
        set({ user: response.user, isRestoring: false })
      } else {
        set({ isRestoring: false })
      }
    } catch {
      set({ isRestoring: false })
    }
  },

  clearError: () => set({ error: null }),
}))
