import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchDiscountedProducts } from '../services/api';
import { getTranslation } from '../services/i18n';
import ProductCard from '../components/ProductCard';

/**
 * 할인 중인 상품 전용 페이지 (/sale)
 * - 모든 등록된 할인 상품을 그리드로 표시
 * - 할인율 뱃지, 원가/할인가 강조 표시
 * - 품절/미등록 상품도 포함 (관리자가 등록한 목록 전체)
 */
const SalePage = ({ lang }) => {
    const [discounts, setDiscounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const t = (key) => getTranslation(lang, key);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const res = await fetchDiscountedProducts();
                setDiscounts(res.discounts || []);
            } catch (err) {
                console.error('[SalePage] Load error:', err);
            }
            setLoading(false);
        };
        loadData();
        window.scrollTo(0, 0);
    }, []);

    // 할인율이 0이거나 상품 정보가 없는 항목 필터링 (선택적)
    const validDiscounts = discounts.filter(d => d.product_code);

    return (
        <div className="min-h-screen bg-white">
            {/* 페이지 헤더 */}
            <div className="bg-zinc-900 text-white py-16 px-4">
                <div className="max-w-7xl mx-auto text-center">
                    <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-4">
                        <span className="text-2xl md:text-3xl text-zinc-500 hidden md:inline">✦</span>
                        <h1 className="text-3xl md:text-5xl font-black tracking-[0.1em] flex flex-col md:flex-row items-center gap-2 md:gap-4">
                            SPECIAL SALE
                            {validDiscounts[0]?.registered_at && (
                                <span className="text-lg md:text-2xl font-medium text-zinc-400 tracking-normal font-serif italic mt-2 md:mt-0">
                                    {(() => {
                                        const start = new Date(validDiscounts[0].registered_at);
                                        if (isNaN(start)) return '';
                                        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
                                        const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
                                        return `(${fmt(start)} ~ ${fmt(end)})`;
                                    })()}
                                </span>
                            )}
                        </h1>
                        <span className="text-2xl md:text-3xl text-zinc-500 hidden md:inline">✦</span>
                    </div>
                    <p className="text-zinc-400 text-xs md:text-sm tracking-[0.2em] uppercase mt-2">
                        {lang === 'TH' ? 'สินค้าลดราคาพิเศษ' : lang === 'KR' ? '특별 할인 상품 모음' : 'Special Discounted Items'}
                    </p>
                    <div className="mt-6 inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-5 py-2 text-sm font-bold tracking-widest border border-white/20">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                        {validDiscounts.length}{lang === 'TH' ? ' รายการ' : lang === 'KR' ? '개 상품' : ' items on sale'}
                    </div>
                </div>
            </div>

            {/* 상품 그리드 */}
            <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-10 h-10 border-4 border-red-200 border-t-red-500 rounded-full animate-spin" />
                        <span className="ml-3 text-gray-500 font-medium">{t('loading')}</span>
                    </div>
                ) : validDiscounts.length === 0 ? (
                    // 등록된 할인 상품이 없는 경우
                    <div className="text-center py-24">
                        <div className="text-6xl mb-4">🛍️</div>
                        <p className="text-gray-400 text-lg font-medium">
                            {lang === 'TH' ? 'ยังไม่มีสินค้าลดราคา' : lang === 'KR' ? '현재 할인 중인 상품이 없습니다.' : 'No sale items at the moment.'}
                        </p>
                        <Link
                            to={`/?lang=${lang}`}
                            className="mt-6 inline-block bg-black text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-gray-800 transition-colors"
                        >
                            {t('nav_catalog')} →
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-2 gap-y-8">
                        {validDiscounts.map((item) => {
                            const mappedProduct = {
                                ...item,
                                code: item.product_code,
                            };
                            return (
                                <div key={item.product_code} className="relative rounded-lg overflow-hidden">
                                    <ProductCard 
                                        product={mappedProduct} 
                                        lang={lang} 
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SalePage;
