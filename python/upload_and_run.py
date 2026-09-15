import sys
import os
import shutil
import time
from datetime import datetime
import subprocess

# 윈도우 인코딩 에러 방지
sys.stdout.reconfigure(encoding='utf-8')

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2.credentials import Credentials
import json

# ==========================================
# 1. 관리자 설정
# ==========================================
# 바탕화면 매입 폴더 경로
LOCAL_TARGET_DIR = r"C:\Users\youin\OneDrive\바탕 화면\매입"
TOKEN_FILE = r"C:\Users\youin\OneDrive\바탕 화면\catalog_app\token.json"
CLIENT_SECRET_FILE = r"C:\Users\youin\OneDrive\바탕 화면\catalog_app\client_secret.json"
ROOT_FOLDER_ID = "1EK9CcoKJz0NKNwp6PMZ5lNx7-i_4oWCt"

def get_drive_service():
    if not os.path.exists(TOKEN_FILE) or not os.path.exists(CLIENT_SECRET_FILE):
        print(f"❌ 오류: 인증 파일(token.json 또는 client_secret.json)이 없습니다.")
        return None
        
    try:
        with open(CLIENT_SECRET_FILE, 'r', encoding='utf-8') as f:
            client_info = json.load(f)
            web = client_info.get('installed', client_info.get('web', {}))
            client_id = web.get('client_id')
            client_secret = web.get('client_secret')
            
        with open(TOKEN_FILE, 'r', encoding='utf-8') as f:
            token_data = json.load(f)
            
        creds = Credentials(
            token=token_data.get('access_token'),
            refresh_token=token_data.get('refresh_token'),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        return build('drive', 'v3', credentials=creds)
    except Exception as e:
        print(f"❌ 오류: OAuth 인증 로드 실패 - {e}")
        return None

def find_or_create_folder(drive_service, parent_id, folder_name):
    query = f"'{parent_id}' in parents and name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    items = results.get('files', [])
    if items:
        return items[0]['id']
    else:
        # 폴더 생성
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = drive_service.files().create(body=file_metadata, fields='id').execute()
        print(f"📁 구글 드라이브에 새 폴더 생성: {folder_name}")
        return folder.get('id')

def main():
    print("🚀 [이미지 정리 및 드라이브 업로드 시스템 시작]")
    
    # 1. 날짜 정보 가져오기
    now = datetime.now()
    month_str = f"{now.month}월"
    date_str = now.strftime("%m%d")
    
    # 2. 로컬 폴더 정리
    if not os.path.exists(LOCAL_TARGET_DIR):
        print(f"❌ 오류: 로컬 대상 폴더({LOCAL_TARGET_DIR})가 존재하지 않습니다.")
        return

    local_date_folder = os.path.join(LOCAL_TARGET_DIR, date_str)
    if not os.path.exists(local_date_folder):
        os.makedirs(local_date_folder)
        print(f"📁 로컬 날짜 폴더 생성: {local_date_folder}")
        
    print(f"\n📦 로컬 폴더('{LOCAL_TARGET_DIR}')의 이미지 정리 중...")
    moved_count = 0
    for filename in os.listdir(LOCAL_TARGET_DIR):
        file_path = os.path.join(LOCAL_TARGET_DIR, filename)
        # 파일이면서 이미지 확장자인 경우
        if os.path.isfile(file_path) and filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp')):
            dest_path = os.path.join(local_date_folder, filename)
            shutil.move(file_path, dest_path)
            moved_count += 1
            print(f"  └ 🚚 이동: {filename}")
            
    if moved_count == 0:
        print("  └ ℹ️ 이동할 새 이미지가 없습니다.")
    else:
        print(f"✅ 총 {moved_count}개의 이미지를 '{date_str}' 폴더로 정리했습니다.")

    # 3. 구글 드라이브 업로드
    files_to_upload = [f for f in os.listdir(local_date_folder) if os.path.isfile(os.path.join(local_date_folder, f))]
    if not files_to_upload:
        print("\n⚠️ 오늘 날짜 폴더에 업로드할 이미지가 없습니다.")
    else:
        print("\n☁️ 구글 드라이브 연동 중...")
        drive_service = get_drive_service()
        if not drive_service:
            return
            
        print(f"🔍 드라이브 내 [{month_str}] > [{date_str}] 폴더 확인 중...")
        month_folder_id = find_or_create_folder(drive_service, ROOT_FOLDER_ID, month_str)
        date_folder_id = find_or_create_folder(drive_service, month_folder_id, date_str)
        
        print(f"\n📤 구글 드라이브 업로드 시작... (총 {len(files_to_upload)}개)")
        uploaded_count = 0
        for filename in files_to_upload:
            file_path = os.path.join(local_date_folder, filename)
            
            # 이미 존재하는지 확인
            query = f"'{date_folder_id}' in parents and name = '{filename}' and trashed = false"
            results = drive_service.files().list(q=query, fields="files(id)").execute()
            if results.get('files', []):
                print(f"  └ ⏭️ 스킵 (이미 존재): {filename}")
                continue
                
            print(f"  └ 🔼 업로드 중: {filename} ...")
            file_metadata = {
                'name': filename,
                'parents': [date_folder_id]
            }
            media = MediaFileUpload(file_path, resumable=True)
            drive_service.files().create(body=file_metadata, media_body=media, fields='id').execute()
            uploaded_count += 1
            
        print(f"\n✅ 총 {uploaded_count}개의 파일 구글 드라이브 업로드 완료!")

    # 4. 완료 후 파이썬 오토시트(autosheet.py) 직접 실행
    print("\n⚙️ 오토시트(AI 분석) 실행 준비...")
    time.sleep(2) # 실행 전 잠시 대기
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    autosheet_path = os.path.join(script_dir, 'autosheet.py')
    
    if os.path.exists(autosheet_path):
        print("▶️ 오토시트 로직 시작!\n======================================")
        subprocess.run(["python", "autosheet.py"], shell=True, cwd=script_dir)
    else:
        print(f"❌ 오류: autosheet.py 파일을 찾을 수 없습니다. (경로: {autosheet_path})")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n❌ 프로그램 실행 중 오류가 발생했습니다: {e}")
    finally:
        input("\n엔터를 누르면 창이 닫힙니다...")
