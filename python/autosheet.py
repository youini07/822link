import sys
import os
import re
import io
import json
import time
from datetime import datetime

# 윈도우 환경에서 이모지 출력 시 발생하는 인코딩(cp949) 에러 방지
sys.stdout.reconfigure(encoding='utf-8')
import gspread
from google import genai
from google.genai import types
from oauth2client.service_account import ServiceAccountCredentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# ==========================================
# 1. 관리자 설정
# ==========================================
GEMINI_API_KEY = "AIzaSyCwieLQKx-bxrSxfNn0FGHazKgsm2Zbn7A"
SERVICE_ACCOUNT_FILE = 'credentials.json'
ROOT_FOLDER_ID = "1EK9CcoKJz0NKNwp6PMZ5lNx7-i_4oWCt"
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1qPfxy3ZF6ZISgPxRwNVYvHC9Qj57lgMeTd_FjN8cdF8/edit?gid=0#gid=0"

# ==========================================
# 2. 초기화 (최신 SDK: google-genai)
# ==========================================
client_genai = genai.Client(api_key=GEMINI_API_KEY)

# 💡 안전 필터를 끄는 설정 (패션 이미지가 차단되지 않도록)
safety_settings = [
    types.SafetySetting(
        category='HARM_CATEGORY_HARASSMENT',
        threshold='BLOCK_NONE'
    ),
    types.SafetySetting(
        category='HARM_CATEGORY_HATE_SPEECH',
        threshold='BLOCK_NONE'
    ),
    types.SafetySetting(
        category='HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold='BLOCK_NONE'
    ),
    types.SafetySetting(
        category='HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold='BLOCK_NONE'
    ),
]

# 💡 2026년 기준 실사용 가능한 Flash 모델 적용
TARGET_MODEL = 'gemini-3.8-flash'

scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

if not os.path.exists(SERVICE_ACCOUNT_FILE):
    print(f"❌ 오류: '{SERVICE_ACCOUNT_FILE}' 파일이 없습니다.")
    exit()

creds = ServiceAccountCredentials.from_json_keyfile_name(SERVICE_ACCOUNT_FILE, scope)
# 💡 타임아웃 120초 설정
client = gspread.authorize(creds)
client.set_timeout(120)
drive_service = build('drive', 'v3', credentials=creds)

# ==========================================
# 3. 함수 모음
# ==========================================

def find_folder_id(parent_id, folder_name):
    query = f"'{parent_id}' in parents and name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    items = results.get('files', [])
    return items[0]['id'] if items else None

def get_target_folder(input_date=None):
    if input_date:
        # 입력된 날짜 파싱 (예: 0426 -> 4월, 0426)
        try:
            if len(input_date) == 4:
                month_int = int(input_date[:2])
                month_str = f"{month_int}월"
                date_str = input_date
            else:
                print("⚠️ 날짜 형식이 잘못되었습니다. (예: 0426)")
                return None
        except ValueError:
            print("⚠️ 숫자 형식으로 입력해주세요. (예: 0426)")
            return None
    else:
        now = datetime.now()
        month_str = f"{now.month}월"
        date_str = now.strftime("%m%d")
    
    print(f"매니저: 경로 탐색 중... [사입품목] > [{month_str}] > [{date_str}]")

    month_id = find_folder_id(ROOT_FOLDER_ID, month_str)
    if not month_id:
        print(f"❌ 오류: '{month_str}' 폴더가 없습니다.")
        return None
    
    day_id = find_folder_id(month_id, date_str)
    if not day_id:
        print(f"⚠️ 대기: '{date_str}' 폴더가 없습니다.")
        return None
        
    return day_id

def custom_sort_key(file_item):
    name = file_item['name']
    base_name = re.sub(r'\.+', '', os.path.splitext(name)[0])
    dot_count = name.count('.')
    return (base_name, -dot_count)

def get_images_from_folder(folder_id):
    query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
    results = drive_service.files().list(q=query, fields="files(id, name, webViewLink)").execute()
    items = results.get('files', [])
    items.sort(key=custom_sort_key)
    return items

def download_image(file_id):
    request = drive_service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    fh.seek(0)
    return fh

def parse_filename_info(filename):
    name_base = os.path.splitext(filename)[0]
    clean_name = name_base.replace('.', '')
    match = re.match(r"([^\d]+)(\d+)", clean_name)
    if match:
        location = match.group(1).strip()
        price = int(match.group(2)) * 1000
    else:
        location = name_base
        price = 0
    return location, price

