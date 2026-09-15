import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/components/AdminRecommendedBrands.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add availableBrands state
if "const [availableBrands, setAvailableBrands]" not in content:
    content = content.replace(
        "const [brands, setBrands] = useState([]);",
        "const [brands, setBrands] = useState([]);\n    const [availableBrands, setAvailableBrands] = useState({});"
    )

# 2. Add fetchAvailableBrands inside useEffect
if "fetchAvailableBrands();" not in content:
    target_use_effect = """    useEffect(() => {
        fetchBrands();
    }, []);"""
    new_use_effect = """    useEffect(() => {
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
    };"""
    content = content.replace(target_use_effect, new_use_effect)

# 3. Replace the brand_name input block
target_input_block = """                        <div>
                            <label className="block text-gray-700 font-bold mb-1">브랜드명 (대소문자 일치) *</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={formData.brand_name}
                                onChange={e => setFormData({...formData, brand_name: e.target.value})}
                                placeholder="예: PAUL SMITH"
                                required
                            />
                            <p className="text-xs text-gray-400 mt-1">실제 DB에 등록된 브랜드명과 동일해야 상품이 조회됩니다.</p>
                        </div>"""

new_input_block = """                        <div>
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
                        </div>"""

if target_input_block in content:
    content = content.replace(target_input_block, new_input_block)
else:
    print("Could not find target_input_block")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("AdminRecommendedBrands patched with dropdown.")
