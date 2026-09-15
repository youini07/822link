import { useState, useEffect } from 'react';
import { Settings, LogOut, UploadCloud, LayoutDashboard, Package, Map as MapIcon, FileSpreadsheet } from 'lucide-react';
import { GlobalSettingsModal } from './GlobalSettingsModal';
import { Login } from './Login';
import { ChangePasswordModal } from './ChangePasswordModal';
import { BandLogo } from './BandLogo';
import { MarketUploadPanel } from './MarketUploadPanel';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';

// 822-link Pages
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'user'>('user');
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  const [remainingDays, setRemainingDays] = useState<number>(0);
  const [isExpired, setIsExpired] = useState(false);
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false);
  
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();
  const currentTab = location.pathname.substring(1) || 'dashboard';

  useEffect(() => {
    // 자동 로그인 처리
    const token = localStorage.getItem('bandadmin_token');
    const expiresAt = localStorage.getItem('bandadmin_token_expires');
    const role = localStorage.getItem('bandadmin_role') || 'user';
    const username = localStorage.getItem('bandadmin_username') || '';
    const autoUpload = localStorage.getItem('bandadmin_auto_upload_enabled') === 'true';

    if (token && expiresAt) {
      const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      const expired = new Date(expiresAt).getTime() < Date.now();
      setUserRole(role as 'admin' | 'user');
      setLoggedInUsername(username);
      setRemainingDays(remaining);
      setIsExpired(expired);
      setAutoUploadEnabled(autoUpload);
      setIsAuthenticated(true);
    }
  }, []);
  
  const handleLoginSuccess = (token: string, expiresAt: string, role: string, username: string, aiEnabledParam: boolean, uploadEnabledParam: boolean, autoSettlementEnabledParam: boolean, bandFeaturesEnabledParam: boolean, geminiApiKey?: string) => {
    const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const expired = new Date(expiresAt).getTime() < Date.now();
    localStorage.setItem('bandadmin_token', token);
    localStorage.setItem('bandadmin_token_expires', expiresAt);
    localStorage.setItem('bandadmin_role', role);
    if (username) localStorage.setItem('bandadmin_username', username);
    localStorage.setItem('bandadmin_auto_upload_enabled', uploadEnabledParam ? 'true' : 'false');
    
    if (window.electron?.getCatalogSettings && window.electron?.saveCatalogSettings && geminiApiKey) {
      window.electron.getCatalogSettings().then((settings: any) => {
        const updates: any = { ...settings, geminiApiKey };
        window.electron.saveCatalogSettings!(updates);
      });
    }

    setUserRole(role as 'admin' | 'user');
    setLoggedInUsername(username || null);
    setRemainingDays(remaining || 0);
    setIsExpired(expired || false);
    setAutoUploadEnabled(uploadEnabledParam || false);
    setIsAuthenticated(true);
    navigate('/');
  };

  const handleLogout = () => {
    localStorage.removeItem('bandadmin_token');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      <div className="h-screen w-full bg-slate-900 text-slate-100 flex flex-col font-sans overflow-hidden">
        {/* Header / Sidebar */}
        <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shrink-0 z-10 shadow-md">
          <div className="flex items-center gap-3">
            <BandLogo size={32} className="drop-shadow-sm" />
            <h1 className="text-xl font-bold tracking-tight text-white">822 Link AI</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700 shrink-0 mr-2">
              <button
                onClick={() => navigate('/')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 border ${currentTab === 'dashboard' || currentTab === '' ? 'bg-blue-600 text-white shadow-sm border-blue-500' : 'text-slate-400 hover:text-slate-200 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'}`}
              >
                <LayoutDashboard size={16} /> 대시보드
              </button>
              <button
                onClick={() => navigate('/products')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 border ${currentTab === 'products' ? 'bg-green-600 text-white shadow-sm border-green-500' : 'text-slate-400 hover:text-slate-200 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'}`}
              >
                <Package size={16} /> 상품 관리
              </button>
              <button
                onClick={() => navigate('/settings')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 border ${currentTab === 'settings' ? 'bg-purple-600 text-white shadow-sm border-purple-500' : 'text-slate-400 hover:text-slate-200 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'}`}
              >
                <Settings size={16} /> 환경설정
              </button>
              <button
                onClick={() => {
                  if (userRole !== 'admin' && !autoUploadEnabled) {
                    alert('오픈마켓 업로드 기능은 MAX 버전부터 이용 가능합니다.');
                    return;
                  }
                  navigate('/market');
                }}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 border ${currentTab === 'market' ? 'bg-orange-600 text-white shadow-sm border-orange-500' : 'text-slate-400 hover:text-slate-200 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'}`}
              >
                <UploadCloud size={16} /> 오픈마켓
              </button>
            </div>

            {/* User Info */}
            {loggedInUsername && userRole !== 'admin' && (
              <div className="flex flex-col items-end text-sm border-r border-slate-700 pr-3 mr-1">
                <div className="text-slate-300 flex items-center">
                  <strong className="text-emerald-400 mr-1">{loggedInUsername}</strong>님
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  남은 기간: <strong className={isExpired ? 'text-red-400' : 'text-blue-400'}>{remainingDays}일</strong>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={handleLogout} className="px-3 py-1.5 text-sm font-medium bg-red-900/40 hover:bg-red-800/60 text-red-300 hover:text-white rounded-md transition-colors shadow-sm flex items-center gap-1">
                <LogOut size={16} /> 로그아웃
              </button>
              {/* 패치/공지 모달 버튼 (원래 설정 버튼이었던 것) */}
              <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 ml-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-all" title="공지/패치노트">
                <FileSpreadsheet size={20} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative bg-slate-900 text-slate-100">
          <div className="h-full w-full bg-slate-900 overflow-auto relative">
             <Routes>
               <Route path="/" element={<DashboardPage />} />
               <Route path="/dashboard" element={<DashboardPage />} />
               <Route path="/products" element={<ProductsPage />} />
               <Route path="/settings" element={<SettingsPage />} />
               <Route 
                 path="/market" 
                 element={
                   <div className={`h-full w-full flex flex-col bg-slate-900 text-slate-100 ${userRole !== 'admin' && !autoUploadEnabled ? 'pointer-events-none select-none' : ''}`}>
                     <MarketUploadPanel isActive={true} />
                   </div>
                 } 
               />
             </Routes>
          </div>
        </main>
      </div>

      {/* Modals */}
      <ChangePasswordModal 
        isOpen={isPasswordModalOpen} 
        onClose={() => setIsPasswordModalOpen(false)} 
        token={localStorage.getItem('bandadmin_token') || ''}
      />

      {isSettingsModalOpen && (
        <GlobalSettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          onCheckUpdates={() => {}}
          isCheckingUpdate={false}
          updateInfo={null}
          isDownloaded={false}
          onOpenChangePassword={() => setIsPasswordModalOpen(true)}
          onOpenNotice={() => {}}
        />
      )}
    </>
  );
}
