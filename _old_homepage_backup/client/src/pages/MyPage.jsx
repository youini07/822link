import AdminThemes from '../components/AdminThemes';
import AdminRecommendedBrands from '../components/AdminRecommendedBrands';
/* eslint-disable react/prop-types */
import * as XLSX from 'xlsx';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWishlist } from '../contexts/WishlistContext';
import ProductCard from '../components/ProductCard';
import { fetchOrders, fetchCustomerProfile, updateProfile, fetchAdminOrders, updateOrderTracking, updateOrderStatus, fetchProducts, sellDirectAdmin, restoreStockAdmin, fetchAdminSales, createGuestOrder, addOrderItem, removeOrderItem, cancelItemPaymentAdmin, updateOrderItemPrice, fetchProductDetail, deleteOrder, registerConsignmentItems, fetchConsignmentItems, markConsignmentSold, bulkMarkConsignmentSold, cancelConsignmentItem, bulkCancelConsignmentItems, fetchManagedCustomers, suggestCustomers, createManagedCustomer, updateManagedCustomer, deleteManagedCustomer, fetchCustomerOrders, fetchTrafficAnalytics, fetchSetting, updateSetting, fetchDiscountedProducts, registerDiscountProducts, updateDiscountRate, deleteDiscountProduct, confirmPreorder, fetchAdminCoupons, generateCoupons, deleteCoupon, getRegisteredCustomers, updateRegisteredCustomer, updateOrderAddress } from '../services/api';
import { getTranslation } from '../services/i18n';
import SalesAnalyticsTab from '../components/SalesAnalyticsTab';
import AdminThemesTab from '../components/AdminThemesTab';

/**
 * 내 정보 관리 페이지 (마이페이지)
 * 3개 탭 구조:
 * 1. 내 정보 수정 - 연락처/주소 변경
 * 2. 배송 관리 - 관리자가 입력한 송장 정보 확인
 * 3. 구매 이력 - 전체 주문/환불 내역 열람
 */

const getImageUrl = (imageUrl, thumbnailUrl) => {
    const fallbackImg = '/static/nophoto.png';
    const cacheBuster = `v=${new Date().toISOString().split('T')[0]}`;
    
    const getSafeUrl = (urlStr) => {
        if (!urlStr) return null;
        if (typeof urlStr === 'string' && urlStr.startsWith('[')) {
            try {
                const arr = JSON.parse(urlStr);
                return arr.length > 0 ? arr[0] : null;
            } catch(e) { return null; }
        }
        return urlStr;
    };
    
    const rawImgSrc = getSafeUrl(thumbnailUrl) || getSafeUrl(imageUrl) || fallbackImg;
    return rawImgSrc.startsWith('http') || rawImgSrc.startsWith('/static') 
        ? `${rawImgSrc}${rawImgSrc.includes('?') ? '&' : '?'}${cacheBuster}`
        : rawImgSrc;
};

const getTrackingUrl = (company, trackingNumber) => {
    if (!trackingNumber) return '#';
    const c = company || '한진택배';
    const num = String(trackingNumber).replace(/[^0-9a-zA-Z]/g, '');
    if (c.includes('한진')) return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${num}`;
    if (c.includes('우체국')) return `https://service.epost.go.kr/trace.RetrieveItemTraceSlct.postal?invcNo=${num}`;
    if (c.includes('대한통운') || c.includes('CJ')) return `https://search.naver.com/search.naver?query=${encodeURIComponent('CJ대한통운 배송조회 ' + num)}`;
    if (c.includes('로젠')) return `https://www.ilogen.com/web/personal/trace/${num}`;
    if (c.includes('롯데')) return `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${num}`;
    return `https://search.naver.com/search.naver?query=${encodeURIComponent(c + ' 배송조회 ' + num)}`;
};

const MyPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);
    const { user, login, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user?.role === 'admin' || user?.login_id === 'dreamstudio';

    // 현재 활성 탭 (profile, shipping, history, admin)
    const [activeTab, setActiveTab] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('tab') || null;
    });
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [profile, setProfile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    
    // 관리자 전용 상태
    const [adminOrders, setAdminOrders] = useState([]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [trackingInputs, setTrackingInputs] = useState({});
    const [adminSearchType, setAdminSearchType] = useState('order_number');
    const [adminSearchQuery, setAdminSearchQuery] = useState('');
    const [adminDateFilter, setAdminDateFilter] = useState('');
    const [selectedAdminOrder, setSelectedAdminOrder] = useState(null);
    const [preorderPricesMap, setPreorderPricesMap] = useState({}); // { [orderNumber]: { [productCode]: price } }

    // [New] POS 상품 관리 상태
    const [adminProducts, setAdminProducts] = useState([]);
    const [productSearch, setProductSearch] = useState('');
    const [productLoading, setProductLoading] = useState(false);
    const [adminProductFilter, setAdminProductFilter] = useState('all'); // all, in_stock, sold_out
    
    // [New] POS 매출 현황 상태
    const [adminSales, setAdminSales] = useState([]);
    const [salesLoading, setSalesLoading] = useState(false);
    
    // [New] 쿠폰 관리 상태
    const [adminCoupons, setAdminCoupons] = useState([]);
    const [couponType, setCouponType] = useState('amount');
    const [couponValue, setCouponValue] = useState('');
    const [couponCount, setCouponCount] = useState(1);
    const [couponLoading, setCouponLoading] = useState(false);
    
    // [New] 자체 통계 상태
    const [trafficStats, setTrafficStats] = useState(null);
    const [trafficLoading, setTrafficLoading] = useState(false);

    // [New] 위탁판매 관리 상태
    const [consignmentItems, setConsignmentItems] = useState([]);
    const [consignmentLoading, setConsignmentLoading] = useState(false);
    const [consignmentInput, setConsignmentInput] = useState('');
    const [consignmentFilter, setConsignmentFilter] = useState('all'); // all, active, sold
    const [consignmentCommission, setConsignmentCommission] = useState(10); // 기본 커미션 10%
    const [bulkSoldInput, setBulkSoldInput] = useState('');
    
    // [New] 가격 수정 모드 상태
    const [editingItem, setEditingItem] = useState(null); // { orderNumber, code, price }
    const [selectedSalesDate, setSelectedSalesDate] = useState(null); // 요약 리스트에서 특정 날짜 클릭 시 상세 토글용

    // [New] 고객관리 상태
    const [managedCustomers, setManagedCustomers] = useState([]);
    const [customerLoading, setCustomerLoading] = useState(false);
    const [customerSearch, setCustomerSearch] = useState('');
    
    const [registeredCustomers, setRegisteredCustomers] = useState([]);
    const [regCustLoading, setRegCustLoading] = useState(false);
    const [regCustSearch, setRegCustSearch] = useState('');
    const [editingRegCust, setEditingRegCust] = useState(null);
    const { wishlist } = useWishlist();

    const [selectedOrdersForExport, setSelectedOrdersForExport] = useState(new Set());

    const toggleOrderExport = (orderNumber) => {
        setSelectedOrdersForExport(prev => {
            const next = new Set(prev);
            if (next.has(orderNumber)) next.delete(orderNumber);
            else next.add(orderNumber);
            return next;
        });
    };

    useEffect(() => {
        if (activeTab === 'admin_registered_customers') {
            loadRegCustomers();
        }
    }, [activeTab]);

    const loadRegCustomers = async (search = '') => {
        setRegCustLoading(true);
        try {
            const res = await getRegisteredCustomers(search);
            setRegisteredCustomers(res.customers || []);
        } catch (err) {
            console.error('Failed to load registered customers:', err);
        }
        setRegCustLoading(false);
    };

    const handleUpdateRegCust = async (id, data) => {
        try {
            await updateRegisteredCustomer(id, data);
            alert('회원 정보가 수정되었습니다.');
            setEditingRegCust(null);
            loadRegCustomers(regCustSearch);
        } catch (err) {
            alert('수정 실패: ' + (err.response?.data?.message || err.message));
        }
    };
    
    const [customerForm, setCustomerForm] = useState({ customer_id: '', phone: '', address: '' });
    const [editingCustomer, setEditingCustomer] = useState(null); // 수정 중인 고객 객체
    const [selectedCustomer, setSelectedCustomer] = useState(null); // 주문내역 볼 고객
    const [customerOrders, setCustomerOrders] = useState([]);
    const [customerOrdersLoading, setCustomerOrdersLoading] = useState(false);

    // [New] 사이트 설정 (틱톡 링크) 상태
    const [tiktokLiveUrlInput, setTiktokLiveUrlInput] = useState('');
    const [tiktokLiveTimeInput, setTiktokLiveTimeInput] = useState('');
    const [tiktokSaving, setTiktokSaving] = useState(false);

    // [New] 할인 관리 상태
    const [discountItems, setDiscountItems] = useState([]); // 전체 할인 상품 목록
    const [discountLoading, setDiscountLoading] = useState(false);
    const [discountInput, setDiscountInput] = useState(''); // 상품코드 일괄 입력
    const [bulkDiscountRate, setBulkDiscountRate] = useState(''); // [New] 일괄 할인율 입력값 상태
    const [discountRateInputs, setDiscountRateInputs] = useState({}); // { product_code: rate입력값 }
    const [discountSaving, setDiscountSaving] = useState({}); // { product_code: true/false }

    // [New] 주문 주소 수정 상태
    const [editingAddressOrder, setEditingAddressOrder] = useState(null);
    const [editingAddressValue, setEditingAddressValue] = useState('');

    const handleSaveOrderAddress = async (orderNumber) => {
        try {
            await updateOrderAddress(orderNumber, editingAddressValue);
            alert('주문 주소가 성공적으로 수정되었습니다.');
            setEditingAddressOrder(null);
            
            // 주문 목록 리로드
            loadMyAdminData();
        } catch (err) {
            alert('주소 수정 실패: ' + (err.response?.data?.error || err.message));
        }
    };

    // 날짜 형식을 YYYY-MM-DD로 표준화하는 함수
    // • 반드시 4자리 연도(숫자)로 시작해야만 날짜로 인식 (ex: 주문번호, 메모 문자열 하다 실패 -> '' 반환)
    const normalizeDate = (dateStr) => {
        if (!dateStr) return '';
        const s = dateStr.trim();
        // YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
        const yyyyFirst = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
        if (yyyyFirst) {
            const [, y, m, d] = yyyyFirst;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        // DD-MM-YYYY or DD/MM/YYYY (not matching 2026-style numbers)
        const ddLast = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
        if (ddLast) {
            const [, d, m, y] = ddLast;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        // YYYYMMDD (no separators)
        const noSep = s.match(/^(\d{4})(\d{2})(\d{2})/);
        if (noSep) {
            const [, y, m, d] = noSep;
            return `${y}-${m}-${d}`;
        }
        return ''; // 날짜가 아니면 빈 문자열 반환→통계 제외
    };
    // 유효한 YYYY-MM 형식인지 확인
    const isValidMonth = (m) => /^\d{4}-\d{2}$/.test(m);
    
    // [New] 매출 그룹화 데이터
    const groupedSales = useMemo(() => {
        const groups = {};
        adminSales.forEach(sale => {
            const dateTime = sale['판매일시'] || '';
            const rawDate = dateTime.split(' ')[0] || '';
            const date = normalizeDate(rawDate);
            if (!date) return; // 날짜 파싱 실패 시 스킵
            const note = sale['비고'] || '';
            
            let orderKey = '현장판매';
            if (note.includes('웹주문(')) {
                const match = note.match(/웹주문\((.*?)\)/);
                if (match) orderKey = match[1];
            } else if (note !== '관리자직판' && note.trim() !== '' && note !== '현장구매(Guest)') {
                // 특정 메모가 있고 '관리자직판'이나 '현장구매'가 아니면 해당 메모를 주문 키로 사용
                orderKey = note;
            }

            if (!groups[date]) {
                groups[date] = {
                    date,
                    orders: {},
                    totalDay: 0,
                    count: 0
                };
            }

            if (!groups[date].orders[orderKey]) {
                groups[date].orders[orderKey] = {
                    orderId: orderKey,
                    customerId: sale['고객아이디'] || '',
                    amount: 0,
                    isWeb: note.includes('웹주문(')
                };
            }

            const price = Number(String(sale['판매가격'] || '0').replace(/[^0-9.-]+/g, '')) || 0;
            groups[date].orders[orderKey].amount += price;
            groups[date].totalDay += price;
            if (sale['상품코드'] !== 'SHIPPING_FEE') {
                groups[date].count += 1;
            }
        });

        return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date))
            .map(group => ({
                ...group,
                orders: Object.values(group.orders).sort((a, b) => b.amount - a.amount)
            }));
    }, [adminSales]);

    // [New] 매출 요약 통계
    const salesStats = useMemo(() => {
        const now = new Date();
        const offset = 7 * 60 * 60 * 1000;
        const thaiNow = new Date(now.getTime() + offset);
        const todayStr = thaiNow.getUTCFullYear() + '-' + String(thaiNow.getUTCMonth() + 1).padStart(2, '0') + '-' + String(thaiNow.getUTCDate()).padStart(2, '0');
        const monthStr = thaiNow.getUTCFullYear() + '-' + String(thaiNow.getUTCMonth() + 1).padStart(2, '0');

        let stats = {
            today: { count: 0, amount: 0 },
            month: { count: 0, amount: 0 },
            total: { count: 0, amount: 0 }
        };

        adminSales.forEach(sale => {
            const price = Number(String(sale['판매가격'] || '0').replace(/[^0-9.-]+/g, '')) || 0;
            
            // 전체 합계는 날짜에 상관없이 항상 누적
            if (sale['상품코드'] !== 'SHIPPING_FEE') {
                stats.total.count++;
            }
            stats.total.amount += price;

            const dateTime = sale['판매일시'] || '';
            const rawDate = dateTime.split(' ')[0] || '';
            const date = normalizeDate(rawDate);
            if (!date) return;

            const month = date.substring(0, 7);
            if (date === todayStr) {
                if (sale['상품코드'] !== 'SHIPPING_FEE') {
                    stats.today.count++;
                }
                stats.today.amount += price;
            }
            if (month === monthStr) {
                if (sale['상품코드'] !== 'SHIPPING_FEE') {
                    stats.month.count++;
                }
                stats.month.amount += price;
            }
        });
        return { ...stats, todayStr };
    }, [adminSales]);

    // [New] 월별 매출 데이터
    const monthlySales = useMemo(() => {
        const groups = {};
        adminSales.forEach(sale => {
            const dateTime = sale['판매일시'] || '';
            const rawDate = dateTime.split(' ')[0] || '';
            const date = normalizeDate(rawDate);
            if (!date) return; // 날짜없는 데이터 월별 통계에서 제외
            const month = date.substring(0, 7);
            if (!isValidMonth(month)) return; // YYYY-MM 형식이 아니면 제외
            const price = Number(String(sale['판매가격'] || '0').replace(/[^0-9.-]+/g, '')) || 0;

            if (!groups[month]) {
                groups[month] = { month, count: 0, amount: 0 };
            }
            if (sale['상품코드'] !== 'SHIPPING_FEE') {
                groups[month].count++;
            }
            groups[month].amount += price;
        });
        return Object.values(groups).sort((a, b) => b.month.localeCompare(a.month));
    }, [adminSales]);

    // [New] 위탁 판매 그룹화 데이터 (판매완료 건 전용)
    const groupedConsignment = useMemo(() => {
        if (consignmentFilter !== 'sold') return [];
        
        const groups = {};
        consignmentItems.forEach(item => {
            const batchId = item.batch_id || 'legacy'; // 차수 정보 없으면 기존건으로 분류
            if (!groups[batchId]) {
                groups[batchId] = {
                    batchId,
                    items: [],
                    totalAmount: 0,
                    totalComm: 0,
                    totalNet: 0,
                    date: item.sold_at || item.registered_at || ''
                };
            }
            groups[batchId].items.push(item);
            
            const price = Number(item.price || 0);
            const comm = Number(item.commission_amount || 0);
            const net = Number(item.net_amount || 0);
            
            groups[batchId].totalAmount += price;
            groups[batchId].totalComm += comm;
            groups[batchId].totalNet += (item.commission_rate ? net : price); // 수수료 없으면 총액이 곧 정산액
        });

        return Object.values(groups).sort((a, b) => b.batchId.localeCompare(a.batchId));
    }, [consignmentItems, consignmentFilter]);


    // [New] 비회원 주문 생성 - 인라인 UI + 자동완성
    const [showGuestOrderForm, setShowGuestOrderForm] = useState(false);
    const [guestNameInput, setGuestNameInput] = useState('');
    const [manualInputMap, setManualInputMap] = useState({}); // { orderNumber: boolean }
    const [manualDataMap, setManualDataMap] = useState({}); // { orderNumber: { name, price } }
    const [guestSuggestions, setGuestSuggestions] = useState([]);
    const [showGuestSuggestions, setShowGuestSuggestions] = useState(false);

    // [New] 결제 확인용 개별 상품 선택 상태
    const [selectedPaymentItems, setSelectedPaymentItems] = useState({}); // { order_number: [code1, code2] }

    // 내 정보 수정용 폼 데이터
    const [formData, setFormData] = useState({
        phone: '', address_kr: '',
        postal_code: '', address_detail: ''
    });

    // 구매 이력 필터
    const [historyFilter, setHistoryFilter] = useState('all');

    
    // 다음 우편번호 찾기 팝업
    const handleOpenPostcode = () => {
        if (!window.daum || !window.daum.Postcode) {
            alert((t('register_address_search') || '주소 검색') + ' 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }
        new window.daum.Postcode({
            oncomplete: function(data) {
                setFormData(prev => ({
                    ...prev,
                    postal_code: data.zonecode,
                    address_kr: data.address
                }));
            }
        }).open();
    };

    async function loadMyAdminData(type = '', query = '', dateValue = adminDateFilter) {
        setAdminLoading(true);
        try {
            const res = await fetchAdminOrders(type, query, dateValue);
            setAdminOrders(res.orders || []);
        } catch (err) {
            console.error('[MyPage] Admin load error:', err);
        }
        setAdminLoading(false);
    }

    function handleAdminSearch() {
        loadMyAdminData(adminSearchType, adminSearchQuery, adminDateFilter);
    }

    function handleAdminDateChange(date) {
        setAdminDateFilter(date);
        loadMyAdminData(adminSearchType, adminSearchQuery, date);
    }

    async function handleDeleteOrder(orderNumber) {
        if (!window.confirm(t('admin_delete_order_confirm_msg').replace('{orderNumber}', orderNumber))) return;
        try {
            await deleteOrder(orderNumber);
            alert(t('admin_order_deleted_msg'));
            loadMyAdminData();
        } catch (err) {
            console.error('[MyPage] Delete order error:', err);
            alert(t('admin_order_delete_failed_msg'));
        }
    }

    async function loadMyPageData() {
        setLoading(true);
        try {
            const [profileRes, ordersRes] = await Promise.all([
                fetchCustomerProfile(user.id),
                fetchOrders(user.id)
            ]);

            if (profileRes.customer) {
                setProfile(profileRes.customer);
                setFormData({
                    phone: profileRes.customer.phone || '',
                    address_kr: profileRes.customer.address_kr || '',
                    postal_code: profileRes.customer.postal_code || '',
                    address_detail: profileRes.customer.address_detail || ''
                });
            }
            setOrders(ordersRes.orders || []);

            // 관리자 전용 사이트 설정 로드
            if (user?.role === 'admin' || user?.login_id === 'dreamstudio') {
                fetchSetting('tiktok_live_url').then(res => {
                    setTiktokLiveUrlInput(res?.value || '');
                }).catch(() => {});
                fetchSetting('tiktok_live_time').then(res => {
                    setTiktokLiveTimeInput(res?.value || '');
                }).catch(() => {});
            }
        } catch (err) {
            console.error('[MyPage] Load error:', err);
        }
        setLoading(false);
    }

    async function handleSaveProfile() {
        setSaving(true);
        setSaveMessage('');
        try {
            await updateProfile(user.id, formData);
            setSaveMessage(t('mypage_save_success'));
            const updatedUser = { ...user, ...formData };
            login(updatedUser);
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (err) {
            console.error('[MyPage] Save profile error:', err);
            setSaveMessage(t('mypage_save_error'));
        }
        setSaving(false);
    }

    async function handleSaveTiktokUrl() {
        setTiktokSaving(true);
        try {
            await updateSetting('tiktok_live_url', tiktokLiveUrlInput);
            await updateSetting('tiktok_live_time', tiktokLiveTimeInput);
            alert('틱톡 라이브 설정이 업데이트되었습니다. 홈페이지 상단에 바로 반영됩니다.');
        } catch (err) {
            console.error('[MyPage] Save tiktok url error:', err);
            alert('업데이트에 실패했습니다.');
        }
        setTiktokSaving(false);
    }

    async function handleUpdateTracking(orderNumber) {
        const order = adminOrders.find(o => o.order_number === orderNumber);
        const input = trackingInputs[orderNumber] || {};
        const tracking_company = input.tracking_company || order?.tracking_company || '한진택배';
        const tracking_number = input.tracking_number || order?.tracking_number;

        if (!tracking_number || !tracking_company) {
            alert(t('register_fill_all') || '모든 필드를 채워주세요.');
            return;
        }

        try {
            await updateOrderTracking(orderNumber, { tracking_number, tracking_company });
            alert(t('mypage_save_success'));
            loadMyAdminData();
        } catch (err) {
            console.error('[MyPage] Update tracking error:', err);
            const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message;
            alert(`${t('mypage_save_error')}\n(${errorMsg})`);
        }
    }

    async function handleConfirmPayment(orderNumber) {
        const order = adminOrders.find(o => o.order_number === orderNumber);
        const selectedCodes = selectedPaymentItems[orderNumber] || [];
        
        // Ensure at least one item is selected if there are unpaid items
        const unpaidCount = (order?.items || []).filter(it => !it.paid).length;
        if (unpaidCount > 0 && selectedCodes.length === 0) {
            alert('결제 확인할 상품을 선택해주세요.');
            return;
        }

        const msgKey = (order?.items?.some(it => it.paid)) ? 'admin_confirm_additional_payment_msg' : 'admin_confirm_payment_msg';
        
        if (!window.confirm(t(msgKey))) return;
        
        try {
            await updateOrderStatus(orderNumber, 'confirmed', selectedCodes);
            alert(t('mypage_save_success'));
            loadMyAdminData();
        } catch (err) {
            console.error('[MyPage] Confirm payment error:', err);
            alert(t('mypage_save_error'));
        }
    }

    async function handleForceCancel(orderNumber) {
        if (!window.confirm(t('admin_force_cancel_msg') || '이 주문을 강제로 취소하시겠습니까?\n취소 시 해당 상품들의 품절 상태가 해제됩니다.')) return;
        try {
            await updateOrderStatus(orderNumber, 'cancelled');
            alert(t('mypage_save_success'));
            loadMyAdminData();
        } catch (err) {
            console.error('[MyPage] Force cancel error:', err);
            alert(t('mypage_save_error'));
        }
    }

    const handleCopyOrder = (e, order) => {
        e.stopPropagation();
        const shippingItem = (order.items || []).find(it => it.code === 'SHIPPING_FEE');
        const productItems = (order.items || []).filter(it => it.code !== 'SHIPPING_FEE');
        
        let text = `[Order Summary]\n`;
        text += `Order No: ${order.order_number}\n`;
        text += `Customer: ${order.customer_name}\n`;
        if (order.phone) text += `Phone: ${order.phone}\n`;
        if (order.shipping_address) {
            text += `Address: ${order.shipping_address.replace(/, , ,/g, '').replace(/^, /, '').trim()}\n`;
        }
        text += `\n[Items]\n`;
        
        productItems.forEach(it => {
            const name = lang === 'EN' && it.name_en ? it.name_en : lang === 'TH' && it.name_th ? it.name_th : it.name;
            text += `- [${it.brand || ''}] ${name} (${it.quantity || 1}) : ฿${Number(it.subtotal || 0).toLocaleString()}\n`;
        });
        
        if (shippingItem && shippingItem.subtotal > 0) {
            text += `- Shipping Fee : ฿${Number(shippingItem.subtotal).toLocaleString()}\n`;
        } else {
            text += `- Shipping Fee : Free\n`;
        }
        
        text += `\nTotal Product: ฿${Number(order.total_amount || 0).toLocaleString()}\n`;
        if (shippingItem && shippingItem.subtotal > 0) {
            text += `Total Shipping: ฿${Number(shippingItem.subtotal).toLocaleString()}\n`;
            text += `Grand Total: ฿${(Number(order.total_amount || 0) + Number(shippingItem.subtotal)).toLocaleString()}\n`;
        } else {
            text += `Grand Total: ฿${Number(order.total_amount || 0).toLocaleString()} (Free Shipping)\n`;
        }

        navigator.clipboard.writeText(text).then(() => {
            alert('주문서가 클립보드에 복사되었습니다.');
        }).catch(err => {
            console.error('Copy failed', err);
            alert('복사 실패! 브라우저 설정에서 클립보드 권한을 확인해주세요.');
        });
    };

    async function handleCancelOrder(orderNumber) {
        if (!window.confirm(lang === 'KR' ? '주문을 취소하시겠습니까?\n취소 시 재고가 실시간으로 안전하게 복구됩니다.' : 'Are you sure you want to cancel this order?')) return;
        try {
            await updateOrderStatus(orderNumber, 'cancelled');
            alert(lang === 'KR' ? '주문이 취소되었습니다.' : 'Order has been cancelled.');
            await loadMyPageData();
        } catch (err) {
            console.error('[MyPage] Cancel order error:', err);
            alert('주문 취소 실패');
        }
    }

    // [New] 비회원 주문 생성 — 인라인 자동완성 기반
    async function handleGuestNameChange(value) {
        setGuestNameInput(value);
        if (value.trim().length >= 1) {
            try {
                const res = await suggestCustomers(value.trim());
                setGuestSuggestions(res.suggestions || []);
                setShowGuestSuggestions(true);
            } catch {
                setGuestSuggestions([]);
            }
        } else {
            setGuestSuggestions([]);
            setShowGuestSuggestions(false);
        }
    }

    function handleSelectGuestSuggestion(suggestion) {
        setGuestNameInput(suggestion.customer_id);
        setShowGuestSuggestions(false);
    }

    async function handleCreateGuestOrder() {
        if (!guestNameInput.trim()) {
            alert('아이디를 입력해주세요.');
            return;
        }
        try {
            await createGuestOrder(guestNameInput.trim());
            alert('주문 셀이 생성되었습니다.');
            setGuestNameInput('');
            setShowGuestOrderForm(false);
            loadMyAdminData();
        } catch (err) {
            console.error('[MyPage] Create guest order error:', err);
            alert('주문 생성 실패');
        }
    }

    // [New] 고객관리 함수들
    async function loadManagedCustomers(search = '') {
        setCustomerLoading(true);
        try {
            const res = await fetchManagedCustomers(search);
            setManagedCustomers(res.customers || []);
        } catch (err) {
            console.error('[Admin] Load managed customers error:', err);
        }
        setCustomerLoading(false);
    }

    async function handleRegisterCustomer() {
        if (!customerForm.customer_id.trim()) {
            alert('고객 아이디를 입력해주세요.');
            return;
        }
        try {
            await createManagedCustomer(customerForm);
            alert('고객이 등록되었습니다.');
            setCustomerForm({ customer_id: '', phone: '', address: '' });
            loadManagedCustomers(customerSearch);
        } catch (err) {
            console.error('[Admin] Register customer error:', err);
            alert(err.response?.data?.message || '고객 등록 실패');
        }
    }

    async function handleUpdateCustomer() {
        if (!editingCustomer) return;
        try {
            await updateManagedCustomer(editingCustomer.id, {
                customer_id: editingCustomer.customer_id,
                phone: editingCustomer.phone,
                address: editingCustomer.address,
            });
            alert('고객 정보가 수정되었습니다.');
            setEditingCustomer(null);
            loadManagedCustomers(customerSearch);
        } catch (err) {
            console.error('[Admin] Update customer error:', err);
            alert(err.response?.data?.message || '고객 수정 실패');
        }
    }

    async function handleDeleteCustomer(id) {
        if (!window.confirm(t('admin_delete_customer_confirm_msg'))) return;
        try {
            await deleteManagedCustomer(id);
            alert(t('admin_customer_deleted_msg'));
            loadManagedCustomers(customerSearch);
            if (selectedCustomer?.id === id) setSelectedCustomer(null);
        } catch (err) {
            console.error('[Admin] Delete customer error:', err);
            alert(t('mypage_save_error'));
        }
    }

    async function handleViewCustomerOrders(customer) {
        // 토글 형태: 이미 선택된 고객 다시 클릭하면 닫기
        if (selectedCustomer?.id === customer.id) {
            setSelectedCustomer(null);
            setCustomerOrders([]);
            return;
        }
        setSelectedCustomer(customer);
        setCustomerOrdersLoading(true);
        try {
            const res = await fetchCustomerOrders(customer.customer_id);
            setCustomerOrders(res.orders || []);
        } catch (err) {
            console.error('[Admin] Fetch customer orders error:', err);
            setCustomerOrders([]);
        }
        setCustomerOrdersLoading(false);
    }

    // [New] 주문에 상품 추가
    async function handleAddItem(orderNumber) {
        try {
            const isManual = manualInputMap[orderNumber];
            let productData = null;

            if (isManual) {
                const mData = manualDataMap[orderNumber] || {};
                if (!mData.name || !mData.price) {
                    alert('상품명과 가격을 모두 입력해주세요.');
                    return;
                }
                productData = {
                    is_manual: true,
                    name: mData.name,
                    price: Number(mData.price)
                };
            } else {
                const inputEl = document.getElementById(`item-input-${orderNumber}`);
                const code = inputEl?.value?.trim();
                if (!code) {
                    alert('추가할 상품 번호를 입력하세요.');
                    return;
                }
                // 1. 상품 검색
                const product = await fetchProductDetail(code);
                if (!product) {
                    alert('상품을 찾을 수 없습니다.');
                    return;
                }
                productData = {
                    product_code: code,
                    price: Number(product.price)
                };
            }

            // 3. 상품 추가 API 호출
            const res = await addOrderItem(orderNumber, productData.product_code, productData.price, 1, productData.is_manual, productData.name);
            alert('상품이 추가되었습니다.');
            if (!isManual) {
                const inputEl = document.getElementById(`item-input-${orderNumber}`);
                if (inputEl) inputEl.value = '';
            } else {
                setManualDataMap(prev => ({ ...prev, [orderNumber]: { name: '', price: '' } }));
                setManualInputMap(prev => ({ ...prev, [orderNumber]: false }));
            }
            
            // UI 최신화
            await loadMyAdminData();
            // selectedAdminOrder가 갱신되어야 새 아이템이 바로 보이므로 현재 주문만 덮어쓰기
            setSelectedAdminOrder(prev => prev && prev.order_number === orderNumber ? { ...prev, items: res.items, total_amount: res.totalAmount, status: res.status || 'pending' } : prev);

        } catch (err) {
            console.error('[MyPage] Add item error:', err);
            alert(err.response?.data?.message || '상품 추가 실패');
        }
    }

    // [New] 주문에서 상품 삭제
    async function handleRemoveItem(orderNumber, code) {
        if (!window.confirm(t('admin_delete_item_confirm_msg'))) return;
        try {
            const res = await removeOrderItem(orderNumber, code);
            alert(t('admin_item_deleted_msg'));
            await loadMyAdminData();
            setSelectedAdminOrder(prev => prev && prev.order_number === orderNumber ? { ...prev, items: res.items, total_amount: res.totalAmount, status: res.status || 'pending' } : prev);
        } catch (err) {
            console.error('[MyPage] Remove item error:', err);
            alert(t('mypage_save_error'));
        }
    }

    // [New] 주문 내 상품 가격 수정 제출
    async function handleUpdateItemPrice(orderNumber, code, newPrice) {
        if (isNaN(newPrice)) {
            alert('올바른 숫자를 입력하세요.');
            return;
        }
        try {
            const res = await updateOrderItemPrice(orderNumber, code, newPrice);
            // UI 최신화
            await loadMyAdminData();
            setSelectedAdminOrder(prev => prev && prev.order_number === orderNumber ? { ...prev, items: res.items, total_amount: res.totalAmount, status: res.status || 'pending' } : prev);
            setEditingItem(null);
        } catch (err) {
            console.error('[MyPage] Update price error:', err);
            alert('가격 수정 실패');
        }
    }

    async function loadAdminProducts(search = '', stock_status = 'all') {
        setProductLoading(true);
        try {
            const res = await fetchProducts({ search, stock_status, limit: 100, isAdminPanel: true });
            setAdminProducts(res.data || []);
        } catch (err) {
            console.error('[Admin] Load products error:', err);
        }
        setProductLoading(false);
    }

    async function handleSellDirect(product) {
        const inputPrice = window.prompt(`[${product.code}] ${product.name}\n${t('admin_sales_amount')}을 확인하거나 수정해주세요.`, product.price);
        if (inputPrice === null) return;
        const finalPrice = Number(inputPrice);
        if (isNaN(finalPrice)) {
            alert('올바른 숫자를 입력해주세요.');
            return;
        }
        if (!window.confirm(`[${product.code}] \u0e3f${finalPrice.toLocaleString()}에 ${t('admin_sell_direct')} 처리하시겠습니까?\n이 작업은 구글 시트에 매출로 기록됩니다.`)) return;
        try {
            await sellDirectAdmin(product.code, '판매완료', finalPrice);
            alert(t('mypage_save_success'));
            loadAdminProducts(productSearch);
        } catch (err) {
            console.error('[Admin] Sell direct error:', err);
            alert(t('mypage_save_error'));
        }
    }

    async function handleRestoreStock(productCode) {
        if (!window.confirm(`[${productCode}] 재고를 다시 '판매 가능' 상태로 복구하시겠습니까?`)) return;
        try {
            await restoreStockAdmin(productCode);
            alert(t('mypage_save_success'));
            loadAdminProducts(productSearch);
        } catch (err) {
            console.error('[Admin] Restore stock error:', err);
            alert(t('mypage_save_error'));
        }
    }

    async function handleCancelItemPayment(orderNumber, code) {
        if (!window.confirm(t('admin_cancel_item_payment_confirm_msg'))) return;
        try {
            await cancelItemPaymentAdmin(orderNumber, code);
            alert(t('mypage_save_success'));
            loadMyAdminData();
            loadAdminSales(); // 매출 현황도 갱신
        } catch (err) {
            console.error('[Admin] Cancel item payment error:', err);
            alert(t('mypage_save_error'));
        }
    }

    // [New] 구매예약 확정 처리
    async function handleConfirmPreorder(orderNumber, updatedPrices) {
        if (!updatedPrices || Object.keys(updatedPrices).length === 0) {
            alert('확정할 예약 상품의 가격을 책정해주세요.');
            return;
        }
        
        // 입력값 검증 (숫자만 입력되었는지 확인)
        for (const [code, val] of Object.entries(updatedPrices)) {
            if (isNaN(val) || String(val).trim() === '' || Number(val) < 0) {
                alert(`상품 [${code}]의 가격을 올바른 숫자로 입력해주세요.`);
                return;
            }
        }

        if (!window.confirm('이 가격으로 구매예약을 확정하시겠습니까?\n확정 시 상품 가격이 변경되고 상품 상태가 [예약중]으로 실시간 갱신됩니다.')) return;
        
        try {
            await confirmPreorder(orderNumber, updatedPrices);
            alert('구매예약이 성공적으로 확정되었습니다!');
            await loadMyAdminData();
            setSelectedAdminOrder(null);
        } catch (err) {
            console.error('[MyPage] Confirm preorder error:', err);
            alert(err.response?.data?.message || '구매예약 확정 실패');
        }
    }


    async function loadAdminSales() {
        setSalesLoading(true);
        try {
            const res = await fetchAdminSales();
            setAdminSales(res.sales || []);
        } catch (err) {
            console.error('[Admin] Load sales error:', err);
        }
        setSalesLoading(false);
    }

    async function loadTrafficStats() {
        setTrafficLoading(true);
        try {
            const res = await fetchTrafficAnalytics();
            setTrafficStats(res);
        } catch (err) {
            console.error('[Admin] Load traffic error:', err);
        }
        setTrafficLoading(false);
    }


    // [New] 위탁판매 목록 로드
    async function loadConsignmentItems(status = consignmentFilter) {
        setConsignmentLoading(true);
        try {
            const res = await fetchConsignmentItems(status);
            setConsignmentItems(res.items || []);
        } catch (err) {
            console.error('[Admin] Load consignment error:', err);
        }
        setConsignmentLoading(false);
    }

    // [New] 위탁판매 일괄 등록
    async function handleRegisterConsignment() {
        if (!consignmentInput.trim()) {
            alert('상품번호를 입력하세요.');
            return;
        }
        // 콤마로 구분된 코드를 배열로 변환
        const codes = consignmentInput.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (codes.length === 0) {
            alert('유효한 상품번호가 없습니다.');
            return;
        }
        try {
            const res = await registerConsignmentItems(codes);
            alert(`${res.insertedCount}개 상품이 위탁 등록되었습니다.`);
            setConsignmentInput('');
            loadConsignmentItems();
        } catch (err) {
            console.error('[Admin] Register consignment error:', err);
            alert('위탁 등록 실패');
        }
    }

    // [New] 위탁판매 판매완료 처리
    async function handleConsignmentSold(id) {
        if (!window.confirm('이 위탁 상품을 판매완료 처리하시겠습니까?')) return;
        try {
            // Optimistic update
            setConsignmentItems(prev => prev.map(it => it.id === id ? { ...it, status: 'sold' } : it));
            
            await markConsignmentSold(id, consignmentCommission);
            alert(t('mypage_save_success'));
            loadConsignmentItems();
        } catch (err) {
            console.error('[Admin] Mark consignment sold error:', err);
            alert(t('mypage_save_error'));
        }
    }

    // [New] 위탁판매 일괄 판매완료 처리
    async function handleBulkConsignmentSold() {
        if (!bulkSoldInput.trim()) {
            alert('판매 완료할 상품 번호(ID)를 입력하세요.');
            return;
        }
        const ids = bulkSoldInput.split(',').map(id => id.trim()).filter(id => id.length > 0);
        if (ids.length === 0) return;

        if (!window.confirm(`${ids.length}개의 위탁 상품을 일괄 판매완료 처리하시겠습니까?\n(설정된 커미션: ${consignmentCommission}%)`)) return;

        try {
            // Optimistic update
            setConsignmentItems(prev => prev.map(it => ids.includes(String(it.id)) ? { ...it, status: 'sold' } : it));

            await bulkMarkConsignmentSold(ids, consignmentCommission);
            alert(`${ids.length}건이 처리되었습니다.`);
            setBulkSoldInput('');
            loadConsignmentItems();
        } catch (err) {
            console.error('[Admin] Bulk consignment sold error:', err);
            alert('일괄 처리 중 오류가 발생했습니다.');
        }
    }

    async function handleConsignmentCancel(id) {
        if (!window.confirm(t('consignment_cancel_confirm_msg'))) return;
        try {
            await cancelConsignmentItem(id);
            alert(t('mypage_save_success'));
            loadConsignmentItems(); // 이제 백엔드에서 cancelled 항목을 필터링하므로 리스트에서 사라짐
        } catch (err) {
            console.error('[Admin] Cancel consignment error:', err);
            alert(t('mypage_save_error'));
        }
    }

    // [New] 위탁중인 제품 전체 취소
    async function handleCancelAllActive() {
        // active 상태인 아이템들만 추출
        const activeIds = consignmentItems
            .filter(item => item.status === 'active')
            .map(item => item.id);

        if (activeIds.length === 0) {
            alert('현재 위탁 중인 상품이 없습니다.');
            return;
        }

        if (!window.confirm(`현재 위탁 중인 상품 ${activeIds.length}건을 모두 취소하시겠습니까?`)) return;

        try {
            await bulkCancelConsignmentItems(activeIds);
            alert(`${activeIds.length}건의 위탁이 취소되었습니다.`);
            loadConsignmentItems();
        } catch (err) {
            console.error('[Admin] Bulk cancel consignment error:', err);
            alert('일괄 취소 처리 중 오류가 발생했습니다.');
        }
    }

    // ═══════════════════════════════════
    // [New] 특별할인 관리 함수들
    // ═══════════════════════════════════

    // 쿠폰 로드
    async function loadCoupons() {
        try {
            const res = await fetchAdminCoupons();
            setAdminCoupons(res.coupons || []);
        } catch (e) {
            console.error('[Admin] Load coupons error:', e);
        }
    }

    async function handleGenerateCoupons() {
        if (!couponValue || Number(couponValue) <= 0) return alert('할인 혜택(금액/비율)을 정확히 입력하세요.');
        if (!couponCount || Number(couponCount) <= 0) return alert('발급 매수를 1 이상 입력하세요.');
        if (!window.confirm(`선택하신 혜택으로 총 ${couponCount}장의 일회성 쿠폰을 발급하시겠습니까?`)) return;
        
        setCouponLoading(true);
        try {
            await generateCoupons(couponType, Number(couponValue), Number(couponCount));
            alert('성공적으로 발급되었습니다. 구글 시트에도 동기화되었습니다.');
            setCouponValue('');
            setCouponCount(1);
            loadCoupons();
        } catch (e) {
            console.error(e);
            alert('발급 중 오류가 발생했습니다.');
        }
        setCouponLoading(false);
    }

    async function handleDeleteCoupon(code) {
        if (!window.confirm(`정말 이 쿠폰(${code})을 삭제하시겠습니까?`)) return;
        try {
            await deleteCoupon(code);
            alert('쿠폰이 삭제되었습니다.');
            loadCoupons();
        } catch (e) {
            console.error('[Admin] Delete coupon error:', e);
            alert('쿠폰 삭제 중 오류가 발생했습니다.');
        }
    }

    const handlePrintCoupons = () => {
        const printableCoupons = adminCoupons.filter(c => !c.is_used).slice(0, 20);
        if (printableCoupons.length === 0) {
            alert('인쇄할 미사용 쿠폰이 없습니다.');
            return;
        }
        window.print();
    };

    /** 할인 상품 전체 목록 로드 */
    async function loadDiscountItems() {
        setDiscountLoading(true);
        try {
            const res = await fetchDiscountedProducts();
            const items = res.discounts || [];
            setDiscountItems(items);
            // 각 상품의 기존 할인율을 입력칸 초기값으로 세팅
            const rateMap = {};
            items.forEach(item => {
                rateMap[item.product_code] = String(item.discount_rate || 0);
            });
            setDiscountRateInputs(rateMap);
        } catch (err) {
            console.error('[Admin] Load discount items error:', err);
        }
        setDiscountLoading(false);
    }

    /**
     * 상품번호 일괄 등록 및 적용 (콤마 구분 텍스트 + 일괄 할인율)
     */
    async function handleRegisterDiscounts() {
        if (!discountInput.trim()) {
            alert('상품번호를 입력하세요. (예: 841,231,561)');
            return;
        }
        try {
            const res = await registerDiscountProducts(discountInput, bulkDiscountRate);
            alert(`${res.insertedCount}개 상품이 할인 목록에 등록 및 적용되었습니다.\n(적용 할인율: ${res.appliedRate || 0}%)`);
            setDiscountInput('');
            setBulkDiscountRate('');
            await loadDiscountItems();
        } catch (err) {
            console.error('[Admin] Register discount error:', err);
            alert(err.response?.data?.error || '등록 실패');
        }
    }

    /**
     * 개별 할인율 적용
     * 입력칸의 값으로 서버에 PUT 요청
     */
    async function handleUpdateDiscountRate(productCode) {
        const rateStr = discountRateInputs[productCode];
        const rate = parseInt(rateStr, 10);
        if (isNaN(rate) || rate < 0 || rate > 100) {
            alert('할인율은 0~100 사이의 숫자를 입력하세요.');
            return;
        }
        setDiscountSaving(prev => ({ ...prev, [productCode]: true }));
        try {
            await updateDiscountRate(productCode, rate);
            // 할인율 적용 시 즉시 홈페이지에 반영되므로 메시지만 표시
            alert(`✅ 상품 [${productCode}] 할인율 ${rate}% 적용 완료!\n홈페이지 할인 섹션에 즉시 반영됩니다.`);
            await loadDiscountItems();
        } catch (err) {
            console.error('[Admin] Update discount rate error:', err);
            alert(err.response?.data?.error || '할인율 수정 실패');
        }
        setDiscountSaving(prev => ({ ...prev, [productCode]: false }));
    }

    /** 특정 상품 할인 해제 */
    async function handleDeleteDiscount(productCode) {
        if (!window.confirm(`[${productCode}] 상품의 할인 등록을 해제하시겠습니까?`)) return;
        try {
            await deleteDiscountProduct(productCode);
            alert('할인 해제되었습니다.');
            await loadDiscountItems();
        } catch (err) {
            console.error('[Admin] Delete discount error:', err);
            alert('할인 해제 실패');
        }
    }

    // 탭 정의 (일반 주문 및 예약구매 분리 탭 추가)
    const tabs = useMemo(() => {
        return isAdmin
            ? [
                { id: 'admin_themes', label: '🎨 추천 테마 관리', icon: '' },
                { id: 'admin_recommended_brands', label: '⭐ 추천 브랜드 관리', icon: '' },
                { id: 'admin_orders', label: '일반 주문 관리', icon: '📦' },
                { id: 'admin_preorders', label: '예약 구매 관리', icon: '🕒', disabled: true },
                { id: 'admin_customers', label: '회원 관리', icon: '👥' },
                { id: 'admin_registered_customers', label: '비회원 고객', icon: '🛡️' },
                { id: 'admin_products', label: t('admin_tab_products'), icon: '🏷️' },
                { id: 'admin_discounts', label: '🔥 할인관리', icon: '' },
                { id: 'admin_coupons', label: '🎟️ 쿠폰관리', icon: '' },
                { id: 'admin_sales', label: t('admin_tab_sales'), icon: '💰' },
                { id: 'admin_analytics', label: t('admin_tab_analytics'), icon: '📈' },
                { id: 'admin_consignment', label: t('admin_tab_consignment'), icon: '🤝', disabled: true },
                { id: 'profile', label: t('mypage_tab_profile'), icon: '👤' },
            ]
            : [
                { id: 'profile', label: t('mypage_tab_profile'), icon: '👤' },
                { id: 'shipping', label: t('mypage_tab_shipping'), icon: '📦' },
                { id: 'history', label: t('mypage_tab_history') || '일반 주문 내역', icon: '📋' },
                { id: 'wishlist', label: t('mypage_tab_wishlist') || '❤️ 내 찜 목록', icon: '❤️' },
                { id: 'preorders', label: t('mypage_tab_preorders') || '예약 구매 내역', icon: '🕒' },
            ];
    }, [isAdmin, lang]);

    // activeTab이 null이 아닌데 현재 가능한 탭 목록에 없으면 메뉴 화면(null)으로 강제 조정
    useEffect(() => {
        const validIds = tabs.map(tab => tab.id);
        if (activeTab !== null && !validIds.includes(activeTab)) {
            setActiveTab(null);
        }
    }, [isAdmin, activeTab, tabs]);

    // 탭 전환 시 데이터 로드
    useEffect(() => {
        if (!isAdmin) return;
        if (activeTab === 'admin_orders' || activeTab === 'admin_preorders') loadMyAdminData();
        if (activeTab === 'admin_customers') loadManagedCustomers(customerSearch);
        if (activeTab === 'admin_products') loadAdminProducts(productSearch, adminProductFilter);
        if (activeTab === 'admin_discounts') loadDiscountItems();
        if (activeTab === 'admin_coupons') loadCoupons();
        if (activeTab === 'admin_sales' || activeTab === 'admin_analytics') {
            loadAdminSales();
            loadTrafficStats();
        }
        if (activeTab === 'admin_consignment') loadConsignmentItems(consignmentFilter);
    }, [activeTab, isAdmin, adminProductFilter, consignmentFilter]);

    useEffect(() => {
        if (authLoading) return; // Wait until AuthContext finishes loading session

        if (!user) {
            navigate('/login');
            return;
        }
        loadMyPageData();
        if (isAdmin) {
            loadMyAdminData();
        }
    }, [user, navigate, isAdmin, authLoading]);

    const getStatusStyle = (status) => {
        switch (status) {
            case 'preorder_pending': return 'bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse-subtle';
            case 'pending': return 'bg-yellow-100 text-yellow-800';
            case 'confirmed': return 'bg-blue-100 text-blue-800';
            case 'shipped': return 'bg-purple-100 text-purple-800';
            case 'delivered': return 'bg-green-100 text-green-800';
            case 'cancelled': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getStatusLabel = (status) => {
        const labels = {
            preorder_pending: lang === 'KR' ? '구매예약 대기' : 'Preorder Pending',
            pending: t('order_status_pending'),
            confirmed: t('order_status_confirmed'),
            shipped: t('order_status_shipped'),
            delivered: t('order_status_delivered'),
            cancelled: t('order_status_cancelled'),
        };
        return labels[status] || status;
    };

    const isPreorderOrder = (order) => {
        return order.status === 'preorder_pending' || (order.items || []).some(it => it.is_preorder);
    };

    const baseOrders = useMemo(() => {
        if (activeTab === 'history') {
            return orders.filter(o => !isPreorderOrder(o));
        } else if (activeTab === 'preorders') {
            return orders.filter(o => isPreorderOrder(o));
        }
        return orders;
    }, [orders, activeTab]);

    const filteredOrders = historyFilter === 'all'
        ? baseOrders
        : baseOrders.filter(o => o.status === historyFilter);

    const shippingOrders = orders.filter(o =>
        o.status === 'shipped' || o.status === 'delivered' || o.tracking_number
    );

    const handleExportExcel = async () => {
        if (selectedOrdersForExport.size === 0) {
            alert('내보낼 주문을 선택해주세요.');
            return;
        }

        try {
            const response = await fetch('/서식_한진-기본.xlsx');
            if (!response.ok) {
                throw new Error('템플릿 파일을 찾을 수 없습니다.');
            }
            const arrayBuffer = await response.arrayBuffer();

            const wb = XLSX.read(arrayBuffer, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];

            const exportData = [];
            adminOrders.forEach(order => {
                if (selectedOrdersForExport.has(order.order_number)) {
                    // A열: 받는사람이름, B열: 전화번호, E열: 우편번호, F열: 주소+(사진부탁드립니다), H열: 주문번호
                    exportData.push([
                        order.customer_name || '', // A
                        order.phone ? String(order.phone) : '', // B
                        '', // C
                        '', // D
                        order.c_postal_code ? String(order.c_postal_code) : '', // E
                        (order.shipping_address || '') + ' (사진부탁드립니다)', // F
                        '', // G
                        String(order.order_number) // H
                    ]);
                }
            });

            XLSX.utils.sheet_add_aoa(ws, exportData, { origin: "A2" });
            const dateStr = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `서식_한진-${dateStr}.xlsx`);
        } catch (error) {
            console.error('Excel export error:', error);
            alert('엑셀 내보내기 중 오류가 발생했습니다: ' + error.message);
        }
    };

    const handleExportInvoiceWord = () => {
        if (selectedOrdersForExport.size === 0) {
            alert('송장을 출력할 주문을 선택해주세요.');
            return;
        }

        const selectedOrders = adminOrders.filter(order => selectedOrdersForExport.has(order.order_number));

        let htmlContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <title>송장 인쇄</title>
            <style>
                body { font-family: 'Malgun Gothic', 'Arial', sans-serif; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                td { width: 50%; height: 280pt; padding: 20pt; border: 1px solid #ccc; vertical-align: top; }
                .label-content { font-size: 14pt; line-height: 1.6; }
                .name { font-weight: bold; font-size: 16pt; margin-bottom: 10px; }
                .address { margin-bottom: 10px; word-break: break-all; white-space: pre-wrap; }
                .phone { font-weight: bold; }
                @page { size: 21cm 29.7cm; margin: 1cm; }
            </style>
        </head>
        <body>
        `;

        for (let i = 0; i < selectedOrders.length; i += 6) {
            const pageOrders = selectedOrders.slice(i, i + 6);
            htmlContent += '<table>';
            for (let j = 0; j < 6; j += 2) {
                htmlContent += '<tr>';
                
                // Left column
                const order1 = pageOrders[j];
                htmlContent += '<td><div class="label-content">';
                if (order1) {
                    htmlContent += `
                        <div class="name">${order1.customer_name || ''}</div>
                        <div class="address">${order1.shipping_address || ''}</div>
                        <div class="phone">${order1.phone || ''}</div>
                    `;
                }
                htmlContent += '</div></td>';

                // Right column
                const order2 = pageOrders[j + 1];
                htmlContent += '<td><div class="label-content">';
                if (order2) {
                    htmlContent += `
                        <div class="name">${order2.customer_name || ''}</div>
                        <div class="address">${order2.shipping_address || ''}</div>
                        <div class="phone">${order2.phone || ''}</div>
                    `;
                }
                htmlContent += '</div></td>';
                
                htmlContent += '</tr>';
            }
            htmlContent += '</table>';
            
            if (i + 6 < selectedOrders.length) {
                htmlContent += '<br clear="all" style="page-break-before:always" />';
            }
        }

        htmlContent += `
        </body>
        </html>
        `;

        const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `송장_Word_${dateStr}.doc`;
        
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }, 100);
    };

    const handleExportInvoicePDF = () => {
        if (selectedOrdersForExport.size === 0) {
            alert('송장을 출력할 주문을 선택해주세요.');
            return;
        }

        const selectedOrders = adminOrders.filter(order => selectedOrdersForExport.has(order.order_number));

        let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>송장 인쇄</title>
            <style>
                @page { size: A4; margin: 0; }
                body { font-family: 'Malgun Gothic', 'Arial', sans-serif; margin: 0; padding: 0; background: #fff; }
                .page { 
                    width: 210mm; 
                    height: 297mm; 
                    padding: 10mm; 
                    box-sizing: border-box; 
                    page-break-after: always;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    grid-template-rows: 1fr 1fr 1fr;
                    gap: 0;
                }
                .page:last-child { page-break-after: auto; }
                .label-cell { 
                    border: 1px dashed #ccc; 
                    padding: 20px; 
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .label-content { font-size: 14pt; line-height: 1.6; }
                .name { font-weight: bold; font-size: 18pt; margin-bottom: 12px; }
                .address { margin-bottom: 12px; word-break: break-all; white-space: pre-wrap; }
                .phone { font-weight: bold; font-size: 14pt; }
                
                @media print {
                    html, body { width: 210mm; height: 297mm; }
                    .page {
                        margin: 0; border: initial; border-radius: initial; width: initial; min-height: initial; box-shadow: initial; background: initial; page-break-after: always;
                    }
                }
            </style>
        </head>
        <body onload="setTimeout(() => window.print(), 500)">
        `;

        for (let i = 0; i < selectedOrders.length; i += 6) {
            const pageOrders = selectedOrders.slice(i, i + 6);
            htmlContent += '<div class="page">';
            for (let j = 0; j < 6; j++) {
                const order = pageOrders[j];
                htmlContent += '<div class="label-cell"><div class="label-content">';
                if (order) {
                    htmlContent += `
                        <div class="name">${order.customer_name || ''}</div>
                        <div class="address">${order.shipping_address || ''}</div>
                        <div class="phone">${order.phone || ''}</div>
                    `;
                }
                htmlContent += '</div></div>';
            }
            htmlContent += '</div>';
        }

        htmlContent += `
        </body>
        </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(htmlContent);
            printWindow.document.close();
        } else {
            alert('팝업 차단이 설정되어 있습니다. 팝업 차단을 해제해주세요.');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className={`${isAdmin ? 'w-full lg:max-w-[90%] xl:max-w-[80%]' : 'w-full max-w-3xl'} mx-auto px-[5px] md:px-4 py-4 md:py-8`}>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{isAdmin ? t('mypage_title') : 'Mypage'}</h1>
            {profile && (
                <p className="text-sm text-gray-400 mb-8">
                    {profile.name} · {t('mypage_member_since')} {profile.created_at?.split(' ')[0]}
                </p>
            )}

            {!activeTab ? (
                <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 md:gap-3 mb-8">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => { if (!tab.disabled) setActiveTab(tab.id) }}
                            disabled={tab.disabled}
                            className={`flex flex-col items-center justify-center aspect-square rounded-lg transition-all ${
                                tab.disabled
                                    ? 'bg-gray-50 text-gray-400 opacity-60 cursor-not-allowed'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:scale-[1.02] active:scale-95'
                            }`}
                        >
                            <span className={`text-2xl md:text-4xl mb-1.5 ${tab.disabled ? 'grayscale opacity-50' : ''}`}>{tab.icon}</span>
                            <span className="text-[10px] md:text-[13px] font-bold text-center break-keep leading-tight px-1">{tab.label}</span>
                            {tab.disabled && <span className="text-[8px] md:text-[10px] mt-0.5 text-gray-400 font-medium">사용불가</span>}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="mb-6 border-b border-gray-100 pb-4">
                    <button 
                        onClick={() => setActiveTab(null)} 
                        className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-black mb-4 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                        </svg>
                        {lang === 'KR' ? '메뉴로 돌아가기' : 'Back to Menu'}
                    </button>
                    <h2 className="text-2xl font-black">{tabs.find(t => t.id === activeTab)?.label}</h2>
                </div>
            )}

            {/* ===== 탭 1: 내 정보 수정 ===== */}
            {activeTab === 'profile' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                    <div className="grid grid-cols-1 gap-4 pb-6 border-b border-gray-100">

                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Login ID</label>
                            <p className="text-sm font-medium text-gray-700">{profile?.login_id}</p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            📱 {t('mypage_phone')}
                        </label>
                        <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            🏠 {t('mypage_address')}
                        </label>
                        <div className="flex gap-2 mb-3">
                            <input 
                                type="text" 
                                value={formData.postal_code} 
                                readOnly 
                                className="w-32 px-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-600 outline-none" 
                                placeholder={t('register_postal_code') || '우편번호'} 
                            />
                            <button
                                type="button"
                                onClick={handleOpenPostcode}
                                className="bg-black text-white px-4 py-3 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors whitespace-nowrap"
                            >
                                {t('register_address_search') || '주소 검색'}
                            </button>
                        </div>
                        <div className="mb-3">
                            <input
                                type="text"
                                value={formData.address_kr}
                                readOnly
                                placeholder={t('register_address_kr_ph') || '기본 주소가 입력됩니다'}
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none transition-all"
                                onClick={handleOpenPostcode}
                            />
                        </div>
                        <input 
                            placeholder={t('register_address_detail_ph') || '나머지 상세 주소를 입력해주세요'} 
                            value={formData.address_detail} 
                            onChange={(e) => setFormData(prev => ({ ...prev, address_detail: e.target.value }))} 
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black" 
                        />
                    </div>

                    <div className="flex items-center gap-4 pt-2">
                        <button onClick={handleSaveProfile} disabled={saving} className="bg-black text-white px-8 py-3 rounded-xl font-medium text-sm hover:bg-gray-800 disabled:bg-gray-400">
                            {saving ? t('mypage_saving') : t('mypage_save')}
                        </button>
                        {saveMessage && (
                            <span className={`text-sm font-medium ${saveMessage.includes('!') ? 'text-green-600' : 'text-red-500'}`}>
                                {saveMessage}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'profile' && isAdmin && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6 mt-6">
                    <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-4">⚙️ 관리자 사이트 설정</h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            🔴 틱톡 실시간 방송 링크 (홈페이지 상단 노출용)
                        </label>
                        <div className="flex flex-col gap-3">
                            <input
                                type="url"
                                placeholder="틱톡 방송 링크 (예: https://www.tiktok.com/@...)"
                                value={tiktokLiveUrlInput}
                                onChange={(e) => setTiktokLiveUrlInput(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#25F4EE]"
                            />
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    placeholder="방송 시간 (예: 20:00~22:30)"
                                    value={tiktokLiveTimeInput}
                                    onChange={(e) => setTiktokLiveTimeInput(e.target.value)}
                                    className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#25F4EE]"
                                />
                                <button 
                                    onClick={handleSaveTiktokUrl} 
                                    disabled={tiktokSaving} 
                                    className="bg-[#FE2C55] hover:bg-[#E0264B] text-white px-6 py-3 rounded-xl font-bold text-sm disabled:bg-gray-400 transition-colors shrink-0"
                                >
                                    {tiktokSaving ? '저장 중...' : '적용하기'}
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                            링크를 입력하고 적용하면 모든 사용자의 메인 페이지 상단에 틱톡 아이콘과 함께 방송 접속 배너가 생깁니다. 방송 종료 후에는 링크를 빈칸으로 두고 적용하세요.
                        </p>
                    </div>
                </div>
            )}

            {/* ===== 탭 2: 배송 관리 ===== */}
            {activeTab === 'shipping' && (
                <div className="space-y-4">
                    {shippingOrders.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
                            <div className="text-5xl mb-4">📦</div>
                            <p className="text-gray-500">{t('mypage_no_tracking')}</p>
                        </div>
                    ) : (
                        shippingOrders.map(order => (
                            <div key={order.order_number} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-100">
                                    <div>
                                        <p className="font-mono font-bold text-sm">{order.order_number}</p>
                                        <p className="text-xs text-gray-400">{order.created_at}</p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusStyle(order.status)}`}>
                                        {getStatusLabel(order.status)}
                                    </span>
                                </div>
                                <div className="px-6 py-4">
                                    {order.tracking_number ? (
                                        <div className="flex items-center gap-6 bg-blue-50 rounded-xl px-4 py-3">
                                            <div>
                                                <p className="text-xs text-gray-400">{t('mypage_tracking_company')}</p>
                                                <p className="text-sm font-bold text-gray-800">{order.tracking_company}</p>
                                            </div>
                                            <div className="border-l border-blue-200 pl-6 flex-1 flex justify-between items-center">
                                                <div>
                                                    <p className="text-xs text-gray-400">{t('mypage_tracking_number')}</p>
                                                    <p className="text-sm font-bold text-blue-700 font-mono">{order.tracking_number}</p>
                                                </div>
                                                <a href={getTrackingUrl(order.tracking_company, order.tracking_number)} target="_blank" rel="noopener noreferrer" className="bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm whitespace-nowrap">
                                                    배송조회
                                                </a>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-400 italic">{t('mypage_no_tracking')}</p>
                                    )}
                                </div>
                                <div className="px-6 pb-4 space-y-1">
                                    {(order.items || []).map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-xs text-gray-500">
                                            <span>[{item.brand}] {lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name} × {item.quantity}</span>
                                            {/* 할인가 표시 (배송 탭에서도 동일) */}
                                            {item.catalog_price && item.catalog_price > (item.sold_price || item.subtotal) ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="line-through text-gray-300">฿{(item.catalog_price * (item.quantity || 1)).toLocaleString()}</span>
                                                    <span className="font-bold text-red-500">฿{item.subtotal?.toLocaleString()}</span>
                                                </div>
                                            ) : (
                                                <span>฿{item.subtotal?.toLocaleString()}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* ===== 탭 3: 구매 이력 & 예약구매 내역 ===== */}
            {(activeTab === 'history' || activeTab === 'preorders') && (
                <div>
                    <div className="flex gap-2 mb-6 flex-wrap">
                        {['all', 'confirmed', 'shipped', 'delivered', 'cancelled'].map(fValue => (
                            <button
                                key={fValue}
                                onClick={() => setHistoryFilter(fValue)}
                                className={`px-4 py-2 rounded-full text-xs font-bold transition-colors ${
                                    historyFilter === fValue ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
                                }`}
                            >
                                {t(`mypage_filter_${fValue}`)}
                            </button>
                        ))}
                    </div>

                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
                            <p className="text-gray-500">{t('mypage_no_orders')}</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredOrders.map(order => (
                                <div key={order.order_number} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b">
                                        <div>
                                            <p className="font-mono font-bold text-sm">{order.order_number}</p>
                                            <p className="text-xs text-gray-400">{order.created_at}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusStyle(order.status)}`}>
                                                {getStatusLabel(order.status)}
                                            </span>
                                            <span className="font-bold text-sm">฿{Number(order.total_amount).toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div className="px-6 py-4 space-y-2">
                                        {(order.items || []).map((item, idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span className="text-gray-700">[{item.brand}] {lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name} × {item.quantity}</span>
                                                {/* 할인가 표시: 카탈로그 원가와 실제 결제가가 다를 때 취소선 + 할인가 강조 */}
                                                {item.catalog_price && item.catalog_price > (item.sold_price || item.subtotal) ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-gray-400 line-through">฿{(item.catalog_price * (item.quantity || 1)).toLocaleString()}</span>
                                                        <span className="font-bold text-red-500">฿{item.subtotal?.toLocaleString()}</span>
                                                    </div>
                                                ) : (
                                                    <span className="font-medium text-gray-900">฿{item.subtotal?.toLocaleString()}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {order.tracking_number && (
                                        <div className="px-6 pb-4">
                                            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 text-xs">
                                                <div className="flex items-center gap-4">
                                                    <span className="text-gray-500">🚚 {order.tracking_company}</span>
                                                    <span className="font-mono font-bold text-blue-700">{order.tracking_number}</span>
                                                </div>
                                                <a href={getTrackingUrl(order.tracking_company, order.tracking_number)} target="_blank" rel="noopener noreferrer" className="bg-blue-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-md hover:bg-blue-700 transition-colors shadow-sm whitespace-nowrap">
                                                    배송조회
                                                </a>
                                            </div>
                                        </div>
                                    )}

                                    {/* 주문 취소 버튼 (pending, preorder_pending 상태일 때만 노출) */}
                                    {(order.status === 'pending' || order.status === 'preorder_pending') && (
                                        <div className="px-6 pb-4 flex justify-end">
                                            <button 
                                                onClick={() => handleCancelOrder(order.order_number)}
                                                className="bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                            >
                                                주문 취소 ❌
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ===== 탭: 내 찜 목록 ===== */}
            {activeTab === 'wishlist' && (
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                        ❤️ 내 찜 목록 ({wishlist.length})
                    </h2>
                    
                    {wishlist.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
                            <p className="text-gray-500 mb-4">찜한 상품이 없습니다.</p>
                            <button 
                                onClick={() => navigate(`/?lang=${lang}`)}
                                className="text-sm font-bold text-blue-600 hover:underline bg-blue-50 px-4 py-2 rounded-lg"
                            >
                                상품 구경하러 가기
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-x-4 gap-y-8">
                            {wishlist.map(product => (
                                <ProductCard 
                                    key={product.code} 
                                    product={product} 
                                    lang={lang} 
                                    isArchive={false} 
                                    isAdmin={isAdmin}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ===== 탭 4: 관리자 - 주문 관리 ===== */}
            {(activeTab === 'admin_orders' || activeTab === 'admin_preorders') && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex gap-4 items-center flex-wrap">
                            <h2 className="text-xl font-bold">
                                {activeTab === 'admin_preorders' ? '🕒 예약 구매 관리' : `📦 ${t('admin_all_orders')}`}
                            </h2>
                            <button onClick={() => setShowGuestOrderForm(!showGuestOrderForm)} className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black transition-colors">
                                + {t('admin_order_guest_title').replace('👤 ', '')}
                            </button>
                        </div>
                        <div className="flex gap-2 items-center">
                            {activeTab === 'admin_orders' && (
                                <>
                                    <button onClick={handleExportInvoicePDF} className="text-xs bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                                        송장 인쇄 (PDF)
                                    </button>
                                    <button onClick={handleExportInvoiceWord} className="text-xs bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                                        송장 다운 (Word)
                                    </button>
                                    <button onClick={handleExportExcel} className="text-xs bg-green-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors shadow-sm">
                                        엑셀 (한진택배)
                                    </button>
                                </>
                            )}
                            <button onClick={() => loadMyAdminData()} className="text-xs text-gray-400 hover:text-black underline">{t('refresh')}</button>
                        </div>
                    </div>

                    {/* 비회원 주문 생성 인라인 폼 + 자동완성 */}
                    {showGuestOrderForm && (
                        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 mb-4">
                            <div className="text-xs font-bold text-blue-600 mb-2">{t('admin_order_guest_title')}</div>
                            <div className="flex gap-2 items-center relative">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        placeholder={t('admin_order_guest_placeholder')}
                                        value={guestNameInput}
                                        onChange={(e) => handleGuestNameChange(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGuestOrder(); }}
                                        onFocus={() => { if (guestSuggestions.length > 0) setShowGuestSuggestions(true); }}
                                        onBlur={() => setTimeout(() => setShowGuestSuggestions(false), 200)}
                                        className="w-full px-4 py-2.5 border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                        autoFocus
                                    />
                                    {showGuestSuggestions && guestSuggestions.length > 0 && (
                                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                                            {guestSuggestions.map(s => (
                                                <button
                                                    key={s.customer_id}
                                                    type="button"
                                                    onMouseDown={(e) => { e.preventDefault(); handleSelectGuestSuggestion(s); }}
                                                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm flex justify-between items-center border-b border-gray-50 last:border-0 transition-colors"
                                                >
                                                    <span className="font-bold text-gray-900">{s.customer_id}</span>
                                                    <span className="text-xs text-gray-400">{s.phone} · {s.address || '-'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button onClick={handleCreateGuestOrder} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shrink-0">
                                    {t('admin_order_create')}
                                </button>
                                <button onClick={() => { setShowGuestOrderForm(false); setGuestNameInput(''); }} className="text-gray-400 hover:text-gray-600 text-xs font-bold">
                                    {t('admin_order_cancel')}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col md:flex-row gap-3">
                        <input 
                            type="date" 
                            value={adminDateFilter} 
                            onChange={(e) => handleAdminDateChange(e.target.value)}
                            className="px-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white"
                        />
                        {adminDateFilter && (
                            <button 
                                onClick={() => handleAdminDateChange('')}
                                className="text-xs text-red-500 hover:text-red-700 font-bold"
                            >
                                {t('admin_order_date_filter_clear')}
                            </button>
                        )}
                        <select value={adminSearchType} onChange={(e) => setAdminSearchType(e.target.value)} className="px-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white">
                            <option value="order_number">{t('admin_order_search_type_number')}</option>
                            <option value="tracking_number">{t('admin_order_search_type_tracking')}</option>
                            <option value="phone">{t('admin_order_search_type_phone')}</option>
                            <option value="customer_id">{t('admin_order_search_type_customer')}</option>
                        </select>
                        <input type="text" placeholder={t('admin_order_search_placeholder')} value={adminSearchQuery} onChange={(e) => setAdminSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdminSearch()} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black" />
                        <button onClick={handleAdminSearch} className="bg-black text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors">{t('search')}</button>
                    </div>

                    {adminLoading ? (
                        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                    ) : (
                        <div className="space-y-4">
                            {(() => {
                                const filtered = adminOrders.filter(order => {
                                    const hasPreorder = order.status === 'preorder_pending' || (order.items || []).some(it => it.is_preorder);
                                    if (activeTab === 'admin_preorders') {
                                        return hasPreorder;
                                    } else {
                                        return !hasPreorder;
                                    }
                                });
                                if (filtered.length === 0) {
                                    return (
                                        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
                                            <p className="text-gray-500">주문 내역이 없습니다.</p>
                                        </div>
                                    );
                                }
                                return filtered.map(order => {
                                const isNewOrder = (() => {
                                    if (!order.created_at) return false;
                                    if (order.status !== 'pending' && order.status !== 'preorder_pending') return false;
                                    try {
                                        const createdDate = new Date(order.created_at.replace(/-/g, '/'));
                                        const now = new Date();
                                        const diffHours = (now - createdDate) / (1000 * 60 * 60);
                                        return diffHours < 24;
                                    } catch {
                                        return false;
                                    }
                                })();

                                return (
                                    <div key={order.order_number} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:border-black transition-all">
                                        <div className="px-6 py-4 bg-gray-50 border-b flex justify-between items-center cursor-pointer" onClick={() => {
                                            if (selectedAdminOrder?.order_number === order.order_number) {
                                                setSelectedAdminOrder(null);
                                            } else {
                                                setSelectedAdminOrder(order);
                                                // Expand 시 미결제 항목 기본 선택
                                                if (order.status === 'pending') {
                                                    const unpaidCodes = (order.items || []).filter(it => !it.paid).map(it => it.code);
                                                    setSelectedPaymentItems(prev => ({ ...prev, [order.order_number]: unpaidCodes }));
                                                }
                                                // Expand 시 예약 상품 책정가 기본 로드
                                                if (order.status === 'preorder_pending') {
                                                    const preorderPrices = {};
                                                    (order.items || []).forEach(it => {
                                                        if (it.is_preorder) {
                                                            preorderPrices[it.code] = it.price || '';
                                                        }
                                                    });
                                                    setPreorderPricesMap(prev => ({
                                                        ...prev,
                                                        [order.order_number]: preorderPrices
                                                    }));
                                                }
                                            }
                                        }}>
                                            {(order.status === 'pending' || order.status === 'confirmed') && (order.items || []).every(it => it.paid) && (
                                                <div className="mr-4 flex items-center" onClick={(e) => e.stopPropagation()}>
                                                    <input 
                                                        type="checkbox"
                                                        className="w-5 h-5 cursor-pointer accent-blue-600"
                                                        checked={selectedOrdersForExport.has(order.order_number)}
                                                        onChange={() => toggleOrderExport(order.order_number)}
                                                    />
                                                </div>
                                            )}
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <p className="font-bold text-sm">{order.order_number}</p>
                                                    {isNewOrder && (
                                                        <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black animate-pulse shadow-sm shrink-0">
                                                            NEW
                                                        </span>
                                                    )}
                                                    {order.created_at && <p className="text-xs font-mono text-gray-400">{order.created_at}</p>}
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order.order_number); }}
                                                        className="text-[10px] text-red-400 hover:text-red-700 underline"
                                                    >
                                                        {t('admin_order_delete')}
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <p className="text-[17px] font-bold text-gray-800">{order.customer_name}</p>
                                                    <button 
                                                        onClick={(e) => handleCopyOrder(e, order)}
                                                        className="bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-100 transition-colors shadow-sm flex items-center gap-1"
                                                    >
                                                        📋 주문서 복사
                                                    </button>
                                                </div>
                                            </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusStyle(order.status)}`}>{getStatusLabel(order.status)}</span>
                                            <span className="text-gray-400">{selectedAdminOrder?.order_number === order.order_number ? '▲' : '▼'}</span>
                                        </div>
                                    </div>
                                    {selectedAdminOrder?.order_number === order.order_number && (
                                        <div className="p-4 md:p-6 border-b bg-white">
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
                                                <div>
                                                    <div className="flex justify-between items-center mb-2">
                                                        <h3 className="text-xs font-bold text-gray-400 uppercase">{t('admin_order_shipping_address')}</h3>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingAddressOrder(order.order_number);
                                                                setEditingAddressValue(order.shipping_address || '');
                                                            }}
                                                            className="text-[10px] text-blue-500 hover:text-blue-700 font-bold px-2 py-0.5 border border-blue-200 rounded"
                                                        >
                                                            수정
                                                        </button>
                                                    </div>
                                                    {editingAddressOrder === order.order_number ? (
                                                        <div className="flex flex-col gap-2 mt-2">
                                                            <textarea 
                                                                value={editingAddressValue}
                                                                onChange={(e) => setEditingAddressValue(e.target.value)}
                                                                className="w-full text-sm p-2 border border-blue-200 rounded outline-none focus:ring-1 focus:ring-blue-400"
                                                                rows="3"
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                                <button 
                                                                    onClick={() => setEditingAddressOrder(null)}
                                                                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                                                                >취소</button>
                                                                <button 
                                                                    onClick={() => handleSaveOrderAddress(order.order_number)}
                                                                    className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 font-bold"
                                                                >저장</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="text-sm">{(order.shipping_address || '').replace(/, , ,/g, '').replace(/^, /, '').trim()}</p>
                                                            <p className="text-xs text-gray-400 mt-1">{order.phone}</p>
                                                        </>
                                                    )}
                                                </div>
                                                <div>
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">{t('admin_order_payment_history')}</h3>
                                                    {(() => {
                                                        const selectedCodes = selectedPaymentItems[order.order_number] || [];
                                                        const isOrderPaid = ['confirmed', 'shipped', 'delivered'].includes(order.status);
                                                        const paidAmount = (order.items || []).reduce((acc, it) => acc + ((it.paid || isOrderPaid) ? (Number(it.subtotal) || 0) : 0), 0);
                                                        const pendingSelectedAmount = (order.items || []).reduce((acc, it) => acc + ((!it.paid && !isOrderPaid && selectedCodes.includes(it.code)) ? (Number(it.subtotal) || 0) : 0), 0);
                                                        return (
                                                            <div className="flex flex-col gap-1">
                                                                <p className="text-sm font-bold text-blue-600">{t('admin_order_payment_paid').replace('{amount}', paidAmount.toLocaleString())}</p>
                                                                <p className="text-sm font-bold text-yellow-600">{t('admin_order_payment_pending').replace('{amount}', pendingSelectedAmount.toLocaleString())}</p>
                                                                <div className="mt-1 pt-1 border-t border-gray-100 flex flex-col gap-0.5">
                                                                    <p className="text-xs font-bold text-gray-500">{t('admin_order_product_sum').replace('{amount}', Number(order.total_amount).toLocaleString())}</p>
                                                                    {(() => {
                                                                        const shippingItem = (order.items || []).find(it => it.code === 'SHIPPING_FEE');
                                                                        if (shippingItem && shippingItem.subtotal > 0) {
                                                                            return (
                                                                                <>
                                                                                    <p className="text-xs font-bold text-gray-400">{t('admin_order_shipping_fee').replace('{amount}', Number(shippingItem.subtotal).toLocaleString())}</p>
                                                                                    <p className="text-sm font-black text-black mt-0.5">{t('admin_order_total_estimated').replace('{amount}', (Number(order.total_amount) + Number(shippingItem.subtotal)).toLocaleString())}</p>
                                                                                </>
                                                                            );
                                                                        }
                                                                        return <p className="text-[10px] font-bold text-blue-500">{t('admin_order_free_shipping')}</p>;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                            <div className="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
                                                {(order.items || []).map((it, idx) => {
                                                    const isEditing = editingItem?.orderNumber === order.order_number && editingItem?.code === it.code;
                                                    return (
                                                        <div key={idx} className={`flex text-sm bg-white p-3 rounded-xl shadow-sm border ${it.code === 'SHIPPING_FEE' ? 'border-blue-100 bg-blue-50/5' : 'border-gray-100'} gap-3 sm:gap-4 relative`}>
                                                            <div className="flex flex-col items-center gap-1 shrink-0">
                                                                {(it.image_url || it.thumbnail_url) && (
                                                                    <img src={getImageUrl(it.image_url, it.thumbnail_url)} alt="" className="w-16 h-16 object-cover rounded-xl bg-gray-100 shadow-sm border border-gray-100" />
                                                                )}
                                                                <span className="text-[9px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">#{it.code}</span>
                                                            </div>
                                                            <div className="flex flex-col min-w-0 flex-1 justify-between py-0.5">
                                                                <div className="flex items-start justify-between gap-2 min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                                                                        <span 
                                                                            className="font-bold text-gray-800 truncate"
                                                                            title={it.code === 'SHIPPING_FEE' ? t('shipping_fee') : `[${it.brand}] ${lang === 'EN' && it.name_en ? it.name_en : lang === 'TH' && it.name_th ? it.name_th : it.name}`}
                                                                        >
                                                                            {it.code === 'SHIPPING_FEE' ? t('shipping_fee') : `[${it.brand}] ${lang === 'EN' && it.name_en ? it.name_en : lang === 'TH' && it.name_th ? it.name_th : it.name}`}
                                                                        </span>
                                                                        {it.code === 'SHIPPING_FEE' && (
                                                                            <span className="text-[10px] text-gray-400 font-normal">
                                                                                {t('shipping_free_condition')}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="shrink-0">
                                                                        {/* 개별 상품 결제 상태 표시 */}
                                                                        {(it.paid || ['confirmed', 'shipped', 'delivered'].includes(order.status)) ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <span className="bg-blue-50 text-blue-600 text-[9px] px-1.5 py-0.5 rounded font-black uppercase">{t('admin_order_payment_paid_label')}</span>
                                                                                <button 
                                                                                    onClick={() => handleCancelItemPayment(order.order_number, it.code)}
                                                                                    className="text-[9px] text-red-400 hover:text-red-600 font-bold ml-1 flex items-center gap-0.5 transition-colors"
                                                                                    title="결제 취소"
                                                                                >
                                                                                    {t('admin_order_payment_cancel')}
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="flex items-center gap-1 bg-yellow-50 border border-yellow-100 rounded px-1.5 py-0.5">
                                                                                <span className="text-yellow-600 text-[9px] font-black uppercase">{t('admin_order_payment_pending_label')}</span>
                                                                                <input 
                                                                                    type="checkbox" 
                                                                                    className="w-3 h-3 cursor-pointer accent-black" 
                                                                                    checked={selectedPaymentItems[order.order_number]?.includes(it.code) || false}
                                                                                    onChange={(e) => {
                                                                                        e.stopPropagation();
                                                                                        const checked = e.target.checked;
                                                                                        setSelectedPaymentItems(prev => {
                                                                                            const current = prev[order.order_number] || [];
                                                                                            if (checked) {
                                                                                                return { ...prev, [order.order_number]: [...current, it.code] };
                                                                                            } else {
                                                                                                return { ...prev, [order.order_number]: current.filter(c => c !== it.code) };
                                                                                            }
                                                                                        });
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="flex justify-between items-end mt-2">
                                                                    <span className="text-xs text-gray-400">{t('admin_order_quantity').replace('{quantity}', it.quantity)}</span>
                                                                    <div className="flex items-center gap-3">
                                                                {/* 가격 수정 UI */}
                                                                {order.status === 'preorder_pending' && it.is_preorder ? (
                                                                    <div className="flex items-center gap-1 bg-indigo-50/30 border border-indigo-100/50 rounded px-2.5 py-1 animate-pulse-subtle">
                                                                        <span className="text-xs text-indigo-600 font-bold">책정가: ฿</span>
                                                                        <input 
                                                                            type="number"
                                                                            placeholder="가격 입력"
                                                                            className="w-20 px-1 py-0.5 border border-indigo-200 rounded text-right font-mono font-bold text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                                                                            value={preorderPricesMap[order.order_number]?.[it.code] ?? ''}
                                                                            onChange={(e) => {
                                                                                const priceVal = e.target.value;
                                                                                setPreorderPricesMap(prev => ({
                                                                                    ...prev,
                                                                                    [order.order_number]: {
                                                                                        ...(prev[order.order_number] || {}),
                                                                                        [it.code]: priceVal
                                                                                    }
                                                                                }));
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter') {
                                                                                    const targetPrice = Number(preorderPricesMap[order.order_number]?.[it.code] || 0);
                                                                                    handleUpdateItemPrice(order.order_number, it.code, targetPrice);
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button 
                                                                            onClick={() => {
                                                                                const targetPrice = Number(preorderPricesMap[order.order_number]?.[it.code] || 0);
                                                                                handleUpdateItemPrice(order.order_number, it.code, targetPrice);
                                                                            }} 
                                                                            className="text-blue-500 hover:text-blue-700 font-bold text-xs p-1"
                                                                            title="가격 개별 저장"
                                                                        >
                                                                            ✔
                                                                        </button>
                                                                    </div>
                                                                ) : it.code === 'SHIPPING_FEE' ? (
                                                                    <div className="flex items-center gap-1 px-2 py-1">
                                                                        <span className="font-mono font-black text-gray-900">฿{it.subtotal?.toLocaleString()}</span>
                                                                    </div>
                                                                ) : isEditing ? (
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-xs text-gray-400">฿</span>
                                                                        <input 
                                                                            type="number"
                                                                            className="w-20 px-2 py-1 border rounded text-right font-mono font-bold text-sm outline-none focus:ring-2 focus:ring-black"
                                                                            value={editingItem.price}
                                                                            onChange={(e) => setEditingItem(prev => ({ ...prev, price: e.target.value }))}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter') handleUpdateItemPrice(order.order_number, it.code, Number(editingItem.price));
                                                                                if (e.key === 'Escape') setEditingItem(null);
                                                                            }}
                                                                            autoFocus
                                                                        />
                                                                        <button onClick={() => handleUpdateItemPrice(order.order_number, it.code, Number(editingItem.price))} className="text-blue-500 font-bold text-xs p-1">✔</button>
                                                                    </div>
                                                                ) : (
                                                                    <div 
                                                                        className="flex items-center gap-1 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded transition-colors"
                                                                        onClick={() => setEditingItem({ orderNumber: order.order_number, code: it.code, price: it.price })}
                                                                    >
                                                                        <span className="font-mono font-black text-gray-900">฿{it.subtotal?.toLocaleString()}</span>
                                                                        <span className="text-[10px] text-gray-300">✎</span>
                                                                    </div>
                                                                )}
                                                                {it.code !== 'SHIPPING_FEE' && (
                                                                    <button onClick={() => handleRemoveItem(order.order_number, it.code)} className="text-gray-300 hover:text-red-500 transition-colors p-1">
                                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                                })}
                                                <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
                                                    <div className="flex justify-between items-center">
                                                        <div className="text-xs font-bold text-gray-500">{t('admin_order_add_item')}</div>
                                                        <button 
                                                            onClick={() => setManualInputMap(prev => ({ ...prev, [order.order_number]: !prev[order.order_number] }))}
                                                            className={`text-[10px] px-2 py-1 rounded font-bold transition-colors ${manualInputMap[order.order_number] ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                                        >
                                                            {manualInputMap[order.order_number] ? t('admin_order_change_to_normal') : t('admin_order_change_to_manual')}
                                                        </button>
                                                    </div>
                                                    
                                                    {manualInputMap[order.order_number] ? (
                                                        <div className="flex flex-col md:flex-row gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                                            <input 
                                                                placeholder={t('admin_order_manual_name_placeholder')} 
                                                                className="flex-[2] px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                                                                value={manualDataMap[order.order_number]?.name || ''}
                                                                onChange={(e) => setManualDataMap(prev => ({ ...prev, [order.order_number]: { ...(prev[order.order_number] || {}), name: e.target.value } }))}
                                                            />
                                                            <input 
                                                                type="number"
                                                                placeholder={t('admin_order_price')} 
                                                                className="flex-1 px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-mono font-bold"
                                                                value={manualDataMap[order.order_number]?.price || ''}
                                                                onChange={(e) => setManualDataMap(prev => ({ ...prev, [order.order_number]: { ...(prev[order.order_number] || {}), price: e.target.value } }))}
                                                            />
                                                            <button onClick={() => handleAddItem(order.order_number)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">{t('admin_order_register_item')}</button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            <input id={`item-input-${order.order_number}`} placeholder={t('admin_order_search_add_placeholder')} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:border-black shadow-sm" onKeyDown={(e) => e.key === 'Enter' && handleAddItem(order.order_number)} />
                                                            <button onClick={() => handleAddItem(order.order_number)} className="bg-white border border-black px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50">{t('admin_order_add')}</button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {/* 하단 송장저장 및 확정 제어판 영역 (카드가 펼쳐졌을 때만 카드 내부 최하단에 밀착되어 렌더링) */}
                                            <div className="p-4 bg-gray-50 border-t flex flex-wrap gap-3 items-center mt-6 -mx-6 -mb-6 rounded-b-xl shadow-sm">
                                                <div className="flex-1 flex gap-2 min-w-[200px]">
                                                    <select 
                                                        className="flex-1 min-w-[100px] max-w-[140px] px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-black cursor-pointer" 
                                                        defaultValue={order.tracking_company || '한진택배'} 
                                                        onChange={e => setTrackingInputs(prev => ({ ...prev, [order.order_number]: { ...(prev[order.order_number] || {}), tracking_company: e.target.value } }))}
                                                    >
                                                        <option value="한진택배">한진택배</option>
                                                        <option value="우체국택배">우체국택배</option>
                                                        <option value="CJ대한통운">CJ대한통운</option>
                                                        <option value="로젠택배">로젠택배</option>
                                                        <option value="롯데택배">롯데택배</option>
                                                        <option value="경동택배">경동택배</option>
                                                        <option value="대신택배">대신택배</option>
                                                        <option value="일양로지스">일양로지스</option>
                                                        <option value="CU편의점택배">CU편의점택배</option>
                                                        <option value="GS편의점택배">GS편의점택배</option>
                                                    </select>
                                                    <input placeholder={t('admin_tracking_placeholder')} className="flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm bg-white" defaultValue={order.tracking_number} onChange={e => setTrackingInputs(prev => ({ ...prev, [order.order_number]: { ...(prev[order.order_number] || {}), tracking_number: e.target.value } }))} />
                                                    {order.tracking_number && (
                                                        <a href={getTrackingUrl(order.tracking_company, order.tracking_number)} target="_blank" rel="noopener noreferrer" className="bg-blue-600 flex items-center justify-center text-white px-3 py-2 rounded-lg text-sm font-bold shrink-0 hover:bg-blue-700 transition-colors shadow-sm">
                                                            배송조회
                                                        </a>
                                                    )}
                                                    <button onClick={() => handleUpdateTracking(order.order_number)} className="bg-black text-white px-4 py-2 rounded-lg text-sm font-bold shrink-0">{t('admin_save_tracking')}</button>
                                                </div>
                                                <div className="flex gap-2 shrink-0">
                                                    {order.status === 'preorder_pending' && (
                                                        <button 
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                handleConfirmPreorder(order.order_number, preorderPricesMap[order.order_number] || {}); 
                                                            }} 
                                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center gap-1"
                                                        >
                                                            ✨ {lang === 'KR' ? '구매예약 확정' : 'Confirm Preorder'}
                                                        </button>
                                                    )}
                                                    {order.status === 'pending' && (
                                                        <button onClick={(e) => { e.stopPropagation(); handleConfirmPayment(order.order_number); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm">
                                                            💳 {order.items?.some(it => it.paid) ? t('admin_confirm_additional_payment') : t('admin_confirm_payment')}
                                                        </button>
                                                    )}
                                                    {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                                        <button onClick={(e) => { e.stopPropagation(); handleForceCancel(order.order_number); }} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-100">
                                                            🚫 {t('admin_force_cancel')}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        });
                    })()}
                </div>
                    )}
                </div>
            )}

            {/* ===== 탭 5: 관리자 - 고객관리 ===== */}
            {activeTab === 'admin_customers' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex gap-4 items-center flex-wrap">
                            <h2 className="text-xl font-bold">👥 고객관리</h2>
                            <button onClick={() => setShowGuestOrderForm(!showGuestOrderForm)} className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black transition-colors">
                                + {t('admin_order_guest_title').replace('👤 ', '')}
                            </button>
                        </div>
                        <button onClick={() => loadManagedCustomers(customerSearch)} className="text-xs text-gray-400 hover:text-black underline">{t('refresh')}</button>
                    </div>

                    {/* 비회원 주문 생성 인라인 폼 + 자동완성 */}
                    {showGuestOrderForm && (
                        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 mb-4">
                            <div className="text-xs font-bold text-blue-600 mb-2">{t('admin_order_guest_title')}</div>
                            <div className="flex gap-2 items-center relative">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        placeholder={t('admin_order_guest_placeholder')}
                                        value={guestNameInput}
                                        onChange={(e) => handleGuestNameChange(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGuestOrder(); }}
                                        onFocus={() => { if (guestSuggestions.length > 0) setShowGuestSuggestions(true); }}
                                        onBlur={() => setTimeout(() => setShowGuestSuggestions(false), 200)}
                                        className="w-full px-4 py-2.5 border border-blue-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                        autoFocus
                                    />
                                    {showGuestSuggestions && guestSuggestions.length > 0 && (
                                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                                            {guestSuggestions.map(s => (
                                                <button
                                                    key={s.customer_id}
                                                    type="button"
                                                    onMouseDown={(e) => { e.preventDefault(); handleSelectGuestSuggestion(s); }}
                                                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 text-sm flex justify-between items-center border-b border-gray-50 last:border-0 transition-colors"
                                                >
                                                    <span className="font-bold text-gray-900">{s.customer_id}</span>
                                                    <span className="text-xs text-gray-400">{s.phone} · {s.address || '-'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button onClick={handleCreateGuestOrder} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shrink-0">
                                    {t('admin_order_create')}
                                </button>
                                <button onClick={() => { setShowGuestOrderForm(false); setGuestNameInput(''); }} className="text-gray-400 hover:text-gray-600 text-xs font-bold">
                                    {t('admin_order_cancel')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 고객 등록 폼 */}
                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <div className="text-xs font-bold text-gray-500 mb-3">📋 고객 등록</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                                type="text"
                                placeholder="고객명 *"
                                value={customerForm.customer_id}
                                onChange={(e) => setCustomerForm(prev => ({ ...prev, customer_id: e.target.value }))}
                                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white"
                            />
                            <input
                                type="text"
                                placeholder="전화번호"
                                value={customerForm.phone}
                                onChange={(e) => setCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
                                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white"
                            />
                            <input
                                type="text"
                                placeholder="주소"
                                value={customerForm.address}
                                onChange={(e) => setCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white"
                            />
                        </div>
                        <button
                            onClick={handleRegisterCustomer}
                            className="mt-3 bg-black text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors"
                        >
                            등록
                        </button>
                    </div>

                    {/* 고객 검색바 */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="아이디로 검색..."
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadManagedCustomers(customerSearch)}
                            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black"
                        />
                        <button onClick={() => loadManagedCustomers(customerSearch)} className="bg-black text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors shrink-0">
                            검색
                        </button>
                    </div>

                    {/* 고객 목록 */}
                    {customerLoading ? (
                        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                    ) : managedCustomers.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
                            <div className="text-4xl mb-3">👥</div>
                            <p className="text-gray-500">등록된 고객이 없습니다.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs">
                                    <tr>
                                        <th className="px-4 py-3">고객명 (아이디)</th>
                                        <th className="px-4 py-3">전화번호</th>
                                        <th className="px-4 py-3">주소</th>
                                        <th className="px-4 py-3">등록일</th>
                                        <th className="px-4 py-3 text-right">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {managedCustomers.map(cust => {
                                        const isEditing = editingCustomer?.id === cust.id;
                                        return (
                                            <Fragment key={cust.id}>
                                                <tr className={`hover:bg-gray-50 transition-colors cursor-pointer ${selectedCustomer?.id === cust.id ? 'bg-blue-50' : ''}`}
                                                    onClick={() => handleViewCustomerOrders(cust)}
                                                >
                                                    <td className="px-4 py-4">
                                                        {isEditing ? (
                                                            <input value={editingCustomer.customer_id} onChange={(e) => setEditingCustomer(prev => ({ ...prev, customer_id: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full outline-none focus:ring-1 focus:ring-black" onClick={(e) => e.stopPropagation()} />
                                                        ) : (
                                                            <span className="font-bold text-gray-900">{cust.customer_id.replace(/^guest_\d+\s*\(?|\)$/g, '') || '-'}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        {isEditing ? (
                                                            <input value={editingCustomer.phone} onChange={(e) => setEditingCustomer(prev => ({ ...prev, phone: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full outline-none focus:ring-1 focus:ring-black" onClick={(e) => e.stopPropagation()} />
                                                        ) : (
                                                            <span className="text-gray-600">{cust.phone || '-'}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4">
                                                        {isEditing ? (
                                                            <input value={editingCustomer.address} onChange={(e) => setEditingCustomer(prev => ({ ...prev, address: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full outline-none focus:ring-1 focus:ring-black" onClick={(e) => e.stopPropagation()} />
                                                        ) : (
                                                            <span className="text-gray-600">{cust.address || '-'}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-xs text-gray-400 font-mono">{cust.created_at?.split(' ')[0]}</td>
                                                    <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                        {isEditing ? (
                                                            <div className="flex gap-1 justify-end">
                                                                <button onClick={handleUpdateCustomer} className="text-[10px] bg-black text-white px-3 py-1.5 rounded-lg font-bold">저장</button>
                                                                <button onClick={() => setEditingCustomer(null)} className="text-[10px] bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold">취소</button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-1 justify-end">
                                                                <button onClick={() => setEditingCustomer({ ...cust })} className="text-[10px] bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-50 transition-colors">수정</button>
                                                                <button onClick={() => handleDeleteCustomer(cust.id)} className="text-[10px] bg-white text-red-600 border border-red-200 px-3 py-1.5 rounded-lg font-bold hover:bg-red-50 transition-colors">삭제</button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                                {/* 선택된 고객의 주문내역 */}
                                                {selectedCustomer?.id === cust.id && (
                                                    <tr key={`orders-${cust.id}`}>
                                                        <td colSpan={5} className="px-4 py-4 bg-gray-50">
                                                            <div className="text-xs font-bold text-gray-500 mb-3">📦 {cust.customer_id}의 주문내역</div>
                                                            {customerOrdersLoading ? (
                                                                <div className="flex justify-center py-4"><div className="w-6 h-6 border-3 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                                                            ) : customerOrders.length === 0 ? (
                                                                <p className="text-xs text-gray-400 italic">주문 내역이 없습니다.</p>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    {customerOrders.map(ord => (
                                                                        <div key={ord.order_number} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                                                                            <div className="flex justify-between items-center mb-2">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="font-mono font-bold text-xs">{ord.order_number}</span>
                                                                                    <span className="text-[10px] text-gray-400 font-mono">{ord.created_at}</span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusStyle(ord.status)}`}>{getStatusLabel(ord.status)}</span>
                                                                                    <span className="font-bold text-xs">฿{Number(ord.total_amount).toLocaleString()}</span>
                                                                                </div>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                {(ord.items || []).map((it, idx) => (
                                                                                    <div key={idx} className="flex justify-between text-[11px] text-gray-500">
                                                                                        <span>[{it.brand}] {lang === 'EN' && it.name_en ? it.name_en : lang === 'TH' && it.name_th ? it.name_th : it.name} × {it.quantity}</span>
                                                                                        <span>฿{it.subtotal?.toLocaleString()}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===== 탭 6: 관리자 - 상품 관리 (POS) ===== */}
            {activeTab === 'admin_themes' && (
                <AdminThemes lang={lang} />
            )}

            {activeTab === 'admin_recommended_brands' && (
                <AdminRecommendedBrands lang={lang} />
            )}

            {activeTab === 'admin_products' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold">🏷️ {t('admin_tab_products')}</h2>
                        <button onClick={() => loadAdminProducts(productSearch)} className="text-xs text-gray-400 hover:text-black underline">{t('refresh')}</button>
                    </div>
                    <div className="flex flex-col md:flex-row gap-3 mb-4">
                        <div className="bg-gray-50 p-1.5 rounded-xl border flex gap-1 self-start flex-wrap">
                            {[
                                { id: 'all', label: '전체' },
                                { id: 'in_stock', label: '판매 중' },
                                { id: 'sold_out', label: '판매 완료' },
                                { id: 'discount', label: '🔥 할인중' }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => {
                                        // 할인중 필터는 별도 탭으로 이동
                                        if (filter.id === 'discount') {
                                            setActiveTab('admin_discounts');
                                        } else {
                                            setAdminProductFilter(filter.id);
                                        }
                                    }}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                        filter.id === 'discount'
                                            ? 'bg-red-500 text-white shadow-sm'
                                            : adminProductFilter === filter.id
                                                ? 'bg-black text-white shadow-sm'
                                                : 'text-gray-400 hover:text-black hover:bg-white'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 flex gap-2">
                            <input type="text" placeholder={t('admin_search_product')} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadAdminProducts(productSearch)} className="flex-1 px-4 py-2 border rounded-xl text-sm" />
                            <button onClick={() => loadAdminProducts(productSearch)} className="bg-black text-white px-6 py-2 rounded-xl text-sm font-bold shrink-0">{t('search')}</button>
                        </div>
                    </div>
                    {productLoading ? (
                        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                    ) : (
                        <div className="bg-white rounded-2xl border overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs">
                                    <tr>
                                        <th className="px-4 py-3">상품</th>
                                        <th className="px-4 py-3">브랜드</th>
                                        <th className="px-4 py-3">가격</th>
                                        <th className="px-4 py-3">상태</th>
                                        <th className="px-4 py-3 text-right">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {adminProducts
                                        .map(product => {
                                            const isSoldOut = product.stock?.toLowerCase().includes('sold') || product.stock?.toLowerCase().includes('out');
                                            return (
                                                <tr key={product.code} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <img src={getImageUrl(product.image_url, product.thumbnail_url)} alt="" className="w-10 h-10 object-cover rounded-lg bg-gray-100 shadow-sm" />
                                                            <div>
                                                                <p className="font-bold text-gray-900">{product.name}</p>
                                                                <p className="text-[10px] text-gray-400 font-mono">{product.code}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 text-gray-500 whitespace-nowrap">{product.brand}</td>
                                                    <td className="px-4 py-4 font-black text-gray-900 whitespace-nowrap">฿{Number(product.price).toLocaleString()}</td>
                                                    <td className="px-4 py-4">
                                                        {isSoldOut ? (
                                                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-black uppercase tracking-wider">SOLD OUT</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-black uppercase tracking-wider">IN STOCK</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-right">
                                                        {isSoldOut ? (
                                                            <button onClick={() => handleRestoreStock(product.code)} className="text-[10px] bg-white text-green-600 border border-green-200 px-3 py-1.5 rounded-lg font-bold hover:bg-green-50 transition-colors">{t('admin_restore_stock')}</button>
                                                        ) : (
                                                            <button onClick={() => handleSellDirect(product)} className="text-[10px] bg-black text-white px-3 py-1.5 rounded-lg font-bold hover:bg-gray-800 transition-colors shadow-sm">{t('admin_sell_direct')}</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===== 탭: 관리자 - 🔥 할인 관리 ===== */}
            {activeTab === 'admin_discounts' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">🔥</span>
                            <h2 className="text-xl font-bold">특별할인 관리</h2>
                            <span className="text-xs text-gray-400 font-medium">홈페이지 상단 + /sale 페이지에 반영</span>
                        </div>
                        <button onClick={loadDiscountItems} className="text-xs text-gray-400 hover:text-black underline">새로고침</button>
                    </div>

                    {/* 상품번호 일괄 등록 섹션 */}
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
                        <h3 className="text-sm font-black text-red-700 mb-1">📌 할인 상품 등록</h3>
                        <p className="text-xs text-red-500 mb-3">
                            상품번호를 콤마(,)로 구분하여 입력하고 일괄 할인율을 지정하세요.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <textarea
                                value={discountInput}
                                onChange={e => setDiscountInput(e.target.value)}
                                placeholder="상품번호 (예: 841, 231, 561)"
                                rows={2}
                                className="flex-1 px-4 py-2.5 border border-red-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-300 bg-white resize-none"
                            />
                            <div className="flex gap-2">
                                <div className="relative">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={bulkDiscountRate}
                                        onChange={e => setBulkDiscountRate(e.target.value)}
                                        placeholder="일괄 할인율"
                                        className="w-28 px-4 py-2.5 border border-red-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-300 bg-white pr-8 h-full"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">%</span>
                                </div>
                                <button
                                    onClick={handleRegisterDiscounts}
                                    className="shrink-0 bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl text-sm font-bold transition-colors shadow-sm h-full"
                                >
                                    등록 및 적용
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 할인 안내 */}
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
                        <span className="text-lg">💡</span>
                        <div className="text-xs text-amber-700">
                            <strong>사용 방법:</strong> 상품 등록 후 아래 목록에서 각 상품의 할인율(%)을 입력하고 <strong>적용</strong>을 클릭하세요.
                            홈페이지 상단 SPECIAL SALE 섹션과 /sale 페이지에 즉시 반영됩니다.
                            <br />할인율이 <strong>0%</strong>인 상품은 홈 상단에 노출되지 않습니다.
                        </div>
                    </div>

                    {/* 등록된 할인 상품 목록 */}
                    {discountLoading ? (
                        <div className="flex justify-center py-16">
                            <div className="w-8 h-8 border-4 border-red-200 border-t-red-500 rounded-full animate-spin" />
                        </div>
                    ) : discountItems.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <div className="text-4xl mb-3">🏷️</div>
                            <p className="font-medium">등록된 할인 상품이 없습니다.</p>
                            <p className="text-xs mt-1">위 입력란에 상품번호를 입력하여 등록하세요.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border overflow-hidden">
                            <div className="bg-red-50 px-4 py-2.5 border-b border-red-100 flex items-center gap-2">
                                <span className="text-[11px] font-black text-red-600 uppercase tracking-wider">등록된 할인 상품</span>
                                <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{discountItems.length}개</span>
                            </div>
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs border-b">
                                    <tr>
                                        <th className="px-4 py-3">상품</th>
                                        <th className="px-4 py-3">브랜드</th>
                                        <th className="px-4 py-3">원가</th>
                                        <th className="px-4 py-3 w-36">할인율 (%)</th>
                                        <th className="px-4 py-3">할인가</th>
                                        <th className="px-4 py-3 text-right">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {discountItems.map(item => {
                                        const hasValidPrice = !isNaN(Number(item.price)) && String(item.price || '').trim() !== '' && Number(item.price) > 0;
                                        const originalPrice = hasValidPrice ? Number(item.price) : null;
                                        const currentRate = parseInt(discountRateInputs[item.product_code] || '0', 10);
                                        const discountedPrice = (originalPrice && currentRate > 0)
                                            ? Math.round(originalPrice * (1 - currentRate / 100))
                                            : originalPrice;
                                        const isSaving = discountSaving[item.product_code];

                                        return (
                                            <tr key={item.product_code} className="hover:bg-gray-50 transition-colors">
                                                {/* 상품 정보 */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <img
                                                            src={getImageUrl(item.image_url, item.thumbnail_url)}
                                                            alt=""
                                                            className="w-10 h-10 object-cover rounded-lg bg-gray-100"
                                                            onError={e => { e.target.src = '/static/nophoto.png'; }}
                                                        />
                                                        <div>
                                                            <p className="font-bold text-gray-900 text-xs leading-tight">{(lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name) || '(상품 미확인)'}</p>
                                                            <p className="text-[10px] text-gray-400 font-mono">{item.product_code}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                {/* 브랜드 */}
                                                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{item.brand || '-'}</td>
                                                {/* 원가 */}
                                                <td className="px-4 py-3 text-xs font-bold text-gray-700 whitespace-nowrap">
                                                    {hasValidPrice ? `฿${originalPrice.toLocaleString()}` : '-'}
                                                </td>
                                                {/* 할인율 입력칸 */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            value={discountRateInputs[item.product_code] ?? item.discount_rate}
                                                            onChange={e => setDiscountRateInputs(prev => ({ ...prev, [item.product_code]: e.target.value }))}
                                                            className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center font-bold outline-none focus:ring-2 focus:ring-red-300 focus:border-red-300"
                                                        />
                                                        <span className="text-xs text-gray-400 font-bold">%</span>
                                                    </div>
                                                </td>
                                                {/* 할인가 프리뷰 */}
                                                <td className="px-4 py-3">
                                                    {hasValidPrice && currentRate > 0 ? (
                                                        <span className="text-sm font-black text-red-500">
                                                            ฿{discountedPrice.toLocaleString()}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-gray-300">-</span>
                                                    )}
                                                </td>
                                                {/* 관리 버튼 */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex gap-1.5 justify-end">
                                                        <button
                                                            onClick={() => handleUpdateDiscountRate(item.product_code)}
                                                            disabled={isSaving}
                                                            className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50 shadow-sm"
                                                        >
                                                            {isSaving ? '...' : '적용'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteDiscount(item.product_code)}
                                                            className="text-[10px] bg-white text-gray-500 border border-gray-200 hover:border-red-300 hover:text-red-500 px-3 py-1.5 rounded-lg font-bold transition-colors"
                                                        >
                                                            삭제
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===== 탭: 판매 경향 분석 ===== */}
            {activeTab === 'admin_analytics' && (
                <div className="space-y-8">
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-2xl font-black flex items-center gap-2">
                            <span className="p-2 bg-indigo-100 rounded-xl">📈</span>
                            {t('admin_tab_analytics')}
                        </h2>
                        <button onClick={loadAdminSales} className="p-2 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-bold hidden md:inline">마지막 새로고침</span>
                            <svg className={`w-5 h-5 text-gray-400 ${salesLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                    {salesLoading ? (
                        <div className="flex justify-center py-20">
                            <div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
                        </div>
                    ) : (
                        <SalesAnalyticsTab sales={adminSales} t={t} />
                    )}
                </div>
            )}

            {/* ===== 탭: 관리자 - 매출 현황 (통계 대시보드) ===== */}
            {activeTab === 'admin_sales' && (
                <div className="space-y-8">
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-2xl font-black flex items-center gap-2">
                            <span className="p-2 bg-yellow-100 rounded-xl">💰</span>
                            {t('admin_sales_summary')}
                        </h2>
                        <button onClick={() => { loadAdminSales(); loadTrafficStats(); }} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                            <svg className={`w-5 h-5 text-gray-400 ${salesLoading || trafficLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>

                    {/* [New] 방문자 트래픽 요약 */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 rounded-3xl shadow-md text-white">
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-widest text-blue-200 mb-1">Today&apos;s Visitors (Beta)</div>
                                <div className="flex items-end gap-2">
                                    <span className="text-3xl font-black">{trafficLoading ? '...' : (trafficStats?.today?.visitors || 0)}</span>
                                    <span className="text-sm font-bold text-blue-200 mb-1">명 방문 ({trafficLoading ? '...' : (trafficStats?.today?.views || 0)} 뷰)</span>
                                </div>
                            </div>
                            <div className="border-l border-white/10 pl-8">
                                <div className="text-[11px] font-black uppercase tracking-widest text-blue-200 mb-1">Total Visitors</div>
                                <div className="flex items-end gap-2">
                                    <span className="text-3xl font-black">{trafficLoading ? '...' : (trafficStats?.total?.visitors || 0)}</span>
                                    <span className="text-sm font-bold text-blue-200 mb-1">명 누적 ({trafficLoading ? '...' : (trafficStats?.total?.views || 0)} 뷰)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 요약 카드 섹션 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
                            <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">{t('admin_sales_today')}</div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-black text-gray-900">฿{salesStats.today.amount.toLocaleString()}</span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-2 font-bold">{salesStats.today.count} {t('admin_sales_count')}</div>
                        </div>
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
                            <div className="text-[10px] font-black text-purple-500 uppercase tracking-widest mb-1">{t('admin_sales_this_month')}</div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-black text-gray-900">฿{salesStats.month.amount.toLocaleString()}</span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-2 font-bold">{salesStats.month.count} {t('admin_sales_count')}</div>
                        </div>
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between bg-gradient-to-br from-gray-900 to-gray-800">
                            <div className="text-[10px] font-black text-yellow-400 uppercase tracking-widest mb-1">{t('admin_sales_total')}</div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-black text-white">฿{salesStats.total.amount.toLocaleString()}</span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-2 font-bold">{salesStats.total.count} {t('admin_sales_count')}</div>
                        </div>
                    </div>

                    {/* 월별 집계 (클릭 시 펼치기 등 가능하게 구성 가능) */}
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                            <h3 className="text-sm font-black text-gray-900 uppercase tracking-tighter">Monthly Breakdown</h3>
                            <span className="text-[10px] font-bold text-gray-400 italic">Since 2024</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {monthlySales.map(m => (
                                <div key={m.month} className="px-6 py-4 flex justify-between items-center hover:bg-gray-50/50 transition-colors">
                                    <div>
                                        <div className="text-[10px] font-black text-gray-400 mb-0.5 uppercase">{m.month.split('-')[0]}</div>
                                        <div className="font-bold text-gray-900">{m.month.split('-')[1]}월 매출</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-black text-gray-900">฿{m.amount.toLocaleString()}</div>
                                        <div className="text-[10px] text-gray-400 font-bold">{m.count}건</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 일별 상세 Summary */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-black text-gray-900 uppercase tracking-tighter px-2">Daily History</h3>
                        {salesLoading ? (
                            <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                        ) : groupedSales.length === 0 ? (
                            <p className="text-center py-10 text-gray-400 text-sm">매출 기록이 없습니다.</p>
                        ) : (
                            <div className="space-y-3">
                                {groupedSales.map((group) => (
                                    <div key={group.date} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                                        <button 
                                            onClick={() => setSelectedSalesDate(selectedSalesDate === group.date ? null : group.date)}
                                            className="w-full px-6 py-5 flex justify-between items-center group"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-2 h-2 rounded-full ${group.date === salesStats.todayStr ? 'bg-green-400' : 'bg-gray-300 group-hover:bg-blue-400 transition-colors'}`}></div>
                                                <div className="text-left">
                                                    <div className="text-sm font-black text-gray-900">{group.date}</div>
                                                    <div className="text-[10px] text-gray-400 font-bold">{group.count}건의 판매</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <div className="text-xs font-black text-gray-500 uppercase leading-none mb-1">Total</div>
                                                    <div className="text-lg font-black text-gray-900 group-hover:text-blue-600 transition-colors">฿{group.totalDay.toLocaleString()}</div>
                                                </div>
                                                <svg className={`w-5 h-5 text-gray-300 transition-transform ${selectedSalesDate === group.date ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                        </button>
                                        
                                        {selectedSalesDate === group.date && (
                                            <div className="px-6 pb-6 border-t border-gray-50 pt-4 animate-in slide-in-from-top-2 duration-200">
                                                <div className="space-y-2">
                                                    {group.orders.map((order, oIdx) => (
                                                        <div key={oIdx} className="flex justify-between items-center p-3 rounded-xl bg-gray-50/50 hover:bg-gray-50 transition-colors">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-1.5 h-1.5 rounded-full ${order.isWeb ? 'bg-blue-400' : 'bg-orange-400'}`} />
                                                                {order.customerId && (
                                                                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex items-center gap-1">
                                                                        👤 {order.customerId}
                                                                    </span>
                                                                )}
                                                                <span className="text-xs font-bold text-gray-800 font-mono tracking-tighter">{order.orderId}</span>
                                                                {!order.isWeb && <span className="text-[8px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-black uppercase">Direct</span>}
                                                            </div>
                                                            <span className="text-xs font-black text-gray-900 font-mono">฿{order.amount.toLocaleString()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}


            {/* ===== 탭 7: 관리자 - 위탁판매관리 ===== */}
            {activeTab === 'admin_coupons' && (
                <div className="space-y-6">
                    {/* 쿠폰 발급 폼 */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                        <h3 className="text-lg font-bold mb-4">🎟️ 신규 쿠폰 발급</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">쿠폰 종류</label>
                                <select 
                                    value={couponType} 
                                    onChange={(e) => setCouponType(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm"
                                >
                                    <option value="amount">정액 할인 (Baht)</option>
                                    <option value="rate">비율 할인 (%)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">혜택 수치</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        placeholder={couponType === 'amount' ? '예: 100' : '예: 10'} 
                                        value={couponValue}
                                        onChange={(e) => setCouponValue(e.target.value)}
                                        className="w-full px-4 py-2 pr-8 border border-gray-200 rounded-lg text-sm"
                                    />
                                    <span className="absolute right-3 top-2.5 text-gray-400 text-sm">{couponType === 'amount' ? '฿' : '%'}</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">발급 매수</label>
                                <input 
                                    type="number" 
                                    min="1" 
                                    max="100"
                                    value={couponCount}
                                    onChange={(e) => setCouponCount(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                            </div>
                            <button 
                                onClick={handleGenerateCoupons}
                                disabled={couponLoading}
                                className="w-full bg-black text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-gray-800 disabled:bg-gray-400"
                            >
                                {couponLoading ? '발급 중...' : '발급하기'}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-3">
                            * 발급된 쿠폰은 구글 시트의 [쿠폰관리] 탭에 즉시 동기화되어 인쇄하기 편리합니다.<br/>
                            * 발급일로부터 1개월간 유효하며, 1회만 사용 가능합니다.
                        </p>
                    </div>

                    {/* 발급된 쿠폰 목록 */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                            <h3 className="font-bold text-sm text-gray-800">최근 발급된 쿠폰 목록 (최대 100건)</h3>
                            <div className="flex gap-4 items-center">
                                <button onClick={handlePrintCoupons} className="bg-black text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800 transition-colors">
                                    🖨️ 최신 미사용 20개 인쇄
                                </button>
                                <button onClick={loadCoupons} className="text-xs text-gray-400 hover:text-black underline">새로고침</button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead>
                                    <tr className="bg-white border-b border-gray-100 text-gray-400 uppercase text-xs tracking-wider">
                                        <th className="px-6 py-4 font-bold">쿠폰번호</th>
                                        <th className="px-6 py-4 font-bold">종류</th>
                                        <th className="px-6 py-4 font-bold">혜택</th>
                                        <th className="px-6 py-4 font-bold">상태</th>
                                        <th className="px-6 py-4 font-bold">만료일</th>
                                        <th className="px-6 py-4 font-bold text-center">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {adminCoupons.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="px-6 py-8 text-center text-gray-400">발급된 쿠폰이 없습니다.</td>
                                        </tr>
                                    ) : (
                                        adminCoupons.slice(0, 100).map(c => (
                                            <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-6 py-4 font-mono font-bold text-blue-600">{c.code}</td>
                                                <td className="px-6 py-4">{c.type === 'amount' ? '정액할인' : '비율할인'}</td>
                                                <td className="px-6 py-4 font-bold">{c.value}{c.type === 'amount' ? ' ฿' : '%'}</td>
                                                <td className="px-6 py-4">
                                                    {c.is_used ? (
                                                        <span className="bg-red-50 text-red-600 px-2 py-1 rounded text-xs">사용완료</span>
                                                    ) : (
                                                        <span className="bg-green-50 text-green-600 px-2 py-1 rounded text-xs">사용가능</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-gray-500 text-xs">{c.expires_at}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <button 
                                                        onClick={() => handleDeleteCoupon(c.code)}
                                                        className="text-[11px] bg-red-50 text-red-600 px-3 py-1.5 rounded font-bold hover:bg-red-100 transition-colors"
                                                    >
                                                        삭제
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'admin_consignment' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold">🤝 {t('admin_tab_consignment')}</h2>
                        <button onClick={() => loadConsignmentItems()} className="text-xs text-gray-400 hover:text-black underline">{t('refresh')}</button>
                    </div>

                    {/* 위탁 상품 일괄 등록 */}
                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        <div className="text-xs font-bold text-gray-500 mb-2">📋 위탁 상품 등록</div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={consignmentInput}
                                onChange={(e) => setConsignmentInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleRegisterConsignment()}
                                placeholder={t('consignment_input_placeholder')}
                                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black bg-white"
                            />
                            <button
                                onClick={handleRegisterConsignment}
                                className="bg-black text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors shrink-0"
                            >
                                {t('consignment_register')}
                            </button>
                        </div>
                    </div>

                    {/* 필터 및 옵션 레이아웃 */}
                    <div className="flex flex-wrap gap-4 items-end">
                        {/* 상태 필터 */}
                        <div className="bg-gray-50 p-1.5 rounded-xl border flex gap-1 w-fit">
                            {[
                                { id: 'all', label: t('consignment_filter_all') },
                                { id: 'active', label: t('consignment_filter_active') },
                                { id: 'sold', label: t('consignment_filter_sold') }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setConsignmentFilter(filter.id)}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                        consignmentFilter === filter.id
                                            ? 'bg-black text-white shadow-sm'
                                            : 'text-gray-400 hover:text-black hover:bg-white'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>

                        {/* 커미션 설정 */}
                        <div className="bg-blue-50 p-2 rounded-xl border border-blue-100 flex items-center gap-3">
                            <span className="text-[10px] font-black text-blue-600 uppercase ml-1">Commission %</span>
                            <input 
                                type="number" 
                                value={consignmentCommission}
                                onChange={(e) => setConsignmentCommission(e.target.value)}
                                className="w-16 px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs font-bold text-center outline-none focus:ring-2 focus:ring-blue-400"
                            />
                        </div>

                        {/* 일괄 처리 */}
                        <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex items-center gap-2 flex-grow max-w-lg">
                            <input 
                                type="text"
                                placeholder="ID(행번호) 일괄입력 (예: 2, 4, 7...)"
                                value={bulkSoldInput}
                                onChange={(e) => setBulkSoldInput(e.target.value)}
                                className="flex-1 px-3 py-1 bg-white border border-gray-100 rounded-lg text-xs outline-none focus:ring-2 focus:ring-black"
                            />
                            <div className="flex gap-2 shrink-0">
                                <button 
                                    onClick={handleBulkConsignmentSold}
                                    className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-black transition-colors"
                                >
                                    일괄 판매완료
                                </button>
                                <button 
                                    onClick={handleCancelAllActive}
                                    className="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-red-100 hover:bg-red-100 transition-colors"
                                >
                                    위탁중인 제품 전체 취소
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 위탁 상품 목록 */}
                    {consignmentLoading ? (
                        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin" /></div>
                    ) : (consignmentFilter === 'sold' ? (
                        /* 판매 완료 건: 차수별 그룹화 뷰 */
                        <div className="space-y-8">
                            {groupedConsignment.map((group, gIdx) => (
                                <div key={group.batchId} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${gIdx * 50}ms` }}>
                                    <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                                            <h3 className="font-mono font-bold text-gray-900 tracking-tight">
                                                {group.batchId === 'legacy' ? '기존 판매 정산분' : `정산 일시: ${group.batchId}`}
                                            </h3>
                                        </div>
                                        <div className="text-right flex items-center gap-6">
                                            <div className="hidden sm:block">
                                                <p className="text-[9px] text-gray-400 uppercase font-black mb-0.5 text-center">Items</p>
                                                <p className="text-sm font-bold text-gray-900 text-center">{group.items.length}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] text-blue-500 uppercase font-black mb-0.5">Batch Net Total</p>
                                                <p className="text-lg font-black text-blue-600">฿{group.totalNet.toLocaleString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="p-0">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50/50 text-gray-400 text-[10px] font-black uppercase tracking-tighter">
                                                <tr>
                                                    <th className="px-6 py-3">ID</th>
                                                    <th className="px-6 py-3">상품 정보</th>
                                                    <th className="px-6 py-3 text-right">금액 상세</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {group.items.map(item => (
                                                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                                        <td className="px-6 py-4 text-[10px] font-mono font-bold text-gray-300">#{item.id}</td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <img src={getImageUrl(item.image_url, item.thumbnail_url)} alt="" className="w-10 h-10 object-cover rounded-lg bg-gray-100 shadow-sm" />
                                                                <div>
                                                                    <p className="font-bold text-gray-900 leading-tight text-xs">{(lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name) || '(상품 미확인)'}</p>
                                                                    <p className="text-[9px] text-gray-400 font-mono italic">{item.brand || '-'} | {item.product_code}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            {item.commission_rate ? (
                                                                <div className="flex flex-col items-end gap-0.5">
                                                                    <div className="flex gap-2 items-center text-[10px]">
                                                                        <span className="text-gray-400 font-bold uppercase text-[8px]">Total</span>
                                                                        <span className="font-mono font-bold text-gray-500">฿{Number(item.price || 0).toLocaleString()}</span>
                                                                    </div>
                                                                    <div className="flex gap-2 items-center text-[10px] text-red-400">
                                                                        <span className="font-bold uppercase text-[8px]">Comm ({item.commission_rate})</span>
                                                                        <span className="font-mono font-bold">-฿{Number(item.commission_amount || 0).toLocaleString()}</span>
                                                                    </div>
                                                                    <div className="flex gap-2 items-center text-blue-600 font-bold">
                                                                        <span className="uppercase text-[9px] font-black">Net</span>
                                                                        <span className="font-mono font-black">฿{Number(item.net_amount || 0).toLocaleString()}</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span className="font-mono font-black text-gray-900">฿{Number(item.price || 0).toLocaleString()}</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="bg-gray-50/30 px-6 py-3 border-t border-gray-100 flex justify-end gap-10">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-gray-400 font-bold uppercase">Batch Total Amount:</span>
                                            <span className="text-sm font-bold text-gray-500 font-mono">฿{group.totalAmount.toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-gray-400 font-bold uppercase">Batch Total Commission:</span>
                                            <span className="text-sm font-bold text-red-500 font-mono">฿{group.totalComm.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* 위탁중/기타: 일반 리스트 뷰 */
                        <div className="bg-white rounded-2xl border overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-[10px] font-black uppercase tracking-tighter">
                                    <tr>
                                        <th className="px-4 py-3">ID</th>
                                        <th className="px-4 py-3">상품 정보</th>
                                        <th className="px-4 py-3">등록일</th>
                                        <th className="px-4 py-3 text-right">금액 상세</th>
                                        <th className="px-4 py-3 text-center">상태</th>
                                        <th className="px-4 py-3 text-right">관리</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {consignmentItems.map(item => (
                                        <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                                            <td className="px-4 py-4 text-[10px] font-mono font-bold text-gray-400">#{item.id}</td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={getImageUrl(item.image_url, item.thumbnail_url)}
                                                        alt=""
                                                        className="w-10 h-10 object-cover rounded-lg bg-gray-100 shadow-sm"
                                                    />
                                                    <div>
                                                        <p className="font-bold text-gray-900 leading-tight">{(lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name) || '(상품 미확인)'}</p>
                                                        <p className="text-[10px] text-gray-400 font-mono italic">{item.brand || '-'} | {item.product_code}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-[10px] text-gray-500 font-mono whitespace-nowrap">{item.registered_at?.split(' ')[0]}</td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="font-mono font-black text-gray-900">฿{isNaN(Number(item.price)) ? (item.price || '-') : Number(item.price).toLocaleString()}</span>
                                            </td>
                                            <td className="px-4 py-4 text-center">
                                                {item.status === 'sold' ? (
                                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[9px] font-black uppercase tracking-wider">{t('consignment_status_sold') || '판매완료'}</span>
                                                ) : (
                                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[9px] font-black uppercase tracking-wider">{t('consignment_status_active')}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                {item.status !== 'sold' && (
                                                    <div className="flex flex-col gap-1 items-end">
                                                        <button
                                                            onClick={() => handleConsignmentSold(item.id)}
                                                            className="text-[9px] bg-black text-white px-3 py-1.5 rounded-lg font-bold hover:bg-gray-800 transition-all shadow-sm hover:scale-105"
                                                        >
                                                            {t('consignment_mark_sold')}
                                                        </button>
                                                        <button
                                                            onClick={() => handleConsignmentCancel(item.id)}
                                                            className="text-[9px] text-red-400 hover:text-red-600 font-bold underline transition-colors"
                                                        >
                                                            {t('consignment_cancel')}
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            )}

            {/* 인쇄용 숨김 영역 (A4 규격) */}
            <div id="coupon-print-area" className="hidden print:block w-[210mm] h-[297mm] bg-white text-black p-0 box-border">
                <div className="grid grid-cols-2 grid-rows-10 h-full w-full border-t-2 border-l-2 border-black box-border">
                    {adminCoupons.filter(c => !c.is_used).slice(0, 20).map((coupon, idx) => (
                        <div key={idx} className="border-b-2 border-r-2 border-dashed border-gray-400 p-2 flex flex-col justify-center items-center relative box-border bg-[#fdfbf7]" style={{ height: '29.7mm' }}>
                            {/* 좌측 절취선 모양 포인트 */}
                            <div className="absolute left-0 top-0 bottom-0 w-2 flex flex-col justify-between py-1 opacity-50">
                                {[...Array(5)].map((_, i) => <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-300 ml-0.5"></div>)}
                            </div>
                            
                            <div className="flex w-full px-3 items-center justify-between gap-2">
                                <div className="text-left flex-1 pl-2 space-y-1">
                                    <h4 className="text-[11px] font-bold tracking-widest text-gray-500 leading-none uppercase">822SHOP Gift Voucher</h4>
                                    <div className="text-[26px] font-black text-[#FE2C55] leading-none py-1 tracking-tight">
                                        ส่วนลด {coupon.type === 'amount' ? `฿${coupon.value}` : `${coupon.value}%`}
                                    </div>
                                    <div className="text-[13px] font-black text-black leading-none">
                                        🌐 www.822shop.com
                                    </div>
                                    <div className="text-[9px] text-gray-500 pt-1 mt-1 border-t border-gray-200 w-fit">
                                        หมดเขต: {coupon.expires_at} (ใช้ได้ครั้งเดียว)
                                    </div>
                                </div>
                                <div className="bg-white border-2 border-black rounded-lg px-3 py-2 flex flex-col items-center justify-center shrink-0 shadow-sm">
                                    <span className="text-[8px] text-gray-500 font-bold mb-0.5 uppercase tracking-widest">Coupon Code</span>
                                    <span className="font-mono text-lg font-black text-black tracking-widest">{coupon.code}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default MyPage;
