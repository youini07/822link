import axios from 'axios';

// 빌드된 프론트엔드가 같은 서버(5000포트)에서 서빙되므로 항상 상대 경로 사용
// Railway 배포 시에도 동일 서버이므로 상대 경로로 충분
const API_BASE_URL = '/api';

export const fetchProducts = async (params) => {
    const response = await axios.get(`${API_BASE_URL}/products`, { params });
    return response.data;
};

export const fetchProductDetail = async (code) => {
    const response = await axios.get(`${API_BASE_URL}/products/${code}`);
    return response.data;
};

export const fetchNotices = async () => {
    const response = await axios.get(`${API_BASE_URL}/notices`);
    return response.data;
};

export const fetchFilters = async () => {
    const response = await axios.get(`${API_BASE_URL}/filters`);
    return response.data;
};

export const fetchShipping = async () => {
    const response = await axios.get(`${API_BASE_URL}/shipping`);
    return response.data;
};

// 회원가입 API
export const registerCustomer = async (data) => {
    const response = await axios.post(`${API_BASE_URL}/register`, data);
    return response.data;
};

// 라인 ID 중복 확인 API
export const checkLineId = async (lineId) => {
    const response = await axios.get(`${API_BASE_URL}/check-line-id/${encodeURIComponent(lineId)}`);
    return response.data;
};

// 아이디 중복 확인 API
export const checkLoginId = async (loginId) => {
    const response = await axios.get(`${API_BASE_URL}/check-login-id/${encodeURIComponent(loginId)}`);
    return response.data;
};

// =============================================
// 로그인 API
// =============================================
export const loginCustomer = async (data) => {
    const response = await axios.post(`${API_BASE_URL}/login`, data);
    return response.data;
};

// =============================================
// 장바구니 API
// =============================================

// 장바구니 조회 (로그인 사용자용)
export const fetchCart = async (customerId) => {
    const response = await axios.get(`${API_BASE_URL}/cart/${customerId}`);
    return response.data;
};

// 장바구니에 상품 추가
export const addToCart = async (customerId, productCode, quantity = 1) => {
    const response = await axios.post(`${API_BASE_URL}/cart`, {
        customer_id: customerId,
        product_code: productCode,
        quantity
    });
    return response.data;
};

// 장바구니 수량 변경
export const updateCartQty = async (customerId, productCode, quantity) => {
    const response = await axios.put(`${API_BASE_URL}/cart`, {
        customer_id: customerId,
        product_code: productCode,
        quantity
    });
    return response.data;
};

// 장바구니 항목 삭제
export const removeFromCart = async (customerId, productCode) => {
    const response = await axios.delete(`${API_BASE_URL}/cart/${customerId}/${encodeURIComponent(productCode)}`);
    return response.data;
};

// =============================================
// 주문 API
// =============================================

// 주문 생성 (장바구니 → 주문)
export const createOrder = async (customerId, couponCode = null, couponTargetProduct = null) => {
    const response = await axios.post(`${API_BASE_URL}/orders`, {
        customer_id: customerId,
        coupon_code: couponCode,
        coupon_target_product: couponTargetProduct
    });
    return response.data;
};

// 내 주문 내역 조회
export const fetchOrders = async (customerId) => {
    const response = await axios.get(`${API_BASE_URL}/orders/${customerId}`);
    return response.data;
};

// =============================================
// 마이페이지 API
// =============================================

// 고객 정보 조회
export const fetchCustomerProfile = async (customerId) => {
    const response = await axios.get(`${API_BASE_URL}/customer/${customerId}`);
    return response.data;
};

// 내 정보 수정 (연락처, 주소)
export const updateProfile = async (customerId, data) => {
    const response = await axios.put(`${API_BASE_URL}/profile/${customerId}`, data);
    return response.data;
};

// =============================================
// 관리자 전용 API
// =============================================

