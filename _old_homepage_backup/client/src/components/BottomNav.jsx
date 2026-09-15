import { Link, useLocation } from 'react-router-dom';
import { getTranslation } from '../services/i18n';
import { useAuth } from '../contexts/AuthContext';

// 아이콘 SVG 컴포넌트
const IconRecommend = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
);

const IconBrand = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="2" />
    </svg>
);

const IconCategory = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
    </svg>
);

const IconLounge = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

const IconScheduled = ({ active }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);


const BottomNav = ({ lang }) => {
    const location = useLocation();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    
    // 현재 경로가 어떤 탭에 속하는지 확인
    const getActiveTab = () => {
        const path = location.pathname;
        if (path.startsWith('/brand') || (path === '/' && location.search.includes('brand='))) return 'brand';
        if (path.startsWith('/category')) return 'category';
        if (path.startsWith('/scheduled')) return 'scheduled';
        if (path.startsWith('/mypage') || path.startsWith('/orders') || path.startsWith('/login')) return 'lounge';
        // 기본값: 홈(추천)
        if (path === '/') return 'recommend';
        return '';
    };

    const activeTab = getActiveTab();

    const tabs = [
        { id: 'recommend', label: getTranslation(lang, 'bottom_nav_recommend'), path: '/', Icon: IconRecommend },
        { id: 'brand', label: getTranslation(lang, 'bottom_nav_brand'), path: '/brand', Icon: IconBrand },
        { id: 'category', label: getTranslation(lang, 'bottom_nav_category'), path: '/category', Icon: IconCategory },
        { id: 'scheduled', label: getTranslation(lang, 'bottom_nav_scheduled'), path: '/scheduled', Icon: IconScheduled },
        { id: 'lounge', label: getTranslation(lang, 'bottom_nav_mypage'), path: '/mypage', Icon: IconLounge },
    ];

    return (
        <nav className="fixed bottom-0 w-full max-w-[600px] sm:landscape:max-w-[900px] md:max-w-[900px] lg:max-w-[1200px] bg-white border-t border-gray-200 z-[1000] pb-safe">
            <div className="flex justify-around items-center h-[60px]">
                {tabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <Link
                            key={tab.id}
                            to={`${tab.path}${tab.path.includes('?') ? '&' : '?'}lang=${lang}`}
                            className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
                                isActive ? 'text-black' : 'text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            <tab.Icon active={isActive} />
                            <span className={`text-[10px] ${isActive ? 'font-bold' : 'font-medium'}`}>
                                {tab.label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
