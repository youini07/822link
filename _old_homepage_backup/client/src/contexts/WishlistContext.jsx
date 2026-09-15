import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getWishlist, toggleWishlist as apiToggleWishlist } from '../services/api';

const WishlistContext = createContext();

export const WishlistProvider = ({ children }) => {
    const { user, isLoggedIn } = useAuth();
    const [wishlist, setWishlist] = useState([]);
    const [wishlistCodes, setWishlistCodes] = useState(new Set());

    useEffect(() => {
        if (isLoggedIn && user?.id) {
            loadWishlist();
        } else {
            setWishlist([]);
            setWishlistCodes(new Set());
        }
    }, [isLoggedIn, user]);

    const loadWishlist = async () => {
        try {
            const res = await getWishlist(user.id);
            if (res.success) {
                setWishlist(res.wishlist);
                setWishlistCodes(new Set(res.wishlist.map(p => p.code)));
            }
        } catch (err) {
            console.error('Failed to load wishlist:', err);
        }
    };

    const toggleWishlist = async (productCode) => {
        if (!isLoggedIn) {
            alert('로그인 후 이용 가능합니다.');
            return false;
        }
        
        try {
            // Optimistic UI update
            const newSet = new Set(wishlistCodes);
            if (newSet.has(productCode)) {
                newSet.delete(productCode);
            } else {
                newSet.add(productCode);
            }
            setWishlistCodes(newSet);

            const res = await apiToggleWishlist(user.id, productCode);
            if (res.success) {
                // If it was added, we should reload to get the full product details for the wishlist page
                if (res.isWished) {
                    loadWishlist();
                } else {
                    setWishlist(prev => prev.filter(p => p.code !== productCode));
                }
            }
            return res.isWished;
        } catch (err) {
            console.error('Failed to toggle wishlist:', err);
            // Revert optimistic update
            loadWishlist();
            return null;
        }
    };

    const isWished = (productCode) => {
        return wishlistCodes.has(productCode);
    };

    return (
        <WishlistContext.Provider value={{ wishlist, toggleWishlist, isWished, loadWishlist }}>
            {children}
        </WishlistContext.Provider>
    );
};

export const useWishlist = () => useContext(WishlistContext);
