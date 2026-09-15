import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import RecommendedBrandsList from '../components/RecommendedBrandsList';
import { fetchProducts, fetchTodayOrders } from '../services/api';
import { getTranslation } from '../services/i18n';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_NAMES = [
    '하이패션/럭셔리', '해외 브랜드', '백화점 클래식', '디자이너 브랜드',
    'SPA/베이직', '스포츠/아웃도어', '일본 빈티지/구제', '골프웨어', '기타'
];

const BrandMainPage = ({ lang }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [searchParams, setSearchParams] = useSearchParams();
    
    const [categorized, setCategorized] = useState({});
    const [loadingBrands, setLoadingBrands] = useState(true);
    // [NEW] 모바일에서는 닫아두고, 데스크탑(768px 이상)에서는 열어두도록 초기값 설정
    const [isSidebarOpen, setIsSidebarOpen] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
    
    // 플로팅 탭 다국어 지원
    const filterText = lang === 'TH' ? 'ตัวกรอง' : (lang === 'EN' ? 'Filter' : '상세 필터');
    
    const [expandedCategory, setExpandedCategory] = useState(null);
    const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || null);
    
    const [products, setProducts] = useState([]);
    const [page, setPage] = useState(1);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [todayOrders, setTodayOrders] = useState([]);
    // 서버에서 반환하는 전체 상품 수 (무한 스크롤 로드 수와 구분)
    const [totalItems, setTotalItems] = useState(0);
    
    const observerTarget = useRef(null);

    // URL 파라미터가 변경되면 동기화
    useEffect(() => {
        const urlBrand = searchParams.get('brand');
        setSelectedBrand(urlBrand || null);
    }, [searchParams]);

    // 1. 브랜드 목록 및 당일 주문 데이터 가져오기
    // ⚠️ 브랜드 fetch와 주문 fetch를 독립적으로 분리하여, 하나가 실패해도 다른 하나에 영향 없도록 함
    useEffect(() => {
        const initData = async () => {
            // 브랜드 데이터 (핵심 - 반드시 로드되어야 함)
            try {
                const brandRes = await fetch(`/api/brands/categorized?t=${Date.now()}`).then(r => r.json());
                console.log('[BrandPage] API 응답:', brandRes);
                
                if (brandRes.success) {
                    setCategorized(brandRes.categorized);
                    
                    // URL에 브랜드가 있으면 해당 브랜드가 속한 카테고리를 열어줌
                    const urlBrand = searchParams.get('brand');
                    if (urlBrand) {
                        for (const cat of CATEGORY_NAMES) {
                            if (brandRes.categorized[cat]?.includes(urlBrand)) {
                                setExpandedCategory(cat);
                                break;
                            }
                        }
                    } else {
                        // 사용자의 요청에 따라 기본적으로 모든 카테고리를 닫아둡니다 (강제 하이패션 노출 방지)
                        setExpandedCategory(null);
                    }
                } else {
                    console.error('[BrandPage] API 응답 success=false:', brandRes);
                }
            } catch (error) {
                console.error('[BrandPage] 브랜드 데이터 로드 실패:', error);
            } finally {
                setLoadingBrands(false);
            }
            
            // 당일 주문 데이터 (관리자 전용 - 일반 유저는 호출 불필요)
            if (isAdmin) {
                try {
                    const ordersRes = await fetchTodayOrders();
                    // fetchTodayOrders는 { orders: [...] } 형태를 반환 (success 키 없음)
                    setTodayOrders(ordersRes?.orders || []);
                } catch (orderErr) {
                    console.error('[BrandPage] 주문 데이터 로드 실패 (무시):', orderErr);
                }
            }
        };
        initData();
    }, []);

    // 2. 선택된 브랜드 변경 시 상품 리셋 및 로드
    useEffect(() => {
        if (!selectedBrand) return;
        
        const loadInitialProducts = async () => {
            setLoadingProducts(true);
            try {
                const data = await fetchProducts({
                    brand: selectedBrand,
                    page: 1,
                    limit: 48
                });
                setProducts(data.data || []);
                setTotalItems(data.total || 0);
                setHasMore(data.page < data.totalPages);
                setPage(1);
            } catch (error) {
                console.error("Failed to fetch products", error);
            } finally {
                setLoadingProducts(false);
            }
        };
        
        loadInitialProducts();
    }, [selectedBrand]);

    // 3. 페이지가 바뀔 때 추가 상품 로드 (무한 스크롤)
    useEffect(() => {
        if (page === 1 || !selectedBrand) return;
        
        const loadMoreProducts = async () => {
            setLoadingProducts(true);
            try {
                const data = await fetchProducts({
                    brand: selectedBrand,
                    page,
                    limit: 48
                });
                if (data.data && data.data.length > 0) {
                    setProducts(prev => {
                        const newProducts = data.data.filter(p => !prev.some(existing => existing.code === p.code));
                        return [...prev, ...newProducts];
                    });
                }
                setHasMore(data.page < data.totalPages);
            } catch (error) {
                console.error("Failed to load more products", error);
            } finally {
                setLoadingProducts(false);
            }
        };
        
        loadMoreProducts();
    }, [page, selectedBrand]);

    // 4. 무한 스크롤 옵저버
    const handleObserver = useCallback((entries) => {
        const target = entries[0];
        if (target.isIntersecting && hasMore && !loadingProducts && selectedBrand) {
            setPage(prev => prev + 1);
        }
    }, [hasMore, loadingProducts, selectedBrand]);

    useEffect(() => {
        const option = { root: null, rootMargin: '20px', threshold: 0 };
        const observer = new IntersectionObserver(handleObserver, option);
        if (observerTarget.current) observer.observe(observerTarget.current);
        return () => observer.disconnect();
    }, [handleObserver]);

    const handleCategoryClick = (cat) => {
        setExpandedCategory(prev => prev === cat ? null : cat);
    };

    const handleBrandClick = (brand) => {
        setSelectedBrand(brand);
        if (brand) { setSearchParams({ brand }); } else { setSearchParams({}); }
        // 모바일 환경일 경우, 브랜드를 선택하면 즉시 사이드바를 닫아줌
        if (window.innerWidth < 768) {
            setIsSidebarOpen(false);
        }
    };

    if (loadingBrands) {
        return <div className="flex justify-center items-center h-64 text-gray-500 text-sm">Loading Brands...</div>;
    }

    return (
        <div className="w-full flex flex-col bg-white min-h-screen pb-20 overflow-x-hidden">
            <div className="flex items-center gap-2 p-4 pb-2 border-b border-gray-100">
                <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="hidden md:block p-1.5 hover:bg-gray-100 rounded text-gray-600 transition-colors"
                    title={isSidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                </button>
                <h2 className="text-xl font-bold uppercase tracking-widest">{getTranslation(lang, 'bottom_nav_brand')}</h2>
            </div>
            
            <div className="flex flex-col md:flex-row w-full relative">
                {/* [NEW] 모바일 화면일 때 사이드바 뒷 배경 어둡게 (Backdrop) */}
                {isSidebarOpen && (
                    <div 
                        className="fixed inset-0 bg-black/50 z-[1005] md:hidden transition-opacity duration-300"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* [NEW] 모바일 전용 플로팅 토글 버튼 (닫혀있을 때만 표시) */}
                {!isSidebarOpen && (
                    <div 
                        onClick={() => setIsSidebarOpen(true)}
                        className="md:hidden fixed left-0 top-[60%] -translate-y-1/2 z-[990] py-6 pr-8 cursor-pointer group"
                    >
                        <div className="bg-black text-white px-1.5 py-4 rounded-r-xl shadow-lg flex flex-col items-center gap-1 group-active:bg-gray-800 transition-colors">
                            <svg className="w-4 h-4 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                            </svg>
                            <div 
                                className="text-[11px] font-bold"
                                style={{ 
                                    writingMode: 'vertical-rl', 
                                    textOrientation: lang === 'KR' ? 'upright' : 'mixed',
                                    letterSpacing: lang === 'KR' ? '0.1em' : 'normal',
                                    transform: lang !== 'KR' ? 'rotate(180deg)' : 'none'
                                }}
                            >
                                {filterText}
                            </div>
                        </div>
                    </div>
                )}

                {/* 왼쪽 사이드바 (카테고리/브랜드 아코디언) */}
                <div 
                    className={`
                        transition-all duration-300 ease-in-out shrink-0 bg-gray-50 border-r border-gray-200 overflow-y-auto overflow-x-hidden
                        /* 모바일 (Drawer) 설정: 헤더(z-1000) 위를 덮도록 z-index를 높임 */
                        fixed inset-y-0 left-0 z-[1010] h-[100dvh] w-4/5 max-w-[320px] shadow-2xl transform 
                        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                        /* 데스크탑 (Inline) 설정: 원래 있던 자리에 고정 */
                        md:relative md:transform-none md:shadow-none md:z-auto md:h-auto md:min-h-screen
                        ${isSidebarOpen 
                            ? 'md:w-1/3 lg:w-1/4 md:opacity-100' 
                            : 'md:w-0 md:opacity-0 md:border-r-0'}
                    `}
                >
                    <div className="min-w-[280px]">
                        {/* 모바일에서만 보이는 최상단 상세 필터 헤더 + 닫기 버튼 */}
                        <div className="flex md:hidden items-center justify-between p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
                            <span className="font-bold text-[16px]">{getTranslation(lang, 'bottom_nav_brand') || '상세 필터'}</span>
                            <button onClick={() => setIsSidebarOpen(false)} className="p-1 text-gray-400 hover:text-black">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="border-b border-gray-200/50">
                            <div 
                                onClick={() => { handleBrandClick(null); setExpandedCategory(null); }}
                                className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${selectedBrand === null ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span className="flex items-center gap-2">⭐ 추천 브랜드 홈</span>
                            </div>
                        </div>
                        <div className="border-b border-gray-200/50">
                            <div 
                                onClick={() => { handleBrandClick('All'); setExpandedCategory(null); }}
                                className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${selectedBrand === 'All' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span>{getTranslation(lang, 'view_all_products') || '전체 상품 보기'}</span>
                            </div>
                        </div>
                    {CATEGORY_NAMES.map(cat => (
                        <div key={cat} className="border-b border-gray-200/50">
                            <div 
                                onClick={() => handleCategoryClick(cat)}
                                className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${expandedCategory === cat ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span>
                                    {getTranslation(lang, cat)}
                                    {categorized[cat]?.length > 0 && (
                                        <span className={`ml-1.5 text-[11px] font-normal ${expandedCategory === cat ? 'text-gray-300' : 'text-gray-400'}`}>({categorized[cat].length})</span>
                                    )}
                                </span>
                                <span>{expandedCategory === cat ? '−' : '+'}</span>
                            </div>
                            
                            {/* 아코디언 펼침 내용 (해당 카테고리의 브랜드들) */}
                            {expandedCategory === cat && (
                                <div className="bg-gray-50 flex flex-wrap gap-2 px-4 py-4 inset-shadow-sm">
                                    {categorized[cat] && categorized[cat].length > 0 ? (
                                        categorized[cat].map(brand => (
                                            <div
                                                key={brand}
                                                onClick={() => handleBrandClick(brand)}
                                                className={`px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer transition-all border ${selectedBrand === brand ? 'bg-black text-white border-black shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-black hover:text-black shadow-sm'}`}
                                            >
                                                {brand}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="px-6 py-3 text-xs text-gray-400">
                                            {getTranslation(lang, 'no_brands_in_category') || '브랜드가 없습니다.'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    </div>
                </div>

                {/* 오른쪽 콘텐츠 (상품 리스트) */}
                <div 
                    className={`transition-all duration-300 ease-in-out p-4 md:p-6 bg-white w-full
                        ${isSidebarOpen ? 'md:w-2/3 lg:w-3/4' : 'md:w-full'}`}
                >
                    {!selectedBrand ? (
                        <RecommendedBrandsList lang={lang} isAdmin={isAdmin} todayOrders={todayOrders} />
                    ) : (
                        <>
                            <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
                                <h3 className="text-2xl font-black tracking-widest">{selectedBrand === 'All' ? (getTranslation(lang, 'view_all_products') || '전체 상품 보기') : selectedBrand}</h3>
                                <div className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                                    {totalItems} Items
                                </div>
                            </div>
                            
                            {products.length === 0 && !loadingProducts ? (
                                <div className="flex flex-col items-center justify-center py-24 px-4 bg-gray-50/30 rounded-3xl border border-gray-100 border-dashed mt-8 transition-all hover:bg-gray-50/80">
                                    <div className="w-16 h-16 mb-5 rounded-2xl bg-white shadow-sm flex items-center justify-center text-gray-300 rotate-3 transition-transform hover:rotate-6">
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                        </svg>
                                    </div>
                                    <h4 className="text-lg font-bold text-gray-700 mb-1">앗, 상품이 없네요!</h4>
                                    <p className="text-sm text-gray-400 text-center max-w-sm">
                                        {getTranslation(lang, 'no_products') || '해당 브랜드의 상품이 현재 모두 품절되었거나 준비 중입니다.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 md:gap-x-6 md:gap-y-10">
                                    {products.map(p => (
                                        <ProductCard 
                                            key={p.code} 
                                            product={p} 
                                            lang={lang} 
                                            isAdmin={isAdmin}
                                            todayOrders={todayOrders}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* 무한 스크롤 로딩 인디케이터 */}
                            {hasMore && selectedBrand && (
                                <div ref={observerTarget} className="h-32 flex flex-col items-center justify-center mt-4 mb-8 gap-4">
                                    <div className="flex space-x-2">
                                        <div className="w-2.5 h-2.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2.5 h-2.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2.5 h-2.5 bg-black rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                    <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold">Loading More</span>
                                </div>
                            )}
                            
                            {!hasMore && products.length > 0 && (
                                <div className="flex items-center justify-center py-16 opacity-70">
                                    <div className="w-12 h-[1px] bg-gray-200"></div>
                                    <span className="mx-4 text-[10px] tracking-[0.3em] uppercase font-bold text-gray-400 flex items-center gap-1.5">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13.5h-13L12 6.5z"/></svg>
                                        End of Catalog
                                    </span>
                                    <div className="w-12 h-[1px] bg-gray-200"></div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BrandMainPage;
