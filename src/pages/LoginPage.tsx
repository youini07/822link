/**
 * 822 Link - 로그인 페이지 (Windows Dialog Style)
 * 
 * 왜 이렇게 설계했는가:
 * - 4~50대 사용자를 위한 친숙한 윈도우 11 표준 다이얼로그 창 느낌
 * - 불필요한 아이콘(Mail, Lock)을 모두 제거하여 텍스트 겹침 등 UI 오류 근본적 차단
 * - 가독성이 높은 화이트/라이트그레이 배경에 윈도우 블루 액센트 적용
 */
import { useState } from 'react'
import { Loader2, AlertCircle, X, Minus, Square } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

interface LoginPageProps {
  onNavigateToRegister: () => void
}

export default function LoginPage({ onNavigateToRegister }: LoginPageProps) {
  const [email, setEmail] = useState('test@822link.com')
  const [password, setPassword] = useState('test1234')
  const [rememberMe, setRememberMe] = useState(true)

  const { login, isLoading, error, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    await login(email.trim(), password.trim())
  }

  return (
    <div className="h-full w-full flex items-center justify-center bg-slate-900 relative overflow-hidden">
      {/* 타이틀바 드래그 영역 (전체 화면 드래그) */}
      <div className="absolute top-0 left-0 right-0 h-9 drag-region" />

      {/* 윈도우 다이얼로그 스타일 카드 */}
      <div className="relative z-10 w-full max-w-[420px] win-dialog-card flex flex-col overflow-hidden animate-fade-in no-drag shadow-2xl">
        
        {/* 가짜 타이틀바 (Windows 느낌) */}
        <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200 drag-region">
          <div className="flex items-center gap-2">
            {/* 작은 앱 아이콘 */}
            <div className="w-4 h-4 bg-[#0078d4] flex items-center justify-center rounded-sm">
              <span className="text-[10px] font-bold text-white leading-none">8</span>
            </div>
            <span className="text-xs text-gray-700 font-medium">로그인 - 822 Link</span>
          </div>
          <div className="flex items-center gap-2 no-drag opacity-50">
            <Minus size={14} className="text-gray-600" />
            <Square size={12} className="text-gray-600" />
            <X size={16} className="text-gray-600" />
          </div>
        </div>

        {/* 본문 콘텐츠 */}
        <div className="p-8 space-y-6 bg-white">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-[#202020]">822 Link에 오신 것을 환영합니다</h1>
            <p className="text-xs text-[#616161]">멀티 플랫폼 대량 등록 데이터 추출기</p>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-[#fdf2f2] border border-[#f87171] rounded text-[#e81123] text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1 font-medium">{error}</span>
              <button onClick={clearError} className="opacity-60 hover:opacity-100 p-0.5">
                <X size={14} />
              </button>
            </div>
          )}

          {/* 로그인 폼 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 이메일 입력 (아이콘 완전 제거, px-3.5 패딩 적용) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">
                아이디 (이메일)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                disabled={isLoading}
                required
                className="w-full px-3.5 py-2 border border-[#d1d1d1] rounded bg-white text-sm text-[#202020] transition-colors focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
              />
            </div>

            {/* 비밀번호 입력 (아이콘 완전 제거) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                disabled={isLoading}
                required
                className="w-full px-3.5 py-2 border border-[#d1d1d1] rounded bg-white text-sm text-[#202020] transition-colors focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
              />
            </div>

            {/* 자동 로그인 */}
            <div className="flex items-center gap-2 pt-1 pb-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-[#0078d4] focus:ring-[#0078d4] cursor-pointer"
              />
              <label htmlFor="rememberMe" className="text-xs text-[#616161] cursor-pointer select-none">
                자동 로그인 유지
              </label>
            </div>

            {/* 로그인 버튼 (윈도우 블루 테마) */}
            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password.trim()}
              className="w-full py-2.5 bg-[#0078d4] hover:bg-[#005a9e] text-white text-sm font-semibold rounded transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {isLoading ? '인증 확인 중...' : '로그인'}
            </button>
          </form>

          {/* 계정 생성 네비게이션 */}
          <div className="flex flex-col items-center gap-2 pt-4 border-t border-gray-100 text-xs">
            <div className="flex items-center gap-2 text-[#616161]">
              <span>아직 라이선스 계정이 없으신가요?</span>
              <button
                onClick={onNavigateToRegister}
                className="font-semibold text-[#0078d4] hover:underline focus:outline-none"
              >
                계정 생성하기
              </button>
            </div>
            <div className="text-[#a1a1a1]">
              문의 카카오톡 채널: <span className="font-medium text-[#616161]">822 Link</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* 배경 버전 정보 */}
      <p className="absolute bottom-4 text-xs text-[#a1a1a1]">
        v0.1.0 — 822 Link © 2026
      </p>
    </div>
  )
}
