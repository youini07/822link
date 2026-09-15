import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchOrders, updateOrderStatus } from '../services/api';
import { getTranslation } from '../services/i18n';

/**
 * 내 주문 내역 페이지
 * - 주문번호, 일시, 상태, 금액, 상품 목록 표시
 */
const OrdersPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    const handleCancelOrder = async (orderNumber) => {
        if (!window.confirm(lang === 'KR' ? '주문을 취소하시겠습니까?\n취소 시 재고가 실시간으로 복구됩니다.' : 'Are you sure you want to cancel this order?')) return;
        try {
            await updateOrderStatus(orderNumber, 'cancelled');
            alert(lang === 'KR' ? '주문이 취소되었습니다.' : 'Order has been cancelled.');
            window.location.reload();
        } catch (err) {
            console.error('Cancel order error:', err);
            alert('주문 취소 실패');
        }
    };

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            navigate('/login');
            return;
        }
        const loadOrders = async () => {
            try {
                const data = await fetchOrders(user.id);
                setOrders(data.orders || []);
            } catch (err) {
                console.error('[Orders] Load error:', err);
            }
            setLoading(false);
        };
        loadOrders();
    }, [user, navigate]);

    // 주문 상태 뱃지 스타일
    const getStatusStyle = (status) => {
        switch (status) {
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
            pending: t('order_status_pending'),
            confirmed: t('order_status_confirmed'),
            shipped: t('order_status_shipped'),
            delivered: t('order_status_delivered'),
            cancelled: t('order_status_cancelled'),
        };
        return labels[status] || status;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-10 h-10 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">{t('orders_title')}</h1>

            {orders.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl shadow-lg border border-gray-100">
                    <div className="text-5xl mb-4">📦</div>
                    <h2 className="text-xl font-bold text-gray-700 mb-2">{t('orders_empty')}</h2>
                    <Link to="/" className="inline-block mt-4 bg-black text-white px-8 py-3 rounded-lg font-medium text-sm hover:bg-gray-800 transition-colors">
                        {t('cart_go_shopping')}
                    </Link>
                </div>
            ) : (
                <div className="space-y-6">
                    {orders.map((order) => (
                        <div key={order.order_number} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            {/* 주문 헤더 */}
                            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-100">
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

                            {/* 상품 목록 */}
                            <div className="px-6 py-4 space-y-2">
                                {order.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between text-sm">
                                        <span className="text-gray-700">
                                            [{item.brand}] {lang === 'EN' && item.name_en ? item.name_en : lang === 'TH' && item.name_th ? item.name_th : item.name} × {item.quantity}
                                        </span>
                                        <span className="font-medium text-gray-900 shrink-0">
                                            ฿{item.subtotal.toLocaleString()}
                                        </span>
                                    </div>
                                ))}
                            </div>

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
    );
};

export default OrdersPage;
