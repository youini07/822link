import json
import os
import difflib
import re

# 현재 스크립트 위치 기준으로 JSON 파일 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# fruits_categories.json은 822-link 폴더(BASE_DIR의 부모)에 있음
JSON_PATH = os.path.join(BASE_DIR, '..', 'fruits_categories.json')

class FruitsCategoryMapper:
    def __init__(self):
        self.categories = {}
        self.load_categories()
        
        # 사장님이 겪으실 엇갈리는 단어들을 수동으로 맞춰주는 '동의어/단축어 사전'
        # 왼쪽 단어가 입력되면, 강제로 오른쪽 단어로 번역합니다.
        self.synonyms = {
            "스웻셔츠": "맨투맨",
            "바지": "기타(하의)",
            "청바지": "데님팬츠",
            "슬리브": "긴팔 티셔츠",
            "야구점퍼": "봄버/블루종",
            "구두": "구두/로퍼",
            "스니커": "스니커즈",
            "후드티/후드집업": "후드티", # 번개장터의 복합 카테고리는 메인인 '후드티'로 통일
        }

    def load_categories(self):
        try:
            with open(JSON_PATH, 'r', encoding='utf-8') as f:
                self.categories = json.load(f)
        except Exception as e:
            print(f"[Python] 카테고리 족보 파일(fruits_categories.json)을 읽을 수 없습니다: {e}")
            # 만약 파일이 없으면 빈 딕셔너리로 둔다

    def parse_input_category(self, raw_category_str, raw_gender=""):
        """
        '대분류 > 소분류' 형태의 문자열과 명시적인 성별을 파싱합니다.
        """
        parts = [p.strip() for p in raw_category_str.split('>')]
        
        # 1. 성별 파악 (raw_gender가 우선, 그 다음 raw_category_str 체크)
        gender = "남성"
        if raw_gender and "여성" in raw_gender:
            gender = "여성"
        elif "여성" in raw_category_str:
            gender = "여성"
            
        # 2. 타겟 분류어 파악 (가장 마지막 단어)
        target_leaf = parts[-1] if parts else ""
        
        # 만약 중간 뎁스가 있다면 참고용으로 저장 (예: 상의)
        target_parent = parts[-2] if len(parts) >= 2 else ""
        
        # 3. 동의어 사전 적용
        # 정확히 일치하는 동의어가 있으면 번역 (예: "후드티/후드집업" -> "후드티")
        if target_leaf in self.synonyms:
            target_leaf = self.synonyms[target_leaf]
        else:
            # 부분 포함 동의어 검색 (스웻셔츠가 포함되어 있다면 맨투맨으로)
            for key, val in self.synonyms.items():
                if key in target_leaf:
                    target_leaf = val
                    break
                    
        return gender, target_parent, target_leaf

    def map_category(self, raw_category_str, raw_gender="", title=""):
        """
        사용자 입력 카테고리 문자열과 성별을 바탕으로 후르츠패밀리의 [성별, 대분류, 소분류]를 찾습니다.
        """
        if not self.categories:
            print("[Python] 카테고리 데이터가 없어 기본값으로 반환합니다.")
            return ["남성", "상의", "기타(상의)"]

        # 1. 입력 문자열 파싱 및 성별, 힌트, 타겟(리프) 추출
        gender, parent_hint, target_leaf = self.parse_input_category(raw_category_str, raw_gender)
        
        # 엑셀의 분류가 너무 광범위한 '점퍼'일 경우, 제목(title)을 분석하여 정확한 소분류로 유도
        if target_leaf == "점퍼":
            if "트랙탑" in title or "져지" in title or "트랙 탑" in title:
                target_leaf = "져지"
                print(f"[Python] 제목 분석: '{title}' -> '점퍼'를 '져지'로 세팅합니다.")
            elif "바람막이" in title or "윈드브레이커" in title:
                target_leaf = "바람막이"
                print(f"[Python] 제목 분석: '{title}' -> '점퍼'를 '바람막이'로 세팅합니다.")
            elif "블루종" in title or "항공" in title or "야구" in title or "ma-1" in title.lower():
                target_leaf = "봄버/블루종"
                print(f"[Python] 제목 분석: '{title}' -> '점퍼'를 '봄버/블루종'으로 세팅합니다.")
            else:
                # 기본값
                target_leaf = "바람막이" 
        
        # 선택된 성별의 트리를 가져옴
        gender_tree = self.categories.get(gender, {})
        if not gender_tree:
            # 만약 성별 트리가 없으면 남성으로 Fallback
            gender = "남성"
            gender_tree = self.categories.get("남성", {})

        # 모든 가능한 소분류들을 모아두고, 어느 대분류 소속인지 추적할 딕셔너리
        sub_to_main_map = {}
        all_subs = []
        for main_cat, sub_cats in gender_tree.items():
            for sub in sub_cats:
                all_subs.append(sub)
                sub_to_main_map[sub] = main_cat

        # 2. AI 텍스트 유사도 매칭 (가장 글자가 비슷한 것을 1개 찾음, 정확도 50% 이상만)
        matches = difflib.get_close_matches(target_leaf, all_subs, n=1, cutoff=0.5)
        
        if matches:
            best_match = matches[0]
            best_main = sub_to_main_map[best_match]
            print(f"[Python] AI 카테고리 매칭 성공! '{target_leaf}' -> '{best_main}' > '{best_match}'")
            return [gender, best_main, best_match]
        
        # 3. 만약 유사한 것을 도저히 찾지 못했다면? (힌트 대분류를 이용해 '기타'로 Fallback)
        print(f"[Python] '{target_leaf}'와 비슷한 카테고리를 찾지 못했습니다. 유도리있게 기타 항목으로 우회합니다.")
        # 만약 엑셀 힌트에 "상의"나 "하의" 등의 대분류 단어가 있었다면 그곳의 "기타"를 선택
        if parent_hint and parent_hint in gender_tree:
            fallback_sub = f"기타({parent_hint})"
            # 족보에 해당 기타 항목이 실제로 있는지 확인
            if fallback_sub in gender_tree[parent_hint]:
                return [gender, parent_hint, fallback_sub]
            return [gender, parent_hint, gender_tree[parent_hint][-1]] # 없으면 해당 대분류의 맨 마지막 항목(주로 기타)
            
        # 힌트도 없다면 최후의 수단: 상의 > 기타(상의)
        return [gender, "상의", "기타(상의)"]

    def map_size(self, raw_size_str, main_cat):
        """
        엑셀의 비정형 사이즈 데이터를 후르츠패밀리의 규격 버튼명으로 매핑합니다.
        대분류(main_cat)에 따라 신발/향수/의류/기타(OS) 로직을 분기합니다.
        """
        if not raw_size_str or not isinstance(raw_size_str, str):
            return "OS"
            
        raw = raw_size_str.upper().strip()
        
        # 1. 무조건 OS인 카테고리들
        os_only_cats = ["액세서리", "주얼리", "라이프", "굿즈", "가방"]
        if main_cat in os_only_cats:
            return "OS"
            
        # 2. 신발류 (220 ~ 310 사이의 숫자 추출)
        if main_cat == "신발":
            # 정규식으로 200~300대 숫자 3자리 추출
            match = re.search(r'(2[2-9][05]|3[01][05])', raw)
            if match:
                return match.group(1)
            return "OS"
            
        # 3. 향수류 (ml 추출)
        if main_cat == "향수":
            match = re.search(r'([0-9.]+)\s*ML', raw)
            if match:
                val = match.group(1)
                # 소수점이 .0 이면 정수로 변환 (예: 50.0 -> 50)
                if val.endswith('.0'):
                    val = val[:-2]
                return f"{val}ml"
            return "OS"
            
        # 4. 의류/모자/하의/치마 등
        # 4-1. 알파벳 사이즈 명시적 추출
        # 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'
        alpha_pattern = r'\b(5XL|4XL|3XL|XXL|XL|L|M|S|XS|XXS|OS|FREE)\b'
        match = re.search(alpha_pattern, raw.replace('(', ' ').replace(')', ' '))
        if match:
            found = match.group(1)
            if found == "FREE":
                return "OS"
            return found
            
        # 4-2. 하의/치마 전용 인치(inch) 사이즈 매핑 (24 ~ 40)
        if main_cat in ["하의", "치마"]:
            inch_match = re.search(r'\b(2[4-9]|3[0-9]|40)\b', raw)
            if inch_match:
                return inch_match.group(1)
            
        # 4-3. 한국 숫자 사이즈 매핑 (90=S, 95=M, 100=L, 105=XL, 110=XXL)
        num_match = re.search(r'\b(85|90|95|100|105|110|115|120)\b', raw)
        if num_match:
            num = num_match.group(1)
            mapping = {
                "85": "XS", "90": "S", "95": "M", "100": "L", 
                "105": "XL", "110": "XXL", "115": "3XL", "120": "4XL"
            }
            return mapping.get(num, "OS")
            
        # 4-4. 만약 0, 1, 2, 3, 4, 5 (디자이너 브랜드 사이즈) 인 경우
        digit_match = re.search(r'\b([0-5])\b', raw)
        if digit_match:
            return digit_match.group(1)
            
        # 매핑 실패 시 최후의 보루
        return "OS"

# 간단 테스트 코드
if __name__ == "__main__":
    mapper = FruitsCategoryMapper()
    print("--- 매핑 테스트 ---")
    test_cases = [
        "남성의류 > 남성의류 > 상의 > 후드티/후드집업",
        "여성의류 > 하의 > 데님 팬츠",
        "남성 > 가방류 > 가죽 크로스백",
        "여성 > 스웻셔츠",
        "남성 > 아우터 > 이상한옷"
    ]
    for tc in test_cases:
        res = mapper.map_category(tc)
        print(f"[{tc}] \n => {res}\n")