def analyze_with_gemini(image_bytes, filename):
    """
    최신 SDK(google-genai) 기반 분석 로직
    """
    image_data = image_bytes.read()
    
    # 💡 프롬프트
    prompt = """
    이 의류 이미지를 분석하여 JSON 포맷으로 추출하세요.
    반드시 유효한 단일 JSON 객체 '{...}' 형태로만 응답하세요.

    [추출 항목]
    1. Brand: 브랜드명 (예: Nike, Stussy)
    2. Category: 반드시 아래 제공된 [대분류 > 소분류] 리스트 중 가장 정확한 하나를 골라서 '대분류 > 소분류' 형태로 응답하세요. (예: 상의 > 맨투맨/스웨트셔츠)
       - 상의: 반팔티, 긴팔티, 맨투맨/스웨트셔츠, 후드티, 셔츠/남방, 니트/스웨터, 슬리브리스(나시)
       - 아우터: 바람막이 / 윈드브레이커, 져지, 자켓, 가디건, 코트, 패딩/푸퍼, 점퍼/블루종, 조끼/베스트, 플리스/뽀글이
       - 하의: 데님/청바지, 면바지/치노팬츠, 슬랙스, 트레이닝팬츠/스웨트팬츠, 반바지/쇼츠, 스커트/치마 (여성)
       - 원피스: 미니 원피스, 미디/롱 원피스, 투피스 세트
       - 신발: 스니커즈/운동화, 구두/로퍼, 부츠/워커, 샌들/슬리퍼
       - 가방: 백팩, 크로스백, 숄더백, 토트백, 에코백, 클러치/파우치
       - 액세서리: 목걸이/팔찌/반지, 안경/선글라스, 지갑/벨트, 넥타이
       - 모자: 캡, 비니, 버킷햇
       
       ★ [특별 지시사항] 스포츠 브랜드(아디다스, 나이키 등)의 '트랙탑(Track Top)', '파이어버드', '운동복 자켓' 형태는 절대로 '아우터 > 자켓'이나 '아우터 > 바람막이 / 윈드브레이커'로 분류하지 말고 무조건 **아우터 > 져지** 로 분류하세요!
       
    3. English_Description: 색상 포함 영어 설명 (예: Black leather jacket)
    4. Size: 추정 사이즈 (S, M, L, XL 등)
    5. Thai_Sales_Description: 태국어 판매 멘트 (브랜드 헤리티지 강조, ครับ 어미 사용, 괄호안에 한국어 번역 포함)
    """

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client_genai.models.generate_content(
                model=TARGET_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_data, mime_type='image/jpeg'),
                    prompt
                ],
                config=types.GenerateContentConfig(
                    safety_settings=safety_settings,
                    response_mime_type='application/json'
                )
            )
            
            result = json.loads(response.text)
            
            # 리스트로 오는 경우 대비
            if isinstance(result, list):
                result = result[0] if result else None
            
            return result
        except Exception as e:
            print(f"⚠️ {filename} 분석 {attempt+1}차 시도 실패... (에러: {e})")
            time.sleep(2)
            
    print(f"💥 {filename} 최종 실패. (API 할당량 또는 네트워크 확인 필요)")
    return None

