import { createContext, useContext, useState, useEffect } from 'react';

/**
 * 전역 인증 상태 관리
 * - LocalStorage에 세션 유지 (브라우저 새로고침 시에도 로그인 유지)
 * - user 객체: { id, name, line_id, phone, province, district, sub_district, postal_code, address_detail }
 */
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

const STORAGE_KEY = 'dreamstudiovtg_user';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // 앱 시작 시 LocalStorage에서 세션 복원
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setUser(JSON.parse(saved));
            }
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
        setLoading(false);
    }, []);

    // 로그인 성공 시 사용자 정보 저장
    const login = (userData) => {
        setUser(userData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    };

    // 로그아웃
    const logout = () => {
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isLoggedIn: !!user }}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
