import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/components/AdminRecommendedBrands.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

upload_function = """    const handleImageUpload = async (e, field) => {
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
"""

if "handleImageUpload" not in content:
    # Insert before `return (`
    idx = content.find("return (")
    if idx != -1:
        content = content[:idx] + upload_function + "\n    " + content[idx:]

target_hero_block = """                        <div>
                            <label className="block text-gray-700 font-bold mb-1">히어로(배경) 이미지 URL</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={formData.hero_image_url}
                                onChange={e => setFormData({...formData, hero_image_url: e.target.value})}
                                placeholder="세로형 배경 이미지 (권장)"
                            />
                        </div>"""

new_hero_block = """                        <div>
                            <label className="block text-gray-700 font-bold mb-1">히어로(배경) 이미지</label>
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
                        </div>"""

target_logo_block = """                        <div>
                            <label className="block text-gray-700 font-bold mb-1">브랜드 로고 이미지 URL</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={formData.logo_url}
                                onChange={e => setFormData({...formData, logo_url: e.target.value})}
                                placeholder="원형 로고 이미지"
                            />
                        </div>"""

new_logo_block = """                        <div>
                            <label className="block text-gray-700 font-bold mb-1">브랜드 로고 이미지</label>
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
                        </div>"""

if target_hero_block in content:
    content = content.replace(target_hero_block, new_hero_block)
else:
    print("Could not find target_hero_block")

if target_logo_block in content:
    content = content.replace(target_logo_block, new_logo_block)
else:
    print("Could not find target_logo_block")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("AdminRecommendedBrands patched with file upload.")