# ==========================================
# 4. 메인 실행
# ==========================================
def main():
    print("🚀 [822shop 매니저 V3] 최신 모터(SDK) 장착 완료!")
    
    # 💡 자동화 모드: 사용자 입력을 기다리지 않고 오늘 날짜로 진행합니다.
    user_date = ""
    print("\n📅 [자동화 모드] 날짜 입력 없이 자동으로 오늘 날짜로 진행합니다.")
    
    target_folder_id = get_target_folder(user_date if user_date else None)
    if not target_folder_id:
        return

    images = get_images_from_folder(target_folder_id)
    print(f"📂 작업 대상: {len(images)}개")
    
    # 💡 [수정] 기존 .sheet1(첫 번째 탭인 '상품목록') 대신 '사입품목' 워크시트를 명시적으로 호출합니다.
    # 왜: 오토시트 실행 시 데이터가 '상품목록'이 아닌 '사입품목' 시트에 정상적으로 누적되도록 하기 위함입니다.
    sheet = client.open_by_url(SPREADSHEET_URL).worksheet('사입품목')
    
    print("[INFO] 기존 시트에서 Drive 파일 ID 기반 중복 체크 중...")
    existing_data = sheet.get_all_values()
    existing_drive_ids = set()
    if len(existing_data) > 1:
        for row in existing_data:
            if len(row) > 11 and row[11]:
                link = str(row[11]).strip()
                id_match = re.search(r'/file/d/([a-zA-Z0-9_-]+)', link)
                if id_match:
                    existing_drive_ids.add(id_match.group(1))

    # 💡 A열(순번) 자동 증가를 위한 마지막 번호 추출 로직
    # 시트의 기존 데이터를 역순으로 검색하여 가장 최근에 등록된 숫자를 찾아 시작점으로 잡습니다.
    # 만약 시트에 아무 값도 없거나 숫자가 존재하지 않는 비상 상황을 대비해 기본값 0에서 시작하게 예외 처리했습니다.
    last_num = 0
    for r in reversed(existing_data):
        if len(r) > 0 and r[0]:
            val = str(r[0]).strip().replace(',', '')
            if val.isdigit():
                last_num = int(val)
                break
    print(f"[INFO] 기존 시트의 A열 마지막 순번: {last_num}")

    # 💡 B열(날짜) 날짜 데이터 처리 로직 (M/D 형식, 예: 5/20)
    # 기본적으로 오늘 날짜를 사용하지만, 만약 사용자가 수동으로 특정 날짜(user_date, 예: 0426)를 입력하고 실행했다면
    # 수동 입력한 날짜 정보를 유지하기 위해 해당 값을 M/D 형태(예: 4/26)로 똑똑하게 파싱하여 적용합니다.
    if user_date and len(user_date) == 4:
        try:
            m = int(user_date[:2])
            d = int(user_date[2:])
            today_date_str = f"{m}/{d}"
        except ValueError:
            now = datetime.now()
            today_date_str = f"{now.month}/{now.day}"
    else:
        now = datetime.now()
        today_date_str = f"{now.month}/{now.day}"
    print(f"[INFO] B열에 입력될 날짜: {today_date_str}")

    new_rows = []
    current_num = last_num

    for img in images:
        location, price = parse_filename_info(img['name'])
        
        if img['id'] in existing_drive_ids:
            print(f"[SKIP] 중복 건너뛰기: {img['name']} (이미 시트에 등록된 파일)")
            continue

        print(f"⬇️ 이미지 다운로드 중: {img['name']} ...")
        img_data = download_image(img['id'])
        
        print(f"🔍 AI 분석 요청 중: {img['name']} ...")
        ai_data = analyze_with_gemini(img_data, img['name'])
        
        image_link = img.get('webViewLink', f"https://drive.google.com/file/d/{img['id']}/view?usp=drivesdk")

        if ai_data:
            cat_code = ai_data.get("Category", "").strip()

            # 💡 매 상품마다 순번을 1씩 증가시킵니다. (예: 1603 -> 1604 -> 1605 ...)
            current_num += 1

            # 💡 A열부터 AC열(29번째 열)까지 새로운 데이터 구조 정의
            # B열에 '관리코드'가 추가되면서 모든 열이 한 칸씩 우측으로 이동했습니다.
            row = [
                "",                                       # A열: 제품코드
                "",                                       # B열: 관리코드
                today_date_str,                           # C열: 등록일
                location,                                 # D열: 사입처
                "도매킵",                                 # E열: 구분
                "",                                       # F열: 상태
                price,                                    # G열: 사입가
                "",                                       # H열: 출고가
                "",                                       # I열: 가격
                "",                                       # J열: 실제판매가격(정산용)
                ai_data.get("Brand", ""),                 # K열: 브랜드
                ai_data.get("Gender", "공용"),             # L열: 성별
                cat_code,                                 # M열: 카테고리
                ai_data.get("English_Description", ""),   # N열: 제품명
                ai_data.get("Size", ""),                  # O열: 사이즈
                "",                                       # P열: 실측사이즈
                "",                                       # Q열: 상품상태
                "",                                       # R열: 제품결함
                ai_data.get("Thai_Sales_Description", ""),# S열: 제품설명
                "",                                       # T열: 제품설명(sns)
                image_link,                               # U열: 이미지
                "",                                       # V열: 정면누끼
                "",                                       # W열: 전체합성
                "",                                       # X열: 해시태그
                "",                                       # Y열: style
                "TBD",                                    # Z열: 예상도착일
                "",                                       # AA열: 아카이브
                "",                                       # AB열: season
                ""                                        # AC열: 홈페이지서버이미지
            ]
            new_rows.append(row)
            time.sleep(1)
        else:
            print(f"❌ {img['name']} 스킵됨")

    if new_rows:
        BATCH_SIZE = 5
        MAX_RETRIES = 3
        total_sent = 0
        
        last_row = len(existing_data)
        print(f"[INFO] 현재 시트 마지막 행: {last_row}행 → {last_row + 1}행부터 추가합니다.")
        
        for i in range(0, len(new_rows), BATCH_SIZE):
            batch = new_rows[i:i + BATCH_SIZE]
            start_row = last_row + 1 + total_sent
            end_row = start_row + len(batch) - 1
            # 💡 기존 A{start_row}:R{end_row} 범위를 AC열까지로 확장하여 A{start_row}:AC{end_row}로 변경
            # 이를 통해 새로운 구조(29열)에 맞게 데이터가 온전히 전달됩니다.
            cell_range = f"A{start_row}:AC{end_row}"
            
            for attempt in range(MAX_RETRIES):
                try:
                    sheet.update(cell_range, batch)
                    total_sent += len(batch)
                    print(f"📤 전송 완료: {total_sent}/{len(new_rows)}개 (행 {start_row}~{end_row})")
                    time.sleep(2)
                    break
                except Exception as e:
                    wait_time = (attempt + 1) * 10
                    print(f"⚠️ 시트 전송 {attempt+1}차 실패 ({e}). {wait_time}초 후 재시도...")
                    time.sleep(wait_time)
            else:
                print(f"💥 배치 전송 최종 실패! ({len(batch)}개 행 누락됨)")
        
        print(f"✅ 완료! {total_sent}/{len(new_rows)}개 상품 등록 완료")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n❌ 프로그램 실행 중 오류가 발생했습니다: {e}")
    finally:
        input("\n엔터를 누르면 창이 닫힙니다...")