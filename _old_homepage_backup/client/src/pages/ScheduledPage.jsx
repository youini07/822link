import { useState, useEffect } from 'react';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getTranslation, formatArrivalDate } from '../services/i18n';
import ShipTracker from '../components/ShipTracker';

const ScheduledPage = ({ lang }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const navigate = useNavigate();
    
    const [groupedProducts, setGroupedProducts] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {


        const fetchScheduledProducts = async () => {
            setLoading(true);
            try {
                // show_scheduled=true 파라미터를 통해 도착예정 상품만 모두 가져옴
                const res = await axios.get('/api/products', {
                    params: { show_scheduled: 'true', limit: 1000 }
                });
                
                if (res.data && res.data.data) {
                    const products = res.data.data;
                    
                    // arrival_date 기준으로 그룹핑
                    const groups = {};
                    products.forEach(p => {
                        const dateStr = p.arrival_date || '미정';
                        if (!groups[dateStr]) {
                            groups[dateStr] = [];
                        }
                        groups[dateStr].push(p);
                    });
                    
                    setGroupedProducts(groups);
                }
            } catch (err) {
                console.error('도착예정 상품 로딩 에러:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchScheduledProducts();
    }, [isAdmin, navigate, lang]);



    // 날짜 오름차순 정렬 (월/일 포맷 파싱)
    const sortedDates = Object.keys(groupedProducts).sort((a, b) => {
        if (a === '미정') return 1;
        if (b === '미정') return -1;
        
        const [monthA, dayA] = a.split('/').map(Number);
        const [monthB, dayB] = b.split('/').map(Number);
        
        if (monthA !== monthB) return monthA - monthB;
        return dayA - dayB;
    });

    const [collapsedDates, setCollapsedDates] = useState({});

    const toggleDate = (date) => {
        setCollapsedDates(prev => ({
            ...prev,
            [date]: !prev[date]
        }));
    };

    return (
        <div className="w-full flex flex-col min-h-screen bg-gray-50 pb-20">
            {/* 상단 헤더 */}
            <div className="bg-white px-4 py-4 border-b border-gray-200 sticky top-0 z-10">
                <h1 className="text-lg font-extrabold text-black flex items-center">
                    <span className="w-2 h-6 bg-black mr-2 inline-block"></span>
                    {getTranslation(lang, 'scheduled_title')} {isAdmin && <span className="text-xs text-red-500 ml-2">{getTranslation(lang, 'scheduled_admin_only')}</span>}
                </h1>
                <p className="text-xs text-gray-500 mt-1">
                    {getTranslation(lang, 'scheduled_desc')}
                </p>
            </div>

            <div className="px-4 mt-6 shrink-0">
                <ShipTracker lang={lang} />
            </div>

            {loading ? (
                <div className="flex-1 flex justify-center items-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-8">
                    {sortedDates.length === 0 ? (
                        <div className="text-center text-gray-400 py-10">
                            {getTranslation(lang, 'scheduled_empty')}
                        </div>
                    ) : (
                        sortedDates.map(date => {
                            const isCollapsed = collapsedDates[date];
                            return (
                                <div key={date} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                                    {/* 날짜 헤더 (클릭 시 토글) */}
                                    <div 
                                        onClick={() => toggleDate(date)}
                                        className="bg-gray-800 text-white px-4 py-3 font-bold flex justify-between items-center cursor-pointer select-none transition-colors hover:bg-gray-700"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <svg 
                                                className={`w-5 h-5 transition-transform duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} 
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                            <span>{formatArrivalDate(date, lang)}</span>
                                        </div>
                                        <span className="bg-white text-gray-800 text-xs px-2 py-1 rounded-full font-extrabold">
                                            {groupedProducts[date].length}{getTranslation(lang, 'unit_items')}
                                        </span>
                                    </div>
                                    
                                    {/* 상품 그리드 (접혔을 때는 숨김) */}
                                    {!isCollapsed && (
                                        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                            {groupedProducts[date].map(product => (
                                                <div key={product.code} className="relative">
                                                    <ProductCard product={product} lang={lang} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

export default ScheduledPage;
