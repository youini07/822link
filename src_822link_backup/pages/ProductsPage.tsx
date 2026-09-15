import { useEffect, useState } from 'react'
import { Package, Settings, ExternalLink, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

export default function ProductsPage() {
  const [sheetUrl, setSheetUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { uploadTarget } = useUIStore()

  useEffect(() => {
    const fetchUrl = async () => {
      try {
        if (window.electronAPI?.settings) {
          const key = uploadTarget === 'dreamstudio' ? 'googleSpreadsheetUrl_dreamstudio' : 'googleSpreadsheetUrl_822shop'
          const url = await window.electronAPI.settings.get(key)
          setSheetUrl(url || null)
        }
      } catch (err) {
        console.error('스프레드시트 URL을 가져오는데 실패했습니다', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchUrl()
  }, [uploadTarget])

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#f3f3f3]">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 size={18} className="animate-spin" />
          <span>스프레드시트 정보를 불러오는 중...</span>
        </div>
      </div>
    )
  }

  // URL이 없는 경우 안내 화면
  if (!sheetUrl) {
    return (
      <div className="h-full flex flex-col p-8 bg-[#f3f3f3]">
        <h2 className="text-xl font-bold text-gray-800">상품 관리</h2>
        <p className="text-sm mt-1 mb-8 text-gray-500">
          AI가 분석한 상품 데이터를 실시간으로 조회하고 편집합니다.
        </p>
        <div className="flex-1 flex flex-col items-center justify-center bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="text-center space-y-4 animate-fade-in p-8">
            <div className="mx-auto w-16 h-16 bg-blue-50 text-[#0078d4] rounded-full flex items-center justify-center mb-4">
              <Package size={32} />
            </div>
            <h3 className="text-lg font-bold text-gray-800">구글 스프레드시트가 연결되지 않았습니다</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
              상품 정보를 실시간으로 관리하려면 먼저 설정 페이지에서 데이터베이스로 사용할 <strong>구글 스프레드시트 주소</strong>를 연동해 주세요.
            </p>
            <div className="pt-4">
              <Link 
                to="/settings"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                <Settings size={16} />
                <span>설정으로 이동하여 URL 입력하기</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 구글 스프레드시트 Iframe 렌더링
  return (
    <div className="h-full flex flex-col bg-white">
      {/* 커스텀 헤더바 (옵션) */}
      <div className="px-5 py-3 border-b border-gray-200 bg-[#f9f9f9] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-[#0078d4]" />
          <h2 className="text-sm font-bold text-gray-800">상품 관리 (Google Sheets)</h2>
        </div>
        <a 
          href={sheetUrl} 
          target="_blank" 
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-[#0078d4] transition-colors bg-white border border-gray-200 px-3 py-1.5 rounded-md hover:bg-blue-50"
          title="새 창(브라우저)에서 열기"
        >
          <ExternalLink size={14} />
          <span>외부 브라우저에서 열기</span>
        </a>
      </div>
      
      {/* Iframe 컨테이너 */}
      <div className="flex-1 w-full bg-[#f3f3f3] relative">
        <iframe 
          src={sheetUrl} 
          className="absolute inset-0 w-full h-full border-none"
          title="Google Spreadsheet Products DB"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
