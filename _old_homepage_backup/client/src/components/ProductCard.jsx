import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getTranslation, formatArrivalDate } from '../services/i18n';
import { useCart } from '../contexts/CartContext';
import { useWishlist } from '../contexts/WishlistContext';
import { addOrderItem } from '../services/api';

/**
 * 상품 카드 컴포넌트
 * - 카탈로그 그리드에 표시되는 개별 상품
 * - "장바구니 담기" 버튼 추가 (가격이 유효한 상품만)
 */
const ProductCard = ({ product, lang, isArchive: isArchivePage, isAdmin, todayOrders = [] }) => {
    const { code, brand, name, price, original_price, stock, thumbnail_url, image_url, product_images, category, discount_rate, name_en, name_th, sku } = product;
    const { addItem } = useCart();
    const { isWished, toggleWishlist } = useWishlist();
    const [added, setAdded] = useState(false);
    const [showOrderDropdown, setShowOrderDropdown] = useState(false);
    const [addStatus, setAddStatus] = useState('idle'); // idle, loading, success, error

    // [NEW] 상품 자체가 Archive 카테고리인지 판별 (페이지 필터와 무관하게 모든 곳에서 강조)
    const isArchiveProduct = String(category || '').toLowerCase().includes('dream archive');
    const isArchive = isArchivePage || isArchiveProduct;

    const isSoldOut = ['sold', 'out'].some(kw => String(stock || '').toLowerCase().includes(kw));
    const isReserved = String(stock || '').toLowerCase() === 'reserved';
    // 가격이 유효한지 확인 (TBD, 빈 값 등이 아닌 숫자인지)
    const hasValidPrice = !isNaN(Number(price)) && String(price).trim() !== '';

    const fallbackImg = '/static/nophoto.png';
    // [Cache-Buster] 이미지 갱신을 위해 쿼리 스트링 추가 (현재 날짜 기준)
    const cacheBuster = `v=${new Date().toISOString().split('T')[0]}`;
    
    const getSafeImgUrl = (urlStr) => {
        if (!urlStr) return null;
        if (typeof urlStr === 'string' && urlStr.startsWith('[')) {
            try {
                const arr = JSON.parse(urlStr);
                return arr.length > 0 ? arr[0] : null;
            } catch(e) { return null; }
        }
        return urlStr;
    };
    
    // [수정] DB 이미지(Google Drive 등) 대신 로컬 서버의 썸네일을 최우선으로 사용합니다.
    // 도착예정 상품인 경우 thumbnails_scheduled 폴더의 원본 썸네일을 불러옵니다.
    const isScheduled = !!product.arrival_date;
    const localThumb = isScheduled 
        ? `/static/thumbnails_scheduled/${code}.jpg?${cacheBuster}` 
        : `/static/thumbnails/${code}.jpg?${cacheBuster}`;

    let cleanImageFromDb = null;
    if (product_images) {
        try {
            const parsed = JSON.parse(product_images);
            if (Array.isArray(parsed) && parsed.length > 0) {
                cleanImageFromDb = parsed.find(img => img.includes('main'));
            }
        } catch (e) {}
    }
    const dbFallbackImg = cleanImageFromDb || getSafeImgUrl(thumbnail_url) || getSafeImgUrl(image_url) || fallbackImg;
    const dbImgSrc = dbFallbackImg.startsWith('http') || dbFallbackImg.startsWith('/static') 
        ? `${dbFallbackImg}${dbFallbackImg.includes('?') ? '&' : '?'}${cacheBuster}`
        : dbFallbackImg;

    // 1순위: 로컬 썸네일 이미지
    const [currentSrc, setCurrentSrc] = useState(localThumb);

    // Handle image error (로컬 이미지 실패 시 -> DB 이미지 -> 기본 이미지)
    const handleImgError = () => {
        if (currentSrc === localThumb) {
            setCurrentSrc(dbImgSrc);
        } else if (currentSrc !== fallbackImg) {
            setCurrentSrc(fallbackImg);
        }
    };

    const cardPadding = isArchive ? "pt-2 pb-5" : "pt-1 pb-2";
    const nameSize = isArchive ? "text-[16px]" : "text-[13px]";
    const imgClass = isArchive ? "product-img-archive" : "product-img";

    // 장바구니 담기 핸들러
    const handleAddToCart = async (e) => {
        e.preventDefault(); // Link 클릭 방지
        e.stopPropagation();
        if (isSoldOut || isReserved || !hasValidPrice) return;

        const success = await addItem(product);
        if (success) {
            setAdded(true);
            // 1.5초 후 원래 상태로 복원
            setTimeout(() => setAdded(false), 1500);
        }
    };

    // [Admin] 특정 주문에 즉시 추가 핸들러
    const handleAddToOrder = async (e, orderNumber) => {
        e.preventDefault();
        e.stopPropagation();
        if (isSoldOut || isReserved || !hasValidPrice) return;

        setAddStatus('loading');
        try {
            const res = await addOrderItem(orderNumber, code, price, 1);
            if (res.success) {
                setAddStatus('success');
                setTimeout(() => {
                    setAddStatus('idle');
                    setShowOrderDropdown(false);
                }, 1500);
            } else {
                setAddStatus('error');
                setTimeout(() => setAddStatus('idle'), 2000);
            }
        } catch (err) {
            console.error("[Admin Order Add] Error:", err);
            setAddStatus('error');
            setTimeout(() => setAddStatus('idle'), 2000);
        }
    };

    return (
        <div className={`product-card ${isArchive ? 'vip-card' : ''} ${isSoldOut ? 'opacity-60 grayscale-[30%]' : ''} ${isReserved ? 'border border-blue-100 shadow-sm shadow-blue-50' : ''}`}>
            <Link to={`/product/${code}?lang=${lang}`} className="w-full text-inherit no-underline block relative">

                <div className="relative w-full group">
                    <img 
                        src={currentSrc} 
                        alt={name} 
                        className={`${imgClass}`} 
                        loading="lazy" 
                        onError={handleImgError}
                        onClick={() => console.log(`[ProductCard] Image Clicked: Code=${code}, Name=${name}`)}
                    />
                    
                    {/* [NEW] 특별할인 뱃지는 아래 가격 옆으로 이동함 */}

                    {/* [NEW] Dream Archive 프리미엄 배지 */}
                    {isArchiveProduct && (
                        <div className="vip-badge-premium">
                            Dream Archive
                        </div>
                    )}
                    {isSoldOut && (
                        <div className={`absolute top-[40%] left-0 w-full text-center py-2.5 font-bold text-xs tracking-widest ${isArchive ? 'bg-gold/90 text-black' : 'bg-white/80 text-black'}`}>
                            {getTranslation(lang, 'sold_out')}
                        </div>
                    )}
                    {isReserved && (
                        <div className="absolute bottom-2 left-2 z-10 bg-blue-600/90 text-white px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase shadow-md flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                            {lang === 'KR' ? '예약중 상품' : 'Reserved'}
                        </div>
                    )}
                    
                    {/* Wishlist Heart Button */}
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleWishlist(code);
                        }}
                        className="absolute bottom-2 left-2 z-20 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center hover:bg-white shadow-sm transition-colors"
                    >
                        <svg className={`w-4 h-4 ${isWished(code) ? 'text-red-500 fill-current' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            {isWished(code) && (
                                <path stroke="none" fill="currentColor" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            )}
                        </svg>
                    </button>

                    {/* 장바구니 담기 버튼 (호버 시 표시, 가격 유효 + 품절/예약 아닌 경우만) */}
                    {hasValidPrice && !isSoldOut && !isReserved && (
                        <div className="absolute bottom-2 right-2 flex flex-col gap-1 items-end z-20">
                            {/* [Admin] 주문 직접 담기 버튼 */}
                            {isAdmin && (
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowOrderDropdown(!showOrderDropdown);
                                        }}
                                        className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all duration-200 border border-gold-deep 
                                            ${addStatus === 'success' ? 'bg-green-500 border-green-500 text-white' : 
                                              addStatus === 'error' ? 'bg-red-500 border-red-500 text-white' :
                                              'bg-white text-gold-deep opacity-0 group-hover:opacity-100 hover:bg-gold-deep hover:text-white'}`}
                                    >
                                        {addStatus === 'success' ? getTranslation(lang, 'admin_add_success') : 
                                         addStatus === 'error' ? getTranslation(lang, 'admin_add_error') :
                                         getTranslation(lang, 'admin_add_to_order')}
                                    </button>

                                    {/* 주문 선택 드롭다운 */}
                                    {showOrderDropdown && (
                                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                                            <div className="p-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-500 uppercase flex justify-between">
                                                <span>{getTranslation(lang, 'admin_select_order')}</span>
                                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowOrderDropdown(false); }}>✕</button>
                                            </div>
                                            <div className="max-h-40 overflow-y-auto">
                                                {todayOrders.length > 0 ? (
                                                    todayOrders.map(order => (
                                                        <button
                                                            key={order.order_number}
                                                            onClick={(e) => handleAddToOrder(e, order.order_number)}
                                                            className="w-full text-left px-3 py-2 text-[12px] hover:bg-gray-100 transition-colors border-b border-gray-50 last:border-0 flex flex-col"
                                                        >
                                                            <span className="font-bold text-black">{order.customer_name}</span>
                                                            <span className="text-[10px] text-gray-500 tracking-tight">#{String(order.order_number).slice(-4)}</span>
                                                        </button>
                                                    ))
                                                ) : (
                                                    <div className="p-3 text-[11px] text-center text-gray-400">
                                                        {getTranslation(lang, 'admin_no_today_orders')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 일반 장바구니 버튼 */}
                            <button
                                onClick={handleAddToCart}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all duration-200 shadow-md
                                    ${added
                                        ? 'bg-green-500 text-white'
                                        : 'bg-black/80 text-white opacity-0 group-hover:opacity-100 hover:bg-black'
                                    }`}
                            >
                                {added ? getTranslation(lang, 'added_to_cart') : getTranslation(lang, 'add_to_cart_short')}
                            </button>
                        </div>
                    )}
                </div>
                <div className={`text-center pt-3 pb-4 px-2 overflow-hidden`}>
                    {/* 1. 브랜드명 */}
                    <div className="text-[11px] uppercase tracking-wider text-[#8b9bb4] truncate w-full px-1">
                        {brand}
                    </div>

                    {/* 2. 하위카테고리 (또는 상품명) */}
                    <div className="text-[12px] text-black mt-1 truncate w-full px-1">
                        {category ? getTranslation(lang, String(category).trim()) : name}
                    </div>

                    {isArchive && (
                        <div className="flex flex-col gap-1 text-[11px] text-[#555] mt-2 mb-1 border-y border-black/5 py-2 px-1">
                            <div className="truncate"><span className="font-bold text-black">{getTranslation(lang, 'filter_size')}:</span> <span className="text-black font-medium">{product.size || '-'}</span></div>
                            {product.measured_size && (
                                <div className="truncate"><span className="font-bold text-black">{lang === 'KR' ? '실측' : 'Actual'}:</span> <span className="text-black font-medium">
                                    {String(product.measured_size).split(',').map(s => {
                                        const val = parseFloat(s);
                                        return isNaN(val) ? s.trim() : `${val}" (${Math.round(val * 2.54)}cm)`;
                                    }).join(' / ')}
                                </span></div>
                            )}
                        </div>
                    )}

                    {/* 3. 출고가 (취소선) */}
                    <div className="text-[11px] text-[#8b9bb4] line-through mt-1.5 leading-none min-h-[11px] truncate w-full px-1">
                        {!isNaN(Number(original_price)) && Number(original_price) > 0 
                            ? `${getTranslation(lang, 'currency')}${Number(original_price).toLocaleString()}` 
                            : ''}
                    </div>

                    {/* 4. 판매가 (굵게) */}
                    <div className="text-[16px] font-bold text-black mt-1 leading-none flex justify-center items-center gap-1.5">
                        {discount_rate > 0 && !isNaN(Number(price)) && (
                            <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm leading-none mr-1">
                                -{discount_rate}%
                            </span>
                        )}
                        {!isNaN(Number(price)) && String(price).trim() !== ''
                            ? `${getTranslation(lang, 'currency')}${discount_rate > 0 ? Math.round(Number(price) * (1 - discount_rate / 100)).toLocaleString() : Number(price).toLocaleString()}`
                            : formatArrivalDate(product.arrival_date, lang)
                        }
                    </div>
                </div>
            </Link>
        </div>
    );
};

export default ProductCard;
