/**
 * 822 Link - 메인 사이드바 컴포넌트 (Windows 11 Explorer Sidebar)
 * 
 * 왜 이렇게 설계했는가:
 * - 탐색기의 좌측 '즐겨찾기 / 내 PC' 트리 메뉴 느낌을 완벽하게 재현
 * - 각 메뉴 항목을 폴더 느낌의 아이콘과 얇은 여백으로 배치
 */
import { Link, useLocation } from 'react-router-dom'
import { 
  Home, 
  Package, 
  MessageSquare, 
  Settings as SettingsIcon, 
  LogOut, 
  Network, 
  Download,
  ChevronDown,
  Monitor,
  FolderOpen,
  Store
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'

export default function Sidebar() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { uploadTarget, setUploadTarget } = useUIStore()

  // 윈도우 탐색기 스타일 네비게이션 아이템
  const navItems = [
    { path: '/', icon: Home, label: '대시보드' },
    { path: '/products', icon: Package, label: '상품 관리' },
    { path: '/bunjang-manager', icon: Store, label: '멀티 마켓 봇' },
    { path: '/prompts', icon: MessageSquare, label: 'AI 프롬프트' },
    { path: '/mapping', icon: Network, label: '카테고리 매핑' },
    { path: '/export', icon: Download, label: '엑셀 내보내기' },
    { path: '/settings', icon: SettingsIcon, label: '설정' },
  ]

  return (
    <aside className="w-64 h-full flex flex-col bg-[#f3f3f3] text-[#202020] select-none text-xs border-r border-gray-200">
      
      {/* 윈도우 탐색기 즐겨찾기 섹션 */}
      <div className="flex-1 overflow-y-auto py-3">
        {/* 즐겨찾기 헤더 */}
        <div className="px-5 mt-4 mb-3 flex items-center gap-3 text-gray-700 cursor-pointer hover:bg-[#e5e5e5] py-3 rounded mx-3 transition-colors">
          <ChevronDown size={14} />
          <span className="font-semibold">즐겨찾기</span>
        </div>
        
        {/* 즐겨찾기 네비게이션 트리 */}
        <nav className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-4 px-10 py-3 mb-1 rounded transition-all duration-150 relative ${
                  isActive 
                    ? 'bg-[#eaeaea] font-medium' 
                    : 'text-gray-700 hover:bg-[#e5e5e5]'
                }`}
              >
                {/* 윈도우 탐색기의 선택 표시선 */}
                {isActive && (
                  <div className="absolute left-1 top-[20%] bottom-[20%] w-[3px] bg-[#0078d4] rounded-full" />
                )}
                
                <item.icon 
                  size={18} 
                  className={isActive ? 'text-[#0078d4]' : 'text-[#616161]'} 
                />
                <span className="flex-1 text-[13px]">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* 내 PC 섹션 (장식용) */}
        <div className="px-5 mt-8 mb-3 flex items-center gap-3 text-gray-700 cursor-pointer hover:bg-[#e5e5e5] py-3 rounded mx-3 transition-colors">
          <ChevronDown size={14} />
          <span className="font-semibold">내 PC</span>
        </div>
        <div className="space-y-1 px-3 text-gray-700 mb-6">
          <div className="flex items-center gap-4 px-10 py-3 mb-1 rounded hover:bg-[#e5e5e5] cursor-pointer">
            <Monitor size={18} className="text-[#616161]" />
            <span className="text-[13px]">로컬 디스크 (C:)</span>
          </div>
          <div className="flex items-center gap-4 px-10 py-3 mb-1 rounded hover:bg-[#e5e5e5] cursor-pointer">
            <FolderOpen size={18} className="text-[#616161]" />
            <span className="text-[13px]">감시 폴더 바로가기</span>
          </div>
        </div>
      </div>

      {/* 업로드 타겟 스위치 */}
      <div className="p-4 bg-white border-t border-gray-300">
        <div className="text-xs font-bold text-gray-700 mb-2 px-1">현재 업로드 타겟</div>
        <div className="flex items-center bg-gray-100 rounded-lg p-1 border border-gray-200">
          <button
            onClick={() => {
              setUploadTarget('822shop')
              // 메인 프로세스(텔레그램 봇 등)도 타겟을 알 수 있도록 config.json에 동기 저장
              window.electronAPI.settings.set('uploadTarget', '822shop')
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              uploadTarget === '822shop'
                ? 'bg-[#0078d4] text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-200'
            }`}
          >
            822shop
          </button>
          <button
            onClick={() => {
              setUploadTarget('dreamstudio')
              // 메인 프로세스(텔레그램 봇 등)도 타겟을 알 수 있도록 config.json에 동기 저장
              window.electronAPI.settings.set('uploadTarget', 'dreamstudio')
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              uploadTarget === 'dreamstudio'
                ? 'bg-[#107c10] text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-200'
            }`}
          >
            Dreamstudio
          </button>
        </div>
      </div>

      {/* 하단 사용자 프로필 및 로그아웃 */}
      <div className="p-4 bg-[#eaeaea] border-t border-gray-300">
        <div className="flex items-center gap-3 p-2.5 rounded hover:bg-[#e5e5e5] transition-colors cursor-pointer border border-transparent hover:border-gray-300">
          <div className="w-10 h-10 rounded-full bg-[#0078d4] flex items-center justify-center shrink-0 text-white font-bold text-sm shadow-sm">
            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {user?.displayName || '사용자'}
            </div>
            <div className="text-xs text-gray-500 truncate mt-0.5">
              {user?.email}
            </div>
          </div>

          <button
            onClick={logout}
            className="p-2 text-gray-600 hover:text-red-600 hover:bg-white rounded transition-colors"
            title="로그아웃"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
