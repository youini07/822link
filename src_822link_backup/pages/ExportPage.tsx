/**
 * 엑셀 내보내기 페이지 (Phase 4에서 구현)
 */
import { FileSpreadsheet } from 'lucide-react'

export default function ExportPage() {
  return (
    <div className="h-full flex flex-col p-8">
      <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>엑셀 내보내기</h2>
      <p className="text-sm mt-1 mb-8" style={{ color: 'var(--text-secondary)' }}>
        플랫폼별 대량 등록용 엑셀 파일을 생성합니다.
      </p>
      <div className="flex-1 flex items-center justify-center glass-card">
        <div className="text-center space-y-3 animate-fade-in">
          <FileSpreadsheet size={48} style={{ color: 'var(--text-muted)' }} className="mx-auto" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Phase 4에서 구현될 예정입니다.</p>
        </div>
      </div>
    </div>
  )
}
