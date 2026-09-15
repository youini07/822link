import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { WishlistProvider } from './contexts/WishlistContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import CatalogPage from './pages/CatalogPage';
import NoticePage from './pages/NoticePage';
import DetailPage from './pages/DetailPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrdersPage from './pages/OrdersPage';
import MyPage from './pages/MyPage';
import SalePage from './pages/SalePage';

/**
 * URL의 lang 파라미터를 컴포넌트 state와 동기화해주는 핸들러
 */
function LangSyncHandler({ lang, setLang }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlLang = params.get('lang');
    
    // 1. URL에 lang이 있고 현재 state와 다르면 state 업데이트 (리다이렉트는 하지 않음)
    if (urlLang && urlLang !== lang) {
      setLang(urlLang);
    }
    
    // 2. HTML 태그에 반영
    document.documentElement.lang = lang.toLowerCase();
  }, [lang, location.pathname, location.search, navigate]);

  return null;
}

import { trackPageView } from './services/api';

/**
 * 페이지 이동 시 구글 애널리틱스에 page_view 전송 및 자체 통계 기록
 */
function AnalyticsTracker() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (loading) return; // 로그인 상태 확인 중 대기
    if (isAdmin) return; // 관리자 방문 제외

    // 1. Google Analytics 전송
    if (window.gtag) {
      window.gtag('event', 'page_view', {
        page_path: location.pathname + location.search,
        page_location: window.location.href,
        page_title: document.title
      });
    }

    // 2. 자체 서버 트래커 전송
    trackPageView(location.pathname + location.search, document.referrer);

  }, [location.pathname, location.search, loading, isAdmin]);

  return null;
}

import RecommendPage from './pages/RecommendPage';
import CategoryMainPage from './pages/CategoryMainPage';
import BrandMainPage from './pages/BrandMainPage';
import ScheduledPage from './pages/ScheduledPage';

/**
 * 필터 존재 여부에 따라 홈 화면 또는 상품 목록 화면을 렌더링
 */
function HomeRouter({ lang }) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  
  const hasFilter = searchParams.has('category') || searchParams.has('brand') || searchParams.has('search') || searchParams.has('upper_category') || searchParams.has('gender') || searchParams.has('style');
  
  if (hasFilter) {
    return <CatalogPage lang={lang} />;
  }
  return <RecommendPage lang={lang} />;
}

function App() {
  const [lang, setLang] = useState(
    () => new URLSearchParams(window.location.search).get('lang') || 'TH'
  );

  return (
    <AuthProvider>
      <WishlistProvider>
        <CartProvider>
          <BrowserRouter>
            <LangSyncHandler lang={lang} setLang={setLang} />
          <AnalyticsTracker />
          {/* 모바일 특화 레이아웃 (배경은 옅은 회색, 중앙 정렬된 600px 화면) */}
          <div className="bg-gray-100 min-h-screen w-full flex justify-center">
            <div className="relative w-full max-w-[600px] sm:landscape:max-w-[900px] md:max-w-[900px] lg:max-w-[1200px] bg-white min-h-screen flex flex-col pt-[130px] md:pt-[80px] shadow-lg">
              <Header lang={lang} setLang={setLang} />
              <main className="flex-1 w-full pb-[80px] overflow-x-hidden">
                <Routes>
                  <Route path="/" element={<HomeRouter lang={lang} />} />
                  <Route path="/category" element={<CategoryMainPage lang={lang} />} />
                  <Route path="/scheduled" element={<ScheduledPage lang={lang} />} />
                  <Route path="/brand" element={<BrandMainPage lang={lang} />} />
                  <Route path="/product/:code" element={<DetailPage lang={lang} />} />
                  <Route path="/notice" element={<NoticePage lang={lang} />} />
                  <Route path="/register" element={<RegisterPage lang={lang} />} />
                  <Route path="/login" element={<LoginPage lang={lang} />} />
                  <Route path="/cart" element={<CartPage lang={lang} />} />
                  <Route path="/checkout" element={<CheckoutPage lang={lang} />} />
                  <Route path="/orders" element={<OrdersPage lang={lang} />} />
                  <Route path="/mypage" element={<MyPage lang={lang} />} />
                  <Route path="/sale" element={<SalePage lang={lang} />} />
                </Routes>
              </main>
              <BottomNav lang={lang} />
            </div>
          </div>
        </BrowserRouter>
        </CartProvider>
      </WishlistProvider>
    </AuthProvider>
  );
}

export default App;
