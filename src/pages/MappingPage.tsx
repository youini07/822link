/**
 * 카테고리 매핑 페이지 (Phase 4에서 구현)
 */
import { Grid3X3 } from 'lucide-react'

export default function MappingPage() {
  return (
    <div className="h-full flex flex-col p-8">
      <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>카테고리 매핑</h2>
      <p className="text-sm mt-1 mb-8" style={{ color: 'var(--text-secondary)' }}>
        내 카테고리와 플랫폼 카테고리 코드를 1:1로 매핑합니다.
      </p>
      <div className="flex-1 flex items-center justify-center glass-card">
        <div className="text-center space-y-3 animate-fade-in">
          <Grid3X3 size={48} style={{ color: 'var(--text-muted)' }} className="mx-auto" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phase 4에서 구현될 예정입니다.</p>
        </div>
      </div>
    </div>
  )
}