// 모든 사용자의 주문 내역 조회 (검색 및 날짜 필터 추가)
export const fetchAdminOrders = async (searchType = '', searchQuery = '', date = '') => {
    const response = await axios.get(`${API_BASE_URL}/admin/orders`, {
        params: { search_type: searchType, search_query: searchQuery, date }
    });
    return response.data;
};

// 주문 주소 수정
export const updateOrderAddress = async (orderNumber, shippingAddress) => {
    const response = await axios.put(`${API_BASE_URL}/admin/orders/${orderNumber}/address`, {
        shipping_address: shippingAddress
    });
    return response.data;
};

/**
 * 당일 주문 내역 조회 (관리자 전용)
 * - 현재 날짜(YYYY-MM-DD) 형식으로 필터링하여 가져옴
 */
// 오늘 및 어제 생성된 주문 내역 모두 가져오기 (타임존 차이로 인한 누락 방지)
export const fetchTodayOrders = async () => {
    const getFormattedDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = getFormattedDate(today);
    const yesterdayStr = getFormattedDate(yesterday);

    try {
        const [todayRes, yesterdayRes] = await Promise.all([
            fetchAdminOrders('', '', todayStr),
            fetchAdminOrders('', '', yesterdayStr)
        ]);
        
        const orders = [...(todayRes.orders || []), ...(yesterdayRes.orders || [])];
        // 중복 제거 (order_number 기준)
        const uniqueOrders = Array.from(new Map(orders.map(o => [o.order_number, o])).values());
        
        return { orders: uniqueOrders };
    } catch (error) {
        console.error("Failed to fetch recent orders:", error);
        return { orders: [] };
    }
};


// 주문 삭제 API
export const deleteOrder = async (orderNumber) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/orders/${orderNumber}`);
    return response.data;
};

// 특정 주문의 송장 정보 업데이트
export const updateOrderTracking = async (orderNumber, trackingData) => {
    const response = await axios.put(`${API_BASE_URL}/orders/${orderNumber}/tracking`, trackingData);
    return response.data;
};

// 특정 주문의 상태 변경 (예: 결제 확인 시 pending -> confirmed)
export const updateOrderStatus = async (orderNumber, status, itemCodes = null) => {
    const payload = { status };
    if (itemCodes) payload.itemCodes = itemCodes;
    const response = await axios.put(`${API_BASE_URL}/orders/${orderNumber}/status`, payload);
    return response.data;
};

// [POS] 관리자 직판 처리 (Sold Out 업데이트 + 시트 기록)
export const sellDirectAdmin = async (productCode, saleNote = '관리자직판', price = undefined) => {
    const response = await axios.post(`${API_BASE_URL}/admin/sell-direct`, {
        product_code: productCode,
        sale_note: saleNote,
        price: price
    });
    return response.data;
};

// [POS] 품절 상품 재고 복구
export const restoreStockAdmin = async (productCode) => {
    const response = await axios.post(`${API_BASE_URL}/admin/restore-stock`, {
        product_code: productCode
    });
    return response.data;
};

// [POS] 구글 시트 매출 내역 조회
export const fetchAdminSales = async () => {
    const response = await axios.get(`${API_BASE_URL}/admin/sales`);
    return response.data;
};

// [POS] 구글 시트 매출 내역 개별 삭제
export const deleteAdminSale = async (rowIndex) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/sales/${rowIndex}`);
    return response.data;
};


// [POS] 비회원 주문 생성
export const createGuestOrder = async (guestName) => {
    const response = await axios.post(`${API_BASE_URL}/admin/orders/guest`, {
        guest_name: guestName
    });
    return response.data;
};

// [POS] 주문에 상품 추가
export const addOrderItem = async (orderNumber, productCode, price, quantity = 1, isManual = false, name = '') => {
    const response = await axios.post(`${API_BASE_URL}/admin/orders/${orderNumber}/items`, {
        product_code: productCode,
        price,
        quantity,
        is_manual: isManual,
        name
    });
    return response.data;
};

