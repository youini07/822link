import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { fetchProducts, fetchFilters, fetchTodayOrders, fetchFeaturedDiscounts, fetchNotices } from '../services/api';
import { getTranslation, formatArrivalDate } from '../services/i18n';
import { useAuth } from '../contexts/AuthContext';
import { Helmet } from 'react-helmet-async';

const CatalogPage = ({ lang }) => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [searchParams, setSearchParams] = useSearchParams();
    
    // [New] 세션 스토리지에서 이전 상태 복구 로직
    const getSavedState = useCallback(() => {
        try {
            const saved = sessionStorage.getItem('catalog_state');
            if (saved) {
                const state = JSON.parse(saved);
                // 현재 URL의 필터와 저장된 필터가 일치할 때만 복구
                if (state.filters === searchParams.toString()) {
                    return state;
                }
            }
        } catch (e) {
            console.error("Failed to parse saved catalog state", e);
        }
        return null;
    }, [searchParams]);

    const savedState = getSavedState();
    const restoredRef = useRef(!!savedState);

    const [products, setProducts] = useState(savedState ? savedState.products : []);
    const [page, setPage] = useState(savedState ? savedState.page : 1);
    const [hasMore, setHasMore] = useState(savedState ? savedState.hasMore : true);
    const [isFetchingNext, setIsFetchingNext] = useState(false);
    const observerTarget = useRef(null);
    const [totalItems, setTotalItems] = useState(savedState ? savedState.totalItems : 0);
    const [totalPages, setTotalPages] = useState(savedState ? savedState.totalPages : 1);
    const [loading, setLoading] = useState(savedState ? false : true);
    const [todayOrders, setTodayOrders] = useState([]);
    // [New] 팁별할인 상품 상태 (uc0c1단 노출용)
    const [featuredDiscounts, setFeaturedDiscounts] = useState([]);
    // [New] 공지사항 상태
    const [notices, setNotices] = useState([]);
    // 필터 목록: brands, upperCategories(상위카테고리), categories(하위카테고리), priceRange
    const [filters, setFilters] = useState({
        brands: [], upperCategories: [], categories: [],
        priceRange: { min: 0, max: 100000 },
        widthRange: { min: 0, max: 100 },
        arrivalDates: []
    });
    const prevFiltersRef = useRef(''); // 필터 변경 감지용
    const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
    const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

    // 컴포넌트 마운트 시 필터 옵션 1회 로드
    useEffect(() => {
        fetchFilters().then(data => {
            setFilters(data);
            if (data.priceRange) {
                if (!searchParams.get('min_price')) setSliderMin(data.priceRange.min);
                if (!searchParams.get('max_price')) setSliderMax(data.priceRange.max);
            }
            if (data.widthRange) {
                if (!searchParams.get('min_width')) setWidthSliderMin(data.widthRange.min);
                if (!searchParams.get('max_width')) setWidthSliderMax(data.widthRange.max);
            }
        }).catch(() => { });

        // [New] 팁별할인 상품 로드 (uc0c1단 노출용)
        fetchFeaturedDiscounts().then(data => {
            setFeaturedDiscounts(data.featured || []);
        }).catch(() => {});

        // [New] 공지사항 로드
        fetchNotices().then(data => {
            setNotices(Array.isArray(data) ? data : (data.notices || []));
        }).catch(() => {});

        // [Admin] 당일 주문 목록 로드 (카탈로그에서 바로 주문 추가 기능용)
        if (isAdmin) {
            fetchTodayOrders()
                .then(data => setTodayOrders(data.orders || []))
                .catch(err => console.error("Failed to fetch today's orders", err));
        }
    }, [isAdmin]);

    // URL 파라미터 기반 필터 상태
    const gender = searchParams.get('gender') || 'All';
    const brand = searchParams.get('brand') || 'All';
    const upperCategory = searchParams.get('upper_category') || 'All';
    const category = searchParams.get('category') || 'All';
    const sort = searchParams.get('sort') || '0';
    const search = searchParams.get('search') || '';
    const showSoldOut = searchParams.get('show_so') || 'false';

    // [New] 검색창 로컬 상태
    const [searchInput, setSearchInput] = useState(search);

    useEffect(() => {
        setSearchInput(search);
    }, [search]);

    const handleSearchSubmit = (e) => {
        if (e) e.preventDefault();
        updateParam('search', searchInput);
    };
    const minPrice = searchParams.get('min_price') || '';
    const maxPrice = searchParams.get('max_price') || '';
    const minWidth = searchParams.get('min_width') || '';
    const maxWidth = searchParams.get('max_width') || '';
    const showInStock = searchParams.get('show_in_stock') || 'false';
    const showScheduled = searchParams.get('show_scheduled') || 'false';
    const arrivalDate = searchParams.get('arrival_date') || 'All';
    const style = searchParams.get('style') || 'All';

    // 가격 슬라이더 로컬 상태 (드래그 중 API 호출 방지)
    const [sliderMin, setSliderMin] = useState(0);
    const [sliderMax, setSliderMax] = useState(100000);

    // 가슴단면 슬라이더 로컬 상태
    const [widthSliderMin, setWidthSliderMin] = useState(0);
    const [widthSliderMax, setWidthSliderMax] = useState(100);

    // 필터 데이터 로드 후 슬라이더 초기값 동기화
    useEffect(() => {
        if (filters.priceRange) {
            const urlMin = searchParams.get('min_price');
            const urlMax = searchParams.get('max_price');
            setSliderMin(urlMin ? parseInt(urlMin) : filters.priceRange.min);
            setSliderMax(urlMax ? parseInt(urlMax) : filters.priceRange.max);
        }
        if (filters.widthRange) {
            const urlWidthMin = searchParams.get('min_width');
            const urlWidthMax = searchParams.get('max_width');
            setWidthSliderMin(urlWidthMin ? parseInt(urlWidthMin) : filters.widthRange.min);
            setWidthSliderMax(urlWidthMax ? parseInt(urlWidthMax) : filters.widthRange.max);
        }
    }, [filters.priceRange, filters.widthRange, searchParams]);

    const sortOptions = [
        getTranslation(lang, 'sort_latest'),
        getTranslation(lang, 'sort_price_asc'),
        getTranslation(lang, 'sort_price_desc'),
    ];

    useEffect(() => {
        if (restoredRef.current) {
            restoredRef.current = false;
            return;
        }

        let isCurrent = true;
        const loadData = async () => {
            // 현재 필터 조합 문자열 생성 (페이지 제외)
            const filterStr = JSON.stringify({ brand, upperCategory, category, sort, search, showSoldOut, minPrice, maxPrice, minWidth, maxWidth, showInStock, showScheduled, arrivalDate, style });
            const isNewFilter = prevFiltersRef.current !== filterStr;
            
            if (isNewFilter) {
                setPage(1); // 필터 변경 시 무조건 1페이지부터
                prevFiltersRef.current = filterStr;
            }

            if (page === 1 || isNewFilter) {
                setLoading(true);
            } else {
                setIsFetchingNext(true);
            }

            try {
                const data = await fetchProducts({
                    gender,
                    page: isNewFilter ? 1 : page, 
                    limit: 48, brand,
                    upper_category: upperCategory,
                    category, sort, search,
                    show_so: showSoldOut,
                    min_price: minPrice,
                    max_price: maxPrice,
                    min_width: minWidth,
                    max_width: maxWidth,
                    show_in_stock: showInStock,
                    show_scheduled: showScheduled,
                    arrival_date: arrivalDate === 'All' ? '' : arrivalDate,
                    style: style === 'All' ? '' : style,
                });
                
                if (!isCurrent) return;

                if (page === 1 || isNewFilter) {
                    setProducts(data.data);
                    if (isNewFilter) setPage(1); // 상태 동기화
                } else {
                    setProducts(prev => {
                        const newProducts = [...prev];
                        const existingCodes = new Set(prev.map(p => p.code));
                        data.data.forEach(p => {
                            if (!existingCodes.has(p.code)) newProducts.push(p);
                        });
                        return newProducts;
                    });
                }
                setTotalItems(data.total);
                setTotalPages(data.totalPages);
                setHasMore(page < data.totalPages);
            } catch (err) {
                if (isCurrent) console.error("Failed to fetch", err);
            } finally {
                if (isCurrent) {
                    setLoading(false);
                    setIsFetchingNext(false);
                }
            }
        };
        loadData();
        return () => { isCurrent = false; };
    }, [page, brand, upperCategory, category, sort, search, showSoldOut, minPrice, maxPrice, minWidth, maxWidth, showInStock, showScheduled, arrivalDate, style]);

    // [New] 정확한 스크롤 위치 추적 (브라우저 네비게이션 시 0으로 초기화되는 현상 방지)
    const scrollYRef = useRef(0);
    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 0) {
                scrollYRef.current = window.scrollY;
            } else if (window.scrollY === 0 && document.documentElement.scrollHeight <= window.innerHeight) {
                 scrollYRef.current = 0;
            }
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // [New] 상태 저장 로직 (언마운트 시 또는 페이지 이동 시)
    useEffect(() => {
        const handleSave = () => {
            // [Fix] 로딩 중이거나 데이터가 없는 상태에서는 잘못된 상태를 저장하지 않음
            if (loading || products.length === 0) return;

            const state = {
                products,
                page,
                hasMore,
                totalItems,
                totalPages,
                scrollY: scrollYRef.current,
                filters: searchParams.toString()
            };
            sessionStorage.setItem('catalog_state', JSON.stringify(state));
        };

        // 컴포넌트가 언마운트될 때 현재 상태 저장
        return () => handleSave();
    }, [products, page, hasMore, totalItems, totalPages, searchParams, loading]);

    // [New] 스크롤 위치 복구
    useEffect(() => {
        if (savedState && products.length > 0) {
            // 렌더링이 완료된 후 스크롤 이동 (React Router 네비게이션과 충돌 방지)
            const timer = setTimeout(() => {
                if (savedState.scrollY > 0) {
                    window.scrollTo({ top: savedState.scrollY, behavior: 'instant' });
                }
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [savedState, products.length]);

    // 무한 스크롤 스크롤 감지
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !loading && !isFetchingNext) {
                    setPage(prev => prev + 1);
                }
            },
            { threshold: 0.1 }
        );
        
        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }
        
        return () => {
            if (observerTarget.current) {
                observer.unobserve(observerTarget.current);
            }
        };
    }, [hasMore, loading, isFetchingNext]);

    const updateParam = (key, value) => {
        const newParams = new URLSearchParams(searchParams);
        if (value) {
            newParams.set(key, value);
        } else {
            newParams.delete(key);
        }
        newParams.delete('page');
        setSearchParams(newParams);
        setPage(1);
    };

    // 가격 슬라이더 변경 완료 시 (mouseup/touchend) URL에 반영
    const applyPriceSlider = useCallback(() => {
        const params = new URLSearchParams(searchParams);
        const rangeMin = filters.priceRange?.min || 0;
        const rangeMax = filters.priceRange?.max || 100000;

        // 전체 범위면 파라미터 삭제
        if (sliderMin <= rangeMin && sliderMax >= rangeMax) {
            params.delete('min_price');
            params.delete('max_price');
        } else {
            if (sliderMin > rangeMin) params.set('min_price', sliderMin.toString());
            else params.delete('min_price');
            if (sliderMax < rangeMax) params.set('max_price', sliderMax.toString());
            else params.delete('max_price');
        }
        params.delete('page');
        setSearchParams(params);
        setPage(1);
    }, [sliderMin, sliderMax, filters.priceRange, searchParams, setSearchParams]);

    // 가슴단면 슬라이더 변경 완료 시 URL에 반영
    const applyWidthSlider = useCallback(() => {
        const params = new URLSearchParams(searchParams);
        const rangeMin = filters.widthRange?.min || 0;
        const rangeMax = filters.widthRange?.max || 100;

        const minVal = widthSliderMin === '' ? rangeMin : parseFloat(widthSliderMin);
        const maxVal = widthSliderMax === '' ? rangeMax : parseFloat(widthSliderMax);

        // 전체 범위면 파라미터 삭제
        if (minVal <= rangeMin && maxVal >= rangeMax) {
            params.delete('min_width');
            params.delete('max_width');
        } else {
            if (minVal > rangeMin) params.set('min_width', minVal.toString());
            else params.delete('min_width');
            if (maxVal < rangeMax) params.set('max_width', maxVal.toString());
            else params.delete('max_width');
        }
        params.delete('page');
        setSearchParams(params);
        setPage(1);
    }, [widthSliderMin, widthSliderMax, filters.widthRange, searchParams, setSearchParams]);

    const isArchive = category === "Dream Archive";
    const isAccessoryCollection = category === "Accessory";
    const isWinterCollection = category === "Winter";

    // 가격 포맷팅 (1000 -> 1,000)
    const formatPrice = (val) => {
        return val?.toLocaleString?.() || val;
    };

    // 상위 카테고리 번역 매핑
    const getUpperCategoryTranslation = (cat) => {
        if (cat === 'Seasonless') return 'Seasonless';
        if (cat === 'Summer') return 'Summer';
        if (cat === 'Winter') return 'Winter';
        return getTranslation(lang, cat) || cat;
    };

    const winterBgStyle = isWinterCollection ? {
        backgroundImage: `url("data:image/svg+xml,%3Csvg%20width='80'%20height='80'%20viewBox='0%200%20100%20100'%20xmlns='http://www.w3.org/2000/svg'%3E%3Cg%20stroke='%2364748b'%20stroke-width='1.5'%20stroke-linecap='round'%20stroke-linejoin='round'%20opacity='0.08'%3E%3Cpath%20d='M50%2020v60M20%2050h60M28.78%2028.78l42.44%2042.44M28.78%2071.22l42.44-42.44'/%3E%3Cpath%20d='M45%2025l5-5%205%205M45%2075l5%205%205-5M25%2045l-5%205%205%205M75%2045l5%205-5%205'/%3E%3C/g%3E%3C/svg%3E")`,
        backgroundColor: '#f8fafc'
    } : {};

    return (
        <div
            className={`transition-all duration-500 relative ${isArchive ? 'vip-archive pt-10 pb-20' : ''} ${isWinterCollection || isAccessoryCollection ? 'min-h-screen' : ''}`}
            style={winterBgStyle}
        >
            <Helmet>
                <title>822SHOP - Vintage & Archive Curator</title>
                <meta name="description" content="Premium Vintage Archive Shop: Curated Luxury & Timeless Collection." />
                <link rel="canonical" href="https://www.822shop.com/" />
            </Helmet>

            <div className={`${isArchive ? 'max-w-[1440px] px-2 md:px-4' : 'max-w-7xl px-4 md:px-8'} w-full mx-auto mt-6`}>
                {/* 메인 상품 그리드 */}
                <section className="w-full">

                    {/* [New] 공지사항 섹션 — 필터가 없는 기본 홈에서만 노출 */}
                    {!isArchive && !search && brand === 'All' && upperCategory === 'All' && category === 'All' && page === 1 && notices.length > 0 && (
                        <div className="mb-10">
                            <div className="flex flex-col gap-2.5">
                                {notices.slice(0, 1).map((notice, idx) => (
                                    <a 
                                        key={idx} 
                                        href={`/notice?lang=${lang}`} 
                                        className="flex items-center group"
                                    >
                                        <span className="w-1 h-1 bg-black mr-3 shrink-0 rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></span>
                                        <span className="text-[15px] text-gray-600 font-medium group-hover:text-black transition-colors truncate flex-1">
                                            <strong className="mr-3 text-black tracking-widest text-xs uppercase">NOTICE</strong>
                                            {notice.title}
                                        </span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* [New] 도착 예정일 날짜 필터 (빨간 네모 영역) */}
                    {showScheduled === 'true' && filters.arrivalDates?.length > 0 && (
                        <div className="mb-8 animate-fadeIn">
                            <div className="flex items-center gap-3 overflow-x-auto pb-2 no-scrollbar">
                                <button
                                    onClick={() => updateParam('arrival_date', 'All')}
                                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${arrivalDate === 'All' ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200 hover:border-black'}`}
                                >
                                    {getTranslation(lang, 'filter_arrival_all')}
                                </button>
                                {filters.arrivalDates.map(d => (
                                    <button
                                        key={d}
                                        onClick={() => updateParam('arrival_date', d)}
                                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${arrivalDate === d ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200 hover:border-black'}`}
                                    >
                                        {formatArrivalDate(d, lang)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* [New] 상단 필터: 성별 및 대분류 */}
                    {!isArchive && (
                        <div className="mb-6 flex flex-col gap-3 animate-fadeIn">


                            {/* [New] 검색 및 사이즈 필터 영역 */}
                            <div className="flex flex-col md:flex-row gap-4 mb-3 bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                {/* 검색 */}
                                <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center gap-2">
                                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider shrink-0 w-16">SEARCH</span>
                                    <input 
                                        type="text" 
                                        value={searchInput}
                                        onChange={(e) => setSearchInput(e.target.value)}
                                        placeholder="상품코드 또는 상품명 검색"
                                        className="w-full text-[13px] border-b border-gray-200 px-2 py-1 focus:outline-none focus:border-black transition-colors bg-transparent placeholder-gray-300"
                                    />
                                    <button type="submit" className="shrink-0 px-3 py-1 bg-black text-white text-[11px] font-bold rounded hover:bg-gray-800 transition-colors">
                                        검색
                                    </button>
                                </form>

                                {/* 사이즈(가슴단면) 필터 */}
                                <div className="flex flex-1 items-center gap-2">
                                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider shrink-0 w-16">SIZE (inch)</span>
                                    <div className="flex items-center gap-1 flex-1">
                                        <input 
                                            type="number" 
                                            value={widthSliderMin}
                                            onChange={(e) => setWidthSliderMin(e.target.value)}
                                            placeholder="Min"
                                            className="w-full text-[13px] border-b border-gray-200 px-2 py-1 focus:outline-none focus:border-black transition-colors text-center bg-transparent placeholder-gray-300"
                                        />
                                        <span className="text-gray-300 text-xs">~</span>
                                        <input 
                                            type="number" 
                                            value={widthSliderMax}
                                            onChange={(e) => setWidthSliderMax(e.target.value)}
                                            placeholder="Max"
                                            className="w-full text-[13px] border-b border-gray-200 px-2 py-1 focus:outline-none focus:border-black transition-colors text-center bg-transparent placeholder-gray-300"
                                        />
                                    </div>
                                    <button onClick={applyWidthSlider} className="shrink-0 px-3 py-1 bg-black text-white text-[11px] font-bold rounded hover:bg-gray-800 transition-colors">
                                        적용
                                    </button>
                                </div>
                            </div>

                            {/* 상위 카테고리 탭 */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                                <button
                                    onClick={() => updateParam('upper_category', 'All')}
                                    className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all border whitespace-nowrap ${upperCategory === 'All' ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200 hover:border-black'}`}
                                >
                                    {getTranslation(lang, 'upper_category_all')}
                                </button>
                                {filters.upperCategories && filters.upperCategories.map(uCat => (
                                    <button
                                        key={uCat}
                                        onClick={() => updateParam('upper_category', uCat)}
                                        className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all border whitespace-nowrap ${upperCategory === uCat ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200 hover:border-black'}`}
                                    >
                                        {getTranslation(lang, uCat) || uCat}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* [New] 하위 카테고리 탭 (상위 카테고리 선택 시) */}
                    {upperCategory !== 'All' && !isArchive && (
                        <div className="mb-6 animate-fadeIn">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="h-4 w-[1px] bg-gray-300 mx-2 hidden"></div>
                                <span className="font-black text-lg tracking-wider">{getTranslation(lang, upperCategory) || upperCategory} {getTranslation(lang, 'category_detail') || '상세분류'}</span>
                            </div>
                            {filters.categoryMap && filters.categoryMap[upperCategory] && filters.categoryMap[upperCategory].length > 0 && (
                                <div className="flex flex-wrap gap-2 pb-2">
                                    <button
                                        onClick={() => updateParam('category', 'All')}
                                        className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all border ${category === 'All' ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-black'}`}
                                    >
                                        {getTranslation(lang, 'see_all') || '전체보기'}
                                    </button>
                                    {filters.categoryMap[upperCategory].map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => updateParam('category', cat)}
                                            className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all border ${category === cat ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-black'}`}
                                        >
                                            {getTranslation(lang, cat.replace('여성 ', '')) || cat}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className={`flex justify-between items-center mb-6 border-b pb-2 ${isArchive ? 'border-black/10' : 'border-border'}`}>
                        <div className={`flex-1 ${isArchive ? 'py-4' : ''}`}>
                            {isArchive ? (
                                <div className="text-center space-y-2">
                                    <h1 className="text-4xl md:text-5xl font-black tracking-[0.25em] text-gold-deep italic mb-1" style={{ fontFamily: 'serif' }}>
                                        822 ARCHIVE
                                    </h1>
                                    <p className="text-[13px] font-medium uppercase tracking-[0.3em] text-gray-500">
                                        Curated Luxury & Timeless Collection
                                    </p>
                                    <div className="w-24 h-[1px] bg-gold/30 mx-auto mt-4"></div>
                                </div>
                            ) : (
                                <div className="text-xl font-black uppercase tracking-[0.2em] text-sm tracking-widest">
                                    {getTranslation(lang, 'total_items')?.replace('{total}', totalItems)}
                                </div>
                            )}
                        </div>
                        {/* 모바일 필터 열기 버튼 (우측 화면 스크롤 시 방해되므로 좌측 고정 플로팅 탭으로 이동) */}
                        <div className="flex-1 text-center px-4">
                            {/* 안내문구 제거됨 */}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin"></div>
                            <div className="ml-3 font-medium">{getTranslation(lang, 'loading')}</div>
                        </div>
                    ) : (
                        <>
                            {products.length === 0 ? (
                                <div className="text-center py-20 text-gray-500">{getTranslation(lang, 'no_products')}</div>
                            ) : (
                                <div className={`grid gap-x-8 gap-y-12 ${isArchive ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4'}`}>
                                    {products.map(p => (
                                        <ProductCard 
                                            key={p.code} 
                                            product={p} 
                                            lang={lang} 
                                            isArchive={isArchive} 
                                            isAdmin={isAdmin}
                                            todayOrders={todayOrders}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* 무한 스크롤 감지 요소 */}
                            {hasMore && (
                                <div ref={observerTarget} className="h-20 flex items-center justify-center mt-8 mb-8">
                                    <div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin"></div>
                                </div>
                            )}
                            {!hasMore && products.length > 0 && (
                                <div className="text-center py-12 text-gray-400 text-sm tracking-widest uppercase">
                                    End of Catalog
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default CatalogPage;
