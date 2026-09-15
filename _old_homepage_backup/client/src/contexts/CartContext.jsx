import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchCart, addToCart as apiAddToCart, removeFromCart as apiRemoveFromCart } from '../services/api';

/**
 * 장바구니 전역 상태 관리
 * - 상품당 1개만 담기 가능 (수량 없음)
 * - 로그인 시 서버 DB와 동기화
 * - 비로그인 시 LocalStorage만 사용
 */
const CartContext = createContext(null);

export const useCart = () => useContext(CartContext);

const LOCAL_CART_KEY = 'dreamstudiovtg_cart';

export const CartProvider = ({ children }) => {
    const { user, isLoggedIn } = useAuth();
    const [cartItems, setCartItems] = useState([]);
    const [cartLoading, setCartLoading] = useState(false);

    // 장바구니 아이템 개수 (뱃지 표시용)
    const cartCount = cartItems.length;
    // 합계 금액 (각 상품 1개씩)
    const cartTotal = cartItems.reduce((sum, item) => {
        return sum + (Number(item.price) || 0);
    }, 0);

    // 로그인 상태 변경 시 장바구니 로드
    useEffect(() => {
        if (isLoggedIn && user?.id) {
            loadServerCart();
        } else {
            try {
                const saved = localStorage.getItem(LOCAL_CART_KEY);
                if (saved) setCartItems(JSON.parse(saved));
            } catch {
                setCartItems([]);
            }
        }
    }, [isLoggedIn, user?.id]);

    // 서버에서 장바구니 로드
    const loadServerCart = useCallback(async () => {
        if (!user?.id) return;
        setCartLoading(true);
        try {
            const data = await fetchCart(user.id);
            setCartItems(data.items || []);
        } catch (err) {
            console.error('[Cart] Load error:', err);
        }
        setCartLoading(false);
    }, [user?.id]);

    // 장바구니에 상품 추가 (1개만 허용, 이미 있으면 차단)
    const addItem = useCallback(async (product) => {
        // 이미 담긴 상품이면 추가 안 함
        const alreadyInCart = cartItems.some(i => i.product_code === product.code);
        if (alreadyInCart) {
            return 'ALREADY_IN_CART';
        }

        if (isLoggedIn && user?.id) {
            try {
                await apiAddToCart(user.id, product.code, 1);
                await loadServerCart();
                return true;
            } catch (err) {
                console.error('[Cart] Add error:', err);
                return false;
            }
        } else {
            setCartItems(prev => {
                const updated = [...prev, {
                    product_code: product.code,
                    quantity: 1,
                    name: product.name,
                    brand: product.brand,
                    price: product.price,
                    thumbnail_url: product.thumbnail_url,
                    image_url: product.image_url,
                }];
                localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(updated));
                return updated;
            });
            return true;
        }
    }, [isLoggedIn, user?.id, loadServerCart, cartItems]);

    // 장바구니에서 삭제
    const removeItem = useCallback(async (productCode) => {
        if (isLoggedIn && user?.id) {
            try {
                await apiRemoveFromCart(user.id, productCode);
                await loadServerCart();
            } catch (err) {
                console.error('[Cart] Remove error:', err);
            }
        } else {
            setCartItems(prev => {
                const updated = prev.filter(i => i.product_code !== productCode);
                localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(updated));
                return updated;
            });
        }
    }, [isLoggedIn, user?.id, loadServerCart]);

    // 장바구니 비우기 (주문 완료 후)
    const clearCart = useCallback(() => {
        setCartItems([]);
        localStorage.removeItem(LOCAL_CART_KEY);
    }, []);

    return (
        <CartContext.Provider value={{
            cartItems, cartCount, cartTotal, cartLoading,
            addItem, removeItem, clearCart, loadServerCart
        }}>
            {children}
        </CartContext.Provider>
    );
};

export default CartContext;
