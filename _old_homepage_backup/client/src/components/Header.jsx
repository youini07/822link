import { Link, useLocation, useNavigate } from 'react-router-dom';
// import { Menu, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { getTranslation } from '../services/i18n';
import { fetchFilters, fetchSetting } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';

const Header = ({ lang, setLang }) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [topBrands, setTopBrands] = useState([]);
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    const [tiktokLiveUrl, setTiktokLiveUrl] = useState('');
    const [tiktokLiveTime, setTiktokLiveTime] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isLoggedIn, logout } = useAuth();
    const { cartCount } = useCart();
    const menuRef = useRef(null);
    const buttonRef = useRef(null);

    const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isMobileMenuOpen && menuRef.current && !menuRef.current.contains(event.target) && buttonRef.current && !buttonRef.current.contains(event.target)) {
                setIsMobileMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMobileMenuOpen]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        
        fetchFilters().then(data => {
            if (data && data.topBrands) {
                setTopBrands(data.topBrands);
            }
        }).catch(() => { });

        const loadTiktokUrl = async () => {
            try {
                const urlData = await fetchSetting('tiktok_live_url');
                setTiktokLiveUrl(urlData?.value || '');
                const timeData = await fetchSetting('tiktok_live_time');
                setTiktokLiveTime(timeData?.value || '');
            } catch (err) {}
        };
        
        loadTiktokUrl();
        const intervalId = setInterval(loadTiktokUrl, 10000);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearInterval(intervalId);
        };
    }, []);

    // 네비게이션 링크 (카테고리 중심)
    const navLinks = [
        { name: getTranslation(lang, 'nav_notice'), path: '/notice' },
        { name: getTranslation(lang, 'nav_catalog'), path: '/' },
        { name: getTranslation(lang, 'nav_archive'), path: '/?category=Dream Archive' },
        { name: '✦ Sale', path: '/sale', isSpecial: true },
        { name: getTranslation(lang, 'category_accessory'), path: '/?category=Accessory' },
        { name: getTranslation(lang, 'category_winter'), path: '/?category=Winter' },
    ];

    const langs = ['KR', 'TH', 'EN'];

    return (
        <header className="fixed top-0 w-full max-w-[600px] sm:landscape:max-w-[900px] md:max-w-[900px] lg:max-w-[1200px] bg-white z-[1000] border-b border-border flex flex-col">
            <div className="max-w-7xl mx-auto w-full px-4 md:px-8">
                <div className="h-[80px] flex items-center justify-between border-b border-border relative">
                    {/* 좌측: 틱톡 라이브 배너 */}
                    <div className="flex-1 flex items-center justify-start z-10">
                        {tiktokLiveUrl && (
                            <div className="flex items-center shrink-0">
                                <a href={tiktokLiveUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center hover:opacity-80 transition-opacity mt-1">
                                    <div className="flex items-center gap-1">
                                        <svg width="18" height="18" viewBox="0 0 448 512" fill="currentColor"><path d="M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,52.23,71.18V0l88,0a121.18,121.18,0,0,0,1.86,22.17h0A122.18,122.18,0,0,0,381,102.39a121.43,121.43,0,0,0,67,20.14Z"/></svg>
                                        <span className="font-bold text-[16px] tracking-tight" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>TikTok</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="bg-[#FE2C55] text-white px-1.5 py-[2px] rounded-sm text-[9px] font-bold tracking-wider flex items-center gap-1 animate-pulse leading-none">
                                            <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                                            LIVE
                                        </span>
                                        {tiktokLiveTime && (
                                            <span className="text-[11px] font-bold tracking-widest text-[#FE2C55]" style={{fontFamily: 'serif'}}>{tiktokLiveTime}</span>
                                        )}
                                    </div>
                                </a>
                            </div>
                        )}
                    </div>

                    {/* 중앙: 로고 */}
                    <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center justify-center pointer-events-none">
                        <a href={`/?lang=${lang}`} className="h-[50px] md:h-[60px] cursor-pointer pointer-events-auto" onClick={() => setIsMobileMenuOpen(false)}>
                            <img src="/822logo_final_v3.png" alt="822 SHOP" className="h-full w-auto object-contain" />
                        </a>
                    </div>

                    {/* 우측: 장바구니 아이콘 + 햄버거 메뉴 */}
                    <div className="flex-1 flex items-center justify-end gap-3 z-10">
                        {/* 장바구니 아이콘 (관리자가 아닐 때만 표시) */}
                        {!(user?.role === 'admin' || user?.login_id === 'dreamstudio') && (
                            <Link
                                to={`/cart?lang=${lang}`}
                                className="relative p-2 text-gray-600 hover:text-black transition-colors"
                                title={getTranslation(lang, 'cart_title')}
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                                </svg>
                                {cartCount > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 bg-black text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                        {cartCount > 99 ? '99+' : cartCount}
                                    </span>
                                )}
                            </Link>
                        )}

                        {/* 웹/모바일 모두 햄버거 메뉴로 통일 (기존 데스크탑 메뉴 제거) */}
                        <button ref={buttonRef} onClick={toggleMenu} className="p-1 text-gray-800 hover:text-black transition-colors ml-1">
                            {isMobileMenuOpen ? (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* 통합 메뉴 (햄버거 클릭 시 - 웹/모바일 동일 적용) */}
            {isMobileMenuOpen && (
                <div ref={menuRef} className="absolute top-[80px] right-0 w-[65%] sm:w-[50%] lg:w-[40%] bg-white border-b border-l border-border p-4 flex flex-col gap-4 shadow-xl z-50 rounded-bl-xl origin-top-right animate-fade-in">
                    {/* 모바일: 언어 선택 (최상단) */}
                    <div className="flex gap-2 pb-3 border-b border-gray-100">
                        {langs.map(l => (
                            <button
                                key={l}
                                onClick={() => {
                                    const params = new URLSearchParams(location.search);
                                    params.set('lang', l);
                                    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
                                    setLang(l);
                                    setIsMobileMenuOpen(false);
                                }}
                                className={`flex-1 text-[14px] font-black py-2 rounded transition-colors text-center ${lang === l ? 'bg-black text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                    
                    {navLinks.map((link) => (
                        <Link
                            key={link.path}
                            to={`${link.path}${link.path.includes('?') ? '&' : '?'}lang=${lang}`}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`text-[15px] font-medium ${location.pathname === link.path ? 'text-black font-bold' : 'text-gray-600'
                                }`}
                        >
                            {link.name}
                        </Link>
                    ))}
                    {/* 모바일: 로그인/로그아웃/주문내역 */}
                    <div className="border-t border-gray-100 pt-3 space-y-3">
                        {isLoggedIn ? (
                            <>
                                {(user.role === 'admin' || user.login_id === 'dreamstudio') && (
                                    <Link to={`/mypage?lang=${lang}&tab=admin`} onClick={() => setIsMobileMenuOpen(false)} className="block text-sm text-gray-600 font-bold">
                                        🛡️ {getTranslation(lang, 'admin_tab')}
                                    </Link>
                                )}
                                {!(user.role === 'admin' || user.login_id === 'dreamstudio') && (
                                    <>
                                        <Link to={`/mypage?lang=${lang}`} onClick={() => setIsMobileMenuOpen(false)} className="block text-sm text-gray-600">
                                            👤 {getTranslation(lang, 'bottom_nav_mypage')}
                                        </Link>
                                        <Link to={`/orders?lang=${lang}`} onClick={() => setIsMobileMenuOpen(false)} className="block text-sm text-gray-600">
                                            📦 {getTranslation(lang, 'nav_my_orders')}
                                        </Link>
                                    </>
                                )}
                                <button onClick={() => { logout(); setIsMobileMenuOpen(false); }} className="block text-sm text-gray-600">
                                    🚪 {getTranslation(lang, 'nav_logout')}
                                </button>
                            </>
                        ) : (
                            <>
                                <Link to={`/login?lang=${lang}`} onClick={() => setIsMobileMenuOpen(false)} className="block text-sm font-bold text-gray-900">
                                    {getTranslation(lang, 'nav_login')}
                                </Link>
                                <Link to={`/register?lang=${lang}`} onClick={() => setIsMobileMenuOpen(false)} className="block text-sm text-gray-600">
                                    {getTranslation(lang, 'nav_register')}
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
};

export default Header;
