/**
 * 822 Link - 계정 생성 (회원가입) 페이지 (Windows Dialog Style)
 * 
 * 왜 이렇게 설계했는가:
 * - 4~50대 사용자를 위한 친숙한 윈도우 11 표준 다이얼로그 창 느낌
 * - 불필요한 아이콘을 모두 제거하여 텍스트 겹침 등 UI 오류 근본적 차단
 * - 가독성이 높은 화이트/라이트그레이 배경에 윈도우 블루 액센트 적용
 */
import { useState } from 'react'
import { Loader2, AlertCircle, X, Minus, Square } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

interface RegisterPageProps {
  onNavigateToLogin: () => void
}

export default function RegisterPage({ onNavigateToLogin }: RegisterPageProps) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const { register, isLoading, error: authError, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    clearError()

    if (!email.trim() || !password.trim()) {
      setValidationError('이메일과 비밀번호를 모두 입력해 주세요.')
      return
    }
    if (password.length < 6) {
      setValidationError('비밀번호는 최소 6자 이상이어야 합니다.')
      return
    }
    if (password !== confirmPassword) {
      setValidationError('비밀번호가 서로 일치하지 않습니다.')
      return
    }

    const success = await register(email.trim(), password.trim(), displayName.trim())
    if (success) {
      // 자동 로그인 처리 됨
    }
  }

  const displayError = validationError || authError

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#f3f3f3] relative overflow-hidden">
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
            <span className="text-xs text-gray-700 font-medium">계정 생성 - 822 Link</span>
          </div>
          <div className="flex items-center gap-2 no-drag opacity-50">
            <Minus size={14} className="text-gray-600" />
            <Square size={12} className="text-gray-600" />
            <X size={16} className="text-gray-600" />
          </div>
        </div>

        {/* 본문 콘텐츠 */}
        <div className="p-8 space-y-5 bg-white">
          <div className="text-center space-y-1 relative">
            {/* 뒤로가기 대신 로그인창으로 돌아가는 텍스트 버튼을 하단에 배치할 것이므로 여기선 타이틀만 둠 */}
            <h1 className="text-xl font-bold text-[#202020]">계정 생성하기</h1>
            <p className="text-xs text-[#616161]">가입 시 7일 무료 체험 라이선스 자동 활성화</p>
          </div>

          {/* 에러 메시지 */}
          {displayError && (
            <div className="flex items-center gap-2 p-3 bg-[#fdf2f2] border border-[#f87171] rounded text-[#e81123] text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1 font-medium">{displayError}</span>
              <button onClick={() => { setValidationError(null); clearError(); }} className="opacity-60 hover:opacity-100 p-0.5">
                <X size={14} />
              </button>
            </div>
          )}

          {/* 회원가입 폼 */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* 사용자 이름 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">사용자 이름 (닉네임)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="홍길동"
                disabled={isLoading}
                className="w-full px-3.5 py-2 border border-[#d1d1d1] rounded bg-white text-sm text-[#202020] transition-colors focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
              />
            </div>

            {/* 이메일 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">이메일 주소 (아이디)</label>
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

            {/* 비밀번호 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">비밀번호 (6자 이상)</label>
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

            {/* 비밀번호 확인 */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#616161]">비밀번호 확인</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="비밀번호를 다시 입력하세요"
                disabled={isLoading}
                required
                className="w-full px-3.5 py-2 border border-[#d1d1d1] rounded bg-white text-sm text-[#202020] transition-colors focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
              />
            </div>

            {/* 가입 완료 버튼 */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading || !email.trim() || !password.trim() || !confirmPassword.trim()}
                className="w-full py-2.5 bg-[#0078d4] hover:bg-[#005a9e] text-white text-sm font-semibold rounded transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                {isLoading ? '계정 생성 중...' : '계정 생성 & 시작하기'}
              </button>
            </div>
          </form>

          {/* 로그인 화면 복귀 네비게이션 */}
          <div className="flex flex-col items-center gap-2 pt-3 border-t border-gray-100 text-xs">
            <div className="flex items-center gap-2 text-[#616161]">
              <span>이미 계정이 있으신가요?</span>
              <button
                onClick={onNavigateToLogin}
                className="font-semibold text-[#0078d4] hover:underline focus:outline-none"
              >
                로그인하기
              </button>
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
