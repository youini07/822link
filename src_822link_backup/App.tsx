/**
 * 822 Link - 메인 앱 컴포넌트 (Windows 11 Explorer Layout)
 * 
 * 왜 이렇게 설계했는가:
 * - 4~50대 사용자를 위한 가장 친숙한 '윈도우 11 폴더 탐색기' 레이아웃 적용
 * - 상단 탭바, 주소창, 툴바를 배치하여 실제 탐색기를 사용하는 듯한 몰입감 제공
 * - HashRouter 사용: Electron에서 file:// 프로토콜과 호환성을 위해
 * - 사용자의 시력을 고려한 화면 확대/축소(zoom) 기능 지원
 */
import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useUIStore } from './stores/uiStore'
import { useFileStore } from './stores/fileStore'
import Sidebar from './components/layout/Sidebar'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import PromptPage from './pages/PromptPage'
import MappingPage from './pages/MappingPage'
import ExportPage from './pages/ExportPage'
import SettingsPage from './pages/SettingsPage'
import BunjangManagerPage from './pages/BunjangManagerPage'
import { 
  Loader2, 
  Minus, 
  Square, 
  X, 
  Plus, 
  ArrowLeft, 
  ArrowRight, 
  ArrowUp, 
  RotateCw, 
  Search,
  FilePlus,
  Scissors,
  Copy,
  Trash2,
  ListFilter,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Check
} from 'lucide-react'