// [POS] 주문에서 상품 삭제
export const removeOrderItem = async (orderNumber, productCode) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/orders/${orderNumber}/items/${encodeURIComponent(productCode)}`);
    return response.data;
};

// [POS] 주문 내 상품 결제 취소
export const cancelItemPaymentAdmin = async (orderNumber, productCode) => {
    const response = await axios.put(`${API_BASE_URL}/admin/orders/${orderNumber}/items/${encodeURIComponent(productCode)}/cancel-payment`);
    return response.data;
};

// [POS] 주문 내 상품 가격 수정
export const updateOrderItemPrice = async (orderNumber, productCode, price) => {

    const response = await axios.put(`${API_BASE_URL}/admin/orders/${orderNumber}/items/${encodeURIComponent(productCode)}/price`, {
        price
    });
    return response.data;
};

// =============================================
// 위탁판매 관리 API
// =============================================

// 위탁판매 일괄 등록 (상품코드 배열)
export const registerConsignmentItems = async (codes) => {
    const response = await axios.post(`${API_BASE_URL}/admin/consignment`, { codes });
    return response.data;
};

// 위탁판매 목록 조회 (status: all, active, sold)
export const fetchConsignmentItems = async (status = 'all') => {
    const response = await axios.get(`${API_BASE_URL}/admin/consignment`, {
        params: { status, t: Date.now() }
    });
    return response.data;
};

// 위탁판매 아이템 판매완료 처리
export const markConsignmentSold = async (id, commissionRate = 0) => {
    const response = await axios.put(`${API_BASE_URL}/admin/consignment/${id}/sold`, { commissionRate });
    return response.data;
};

// 위탁판매 아이템 일괄 판매완료 처리
export const bulkMarkConsignmentSold = async (ids, commissionRate = 0) => {
    const response = await axios.post(`${API_BASE_URL}/admin/consignment/bulk-sold`, { ids, commissionRate });
    return response.data;
};

export const cancelConsignmentItem = async (id) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/consignment/${id}`);
    return response.data;
};

// 위탁판매 아이템 일괄 취소 처리
export const bulkCancelConsignmentItems = async (ids) => {
    const response = await axios.post(`${API_BASE_URL}/admin/consignment/bulk-cancel`, { ids });
    return response.data;
};

// =============================================
// 관리자 고객관리 API
// =============================================

// 전체 고객 목록 조회 (검색 지원)
export const fetchManagedCustomers = async (search = '') => {
    const response = await axios.get(`${API_BASE_URL}/admin/managed-customers`, {
        params: { search }
    });
    return response.data;
};

// 아이디 자동완성 추천 (prefix 매칭)
export const suggestCustomers = async (q) => {
    const response = await axios.get(`${API_BASE_URL}/admin/managed-customers/suggest`, {
        params: { q }
    });
    return response.data;
};

// 고객 등록
export const createManagedCustomer = async (data) => {
    const response = await axios.post(`${API_BASE_URL}/admin/managed-customers`, data);
    return response.data;
};

// 고객 정보 수정
export const updateManagedCustomer = async (id, data) => {
    const response = await axios.put(`${API_BASE_URL}/admin/managed-customers/${id}`, data);
    return response.data;
};

