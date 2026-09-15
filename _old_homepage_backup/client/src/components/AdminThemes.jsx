import React, { useState, useEffect } from 'react';
import { getTranslation } from '../services/i18n';

const AdminThemes = ({ lang }) => {
    const [themes, setThemes] = useState([]);
    const [filters, setFilters] = useState({ brands: [], upperCategories: [], categories: [] });
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    
    // 폼 상태
    const [formData, setFormData] = useState(setFormDataInitial());

    // 메인 배너 관리 상태
    const [mainBanners, setMainBanners] = useState([]);
    const [bannerLoading, setBannerLoading] = useState(true);
    const [bannerFormData, setBannerFormData] = useState({
        image_url: '',
        link_url: '',
        title: '',
        subtitle: '',
        sort_order: 0
    });
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    
    // 배너 자동 생성 상태
    const [generateDate, setGenerateDate] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    function setFormDataInitial() {
        return {
            id: null,
            title: '',
            filter_mode: 'filter',
            max_items: 10,
            filter_gender: [],
            filter_upper_category: [],
            filter_category: [],
            filter_brand: [],
            filter_season: '',
            sort_order: 0
        };
    }

    useEffect(() => {
        fetchData();
        fetchMainBanners();
    }, []);

    const fetchMainBanners = async () => {
        setBannerLoading(true);
        try {
            const res = await fetch('/api/main_banners');
            const data = await res.json();
            if (data.success) setMainBanners(data.banners);
        } catch (err) {
            console.error('메인 배너 조회 실패:', err);
        } finally {
            setBannerLoading(false);
        }
    };

    const handleAutoGenerate = async () => {
        if (!generateDate) {
            alert('입고 예정일을 입력해주세요 (예: 9/1)');
            return;
        }
        setIsGenerating(true);
        try {
            const res = await fetch('/api/admin/generate-banner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_date: generateDate })
            });
            const data = await res.json();
            if (data.success) {
                setBannerFormData(prev => ({
                    ...prev,
                    image_url: data.image_url,
                    title: data.title,
                    link_url: `/?lang=KR&search=${encodeURIComponent(generateDate)}`
                }));
                alert('배너가 성공적으로 자동 생성되었습니다! 아래 입력 폼을 확인하고 추가를 눌러주세요.');
            } else {
                alert('배너 생성 실패: ' + (data.message || '알 수 없는 오류'));
            }
        } catch (error) {
            console.error(error);
            alert('서버 오류 발생');
        } finally {
            setIsGenerating(false);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const [themesRes, filtersRes] = await Promise.all([
                fetch('/api/themes').then(r => r.json()),
                fetch('/api/filters').then(r => r.json())
            ]);
            
            if (themesRes.success) {
                setThemes(themesRes.themes);
            }
            if (filtersRes) {
                setFilters({
                    brands: filtersRes.brands || [],
                    upperCategories: filtersRes.upperCategories || [],
                    categories: filtersRes.categories || []
                });
            }
        } catch (err) {
            console.error('Failed to fetch admin themes data:', err);
            alert('데이터를 불러오는데 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleCheckToggle = (field, value) => {
        setFormData(prev => {
            const list = prev[field] || [];
            if (list.includes(value)) {
                return { ...prev, [field]: list.filter(v => v !== value) };
            } else {
                return { ...prev, [field]: [...list, value] };
            }
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.title) {
            alert('테마 제목을 입력해주세요.');
            return;
        }

        const payload = {
            title: formData.title,
            filter_mode: formData.filter_mode || 'filter',
            max_items: parseInt(formData.max_items) || 10,
            filter_gender: formData.filter_gender.join(','),
            filter_upper_category: formData.filter_upper_category.join(','),
            filter_category: formData.filter_category.join(','),
            filter_brand: formData.filter_brand.join(','),
            filter_season: formData.filter_season || '',
            sort_order: parseInt(formData.sort_order) || 0
        };

        try {
            let res;
            if (isEditing && formData.id) {
                res = await fetch(`/api/admin/themes/${formData.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch('/api/admin/themes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            
            const data = await res.json();
            if (data.success) {
                alert(isEditing ? '테마가 수정되었습니다.' : '테마가 추가되었습니다.');
                setFormData(setFormDataInitial());
                setIsEditing(false);
                fetchData();
            } else {
                alert('저장 실패: ' + data.message);
            }
        } catch (err) {
            console.error(err);
            alert('요청 중 오류가 발생했습니다.');
        }
    };

    const handleEdit = (theme) => {
        setFormData({
            id: theme.id,
            title: theme.title,
            filter_mode: theme.filter_mode || 'filter',
            max_items: theme.max_items || 10,
            filter_gender: theme.filter_gender ? theme.filter_gender.split(',').filter(x => x) : [],
            filter_upper_category: theme.filter_upper_category ? theme.filter_upper_category.split(',').filter(x => x) : [],
            filter_category: theme.filter_category ? theme.filter_category.split(',').filter(x => x) : [],
            filter_brand: theme.filter_brand ? theme.filter_brand.split(',').filter(x => x) : [],
            filter_season: theme.filter_season || '',
            sort_order: theme.sort_order || 0
        });
        setIsEditing(true);
        const themeSection = document.getElementById('theme-management-section');
        if (themeSection) {
            themeSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('정말 이 테마를 삭제하시겠습니까?')) return;
        
        try {
            const res = await fetch(`/api/admin/themes/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                alert('테마가 삭제되었습니다.');
                fetchData();
                if (formData.id === id) {
                    setFormData(setFormDataInitial());
                    setIsEditing(false);
                }
            } else {
                alert('삭제 실패: ' + data.message);
            }
        } catch (err) {
            console.error(err);
            alert('삭제 중 오류가 발생했습니다.');
        }
    };

    const handleCancelEdit = () => {
        setFormData(setFormDataInitial());
        setIsEditing(false);
    };

    // ==== 메인 배너 관련 핸들러 ====
    const handleBannerChange = (e) => {
        const { name, value } = e.target;
        setBannerFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
            setBannerFormData(prev => ({ ...prev, image_url: '' }));
        }
    };

    const handleBannerCreate = async (e) => {
        e.preventDefault();
        
        let finalImageUrl = bannerFormData.image_url;

        if (selectedFile) {
            setIsUploading(true);
            const uploadData = new FormData();
            uploadData.append('image', selectedFile);

            try {
                const uploadRes = await fetch('/api/admin/upload_banner', {
                    method: 'POST',
                    body: uploadData
                });
                const uploadResult = await uploadRes.json();
                if (uploadResult.success) {
                    finalImageUrl = uploadResult.imageUrl;
                } else {
                    alert('이미지 업로드 실패: ' + uploadResult.message);
                    setIsUploading(false);
                    return;
                }
            } catch (err) {
                console.error('이미지 업로드 에러:', err);
                alert('이미지 업로드 중 오류가 발생했습니다.');
                setIsUploading(false);
                return;
            }
        }

        if (!finalImageUrl) {
            alert('이미지 URL을 입력하거나 이미지를 업로드해주세요.');
            setIsUploading(false);
            return;
        }

        try {
            const res = await fetch('/api/admin/main_banners', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bannerFormData, image_url: finalImageUrl })
            });
            const data = await res.json();
            if (data.success) {
                alert('메인 배너가 생성되었습니다.');
                setBannerFormData({ image_url: '', link_url: '', title: '', subtitle: '', sort_order: 0 });
                setSelectedFile(null);
                const fileInput = document.getElementById('banner_file_input');
                if (fileInput) fileInput.value = '';
                fetchMainBanners();
            } else {
                alert('배너 생성 실패: ' + data.message);
            }
        } catch (err) {
            console.error('배너 생성 에러:', err);
            alert('배너 생성 중 오류가 발생했습니다.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleBannerDelete = async (id) => {
        if (!window.confirm('이 메인 배너를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/admin/main_banners/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                alert('배너가 삭제되었습니다.');
                fetchMainBanners();
            } else {
                alert('삭제 실패: ' + data.message);
            }
        } catch (err) {
            console.error('배너 삭제 에러:', err);
            alert('배너 삭제 중 오류가 발생했습니다.');
        }
    };

    if (loading) {
        return <div className="p-4">로딩 중...</div>;
    }

    // 화면용 옵션 리스트
    const genderOptions = ['남성', '여성'];
    const upperCategoryOptions = ['상의', '아우터', '하의', '원피스', '신발', '가방', '모자', '액세서리'];

    return (
        <div className="p-4 text-sm space-y-12">
            
            {/* ================= 메인 배너 관리 ================= */}
            <div>
                <h2 className="text-xl font-bold mb-4">🖼️ 메인 배너 관리 (최상단 스와이프 배너)</h2>
                
                {/* 1. 자동 생성기 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 shadow-sm">
                    <h3 className="text-lg font-bold mb-2 text-blue-800">✨ 자동 커밍순 배너 생성</h3>
                    <p className="text-sm text-blue-600 mb-4">입고 예정일을 입력하시면 해당하는 상품들의 이미지를 모아 예쁜 커밍순 배너를 즉시 자동 생성해 드립니다.</p>
                    <div className="flex gap-2 items-center">
                        <input 
                            type="text" 
                            placeholder="예: 9/1"
                            value={generateDate}
                            onChange={(e) => setGenerateDate(e.target.value)}
                            className="border border-blue-300 rounded px-3 py-2 outline-none focus:border-blue-500 w-48"
                        />
                        <button 
                            onClick={handleAutoGenerate}
                            disabled={isGenerating}
                            className="bg-blue-600 text-white font-bold px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
                        >
                            {isGenerating ? '생성 중 (약 5~10초 소요)...' : '자동 생성 시작'}
                        </button>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-8 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 border-b pb-2">새 메인 배너 추가</h3>
                    
                    <form onSubmit={handleBannerCreate} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">이미지 직접 업로드</label>
                                    <input 
                                        id="banner_file_input"
                                        type="file" 
                                        accept="image/*"
                                        onChange={handleFileChange}
                                        className="w-full border border-gray-300 rounded px-3 py-2 outline-none"
                                    />
                                    <div className="text-[11px] text-gray-500 mt-2 bg-gray-50 p-2 rounded">
                                        <p>✔️ <span className="font-bold text-blue-600">권장 해상도:</span> 1600 x 900 (16:9 비율)</p>
                                        <p>✔️ <span className="font-bold text-gray-700">지원 포맷:</span> JPG, PNG, WEBP</p>
                                        <p>✔️ <span className="font-bold text-red-500">최대 용량:</span> 5MB 이하</p>
                                    </div>
                                </div>
                                <div className="flex items-center text-gray-400 text-xs font-bold my-2">
                                    <div className="flex-1 border-t border-gray-200"></div>
                                    <span className="px-3">또는</span>
                                    <div className="flex-1 border-t border-gray-200"></div>
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">이미지 URL 직접 입력</label>
                                    <input 
                                        type="text" 
                                        name="image_url"
                                        value={bannerFormData.image_url} 
                                        onChange={handleBannerChange}
                                        disabled={!!selectedFile}
                                        className={`w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black ${selectedFile ? 'bg-gray-100' : ''}`}
                                        placeholder="https://..."
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">클릭 시 이동할 링크 URL (선택)</label>
                                    <input 
                                        type="text" 
                                        name="link_url"
                                        value={bannerFormData.link_url} 
                                        onChange={handleBannerChange}
                                        className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                                        placeholder="예) /?lang=KR&category=아우터"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">배너 메인 타이틀 (선택)</label>
                                    <input 
                                        type="text" 
                                        name="title"
                                        value={bannerFormData.title} 
                                        onChange={handleBannerChange}
                                        className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">배너 서브 타이틀 (선택)</label>
                                    <input 
                                        type="text" 
                                        name="subtitle"
                                        value={bannerFormData.subtitle} 
                                        onChange={handleBannerChange}
                                        className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-bold mb-1">표시 순서 (작을수록 상단)</label>
                                    <input 
                                        type="number" 
                                        name="sort_order"
                                        value={bannerFormData.sort_order} 
                                        onChange={handleBannerChange}
                                        className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                                    />
                                </div>
                            </div>
                        </div>

                        <button type="submit" disabled={isUploading} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-300">
                            {isUploading ? '업로드 중...' : '메인 배너 추가하기'}
                        </button>
                    </form>
                </div>

                <div>
                    <h3 className="text-lg font-bold mb-3 border-b pb-2">등록된 메인 배너 리스트</h3>
                    {bannerLoading ? (
                        <p className="text-gray-500">로딩 중...</p>
                    ) : mainBanners.length === 0 ? (
                        <p className="text-gray-500 bg-gray-50 p-4 rounded text-center border border-gray-100">등록된 배너가 없습니다. 기본 배너가 노출됩니다.</p>
                    ) : (
                        <div className="space-y-3">
                            {mainBanners.map(banner => (
                                <div key={banner.id} className="border border-gray-200 rounded-lg p-3 bg-white flex flex-col sm:flex-row items-center gap-4 shadow-sm">
                                    <div className="w-full sm:w-40 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0 relative">
                                        <img src={banner.image_url} alt="배너" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-1 w-full">
                                        <div className="font-bold text-base">{banner.title || '(타이틀 없음)'} <span className="text-xs text-gray-400 font-normal ml-2">순서: {banner.sort_order}</span></div>
                                        <p className="text-xs text-gray-500 mt-0.5">{banner.subtitle}</p>
                                        <p className="text-xs text-gray-600 mt-2 truncate max-w-md">링크: <a href={banner.link_url} className="text-blue-500 hover:underline">{banner.link_url || '없음'}</a></p>
                                    </div>
                                    <button onClick={() => handleBannerDelete(banner.id)} className="w-full sm:w-auto px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded text-sm font-bold hover:bg-red-100">
                                        삭제
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ================= 테마 관리 ================= */}
            <div id="theme-management-section" className="pt-8 border-t border-gray-200">
                <h2 className="text-xl font-bold mb-4">🎨 추천 테마 관리 (상품 리스트용)</h2>
            
            {/* 폼 영역 */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-8 shadow-sm">
                <h3 className="text-lg font-bold mb-4 border-b pb-2">{isEditing ? '테마 수정' : '새 테마 추가'}</h3>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* 제목 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">테마 제목 <span className="text-red-500">*</span></label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                            placeholder="예) 아디다스 져지 특선!"
                            value={formData.title}
                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                        />
                    </div>

                    {/* 테마 모드 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">테마 유형</label>
                        <div className="flex gap-3">
                            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all ${
                                formData.filter_mode === 'filter' 
                                    ? 'border-black bg-black text-white' 
                                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                            }`}>
                                <input 
                                    type="radio" 
                                    name="filter_mode"
                                    value="filter"
                                    checked={formData.filter_mode === 'filter'}
                                    onChange={() => setFormData({ ...formData, filter_mode: 'filter' })}
                                    className="hidden"
                                />
                                <span className="text-sm font-bold">🏷️ 필터 지정</span>
                            </label>
                            <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all ${
                                formData.filter_mode === 'recent' 
                                    ? 'border-black bg-black text-white' 
                                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                            }`}>
                                <input 
                                    type="radio" 
                                    name="filter_mode"
                                    value="recent"
                                    checked={formData.filter_mode === 'recent'}
                                    onChange={() => setFormData({ ...formData, filter_mode: 'recent' })}
                                    className="hidden"
                                />
                                <span className="text-sm font-bold">🆕 최근 업로드</span>
                            </label>
                        </div>
                        {formData.filter_mode === 'recent' && (
                            <p className="text-xs text-blue-600 mt-1">✨ 가장 최근에 등록된 상품을 자동으로 보여줍니다.</p>
                        )}
                    </div>

                    {/* 표시 개수 (최근 업로드 모드일 때만 표시하거나 항상 표시) */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">
                            표시 상품 수 {formData.filter_mode === 'recent' && <span className="text-xs text-gray-400 font-normal">(최근 업로드 순)</span>}
                        </label>
                        <input 
                            type="number" 
                            min="1" max="50"
                            className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                            value={formData.max_items}
                            onChange={e => setFormData({ ...formData, max_items: e.target.value })}
                            placeholder="10"
                        />
                    </div>

                    {/* 필터 모드일 때만 필터 옵션 표시 */}
                    {formData.filter_mode === 'filter' && (<>

                    {/* 시즌 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">시즌 (선택안함 = 전체)</label>
                        <select 
                            name="filter_season"
                            value={formData.filter_season || ''} 
                            onChange={e => setFormData({ ...formData, filter_season: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black bg-white"
                        >
                            <option value="">전체 (시즌무관)</option>
                            <option value="w">겨울 (w)</option>
                            <option value="s">여름 (s)</option>
                            <option value="sl">시즌리스 (sl)</option>
                        </select>
                    </div>

                    {/* 성별 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">성별 (선택안함 = 전체)</label>
                        <div className="flex flex-wrap gap-2">
                            {genderOptions.map(g => (
                                <label key={g} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200">
                                    <input 
                                        type="checkbox" 
                                        checked={formData.filter_gender.includes(g)}
                                        onChange={() => handleCheckToggle('filter_gender', g)}
                                        className="accent-black"
                                    />
                                    <span>{g}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 대분류 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">상위 카테고리 (선택안함 = 전체)</label>
                        <div className="flex flex-wrap gap-2">
                            {upperCategoryOptions.map(c => (
                                <label key={c} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200">
                                    <input 
                                        type="checkbox" 
                                        checked={formData.filter_upper_category.includes(c)}
                                        onChange={() => handleCheckToggle('filter_upper_category', c)}
                                        className="accent-black"
                                    />
                                    <span>{c}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 소분류 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">하위 카테고리 (다중 선택 가능)</label>
                        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded p-2 flex flex-wrap gap-2 bg-gray-50">
                            {filters.categories.map(c => (
                                <label key={c} className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded text-xs cursor-pointer hover:bg-gray-100">
                                    <input 
                                        type="checkbox" 
                                        checked={formData.filter_category.includes(c)}
                                        onChange={() => handleCheckToggle('filter_category', c)}
                                        className="accent-black"
                                    />
                                    <span>{c}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 브랜드 선택 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">브랜드 (다중 선택 가능)</label>
                        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded p-2 flex flex-wrap gap-2 bg-gray-50">
                            {filters.brands.map(b => (
                                <label key={b} className="flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded text-xs cursor-pointer hover:bg-gray-100">
                                    <input 
                                        type="checkbox" 
                                        checked={formData.filter_brand.includes(b)}
                                        onChange={() => handleCheckToggle('filter_brand', b)}
                                        className="accent-black"
                                    />
                                    <span>{b}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    </>)}

                    {/* 순서 정렬 */}
                    <div>
                        <label className="block text-gray-700 font-bold mb-1">표시 순서 (작을수록 상단)</label>
                        <input 
                            type="number" 
                            className="w-full border border-gray-300 rounded px-3 py-2 outline-none focus:border-black"
                            value={formData.sort_order}
                            onChange={e => setFormData({ ...formData, sort_order: e.target.value })}
                        />
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="submit" className="flex-1 bg-black text-white py-2 rounded-md font-bold hover:bg-gray-800">
                            {isEditing ? '수정 완료' : '추가하기'}
                        </button>
                        {isEditing && (
                            <button type="button" onClick={handleCancelEdit} className="flex-1 bg-gray-200 text-black py-2 rounded-md font-bold hover:bg-gray-300">
                                취소
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* 리스트 영역 */}
            <div>
                <h3 className="text-lg font-bold mb-3 border-b pb-2">등록된 테마 리스트</h3>
                {themes.length === 0 ? (
                    <p className="text-gray-500">등록된 추천 테마가 없습니다.</p>
                ) : (
                    <div className="space-y-3">
                        {themes.map(theme => (
                            <div key={theme.id} className="border border-gray-200 rounded-lg p-3 bg-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                                <div className="flex-1">
                                    <div className="font-bold text-base">{theme.title} <span className="text-xs text-gray-400 font-normal ml-2">순서: {theme.sort_order}</span></div>
                                    <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                                        {theme.filter_mode === 'recent' 
                                            ? <div className="text-blue-600 font-bold">🆕 최근 업로드 {theme.max_items || 10}개</div>
                                            : <>
                                                {theme.filter_gender && <div>• 성별: {theme.filter_gender}</div>}
                                                {theme.filter_upper_category && <div>• 대분류: {theme.filter_upper_category}</div>}
                                                {theme.filter_category && <div>• 소분류: {theme.filter_category}</div>}
                                                {theme.filter_brand && <div>• 브랜드: {theme.filter_brand}</div>}
                                                {theme.filter_season && <div>• 시즌: {theme.filter_season}</div>}
                                                {!theme.filter_gender && !theme.filter_upper_category && !theme.filter_category && !theme.filter_brand && !theme.filter_season && <div>• 전체 상품</div>}
                                            </>
                                        }
                                        <div className="text-gray-400">표시: {theme.max_items || 10}개</div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleEdit(theme)} className="px-3 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs font-bold hover:bg-blue-100">
                                        수정
                                    </button>
                                    <button onClick={() => handleDelete(theme.id)} className="px-3 py-1 bg-red-50 text-red-600 border border-red-200 rounded text-xs font-bold hover:bg-red-100">
                                        삭제
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            </div>
        </div>
    );
};

export default AdminThemes;
