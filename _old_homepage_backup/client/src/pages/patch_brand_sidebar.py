import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/pages/BrandMainPage.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Change default selectedBrand
content = content.replace(
    "const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || 'All');",
    "const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || null);"
)

# 2. Add Recommended Brands Home button to sidebar
target_all_button = """                        <div className="border-b border-gray-200/50">
                        <div 
                            onClick={() => { handleBrandClick('All'); setExpandedCategory(null); }}
                            className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${selectedBrand === 'All' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                        >
                            <span>{getTranslation(lang, 'view_all_products') || '전체 상품 보기'}</span>
                        </div>
                    </div>"""

new_buttons = """                        <div className="border-b border-gray-200/50">
                            <div 
                                onClick={() => { handleBrandClick(null); setExpandedCategory(null); }}
                                className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${selectedBrand === null ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span className="flex items-center gap-2">⭐ 추천 브랜드 홈</span>
                            </div>
                        </div>
                        <div className="border-b border-gray-200/50">
                            <div 
                                onClick={() => { handleBrandClick('All'); setExpandedCategory(null); }}
                                className={`p-4 flex justify-between items-center text-[13px] font-bold cursor-pointer transition-colors ${selectedBrand === 'All' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                            >
                                <span>{getTranslation(lang, 'view_all_products') || '전체 상품 보기'}</span>
                            </div>
                        </div>"""

if target_all_button in content:
    content = content.replace(target_all_button, new_buttons)
else:
    print("Could not find target_all_button in BrandMainPage.jsx")

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("BrandMainPage updated with sidebar Recommended Brands link.")
