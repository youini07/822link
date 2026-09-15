import React, { useState, useEffect, useRef } from 'react';
import { getTranslation } from '../services/i18n';

const AdminRecommendedBrands = ({ lang }) => {
    const [brands, setBrands] = useState([]);
    const [availableBrands, setAvailableBrands] = useState({});
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    
    // 폼 상태
    const [formData, setFormData] = useState(setFormDataInitial());

    function setFormDataInitial() {
        return {
            id: null,
            group_name: '',
            brand_name: '',
            description_kr: '',
            description_en: '',
            description_th: '',
            hero_image_url: '',
            logo_url: '',
            sort_order: 0
        };
    }

    const formRef = useRef(null);

    useEffect(() => {
        fetchBrands();
        fetchAvailableBrands();
    }, []);

    const fetchAvailableBrands = async () => {
        try {
            const res = await fetch('/api/brands/categorized?t=' + Date.now());
            const data = await res.json();
            if (data.success && data.categorized) {
                setAvailableBrands(data.categorized);
            }
        } catch (err) {
            console.error('Failed to fetch available brands:', err);
        }
    };

    const fetchBrands = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/recommended_brands');
            const data = await res.json();
            if (data.success) {
                setBrands(data.brands);
            }
        } catch (err) {
            console.error('Failed to fetch recommended brands:', err);
            alert('데이터를 불러오는데 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedGroupName = (formData.group_name || '').trim();
        if (!trimmedGroupName || !formData.brand_name) {
            alert('그룹명과 브랜드명은 필수입니다.');
            return;
        }

        const url = isEditing ? `/api/admin/recommended_brands/${formData.id}` : '/api/admin/recommended_brands';
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (data.success) {
                alert(isEditing ? '수정되었습니다.' : '추가되었습니다.');
                setFormData(setFormDataInitial());
                setIsEditing(false);
                fetchBrands();
            } else {
                alert('오류 발생: ' + data.message);
            }
        } catch (err) {
            console.error(err);
            alert('서버 통신 오류');
        }
    };

    const handleEdit = (brand) => {
        setFormData({ ...brand });
        setIsEditing(true);
        if (formRef.current) {
            const y = formRef.current.getBoundingClientRect().top + window.scrollY - 100;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('정말 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/admin/recommended_brands/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                alert('삭제되었습니다.');
                fetchBrands();
            } else {
                alert('삭제 실패: ' + data.message);
            }
        } catch (err) {
            console.error(err);
            alert('서버 오류');
        }
    };

        const handleImageUpload = async (e, field) => {
        const file = e.target.files[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('image', file);

        try {
            const res = await fetch('/api/admin/upload_banner', {
                method: 'POST',
                body: uploadData
            });
            const data = await res.json();
            if (data.success) {
                setFormData({ ...formData, [field]: data.imageUrl });
            } else {
                alert('업로드 실패: ' + data.message);
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert('이미지 업로드 중 오류가 발생했습니다.');
        }
    };

    return (
        <div className="p-4 text-sm space-y-12">
            
            {/* 등록 / 수정 폼 */}
            <div ref={formRef} className="bg-white p-6 rounded-lg shadow border border-gray-200">
                <h3 className="text-lg font-bold mb-4">{isEditing ? '추천 브랜드 수정' : '새 추천 브랜드 추가'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">그룹명 *</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={formData.group_name}
                                onChange={e => setFormData({...formData, group_name: e.target.value})}
                                placeholder="예: 주목받는 하이패션/럭셔리 브랜드"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">브랜드 선택 *</label>
                            <select
                                className="w-full border p-2 rounded"
                                value={formData.brand_name}
                                onChange={e => setFormData({...formData, brand_name: e.target.value})}
                                required
                            >
                                <option value="" disabled>-- 브랜드를 선택하세요 --</option>
                                {Object.keys(availableBrands).map(category => (
                                    <optgroup key={category} label={category}>
                                        {availableBrands[category].map(bName => (
                                            <option key={bName} value={bName}>{bName}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            <p className="text-xs text-gray-400 mt-1">실제 등록된 브랜드 목록에서 하나를 선택하세요.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">히어로(배경) 이미지 <span className="text-sm font-normal text-gray-500">(권장: 800 x 1200px 등 세로형)</span></label>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="text"
                                    className="flex-1 border p-2 rounded"
                                    value={formData.hero_image_url}
                                    onChange={e => setFormData({...formData, hero_image_url: e.target.value})}
                                    placeholder="이미지 업로드 또는 URL 직접 입력"
                                />
                                <label className="cursor-pointer bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-bold whitespace-nowrap">
                                    파일 선택
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={e => handleImageUpload(e, 'hero_image_url')} 
                                    />
                                </label>
                            </div>
                            {formData.hero_image_url && (
                                <img src={formData.hero_image_url} alt="hero preview" className="mt-2 h-24 object-contain border rounded p-1" />
                            )}
                        </div>
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">브랜드 로고 이미지 <span className="text-sm font-normal text-gray-500">(권장: 400 x 400px 등 정방형)</span></label>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="text"
                                    className="flex-1 border p-2 rounded"
                                    value={formData.logo_url}
                                    onChange={e => setFormData({...formData, logo_url: e.target.value})}
                                    placeholder="이미지 업로드 또는 URL 직접 입력"
                                />
                                <label className="cursor-pointer bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-bold whitespace-nowrap">
                                    파일 선택
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={e => handleImageUpload(e, 'logo_url')} 
                                    />
                                </label>
                            </div>
                            {formData.logo_url && (
                                <img src={formData.logo_url} alt="logo preview" className="mt-2 h-16 w-16 object-contain border rounded-full p-1 bg-white" />
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 mt-2 border-t pt-4">
                        <p className="text-gray-500 font-bold mb-2">언어별 브랜드 설명 멘트 (직접 입력)</p>
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">한국어 설명 (KR)</label>
                            <textarea
                                className="w-full border p-2 rounded text-sm"
                                rows="2"
                                value={formData.description_kr}
                                onChange={e => setFormData({...formData, description_kr: e.target.value})}
                                placeholder="브랜드에 대한 설명을 입력하세요."
                            />
                        </div>
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">태국어 설명 (TH)</label>
                            <textarea
                                className="w-full border p-2 rounded text-sm"
                                rows="2"
                                value={formData.description_th}
                                onChange={e => setFormData({...formData, description_th: e.target.value})}
                                placeholder="번역기를 활용하여 태국어 설명을 입력하세요."
                            />
                        </div>
                        <div>
                            <label className="block text-gray-700 font-bold mb-1">영어 설명 (EN)</label>
                            <textarea
                                className="w-full border p-2 rounded text-sm"
                                rows="2"
                                value={formData.description_en}
                                onChange={e => setFormData({...formData, description_en: e.target.value})}
                                placeholder="번역기를 활용하여 영어 설명을 입력하세요."
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-gray-700 font-bold mb-1">노출 순서 (작을수록 상단)</label>
                        <input
                            type="number"
                            className="w-full border p-2 rounded"
                            value={formData.sort_order}
                            onChange={e => setFormData({...formData, sort_order: parseInt(e.target.value) || 0})}
                        />
                    </div>

                    <div className="flex gap-2 pt-4">
                        <button type="submit" className="bg-black text-white px-6 py-2 rounded font-bold flex-1 hover:bg-gray-800 transition">
                            {isEditing ? '수정 완료' : '브랜드 추가'}
                        </button>
                        {isEditing && (
                            <button 
                                type="button" 
                                onClick={() => { setIsEditing(false); setFormData(setFormDataInitial()); }}
                                className="bg-gray-200 text-gray-800 px-6 py-2 rounded font-bold flex-1 hover:bg-gray-300 transition"
                            >
                                취소
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* 리스트 */}
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                <h3 className="text-lg font-bold mb-4">등록된 추천 브랜드 목록</h3>
                {loading ? <p>로딩중...</p> : (
                    brands.length === 0 ? (
                        <p className="text-gray-500">등록된 추천 브랜드가 없습니다.</p>
                    ) : (
                        <div className="space-y-4">
                            {brands.map(brand => (
                                <div key={brand.id} className="border p-4 rounded flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50">
                                    <div className="flex-1 flex gap-4 items-start">
                                        <div className="w-20 h-28 bg-gray-200 rounded shrink-0 overflow-hidden relative">
                                            {brand.hero_image_url ? (
                                                <img src={brand.hero_image_url} alt="hero" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">NO IMG</div>
                                            )}
                                            {brand.logo_url && (
                                                <div className="absolute inset-0 m-auto w-10 h-10 bg-white rounded-full p-1 shadow-md">
                                                    <img src={brand.logo_url} alt="logo" className="w-full h-full object-contain rounded-full" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-gray-400 mb-1">{brand.group_name}</div>
                                            <h4 className="font-bold text-lg mb-1">{brand.brand_name}</h4>
                                            <p className="text-xs text-gray-600 line-clamp-2 max-w-lg mb-1">{brand.description_kr}</p>
                                            <div className="text-[10px] text-gray-500 font-mono">
                                                ID: {brand.id} | 순서: {brand.sort_order}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 w-full md:w-auto shrink-0">
                                        <button onClick={() => handleEdit(brand)} className="flex-1 md:flex-none px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm font-bold transition">수정</button>
                                        <button onClick={() => handleDelete(brand.id)} className="flex-1 md:flex-none px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-bold transition">삭제</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>

        </div>
    );
};

export default AdminRecommendedBrands;
