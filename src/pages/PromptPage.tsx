/**
 * AI 프롬프트 설정 페이지 (Phase 3에서 구현)
 * - 상품명/설명 생성 프롬프트 편집기
 * - 태그 치환 시스템
 * - 실시간 테스트 미리보기
 */
import { Sparkles } from 'lucide-react'

export default function PromptPage() {
  return (
    <div className="h-full flex flex-col p-8">
      <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>AI 프롬프트 설정</h2>
      <p className="text-sm mt-1 mb-8" style={{ color: 'var(--text-secondary)' }}>
        AI가 상품 설명을 생성할 때 사용하는 프롬프트를 커스텀합니다.
      </p>
      <div className="flex-1 flex items-center justify-center glass-card">
        <div className="text-center space-y-3 animate-fade-in">
          <Sparkles size={48} style={{ color: 'var(--text-muted)' }} className="mx-auto" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phase 3에서 구현될 예정입니다.</p>
        </div>
      </div>
    </div>
  )
}
