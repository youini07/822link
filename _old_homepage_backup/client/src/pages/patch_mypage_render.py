import os

file_path = 'c:/Users/youin/OneDrive/바탕 화면/catalog_app/catalog_app_v2/client/src/pages/MyPage.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

target = """            {activeTab === 'admin_themes' && (
                <AdminThemes lang={lang} />
            )}"""

replacement = """            {activeTab === 'admin_themes' && (
                <AdminThemes lang={lang} />
            )}

            {activeTab === 'admin_recommended_brands' && (
                <AdminRecommendedBrands lang={lang} />
            )}"""

if target in content and "activeTab === 'admin_recommended_brands'" not in content:
    content = content.replace(target, replacement)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("MyPage.jsx render patched.")
else:
    print("Target not found or already patched.")
