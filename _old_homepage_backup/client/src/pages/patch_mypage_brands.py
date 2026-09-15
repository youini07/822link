import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/pages/MyPage.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import
if "import AdminRecommendedBrands from '../components/AdminRecommendedBrands';" not in content:
    content = content.replace("import AdminThemes from '../components/AdminThemes';", 
                              "import AdminThemes from '../components/AdminThemes';\nimport AdminRecommendedBrands from '../components/AdminRecommendedBrands';")

# 2. Add to tabs
target_tab = "{ id: 'admin_themes', label: '🎨 추천 테마 관리', icon: '' },"
new_tab = "                { id: 'admin_recommended_brands', label: '⭐ 추천 브랜드 관리', icon: '' },"
if "id: 'admin_recommended_brands'" not in content:
    content = content.replace(target_tab, target_tab + "\n" + new_tab)

# 3. Add to rendering switch
target_render = "case 'admin_themes':"
new_render = """            case 'admin_recommended_brands':
                return (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="bg-gray-50 px-6 py-4 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <span>⭐</span> 추천 브랜드 관리
                            </h2>
                            <p className="text-sm text-gray-500 mt-1">브랜드 탭의 추천 브랜드를 관리합니다.</p>
                        </div>
                        <AdminRecommendedBrands lang={lang} />
                    </div>
                );
"""
if "case 'admin_recommended_brands':" not in content:
    content = content.replace(target_render, new_render + "            " + target_render)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("MyPage.jsx patched.")
