import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/pages/BrandMainPage.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import
if "import RecommendedBrandsList from '../components/RecommendedBrandsList';" not in content:
    content = content.replace("import ProductCard from '../components/ProductCard';", 
                              "import ProductCard from '../components/ProductCard';\nimport RecommendedBrandsList from '../components/RecommendedBrandsList';")

# 2. Replace empty state
target_to_replace = """                    {!selectedBrand ? (
                        <div className="flex flex-col items-center justify-center h-[60vh] text-gray-400 animate-fade-in">
                            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-gray-100">
                                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 mb-2">브랜드를 선택해주세요</h3>
                            <p className="text-sm text-gray-400 max-w-xs text-center">{getTranslation(lang, 'no_brands_in_category') || '왼쪽 사이드바에서 원하시는 브랜드를 선택하여 상품을 확인해보세요.'}</p>
                        </div>
                    ) : ("""

replacement = """                    {!selectedBrand ? (
                        <RecommendedBrandsList lang={lang} isAdmin={isAdmin} todayOrders={todayOrders} />
                    ) : ("""

if target_to_replace in content:
    content = content.replace(target_to_replace, replacement)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("BrandMainPage.jsx patched.")
else:
    print("Could not find target block to replace.")
