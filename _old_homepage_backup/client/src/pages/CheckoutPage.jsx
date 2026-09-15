import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';
import { createOrder, validateCoupon } from '../services/api';
import { getTranslation } from '../services/i18n';

/**
 * 주문 확인 + 확정 페이지
 * - 배송 주소 표시 (회원 정보에서 가져옴)
 * - 장바구니 상품 요약
 * - "주문 확정" → POST /api/orders
 */
const CheckoutPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);
    const { user, loading: authLoading } = useAuth();
    const { cartItems, cartTotal, clearCart } = useCart();
    const navigate = useNavigate();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [orderResult, setOrderResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');

    // 주문 완료 후 LINE 알림용: clearCart() 후에도 상품 목록을 유지하기 위해 별도 저장
    const [orderedItems, setOrderedItems] = useState([]);

    // 쿠폰 상태
    const [couponInput, setCouponInput] = useState('');
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [couponTarget, setCouponTarget] = useState('');
    const [validatingCoupon, setValidatingCoupon] = useState(false);

    // 로그인 안 되어 있으면 로그인으로
    if (authLoading) return null;
    if (!user) {
        navigate('/login');
        return null;
    }

    // 장바구니가 비어있으면 장바구니로
    if (cartItems.length === 0 && !orderResult) {
        navigate('/cart');
        return null;
    }

    const handleApplyCoupon = async () => {
        if (!couponInput.trim()) return;
        setValidatingCoupon(true);
        setErrorMsg('');
        try {
            const res = await validateCoupon(couponInput.trim());
            const c = res.coupon;
            setAppliedCoupon(c);
            
            // 할인율 쿠폰인 경우, 기본 타겟을 첫 번째 상품으로 설정
            if (c.type === 'rate' && productItems.length > 0) {
                setCouponTarget(productItems[0].product_code);
            }
        } catch (err) {
            const msg = err.response?.data?.message || '유효하지 않은 쿠폰입니다.';
            setErrorMsg(msg);
            setAppliedCoupon(null);
        }
        setValidatingCoupon(false);
    };

    const handlePlaceOrder = async () => {
        setErrorMsg('');
        setIsSubmitting(true);
        try {
            // 주문 완료 후 LINE 알림에 사용하기 위해, clearCart 전에 상품 목록을 저장
            setOrderedItems([...cartItems]);
            
            const result = await createOrder(
                user.id, 
                appliedCoupon ? appliedCoupon.code : null, 
                couponTarget || null
            );
            
            setOrderResult(result);
            clearCart();
        } catch (err) {
            const errData = err.response?.data;
            if (errData?.error === 'EMPTY_CART') {
                setErrorMsg(t('checkout_cart_empty'));
            } else if (errData?.error === 'CUSTOMER_NOT_FOUND') {
                setErrorMsg('계정 정보를 찾을 수 없습니다. (초기화 됨). 다시 가입해주세요.');
            } else if (errData?.error === 'INVALID_COUPON') {
                setErrorMsg('유효하지 않거나 이미 사용된 쿠폰입니다.');
            } else {
                setErrorMsg(t('checkout_error') + (errData?.message ? ' (' + errData.message + ')' : ''));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    /**
     * LINE 주문 알림 보내기
     * - DetailPage의 handleLineInquiry와 동일한 방식 (line.me/R/oaMessage)
     * - 주문 완료 후 버튼 클릭 시, 주문 내역이 자동 완성된 메시지로 관리자 LINE에 연결
     * - 왜: 서버 LINE Notify 외에, 고객이 직접 1:1 채팅으로 주문 사실을 알려주는 이중 안전장치
     */
    const handleLineOrderNotify = async () => {
        // 주문 상품 목록을 텍스트로 변환
        const itemsList = orderedItems
            .map(item => {
                const itemName = lang === 'EN' && item.name_en ? item.name_en 
                    : lang === 'TH' && item.name_th ? item.name_th 
                    : item.name;
                return `- [${item.brand || ''}] ${itemName} x${item.quantity} (฿${(Number(item.price) || 0).toLocaleString()})`;
            })
            .join('\n');

        // 다국어 메시지 템플릿
        const msgText = lang === 'KR'
            ? `[822SHOP 구매신청 알림]\n\n주문번호: ${orderResult.orderNumber}\n고객명: ${user.name}\n연락처: ${user.phone}\n\n[주문 상품]\n${itemsList}\n\n총 결제금액: ฿${orderResult.totalAmount.toLocaleString()}\n\n구매신청이 완료되었습니다. 확인 부탁드립니다!`
            : lang === 'TH'
            ? `[822SHOP แจ้งสั่งซื้อ]\n\nเลขที่สั่งซื้อ: ${orderResult.orderNumber}\nชื่อลูกค้า: ${user.name}\nเบอร์โทร: ${user.phone}\n\n[รายการสินค้า]\n${itemsList}\n\nยอดรวม: ฿${orderResult.totalAmount.toLocaleString()}\n\nสั่งซื้อเรียบร้อยแล้ว กรุณาตรวจสอบครับ/ค่ะ!`
            : `[822SHOP Order Notification]\n\nOrder No: ${orderResult.orderNumber}\nCustomer: ${user.name}\nPhone: ${user.phone}\n\n[Ordered Items]\n${itemsList}\n\nTotal: ฿${orderResult.totalAmount.toLocaleString()}\n\nOrder has been placed. Please confirm!`;

        const msgUrlEncoded = encodeURIComponent(msgText);
        const lineUrl = `https://line.me/R/oaMessage/@102ipvys/?${msgUrlEncoded}`;

        // 클립보드에 복사 후 LINE 채팅창 열기
        const alertMsg = lang === 'KR'
            ? '주문 정보가 복사되었습니다!\n라인 채팅창이 열리면 붙여넣기 해주세요.'
            : lang === 'TH'
            ? 'คัดลอกข้อมูลการสั่งซื้อแล้ว!\nกรุณา "วาง (Paste)" ในหน้าต่างแชท LINE'
            : 'Order details copied!\nPlease "Paste" it into the LINE chat.';

        try {
            await navigator.clipboard.writeText(msgText);
            alert(alertMsg);
            window.open(lineUrl, '_blank');
        } catch (err) {
            console.error('클립보드 복사 실패:', err);
            window.open(lineUrl, '_blank');
        }
    };

    // 주문 완료 화면
    if (orderResult) {
        return (
            <div className="max-w-lg mx-auto px-4 py-12 text-center">
                <div className="bg-white rounded-2xl shadow-lg p-10 border border-gray-100">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
                        <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-3">{t('checkout_success_title')}</h2>
                    <p className="text-gray-500 mb-2">{t('checkout_success_msg')}</p>
                    <div className="bg-gray-50 rounded-lg p-4 my-6">
                        <p className="text-sm text-gray-400">{t('checkout_order_number')}</p>
                        <p className="text-2xl font-mono font-bold text-black">{orderResult.orderNumber}</p>
                        <p className="text-sm text-gray-500 mt-2">
                            {t('checkout_total')}: <span className="font-bold">฿{orderResult.totalAmount.toLocaleString()}</span>
                        </p>
                    </div>

                    {/* LINE 주문 알림 섹션 */}
                    <div className="bg-green-50/50 border border-green-100 rounded-2xl p-6 mb-6">
                        <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center justify-center gap-2">
                            <svg className="w-5 h-5 text-[#06C755]" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                            </svg>
                            {lang === 'KR' ? 'LINE으로 주문 알림 보내기' : lang === 'TH' ? 'แจ้งคำสั่งซื้อทาง LINE' : 'Notify Order via LINE'}
                        </h3>

                        {/* QR 코드 섹션 - PC에서 LINE 앱이 없는 경우를 위한 대안 */}
                        <div className="mb-5">
                            <p className="text-xs text-gray-500 mb-3">
                                {lang === 'KR' 
                                    ? '📱 휴대폰으로 QR코드를 스캔하여 LINE 채팅방으로 이동하세요' 
                                    : lang === 'TH' 
                                    ? '📱 สแกน QR Code ด้วยมือถือเพื่อไปที่ห้องแชท LINE' 
                                    : '📱 Scan the QR code with your phone to open LINE chat'}
                            </p>
                            <div className="bg-white rounded-xl p-4 inline-block shadow-sm border border-gray-100">
                                <img 
                                    src="/assets/line_qr.jpg" 
                                    alt="LINE QR Code" 
                                    className="w-40 h-40 mx-auto object-contain"
                                />
                            </div>
                            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
                                <p className="text-xs font-bold text-amber-700 mb-1">
                                    {lang === 'KR' ? '⚠️ QR 스캔 시 안내' : lang === 'TH' ? '⚠️ หมายเหตุเมื่อสแกน QR' : '⚠️ Note for QR scan'}
                                </p>
                                <p className="text-xs text-amber-600">
                                    {lang === 'KR' 
                                        ? `QR코드로 접속하신 경우, 채팅방에서 아래 내용을 직접 보내주세요:\n"주문번호 ${orderResult.orderNumber} 구매신청 완료했습니다. 확인 부탁드립니다."` 
                                        : lang === 'TH' 
                                        ? `หากเข้าผ่าน QR Code กรุณาส่งข้อความนี้ในแชท:\n"หมายเลขสั่งซื้อ ${orderResult.orderNumber} สั่งซื้อเรียบร้อยแล้ว กรุณาตรวจสอบครับ/ค่ะ"` 
                                        : `If you accessed via QR code, please send this message in the chat:\n"Order No. ${orderResult.orderNumber} has been placed. Please confirm."`}
                                </p>
                            </div>
                        </div>

                        {/* 구분선 */}
                        <div className="flex items-center gap-3 mb-5">
                            <div className="flex-1 border-t border-green-200"></div>
                            <span className="text-xs text-gray-400 font-medium">
                                {lang === 'KR' ? '또는' : lang === 'TH' ? 'หรือ' : 'OR'}
                            </span>
                            <div className="flex-1 border-t border-green-200"></div>
                        </div>

                        {/* LINE 자동 전송 버튼 - 기존 기능 유지 */}
                        <button
                            onClick={handleLineOrderNotify}
                            className="w-full flex items-center justify-center gap-2 bg-[#06C755] text-white px-6 py-4 rounded-xl font-bold text-sm hover:bg-[#05b34d] transition-all shadow-lg shadow-green-200/50 mb-2"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                            </svg>
                            {lang === 'KR' ? 'LINE 앱으로 주문 내역 자동 전송' : lang === 'TH' ? 'ส่งรายละเอียดคำสั่งซื้ออัตโนมัติผ่านแอป LINE' : 'Auto-send order details via LINE app'}
                        </button>
                        <p className="text-xs text-gray-400">
                            {lang === 'KR' ? '💻 PC에 LINE이 설치되어 있는 경우, 버튼 클릭으로 주문 내역이 자동 전송됩니다' : lang === 'TH' ? '💻 หากติดตั้ง LINE บน PC แล้ว กดปุ่มเพื่อส่งรายละเอียดอัตโนมัติ' : '💻 If LINE is installed on your PC, click to auto-send order details'}
                        </p>
                    </div>

                    <div className="flex gap-3 justify-center">
                        <Link to="/orders" className="inline-block bg-black text-white px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-800 transition-colors">
                            {t('checkout_view_orders')}
                        </Link>
                        <Link to="/" className="inline-block bg-white text-black border border-gray-200 px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors">
                            {t('checkout_go_home')}
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // 장바구니 상품들 중 배송비가 아닌 실제 상품
    const productItems = cartItems;
    
    // 장바구니 소계 (배송비 제외 원래 가격)
    const itemsSubtotal = productItems.reduce((sum, item) => sum + (Number(item.price) || 0) * item.quantity, 0);

    // 쿠폰 할인액 계산
    let discountAmount = 0;
    if (appliedCoupon) {
        if (appliedCoupon.type === 'amount') {
            discountAmount = appliedCoupon.value;
            if (discountAmount > itemsSubtotal) discountAmount = itemsSubtotal;
        } else if (appliedCoupon.type === 'rate' && couponTarget) {
            const targetItem = productItems.find(it => it.product_code === couponTarget);
            if (targetItem) {
                discountAmount = Math.floor((Number(targetItem.price) || 0) * targetItem.quantity * (appliedCoupon.value / 100));
            }
        }
    }

    const finalTotal = cartTotal - discountAmount;

    // 주소 정보 조합
    const addressParts = [
        user.address_kr,
        user.address_detail,
        user.sub_district,
        user.district,
        user.province,
        user.postal_code
    ].filter(p => p && p.trim() !== '');
    const fullAddress = addressParts.join(', ');

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('checkout_title')}</h1>

            {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
                    {errorMsg}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 배송 정보 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{t('checkout_shipping_info')}</h3>
                    <div className="space-y-2 text-sm">
                        <p><span className="font-semibold">{t('checkout_name')}:</span> {user.name}</p>
                        
                        <p><span className="font-semibold">{t('checkout_phone')}:</span> {user.phone}</p>
                        <p><span className="font-semibold">{t('checkout_address')}:</span> {fullAddress}</p>
                    </div>
                </div>

                {/* 주문 요약 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{t('checkout_order_summary')}</h3>
                    <div className="space-y-3 mb-4">
                        {cartItems.map(item => (
                            <div key={item.product_code} className="flex justify-between text-sm">
                                <span className="text-gray-700 line-clamp-1 flex-1 mr-2">
                                    {lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name}
                                </span>
                                <span className="font-medium shrink-0">
                                    ฿{(Number(item.price) || 0).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-gray-100 pt-4">
                        <div className="flex justify-between text-sm font-medium text-gray-500 mb-2">
                            <span>상품 합계</span>
                            <span>฿{itemsSubtotal.toLocaleString()}</span>
                        </div>
                        {appliedCoupon && discountAmount > 0 && (
                            <div className="flex justify-between text-sm font-medium text-red-500 mb-2">
                                <span>쿠폰 할인 ({appliedCoupon.type === 'amount' ? '정액' : `${appliedCoupon.value}%`})</span>
                                <span>-฿{discountAmount.toLocaleString()}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-lg font-bold">
                            <span>{t('checkout_total')}</span>
                            <span>฿{finalTotal.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                {/* 쿠폰 입력 섹션 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:col-span-2">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">🎟️ {t('coupon_title') || '쿠폰 할인 (Coupon)'}</h3>
                    {!appliedCoupon ? (
                        <div className="flex gap-2 max-w-md">
                            <input
                                type="text"
                                placeholder={t('coupon_placeholder') || '쿠폰 코드를 입력하세요'}
                                value={couponInput}
                                onChange={(e) => setCouponInput(e.target.value)}
                                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-black uppercase"
                            />
                            <button
                                onClick={handleApplyCoupon}
                                disabled={validatingCoupon}
                                className="bg-black text-white px-6 py-3 rounded-lg font-bold text-sm hover:bg-gray-800 disabled:bg-gray-400 whitespace-nowrap"
                            >
                                {validatingCoupon ? (t('coupon_applying') || '확인 중...') : (t('coupon_apply') || '적용')}
                            </button>
                        </div>
                    ) : (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-bold text-green-700">✅ {t('coupon_applied') || '쿠폰이 적용되었습니다'}: {appliedCoupon.code}</span>
                                <button 
                                    onClick={() => { setAppliedCoupon(null); setCouponInput(''); discountAmount = 0; }}
                                    className="text-xs text-gray-500 hover:text-black underline"
                                >
                                    {t('coupon_cancel') || '취소'}
                                </button>
                            </div>
                            <p className="text-sm text-green-600 mb-3">
                                {appliedCoupon.type === 'amount' 
                                    ? (t('coupon_desc_amount') || '결제 금액에서 ฿{value} 정액 할인을 받습니다.').replace('{value}', appliedCoupon.value)
                                    : (t('coupon_desc_rate') || '선택하신 상품에서 {value}% 할인을 받습니다.').replace('{value}', appliedCoupon.value)}
                            </p>
                            
                            {appliedCoupon.type === 'rate' && (
                                <div className="mt-4 pt-4 border-t border-green-200/50">
                                    <p className="text-sm font-bold text-gray-700 mb-2">{t('coupon_select_target') || '할인을 적용할 상품을 선택하세요:'}</p>
                                    <div className="space-y-2">
                                        {productItems.map(item => (
                                            <label key={item.product_code} className="flex items-center gap-3 p-2 border border-gray-200 rounded-lg bg-white cursor-pointer hover:bg-gray-50">
                                                <input 
                                                    type="radio" 
                                                    name="couponTarget" 
                                                    value={item.product_code}
                                                    checked={couponTarget === item.product_code}
                                                    onChange={() => setCouponTarget(item.product_code)}
                                                    className="w-4 h-4 text-black focus:ring-black"
                                                />
                                                <div className="flex-1 flex justify-between text-sm">
                                                    <span className="line-clamp-1">{lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name}</span>
                                                    <span className="font-bold text-gray-900">฿{(Number(item.price) || 0).toLocaleString()}</span>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* 주문 확정 버튼 */}
            <div className="mt-8">
                <button
                    onClick={handlePlaceOrder}
                    disabled={isSubmitting}
                    className="w-full bg-black text-white py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {isSubmitting ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {t('checkout_processing')}
                        </>
                    ) : t('checkout_confirm')}
                </button>
                <p className="text-center text-xs text-gray-400 mt-3">{t('checkout_note')}</p>
            </div>
        </div>
    );
};

export default CheckoutPage;
