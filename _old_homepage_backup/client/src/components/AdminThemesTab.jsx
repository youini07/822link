import React, { useState, useEffect } from 'react';

const AdminThemesTab = () => {
    // 테마 관리 상태
    const [themes, setThemes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        title: '',
        filter_category: '',
        filter_brand: '',
        filter_season: '',
        sort_order: 0
    });

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

    const fetchThemes = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/themes');
            const data = await res.json();
            if (data.success) {
                setThemes(data.themes);
            }
        } catch (err) {
            console.error('테마 조회 실패:', err);
        } finally {
            setLoading(false);
        }
    };

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

    useEffect(() => {
        fetchThemes();
        fetchMainBanners();
    }, []);

    // ==== 테마 관련 핸들러 ====
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!formData.title) {
            alert('테마 제목을 입력해주세요.');
            return;
        }

        try {
            const res = await fetch('/api/admin/themes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (data.success) {
                alert('테마가 생성되었습니다.');
                setFormData({ title: '', filter_category: '', filter_brand: '', filter_season: '', sort_order: 0 });
                fetchThemes();
            } else {
                alert('생성 실패: ' + data.message);
            }
        } catch (err) {
            console.error('테마 생성 에러:', err);
            alert('테마 생성 중 오류가 발생했습니다.');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('이 테마를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/admin/themes/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                alert('테마가 삭제되었습니다.');
                fetchThemes();
            } else {
                alert('삭제 실패: ' + data.message);
            }
        } catch (err) {
            console.error('테마 삭제 에러:', err);
            alert('테마 삭제 중 오류가 발생했습니다.');
        }
    };

    // ==== 메인 배너 관련 핸들러 ====
    const handleBannerChange = (e) => {
        const { name, value } = e.target;
        setBannerFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setSelectedFile(e.target.files[0]);
            // 파일이 선택되면 image_url 입력창을 비워 혼동을 방지
            setBannerFormData(prev => ({ ...prev, image_url: '' }));
        }
    };

    const handleBannerCreate = async (e) => {
        e.preventDefault();
        
        let finalImageUrl = bannerFormData.image_url;

        // 1. 파일 업로드가 선택된 경우 먼저 업로드 진행
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
                // 파일 인풋 초기화
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

    return (
        <div className="space-y-8">
            {/* ================= 메인 배너 관리 ================= */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                <h2 className="text-xl font-bold border-b border-gray-100 pb-4">🖼️ 홈 화면 메인 배너 관리 (PC / 모바일 공통)</h2>
                
                <form onSubmit={handleBannerCreate} className="bg-blue-50/50 border border-blue-100 p-4 rounded-lg space-y-4">
                    <h3 className="font-bold text-blue-900 text-sm">새 메인 배너 추가</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-3 p-4 bg-white border border-gray-200 rounded-lg">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">이미지 직접 업로드</label>
                                <input 
                                    id="banner_file_input"
                                    type="file" 
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                />
                                <div className="text-[11px] text-gray-500 mt-3 leading-relaxed space-y-0.5 bg-gray-50 p-2 rounded">
                                    <p>✔️ <span className="font-bold text-blue-600">권장 해상도:</span> 1600 x 900 (16:9 비율)</p>
                                    <p>✔️ <span className="font-bold text-gray-700">지원 포맷:</span> JPG, PNG, WEBP</p>
                                    <p>✔️ <span className="font-bold text-red-500">최대 용량:</span> 5MB 이하 (최적화 권장)</p>
                                </div>
                            </div>
                            <div className="relative flex items-center py-2">
                                <div className="flex-grow border-t border-gray-200"></div>
                                <span className="flex-shrink-0 mx-4 text-xs font-bold text-gray-400">또는</span>
                                <div className="flex-grow border-t border-gray-200"></div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">이미지 URL 직접 입력</label>
                                <input 
                                    type="text" 
                                    name="image_url"
                                    value={bannerFormData.image_url} 
                                    onChange={handleBannerChange}
                                    disabled={!!selectedFile}
                                    className={`w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-blue-500 ${selectedFile ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                    placeholder="https://..."
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">클릭 시 이동할 링크 URL (선택)</label>
                                <input 
                                    type="text" 
                                    name="link_url"
                                    value={bannerFormData.link_url} 
                                    onChange={handleBannerChange}
                                    className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                                    placeholder="예) /?lang=KR&category=아우터"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">배너 메인 타이틀 (선택)</label>
                                <input 
                                    type="text" 
                                    name="title"
                                    value={bannerFormData.title} 
                                    onChange={handleBannerChange}
                                    className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                                    placeholder="예) 나이키 바람막이 특가전"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">배너 서브 타이틀 (선택)</label>
                                <input 
                                    type="text" 
                                    name="subtitle"
                                    value={bannerFormData.subtitle} 
                                    onChange={handleBannerChange}
                                    className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                                    placeholder="예) 이번 주 업데이트된 신상품을 만나보세요"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">정렬 순서 (숫자가 작을수록 먼저 노출)</label>
                                <input 
                                    type="number" 
                                    name="sort_order"
                                    value={bannerFormData.sort_order} 
                                    onChange={handleBannerChange}
                                    className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>
                    </div>

                    <button type="submit" disabled={isUploading} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-300">
                        {isUploading ? '업로드 중...' : '메인 배너 추가하기'}
                    </button>
                </form>

                <div className="mt-8">
                    <h3 className="font-bold text-gray-800 mb-4">등록된 메인 배너 목록</h3>
                    {bannerLoading ? (
                        <div className="text-sm text-gray-500">로딩 중...</div>
                    ) : mainBanners.length === 0 ? (
                        <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded">등록된 메인 배너가 없습니다. (기본 디자인이 노출됩니다)</div>
                    ) : (
                        <div className="space-y-4">
                            {mainBanners.map(banner => (
                                <div key={banner.id} className="border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row gap-4 items-center bg-white hover:border-blue-300 transition-colors">
                                    <div className="w-full md:w-48 h-24 bg-gray-100 rounded flex-shrink-0 overflow-hidden relative">
                                        <img src={banner.image_url} alt={banner.title || '배너'} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-grow w-full">
                                        <h4 className="font-bold text-black text-sm">{banner.title || '(타이틀 없음)'}</h4>
                                        <p className="text-xs text-gray-500 mt-0.5">{banner.subtitle}</p>
                                        <div className="text-xs text-gray-400 mt-2 space-y-1">
                                            <p className="truncate"><span className="font-bold text-gray-600">링크:</span> {banner.link_url || '없음'}</p>
                                            <p><span className="font-bold text-gray-600">우선순위:</span> {banner.sort_order}</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleBannerDelete(banner.id)}
                                        className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded text-xs font-bold transition-colors w-full md:w-auto flex-shrink-0"
                                    >
                                        삭제
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ================= 기존 테마 관리 ================= */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                <h2 className="text-xl font-bold border-b border-gray-100 pb-4">🎨 추천 테마 관리 (가로 스크롤 상품 목록)</h2>
                
                <form onSubmit={handleCreate} className="bg-gray-50 p-4 rounded-lg space-y-4">
                    <h3 className="font-bold text-gray-800 text-sm">새 테마 추가</h3>
                    
                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">테마 제목 (필수)</label>
                        <input 
                            type="text" 
                            name="title"
                            value={formData.title} 
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-black"
                            placeholder="예) 올 겨울 필수 노스페이스 패딩"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">필터: 카테고리 (선택)</label>
                            <input 
                                type="text" 
                                name="filter_category"
                                value={formData.filter_category} 
                                onChange={handleChange}
                                className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-black"
                                placeholder="예) 아우터"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">필터: 브랜드 (선택)</label>
                            <input 
                                type="text" 
                                name="filter_brand"
                                value={formData.filter_brand} 
                                onChange={handleChange}
                                className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-black"
                                placeholder="예) THE NORTH FACE"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1">필터: 시즌 (선택)</label>
                            <select 
                                name="filter_season"
                                value={formData.filter_season} 
                                onChange={handleChange}
                                className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-black bg-white"
                            >
                                <option value="">전체 (시즌무관)</option>
                                <option value="w">겨울 (w)</option>
                                <option value="s">여름 (s)</option>
                                <option value="sl">시즌리스 (sl)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">정렬 순서 (숫자가 작을수록 상단에 노출)</label>
                        <input 
                            type="number" 
                            name="sort_order"
                            value={formData.sort_order} 
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:border-black"
                        />
                    </div>

                    <button type="submit" className="w-full bg-black text-white font-bold py-2.5 rounded hover:bg-gray-800 transition-colors">
                        테마 추가하기
                    </button>
                </form>

                <div className="mt-8">
                    <h3 className="font-bold text-gray-800 mb-4">등록된 테마 목록</h3>
                    {loading ? (
                        <div className="text-sm text-gray-500">로딩 중...</div>
                    ) : themes.length === 0 ? (
                        <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded">등록된 테마가 없습니다.</div>
                    ) : (
                        <div className="space-y-3">
                            {themes.map(theme => (
                                <div key={theme.id} className="border border-gray-200 rounded p-4 flex justify-between items-center bg-white hover:border-black transition-colors">
                                    <div>
                                        <h4 className="font-bold text-black text-sm">{theme.title}</h4>
                                        <div className="text-xs text-gray-500 mt-1 space-x-2">
                                            {theme.filter_category && <span>카테고리: {theme.filter_category}</span>}
                                            {theme.filter_brand && <span>브랜드: {theme.filter_brand}</span>}
                                            {theme.filter_season && <span>시즌: {theme.filter_season}</span>}
                                            <span>우선순위: {theme.sort_order}</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleDelete(theme.id)}
                                        className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded text-xs font-bold transition-colors"
                                    >
                                        삭제
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminThemesTab;