// 상단 헤더 컴포넌트 (윈도우 탐색기 탭, 주소창, 툴바)
function ExplorerHeader() {
  const location = useLocation()
  const { 
    zoomLevel, 
    setZoomLevel,
    viewMode,
    setViewMode,
    sortKey,
    sortOrder,
    setSort,
    toggleSort
  } = useUIStore()

  const [isSortOpen, setIsSortOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  
  // 현재 경로에 따른 주소창 텍스트 매핑
  const getPathName = () => {
    switch (location.pathname) {
      case '/': return '대시보드'
      case '/products': return '상품 관리'
      case '/prompts': return 'AI 프롬프트'
      case '/mapping': return '카테고리 매핑'
      case '/export': return '엑셀 내보내기'
      case '/settings': return '설정'
      default: return '홈'
    }
  }

  // 보기 모드 한글 텍스트 매핑
  const getViewModeText = (mode: string) => {
    switch (mode) {
      case 'small-icon': return '작은 아이콘'
      case 'details': return '자세히'
      default: return '보기'
    }
  }

  return (
    <div className="flex flex-col bg-[#f3f3f3] border-b border-gray-200 drag-region select-none relative z-50">
      {/* 1단: 탭 바 및 윈도우 컨트롤 공간 확보 */}
      <div className="flex items-center justify-between pl-4 pr-[140px] h-10">
        <div className="flex items-center mt-3 no-drag">
          {/* 활성화된 탭 */}
          <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-t-md border border-b-0 border-gray-200 min-w-[220px] max-w-[280px]">
            <div className="w-4 h-4 bg-[#0078d4] flex items-center justify-center rounded-sm">
              <span className="text-[10px] font-bold text-white leading-none">8</span>
            </div>
            <span className="text-xs text-gray-800 font-medium truncate flex-1">
              822 Link - {getPathName()}
            </span>
            <X size={14} className="text-gray-500 hover:text-black cursor-pointer" />
          </div>
          {/* 새 탭 버튼 */}
          <button className="ml-2 p-2 hover:bg-[#e5e5e5] rounded text-gray-600 transition-colors">
            <Plus size={18} />
          </button>
        </div>
        {/* 우측 윈도우 컨트롤은 Electron의 titleBarOverlay(네이티브)가 렌더링되므로 이 공간을 비워둡니다 */}
      </div>

      {/* 2단: 네비게이션 & 주소창 */}
      <div className="flex items-center gap-3 px-3 py-2 no-drag bg-[#f3f3f3]">
        <div className="flex items-center gap-1.5 text-gray-500">
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors"><ArrowLeft size={20} /></button>
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors"><ArrowRight size={20} /></button>
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors"><ArrowUp size={20} /></button>
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors"><RotateCw size={18} /></button>
        </div>
        {/* 주소창 */}
        <div className="flex-1 flex items-center bg-white border border-gray-300 rounded-md px-3 py-1.5 mx-2 shadow-sm">
          <span className="text-xs text-gray-600 font-medium cursor-text flex-1">
            내 PC &gt; 822 Link &gt; {getPathName()}
          </span>
        </div>
        {/* 검색창 */}
        <div className="w-72 flex items-center bg-white border border-gray-300 rounded-md px-3 py-1.5 mr-2 shadow-sm">
          <input type="text" placeholder="검색" className="flex-1 text-xs outline-none" />
          <Search size={16} className="text-gray-500" />
        </div>
      </div>

      {/* 3단: 툴바 & 화면 배율 조절 */}
      <div className="flex items-center justify-between px-4 py-2 no-drag bg-[#f3f3f3] border-t border-white/50 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#e5e5e5] rounded transition-colors">
            <FilePlus size={18} className="text-[#0078d4]" />
            <span>새로 만들기</span>
          </button>
          <div className="w-[1px] h-5 bg-gray-300 mx-2" />
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors" title="잘라내기"><Scissors size={18} /></button>
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors" title="복사"><Copy size={18} /></button>
          <button className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors" title="삭제"><Trash2 size={18} /></button>
          <div className="w-[1px] h-5 bg-gray-300 mx-2" />
          
          {/* 윈도우 스타일 정렬 드롭다운 컨테이너 */}
          <div className="relative">
            <button 
              onClick={() => { setIsSortOpen(!isSortOpen); setIsViewOpen(false); }}
              className={`flex items-center gap-2 px-3 py-1.5 hover:bg-[#e5e5e5] rounded transition-colors ${isSortOpen ? 'bg-[#e5e5e5]' : ''}`}
            >
              <ListFilter size={18} />
              <span>정렬</span>
            </button>

            {/* 정렬 메뉴 팝업 */}
            {isSortOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSortOpen(false)} />
                <div className="absolute left-0 mt-1 w-44 bg-white border border-gray-300 rounded shadow-lg py-1 z-50 animate-fade-in text-[13px]">
                  <button 
                    onClick={() => { toggleSort('name'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>이름</span>
                    {sortKey === 'name' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <button 
                    onClick={() => { toggleSort('date'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>수정한 날짜</span>
                    {sortKey === 'date' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <button 
                    onClick={() => { toggleSort('type'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>유형</span>
                    {sortKey === 'type' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <button 
                    onClick={() => { toggleSort('size'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>크기</span>
                    {sortKey === 'size' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <div className="h-[1px] bg-gray-200 my-1" />
                  <button 
                    onClick={() => { setSort(sortKey, 'asc'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>오름차순</span>
                    {sortOrder === 'asc' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <button 
                    onClick={() => { setSort(sortKey, 'desc'); setIsSortOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>내림차순</span>
                    {sortOrder === 'desc' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 윈도우 스타일 보기 드롭다운 컨테이너 */}
          <div className="relative">
            <button 
              onClick={() => { setIsViewOpen(!isViewOpen); setIsSortOpen(false); }}
              className={`flex items-center gap-2 px-3 py-1.5 hover:bg-[#e5e5e5] rounded transition-colors ${isViewOpen ? 'bg-[#e5e5e5]' : ''}`}
            >
              <LayoutGrid size={18} />
              <span>보기 ({getViewModeText(viewMode)})</span>
            </button>

            {/* 보기 형식 메뉴 팝업 */}
            {isViewOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsViewOpen(false)} />
                <div className="absolute left-0 mt-1 w-44 bg-white border border-gray-300 rounded shadow-lg py-1 z-50 animate-fade-in text-[13px]">
                  <button 
                    onClick={() => { setViewMode('small-icon'); setIsViewOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>작은 아이콘</span>
                    {viewMode === 'small-icon' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                  <button 
                    onClick={() => { setViewMode('details'); setIsViewOpen(false); }}
                    className="w-full flex items-center justify-between px-4 py-1.5 hover:bg-[#f3f3f3] text-left"
                  >
                    <span>자세히</span>
                    {viewMode === 'details' && <Check size={14} className="text-[#0078d4]" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* 우측 화면 확대/축소 버튼 */}
        <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-md p-0.5 shadow-sm">
          <button 
            onClick={() => setZoomLevel(Math.max(0.8, zoomLevel - 0.1))}
            className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors text-gray-600"
            title="화면 축소"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs font-semibold px-2 min-w-[50px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button 
            onClick={() => setZoomLevel(Math.min(1.5, zoomLevel + 0.1))}
            className="p-1.5 hover:bg-[#e5e5e5] rounded transition-colors text-gray-600"
            title="화면 확대"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}


export default function App() {
  const { user, isRestoring, restoreSession } = useAuthStore()
  const { zoomLevel } = useUIStore()
  const [showRegister, setShowRegister] = useState(false)
  const [lastAutoUpDate, setLastAutoUpDate] = useState<string>('')
  const [autoUpStatus, setAutoUpStatus] = useState<string>('')

  // 앱 시작 시 저장된 세션 복구 시도 (자동 로그인)
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  // 백그라운드 실시간 폴더 감시 파일 이벤트 구독 및 설정 불러오기
  const { initializeFileListener, setOptions } = useFileStore()
  useEffect(() => {
    // 저장된 설정 불러오기
    const loadSettings = async () => {
      if (window.electronAPI?.settings) {
        const rmbg = await window.electronAPI.settings.get('enableRemoveBg')
        const synth = await window.electronAPI.settings.get('enableSynthesis')
        // 값이 null이 아닐 경우에만 설정 (기본값은 store에 있는 값 사용)
        setOptions(rmbg !== null ? rmbg === 'true' : true, synth !== null ? synth === 'true' : true)
      }
    }
    loadSettings()

    const unsubscribe = initializeFileListener()
    return () => unsubscribe()
  }, [initializeFileListener, setOptions])

  // 자동 UP 스케줄러 (매일 18:00 체크)
  useEffect(() => {
    if (!user) return

    const checkTime = () => {
      const now = new Date()
      const hours = now.getHours()
      const minutes = now.getMinutes()
      const dateStr = now.toLocaleDateString()

      // 매일 18시 00분에 동작
      if (hours === 18 && minutes === 0) {
        if (lastAutoUpDate !== dateStr) {
          setLastAutoUpDate(dateStr)
          setAutoUpStatus('⚡ 번개장터 자동 UP 로봇 가동 중...')
          
          if ((window as any).electronAPI && (window as any).electronAPI.bunjang) {
            (window as any).electronAPI.bunjang.autoUp().then((res: any) => {
               if (res.success) {
                 setAutoUpStatus(`✅ 자동 UP 완료 (성공: ${res.summary?.success}개, 실패: ${res.summary?.failed}개)`)
               } else {
                 setAutoUpStatus(`❌ 자동 UP 실패: ${res.error}`)
               }
               // 10초 뒤에 메시지 숨기기
               setTimeout(() => setAutoUpStatus(''), 10000)
            })
          }
        }
      }
    }

    const intervalId = setInterval(checkTime, 30000) // 30초마다 체크
    checkTime()

    return () => clearInterval(intervalId)
  }, [user, lastAutoUpDate])

  // 세션 복구 중: 로딩 화면 표시
  if (isRestoring) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#f3f3f3]">
        <div className="text-center space-y-4 animate-fade-in">
          {/* 로딩 로고 */}
          <div className="mx-auto w-14 h-14 rounded-md flex items-center justify-center bg-[#0078d4] shadow-md">
            <span className="text-xl font-bold text-white">8</span>
          </div>
          <div className="flex items-center gap-2 justify-center text-[#616161]">
            <Loader2 size={16} className="animate-spin text-[#0078d4]" />
            <span className="text-sm">세션 복구 중...</span>
          </div>
        </div>
      </div>
    )
  }

  // 미인증 상태: 로그인 또는 회원가입 창 (다이얼로그)
  if (!user) {
    return (
      <div style={{ zoom: zoomLevel } as any} className="h-full w-full">
        {showRegister ? (
          <RegisterPage onNavigateToLogin={() => setShowRegister(false)} />
        ) : (
          <LoginPage onNavigateToRegister={() => setShowRegister(true)} />
        )}
      </div>
    )
  }

  // 인증 완료: 메인 레이아웃 (탐색기 헤더 + 사이드바 + 콘텐츠)
  // zoom CSS 속성을 최상위 컨테이너에 부여하여 전체 스케일링
  return (
    <HashRouter>
      {/* 윈도우 전체 창 밖 여백(5px) */}
      <div className="h-full w-full flex flex-col bg-[#f0f0f0] overflow-hidden p-[5px]" style={{ zoom: zoomLevel } as any}>
        
        {/* 내부 컨텐츠 영역 (둥근 모서리와 그림자 적용) */}
        <div className="h-full w-full flex flex-col bg-white overflow-hidden rounded-md border border-gray-300 shadow-sm">
          {/* 상단 탐색기 헤더 영역 */}
          <ExplorerHeader />

          {/* 하단 메인 영역 캔버스 */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* 좌측 탐색 창 (사이드바) */}
            <Sidebar />

            {/* 우측 메인 파일/콘텐츠 목록 영역 */}
            <main className="flex-1 overflow-y-auto bg-[#f3f3f3]">
              <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/prompts" element={<PromptPage />} />
                  <Route path="/mapping" element={<MappingPage />} />
                  <Route path="/export" element={<ExportPage />} />
                  <Route path="/bunjang-manager" element={<BunjangManagerPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
            </main>
          </div>
        </div>

        {/* 자동 UP 토스트 알림 */}
        {autoUpStatus && (
          <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-6 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-3 animate-fade-in border border-gray-700">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="font-bold text-sm tracking-wide">{autoUpStatus}</span>
          </div>
        )}
      </div>
    </HashRouter>
  )
}
