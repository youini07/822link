import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { getTranslation } from '../services/i18n';

/**
 * 장바구니 페이지
 * - 수량 선택 없음 (상품당 1개만 존재)
 * - 담긴 상품 목록, 삭제 가능
 * - 합계 표시 + 주문하기 버튼
 */
const CartPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);
    const { cartItems, cartTotal, cartLoading, removeItem } = useCart();
    const { isLoggedIn } = useAuth();
    const navigate = useNavigate();

    const handleCheckout = () => {
        if (!isLoggedIn) {
            navigate('/login');
            return;
        }
        navigate('/checkout');
    };

    if (cartLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('cart_title')}</h1>

            {cartItems.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl shadow-lg border border-gray-100">
                    <div className="text-5xl mb-4">🛒</div>
                    <h2 className="text-xl font-bold text-gray-700 mb-2">{t('cart_empty')}</h2>
                    <p className="text-gray-400 mb-6">{t('cart_empty_desc')}</p>
                    <Link to="/" className="inline-block bg-black text-white px-8 py-3 rounded-lg font-medium text-sm hover:bg-gray-800 transition-colors">
                        {t('cart_go_shopping')}
                    </Link>
                </div>
            ) : (
                <>
                    <div className="space-y-4 mb-8">
                        {cartItems.map((item) => {
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
                            const rawImgSrc = getSafeImgUrl(item.thumbnail_url) || getSafeImgUrl(item.image_url) || '/static/nophoto.png';
                            const cacheBuster = `v=${new Date().toISOString().split('T')[0]}`;
                            const imgSrc = rawImgSrc.startsWith('http') || rawImgSrc.startsWith('/static') 
                                ? `${rawImgSrc}${rawImgSrc.includes('?') ? '&' : '?'}${cacheBuster}`
                                : rawImgSrc;
                            const unitPrice = Number(item.price) || 0;
                            const isPreorderItem = isNaN(Number(item.price)) || 
                                                   String(item.price).trim() === '' || 
                                                   String(item.price).toUpperCase() === 'TBD' || 
                                                   !['onsale', 'soldout'].includes(String(item.stock || '').toLowerCase().replace(/\s+/g, ''));

                            return (
                                <div key={item.product_code} className="flex gap-4 bg-white rounded-xl shadow-sm border border-gray-100 p-4 items-center">
                                    {/* 상품 이미지 */}
                                    <Link to={`/product/${item.product_code}?lang=${lang}`} className="shrink-0">
                                        <img
                                            src={imgSrc}
                                            alt={item.name}
                                            className="w-20 h-20 object-cover rounded-lg bg-gray-50"
                                            loading="lazy"
                                        />
                                    </Link>

                                    {/* 상품 정보 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-xs text-gray-400 uppercase tracking-wider">{item.brand}</span>
                                            {isPreorderItem && (
                                                <span className="text-[9px] bg-blue-50 text-blue-600 font-bold px-1.5 py-0.5 rounded border border-blue-100 uppercase tracking-wider">
                                                    {lang === 'KR' ? '예약 대기' : 'Preorder'}
                                                </span>
                                            )}
                                        </div>
                                        <Link to={`/product/${item.product_code}?lang=${lang}`} className="text-sm font-medium text-gray-900 hover:underline line-clamp-1">
                                            {lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name}
                                        </Link>
                                    </div>

                                    {/* 가격 (수량 선택 없음 - 1개 고정) */}
                                    <div className="text-right shrink-0">
                                        {isPreorderItem ? (
                                            <p className="text-xs font-bold text-blue-600 bg-blue-50/50 px-2 py-1 rounded border border-blue-100/50">
                                                {lang === 'KR' ? '가격 책정 전' : 'TBD'}
                                            </p>
                                        ) : (
                                            <p className="text-sm font-bold">฿{unitPrice.toLocaleString()}</p>
                                        )}
                                    </div>

                                    {/* 삭제 */}
                                    <button
                                        onClick={() => removeItem(item.product_code)}
                                        className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                                        title={t('cart_remove')}
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* 구매예약 상품 포함 시 알림 배너 */}
                    {cartItems.some(item => 
                        isNaN(Number(item.price)) || 
                        String(item.price).trim() === '' || 
                        String(item.price).toUpperCase() === 'TBD' || 
                        !['onsale', 'soldout'].includes(String(item.stock || '').toLowerCase().replace(/\s+/g, ''))
                    ) && (
                        <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-4 mb-6 text-sm text-blue-800 flex items-start gap-3 animate-pulse-subtle">
                            <span className="text-lg shrink-0">ℹ️</span>
                            <div>
                                <h4 className="font-bold mb-0.5 text-blue-900">
                                    {lang === 'KR' ? '구매예약 신청 상품이 포함되어 있습니다.' : 'Preorder Items Included'}
                                </h4>
                                <p className="text-xs text-blue-700 leading-relaxed">
                                    {lang === 'KR' 
                                        ? '도착하지 않은 예약 상품은 합계 금액(฿0)에서 임시 제외되었습니다. 관리자가 구매예약을 확인하고 최종 가격을 책정하면 마이페이지에서 상세 가격 확인이 가능하며, 상품 상태도 예약중 상품으로 변경됩니다.'
                                        : 'Preorder items are excluded from the current total. The admin will review and finalize the price, which will update your order and mark the product as reserved.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* 합계 + 주문 */}
                    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                        <div className="flex justify-between items-center text-lg font-bold mb-6">
                            <span>{t('cart_total')}</span>
                            <span>฿{cartTotal.toLocaleString()}</span>
                        </div>
                        <button
                            onClick={handleCheckout}
                            className="w-full bg-black text-white py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-gray-800 transition-all"
                        >
                            {isLoggedIn ? t('cart_checkout') : t('cart_login_to_checkout')}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default CartPage;
