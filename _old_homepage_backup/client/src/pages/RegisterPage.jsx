import { useState, useCallback, useRef, useEffect } from 'react';
import { getTranslation } from '../services/i18n';
import { registerCustomer, checkLoginId } from '../services/api';
import { getProvinces, getDistricts, getSubDistricts, getPostalCode } from '../data/thai-address-data';

/**
 * 회원가입 페이지 (한국형)
 * - 아이디, 닉네임, 연락처, 비밀번호 수집
 * - 연락처를 주요 식별자로 사용 (서버에서 숫자만 파싱하여 저장/중복체크)
 * - 다음 카카오 주소 API 연동 {t('register_optional') || '(선택사항)'}
 */
const RegisterPage = ({ lang }) => {
    const t = (key) => getTranslation(lang, key);

    // 이전 버전(태국/글로벌) 주소 입력 방식으로 복원하여 API 불필요

    // 폼 필드 상태
    const [form, setForm] = useState({
        login_id: '',
        password: '',
        passwordConfirm: '',
        name: '',
        phone: '',
        province: '',
        district: '',
        sub_district: '',
        postal_code: '',
        address_detail: ''
    });

    // UI 상태
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    
    // 중복 체크 상태
    const [loginIdStatus, setLoginIdStatus] = useState(''); // 'checking', 'available', 'taken', 'invalid', ''
    
    // 타이머
    const loginIdTimerRef = useRef(null);

    // 주소 드롭다운 데이터
    const provinces = getProvinces();
    const districts = form.province ? getDistricts(form.province) : [];
    const subDistricts = form.province && form.district ? getSubDistricts(form.province, form.district) : [];

    // 폼 필드 업데이트
    const updateField = (field, value) => {
        setErrorMsg('');
        setForm(prev => {
            const updated = { ...prev, [field]: value };

            // 계단식 드롭다운: 상위 변경시 하위 초기화
            if (field === 'province') {
                updated.district = '';
                updated.sub_district = '';
                updated.postal_code = '';
            } else if (field === 'district') {
                updated.sub_district = '';
                updated.postal_code = '';
            } else if (field === 'sub_district') {
                const zip = getPostalCode(updated.province, updated.district, value);
                updated.postal_code = zip || '';
            }

            return updated;
        });
    };

    // 아이디 중복 체크 (디바운스 500ms)
    const handleLoginIdChange = (value) => {
        updateField('login_id', value);
        setLoginIdStatus('');

        if (loginIdTimerRef.current) clearTimeout(loginIdTimerRef.current);
        if (!value.trim()) return;

        // 형식 검사 (영어/숫자 4~20자)
        const idRegex = /^[a-zA-Z0-9]{4,20}$/;
        if (!idRegex.test(value)) {
            setLoginIdStatus('invalid');
            return;
        }

        loginIdTimerRef.current = setTimeout(async () => {
            setLoginIdStatus('checking');
            try {
                const result = await checkLoginId(value.trim());
                setLoginIdStatus(result.exists ? 'taken' : 'available');
            } catch {
                setLoginIdStatus('');
            }
        }, 500);
    };

    // 수동 주소 입력으로 복원됨

    // 폼 제출
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        // 1. 필수 필드 검증
        if (!form.login_id.trim() || !form.password || !form.passwordConfirm || !form.name.trim() || !form.phone.trim() || !form.province.trim() || !form.district.trim() || !form.sub_district.trim() || !form.postal_code.trim() || !form.address_detail.trim()) {
            setErrorMsg('모든 필수 항목(주소 포함)을 빠짐없이 입력해주세요.');
            return;
        }

        // 2. 아이디 규칙 검증
        const idRegex = /^[a-zA-Z0-9]{4,20}$/;
        if (!idRegex.test(form.login_id)) {
            setErrorMsg(t('register_invalid_id'));
            return;
        }

        if (loginIdStatus === 'taken') {
            setErrorMsg(t('register_login_id_taken'));
            return;
        }

        // 3. 비밀번호 검증
        const pwRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
        if (!pwRegex.test(form.password)) {
            setErrorMsg(t('register_invalid_pw') || '비밀번호는 영문, 숫자를 포함하여 8자 이상이어야 합니다.');
            return;
        }

        if (form.password !== form.passwordConfirm) {
            setErrorMsg('비밀번호가 일치하지 않습니다.');
            return;
        }

        setIsSubmitting(true);
        try {
            await registerCustomer(form);
            setIsSuccess(true);
        } catch (err) {
            const errData = err.response?.data;
            if (errData?.error === 'DUPLICATE_LOGIN_ID') {
                setErrorMsg(t('register_login_id_taken'));
                setLoginIdStatus('taken');
            } else if (errData?.error === 'DUPLICATE_PHONE') {
                setErrorMsg('이미 가입된 연락처입니다. 다른 연락처를 사용해주세요.');
            } else {
                setErrorMsg(t('register_error') || '회원가입 중 오류가 발생했습니다.');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="max-w-lg mx-auto px-4 py-12 text-center">
                <div className="bg-white rounded-2xl shadow-lg p-10 border border-border">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-50 flex items-center justify-center">
                        <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-3">{t('register_success_title') || '회원가입 완료'}</h2>
                    <p className="text-gray-500 mb-8 leading-relaxed">{t('register_success_msg') || '가입이 성공적으로 완료되었습니다. 로그인 후 서비스를 이용해주세요.'}</p>
                    <a
                        href={`/login?lang=${lang}`}
                        className="inline-block bg-black text-white px-8 py-3 rounded-lg font-medium text-sm tracking-wide hover:bg-gray-800 transition-colors"
                    >
                        {t('nav_login')}
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('register_title') || '회원가입'}</h1>
                <p className="text-gray-500 text-sm">{t('register_subtitle') || '드림스튜디오 회원가입을 환영합니다.'}</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg border border-border p-6 md:p-10 space-y-6">
                {errorMsg && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {errorMsg}
                    </div>
                )}

                <div className="space-y-5">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b border-border pb-2">
                        {t('register_section_info') || '필수 정보 입력'}
                    </h3>

                    {/* 아이디 */}
                    <div>
                        <label htmlFor="reg-login-id" className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('register_login_id') || '로그인 아이디'} <span className="text-red-400">*</span>
                        </label>
                        <div className="relative">
                            <input
                                id="reg-login-id"
                                type="text"
                                value={form.login_id}
                                onChange={(e) => handleLoginIdChange(e.target.value)}
                                placeholder={t('register_login_id_ph') || '영문, 숫자 4~20자'}
                                className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 transition-all ${
                                    loginIdStatus === 'taken' || loginIdStatus === 'invalid' ? 'border-red-400 bg-red-50' :
                                    loginIdStatus === 'available' ? 'border-green-400 bg-green-50' :
                                    'border-gray-200'
                                }`}
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                {loginIdStatus === 'checking' && <div className="w-5 h-5 border-2 border-gray-300 border-t-black rounded-full animate-spin" />}
                                {loginIdStatus === 'available' && <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth={2} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                {(loginIdStatus === 'taken' || loginIdStatus === 'invalid') && <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth={2} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                        </div>
                        {loginIdStatus === 'invalid' && <p className="text-red-500 text-xs mt-1">{t('register_invalid_id') || '아이디 형식이 올바르지 않습니다.'}</p>}
                        {loginIdStatus === 'taken' && <p className="text-red-500 text-xs mt-1">{t('register_login_id_taken') || '이미 사용중인 아이디입니다.'}</p>}
                    </div>

                    {/* 비밀번호 */}
                    <div>
                        <label htmlFor="reg-pw" className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('register_password') || '비밀번호'} <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="reg-pw"
                            type="password"
                            value={form.password}
                            onChange={(e) => updateField('password', e.target.value)}
                            placeholder={t('register_password_ph') || '영문, 숫자 포함 8자 이상'}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                        />
                    </div>
                    
                    {/* 비밀번호 확인 */}
                    <div>
                        <label htmlFor="reg-pw-confirm" className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('register_password_confirm') || '비밀번호 재입력'} <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="reg-pw-confirm"
                            type="password"
                            value={form.passwordConfirm}
                            onChange={(e) => updateField('passwordConfirm', e.target.value)}
                            placeholder={t('register_password_confirm_ph') || '비밀번호를 다시 한 번 입력해주세요'}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                        />
                    </div>

                    {/* 이름 (닉네임) */}
                    <div>
                        <label htmlFor="reg-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('register_name') || '닉네임 (이름)'} <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="reg-name"
                            type="text"
                            value={form.name}
                            onChange={(e) => updateField('name', e.target.value)}
                            placeholder={t('register_name_ph') || '이름 또는 닉네임을 입력해주세요'}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                        />
                    </div>

                    {/* 연락처 */}
                    <div>
                        <label htmlFor="reg-phone" className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('register_phone') || '연락처 (Phone)'} <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="reg-phone"
                            type="tel"
                            value={form.phone}
                            onChange={(e) => updateField('phone', e.target.value)}
                            placeholder={t('register_phone_ph') || '전화번호를 입력해주세요'}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                        />
                    </div>
                </div>

                {/* 섹션 2: 배송 주소 (필수) */}
                <div className="space-y-5">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b border-border pb-2 flex items-center gap-2">
                        {t('register_section_address') || '배송 주소 (Shipping Address)'} <span className="text-red-400">*</span>
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                        {/* Province */}
                        <div>
                            <select
                                value={form.province}
                                onChange={(e) => updateField('province', e.target.value)}
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all appearance-none cursor-pointer"
                            >
                                <option value="">{t('register_select_province') || '-- เลือกจังหวัด --'}</option>
                                {provinces.map(p => <option key={p.th} value={p.th}>{p.th} ({p.en})</option>)}
                            </select>
                        </div>
                        {/* District */}
                        <div>
                            <select
                                value={form.district}
                                onChange={(e) => updateField('district', e.target.value)}
                                disabled={!form.province}
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all appearance-none cursor-pointer disabled:opacity-50"
                            >
                                <option value="">{t('register_select_district') || '-- เลือกอำเภอ/เขต --'}</option>
                                {districts.map(d => <option key={d.th} value={d.th}>{d.th} ({d.en})</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {/* Sub-district */}
                        <div>
                            <select
                                value={form.sub_district}
                                onChange={(e) => updateField('sub_district', e.target.value)}
                                disabled={!form.district}
                                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all appearance-none cursor-pointer disabled:opacity-50"
                            >
                                <option value="">{t('register_select_sub_district') || '-- เลือกตำบล/แขวง --'}</option>
                                {subDistricts.map(s => <option key={s.th} value={s.th}>{s.th} ({s.en})</option>)}
                            </select>
                        </div>
                        {/* Postal Code */}
                        <div>
                            <input
                                type="text"
                                value={form.postal_code}
                                readOnly
                                placeholder={t('register_postal_auto') || 'รหัสไปรษณีย์'}
                                className="w-full px-4 py-3 border border-gray-100 rounded-lg text-sm bg-gray-50 text-gray-600 focus:outline-none"
                            />
                        </div>
                    </div>
                    
                    {/* Address Detail */}
                    <div>
                        <input
                            id="reg-address-detail"
                            type="text"
                            value={form.address_detail}
                            onChange={(e) => updateField('address_detail', e.target.value)}
                            placeholder={t('register_address_detail_ph') || '건물명, 층, 호수, 거리 등 상세주소'}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black transition-all"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting || loginIdStatus === 'taken'}
                    className="w-full bg-black text-white py-3.5 rounded-lg font-bold text-sm tracking-wide hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isSubmitting ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 처리중...</> : '가입하기'}
                </button>
            </form>
        </div>
    );
};

export default RegisterPage;