// 고객 삭제
export const deleteManagedCustomer = async (id) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/managed-customers/${id}`);
    return response.data;
};

// 특정 고객의 주문 내역 조회
export const fetchCustomerOrders = async (customerId) => {
    const response = await axios.get(`${API_BASE_URL}/admin/managed-customers/${encodeURIComponent(customerId)}/orders`);
    return response.data;
};

// =============================================
// 자체 통계 트래커 API
// =============================================
export const trackPageView = async (path, referrer) => {
    try {
        await axios.post(`${API_BASE_URL}/track`, { path, referrer });
    } catch (err) {
        console.error('[Tracker] track error (ignored):', err);
    }
};

export const fetchTrafficAnalytics = async () => {
    const response = await axios.get(`${API_BASE_URL}/admin/traffic`);
    return response.data;
};

// =============================================
// 사이트 설정 (틱톡 라이브 등) API
// =============================================
export const fetchSetting = async (key) => {
    try {
        const response = await axios.get(`${API_BASE_URL}/settings/${encodeURIComponent(key)}`);
        return response.data;
    } catch (err) {
        console.error(`[API] fetchSetting(${key}) error:`, err);
        return { key, value: null };
    }
};

export const updateSetting = async (key, value) => {
    const response = await axios.post(`${API_BASE_URL}/admin/settings`, { key, value });
    return response.data;
};

// =============================================
// 특별할인 상품 API
// =============================================

/**
 * 홈 상단용 — 할인율 높은 순 상위 8개 상품 조회
 */
export const fetchFeaturedDiscounts = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/discounts/featured`);
        return response.data;
    } catch (err) {
        console.error('[API] fetchFeaturedDiscounts error:', err);
        return { featured: [] };
    }
};

/**
 * 전체 할인 상품 목록 조회 (할인 페이지 & 관리자용)
 */
export const fetchDiscountedProducts = async () => {
    const response = await axios.get(`${API_BASE_URL}/discounts`);
    return response.data;
};

/**
 * 할인 상품 일괄 등록
 * @param {string} codesStr - 콤마로 구분된 상품번호 문자열 ("841,231,561")
 * @param {number} discountRate - 일괄 적용할 할인율 (선택)
 */
export const registerDiscountProducts = async (codesStr, discountRate = 0) => {
    // 콤마 구분 → 배열 변환
    const codes = codesStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
    const response = await axios.post(`${API_BASE_URL}/admin/discounts`, { codes, discount_rate: discountRate });
    return response.data;
};

/**
 * 특정 상품의 할인율 수정
 * @param {string} code - 상품 코드
 * @param {number} discountRate - 새 할인율 (0~100)
 */
export const updateDiscountRate = async (code, discountRate) => {
    const response = await axios.put(`${API_BASE_URL}/admin/discounts/${encodeURIComponent(code)}`, {
        discount_rate: discountRate
    });
    return response.data;
};

/**
 * 할인 상품 등록 해제
 * @param {string} code - 상품 코드
 */
export const deleteDiscountProduct = async (code) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/discounts/${encodeURIComponent(code)}`);
    return response.data;
};

// 구매예약 확정 API
export const confirmPreorder = async (orderNumber, updatedPrices) => {
    const response = await axios.put(`${API_BASE_URL}/admin/orders/${orderNumber}/confirm-preorder`, {
        updated_prices: updatedPrices
    });
    return response.data;
};

// =============================================
// 쿠폰 관련 API
// =============================================

export const fetchAdminCoupons = async () => {
    const response = await axios.get(`${API_BASE_URL}/admin/coupons`);
    return response.data;
};

export const generateCoupons = async (type, value, count) => {
    const response = await axios.post(`${API_BASE_URL}/admin/coupons/generate`, { type, value, count });
    return response.data;
};

export const deleteCoupon = async (code) => {
    const response = await axios.delete(`${API_BASE_URL}/admin/coupons/${encodeURIComponent(code)}`);
    return response.data;
};

export const validateCoupon = async (code) => {
    const response = await axios.get(`${API_BASE_URL}/coupons/validate/${encodeURIComponent(code)}`);
    return response.data;
};

export const toggleWishlist = async (customerId, productCode) => {
    const response = await axios.post(`${API_BASE_URL}/wishlist/toggle`, { customerId, productCode });
    return response.data;
};

export const getWishlist = async (customerId) => {
    const response = await axios.get(`${API_BASE_URL}/wishlist/${customerId}`);
    return response.data;
};

export const getRegisteredCustomers = async (search = '') => {
    const response = await axios.get(`${API_BASE_URL}/admin/registered-customers`, { params: { search } });
    return response.data;
};

export const updateRegisteredCustomer = async (id, data) => {
    const response = await axios.put(`${API_BASE_URL}/admin/registered-customers/${id}`, data);
    return response.data;
};
