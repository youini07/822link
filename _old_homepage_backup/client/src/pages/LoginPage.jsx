import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { loginCustomer } from '../services/api';
import { getTranslation } from '../services/i18n';

/**
 * 로그인 페이지
 * - Line ID + 이름(닉네임)으로 간편 로그인
 * - 비밀번호 없이 회원가입 시 등록한 정보로 인증
 */
const LoginPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);
    const { login } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({
        login_id: '',
        password: ''
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!form.login_id || !form.password) {
            setError(t('login_fill_all'));
            return;
        }

        setIsLoading(true);
        try {
            const result = await loginCustomer(form);
            if (result.success) {
                login(result.user);
                navigate(`/?lang=${lang}`);
            }
        } catch (err) {
            const errData = err.response?.data;
            if (errData?.error === 'NOT_FOUND') {
                setError(t('login_not_found'));
            } else if (errData?.error === 'INVALID_CREDENTIALS') {
                setError(t('login_invalid'));
            } else {
                setError(t('login_error'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-md mx-auto px-4 py-12">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold text-gray-900 mb-3">{t('login_title')}</h1>
                    <p className="text-gray-500 text-sm">{t('login_subtitle')}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">{t('register_login_id')}</label>
                        <input
                            type="text"
                            value={form.login_id}
                            onChange={(e) => setForm(prev => ({ ...prev, login_id: e.target.value }))}
                            placeholder={t('login_id_ph')}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                        />
                    </div>
 
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">{t('login_password')}</label>
                        <input
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                            placeholder={t('login_password_ph')}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-black text-white py-4 rounded-xl font-bold text-sm tracking-wide hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 mt-4 flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {t('login_logging_in')}
                            </>
                        ) : (
                            t('nav_login')
                        )}
                    </button>
                </form>

                <div className="mt-8 pt-8 border-t border-gray-100 text-center">
                    <p className="text-gray-500 text-sm mb-3">{t('login_no_account')}</p>
                    <a
                        href={`/register?lang=${lang}`}
                        className="text-black font-bold text-sm hover:underline decoration-2 underline-offset-4"
                    >
                        {t('login_register_link')}
                    </a>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
