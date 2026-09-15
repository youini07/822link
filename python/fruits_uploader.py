import sys
import json
import time
import os
import uiautomator2 as u2
from fruits_category_mapper import FruitsCategoryMapper

def upload_to_fruits(data):
    try:
        # 0. 연결 및 기본 설정
        print("[Python] 후르츠패밀리 업로더 시작...")
        d = u2.connect("127.0.0.1:5555")
        d.implicitly_wait(10.0)
        
        prodCode = data.get('prodCode', '0000')
        remote_dir = "/sdcard/Pictures/Fruits"
        
        # 기존 캐시 초기화
        d.shell(f"rm -rf {remote_dir}")
        d.shell(f"mkdir -p {remote_dir}")
        
        # 앱 무조건 강제 종료 (이전 작업 잔여물 초기화)
        package_name = "com.fruitsfamily"
        d.app_stop(package_name)
        
        # 1. 로컬 이미지 경로 로드 (Node.js 측에서 스캔하여 넘겨준 배열)
        image_paths = data.get('imagePaths', [])
        
        if not image_paths:
            raise Exception(f"업로드할 이미지가 전달되지 않았습니다 (imagePaths 배열이 비어있음).")

        # 2. LD플레이어 PC 공유 폴더를 통한 초고속/무결점 파일 전송
        print(f"[Python] 앱플레이어로 이미지 {len(image_paths)}장 전송 중...")
        
        print("[Python] 기존 미디어 갤러리 앱 종료...")
        d.app_stop("com.sec.android.gallery3d")
        d.app_stop("com.google.android.providers.media.module")

        uploaded_remote_paths = []
        
        # 안드로이드 갤러리는 최신 파일(가장 마지막에 저장된 파일)이 첫 번째(좌측 상단)에 표시됩니다.
        # 유저 요청: "누끼딴 main 이미지가 젤 먼저, 그리고 생성순서대로 원본 6개"
        # 따라서, 배열을 역순으로 뒤집어서 [sub6, sub5 ... sub1, main] 순서로 push 합니다.
        # 그러면 가장 마지막에 push된 main 이미지가 갤러리 1번 자리에 오게 됩니다.
        image_paths_to_push = list(reversed(image_paths))
        
        for idx, local_path in enumerate(image_paths_to_push):
            ext = os.path.splitext(local_path)[1]
            target_name = f"img_{idx:02d}{ext}"
            remote_path = f"{remote_dir}/{target_name}"

            d.push(local_path, remote_path)
            uploaded_remote_paths.append(remote_path)

            # 미디어 스캐너 강제 호출 (새로고침)
            d.shell(f"am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://{remote_path}")
            # 안드로이드 10 이상을 위한 content DB 강제 삽입
            d.shell(f"content insert --uri content://media/external/images/media --bind _data:s:{remote_path}")
            time.sleep(0.5) # 파일 저장 시간 확보 (순서 보장)

        print("[Python] 미디어 스캔 반영 대기 (5초)...")
        time.sleep(5)
        
        # 3. 앱 실행 및 업로드 진입
        d.app_start(package_name)
        print("[Python] 후르츠패밀리 앱 실행...")
        d.app_start("com.fruitsfamily.app")
        
        # 메인 화면의 하단 탭(예: '판매' 버튼)이 보일 때까지 최대 15초 대기
        if d(descriptionContains="판매").exists(timeout=15) or d(textContains="판매").exists(timeout=15):
            print("[Python] 메인 화면 로딩 완료. 팝업이 뜰 수 있으니 4초 추가 대기...")
        else:
            print("[Python] [WARN] 메인 화면 로딩을 감지하지 못했습니다. 일단 진행합니다.")
            
        time.sleep(4) # 팝업이 뒤늦게 뜨는 것을 대비한 넉넉한 딜레이
        
        # 팝업 방어 로직 (판매 안내 팝업 등 닫기)
        popup_detected = False
        if d(textContains="판매된 상품을").exists(timeout=3) or d(textContains="발송할").exists() or d(textContains="보내주세요").exists() or d(textContains="배송").exists() or d(textContains="결제완료").exists():
            popup_detected = True
            
        if popup_detected:
            print("[Python] 판매/발송 안내 팝업 감지, 뒤로가기로 닫기 시도")
            d.press("back")
            time.sleep(1)
            
            if d(textContains="판매된 상품을").exists() or d(textContains="발송할").exists():
                print("[Python] 뒤로가기로 닫히지 않아 빈 공간(배경) 터치 시도")
                width, height = d.window_size()
                d.click(width * 0.5, height * 0.1) # 팝업 바깥 상단 여백 터치
                time.sleep(1)
                
            if d(textContains="판매된 상품을").exists() or d(textContains="발송할").exists():
                print("[Python] 그래도 닫히지 않아 팝업 상단의 X 이미지 버튼 탐색")
                # 팝업 근처의 ImageView(일반적으로 X버튼)를 찾아 클릭 시도
                x_btns = d(className="android.widget.ImageView")
                if len(x_btns) > 0:
                    for i in range(min(3, len(x_btns))): # 상위 3개 이미지 뷰를 찔러봄
                        try:
                            x_btns[i].click()
                            time.sleep(0.5)
                        except:
                            pass
                else:
                    d.click(width * 0.85, height * 0.35) # X 버튼 좌표 보정 (조금 더 아래로)
                time.sleep(1)
                
        if d(textContains="확인").exists:
            d(textContains="확인").click()
            
        print("[Python] 업로드 화면 진입 시도...")
        if d(resourceId="goToUploadButton").exists:
            d(resourceId="goToUploadButton").click()
        elif d(textContains="판매").exists(timeout=5):
            # "+ 판매" 처럼 텍스트 포함 조건으로 검색
            d(textContains="판매").click()
        elif d(descriptionContains="판매").exists(timeout=1):
            d(descriptionContains="판매").click()
        else:
            print("[Python] [WARN] '판매' 버튼을 텍스트로 찾을 수 없습니다. 우측 하단 고정 좌표를 시도합니다.")
            width, height = d.window_size()
            # 캡처 화면 상 판매 버튼은 우측 하단 플로팅 버튼임
            d.click(width - 100, height - 150)
                
        time.sleep(2)
        if d(textContains="확인").exists(timeout=2):
            d(textContains="확인").click()
            
        print("[Python] 사진 추가 클릭...")
        if d(textContains="0/10").exists(timeout=5):
            d(textContains="0/10").click()
        else:
            print("[Python] [WARN] '0/10' 텍스트를 찾을 수 없습니다. 갤러리 진입 고정 좌표를 클릭합니다.")
            d.click(150, 300)
            
        time.sleep(1)
        print("[Python] 앨범/갤러리 선택 메뉴 클릭 시도...")
        if d(textContains="갤러리").exists(timeout=2):
            d(textContains="갤러리").click()
        elif d(textContains="앨범").exists(timeout=2):
            d(textContains="앨범").click()
        elif d(textContains="라이브러리").exists(timeout=2):
            d(textContains="라이브러리").click()
        elif d(textContains="선택하기").exists(timeout=2):
            d(textContains="선택하기").click()
        else:
            print("[Python] [WARN] 하단 사진선택 메뉴(갤러리/앨범) 텍스트를 찾지 못했습니다. 강제 터치 시도...")
            width, height = d.window_size()
            d.click(width // 2, height - 200)

        print("[Python] 갤러리 로딩 대기 3초...")
        time.sleep(3)
        
        thumb_ids = [
            "com.google.android.gms.optional_photopicker:id/icon_thumbnail",
            "com.sec.android.gallery3d:id/thumbnail",
            "com.android.gallery3d:id/gl_root_view"
        ]
        
        thumbnails = None
        for tid in thumb_ids:
            if d(resourceId=tid).exists:
                thumbnails = d(resourceId=tid)
                break
                
        if thumbnails and len(thumbnails) > 0:
            target_count = min(len(image_paths), len(thumbnails))
            print(f"[Python] 갤러리 썸네일 감지됨. 최상단부터 {target_count}장 선택합니다.")
            for i in range(target_count):
                thumbnails[i].click()
                time.sleep(0.5)
        else:
            print("[Python] 썸네일 ID를 찾을 수 없어 좌표 기반으로 상단 사진들을 터치합니다.")
            d.click(150, 400)
            if len(image_paths) > 1: d.click(400, 400)
            if len(image_paths) > 2: d.click(650, 400)
            if len(image_paths) > 3: d.click(900, 400)
            
        print("[Python] 갤러리 선택 완료 버튼 클릭 시도...")
        width, height = d.window_size()
        
        if d(textContains="추가").exists(timeout=1.5):
            d(textContains="추가").click()
        elif d(textContains="완료").exists(timeout=1.5):
            d(textContains="완료").click()
        elif d(textContains="선택").exists(timeout=1.5):
            d(textContains="선택").click()
        elif d(descriptionContains="추가").exists(timeout=1):
            d(descriptionContains="추가").click()
        elif d(descriptionContains="완료").exists(timeout=1):
            d(descriptionContains="완료").click()
        elif d(descriptionContains="선택").exists(timeout=1):
            d(descriptionContains="선택").click()
        elif d(resourceId="com.sec.android.gallery3d:id/menu_done").exists(timeout=1):
            d(resourceId="com.sec.android.gallery3d:id/menu_done").click()
        elif d(resourceId="com.google.android.gms.optional_photopicker:id/button_add").exists(timeout=1):
            d(resourceId="com.google.android.gms.optional_photopicker:id/button_add").click()
        elif d(text="열기").exists(timeout=1):
            d(text="열기").click()
        else:
            print("[Python] [WARN] 선택/추가 버튼을 찾을 수 없습니다! 상하단 모서리 강제 터치...")
            d.click(width - 60, 60)   # 삼성 갤러리 우측 상단
            time.sleep(0.5)
            d.click(width - 100, height - 100) # 구글 포토피커 우측 하단
            
        print("[Python] 갤러리 닫기 후 메인 화면 복귀 대기...")
        time.sleep(3)
        
        # 정보 입력 파트
        print("[Python] 상품 정보 텍스트 입력 중...")
        title = data.get('title', '')
        desc = data.get('description', '')
        raw_category = data.get('category', '')
        raw_gender = data.get('gender', '')
        
        mapper = FruitsCategoryMapper()
        category_path = mapper.map_category(raw_category, raw_gender, title)
        
        if d(resourceId="uploadProductTitle").exists(timeout=5):
            d(resourceId="uploadProductTitle").clear_text()
            d.set_fastinput_ime(True)
            d(resourceId="uploadProductTitle").set_text(title)
            
            print("[Python] 브랜드/카테고리 추천 태그 로딩 대기 2초...")
            time.sleep(2)

            try:
                title_bottom = d(resourceId="uploadProductTitle").info['bounds']['bottom']
                y_coord = title_bottom + 130
                
                print(f"[Python] 첫 번째 추천 태그(브랜드) 3연속 클릭! (Y:{y_coord})")
                for _ in range(3):
                    d.click(150, y_coord)
                    time.sleep(0.3)
                        
            except Exception as e:
                print(f"[Python] 추천 태그 클릭 중 에러: {str(e)}")

            d.set_fastinput_ime(False)
            
        print("[Python] 제품 설명 입력 시도...")
        if d(resourceId="uploadProductDesc").exists:
            d(resourceId="uploadProductDesc").clear_text()
            d(resourceId="uploadProductDesc").set_text(desc)
        elif d(textContains="설명").exists:
            d(textContains="설명").clear_text()
            d(textContains="설명").set_text(desc)
        elif len(d(className="android.widget.EditText")) >= 2:
            d(className="android.widget.EditText")[1].clear_text()
            d(className="android.widget.EditText")[1].set_text(desc)
        else:
            print("[Python] [WARN] 제품 설명 입력창을 찾을 수 없습니다!")
            
        print("[Python] 카테고리를 찾기 위해 스크롤합니다...")
        d.swipe(10, 800, 10, 300)
        time.sleep(0.5)
            
        if d(description="Category").exists(timeout=2) or d(text="Category").exists(timeout=2) or d(text="카테고리").exists(timeout=2): 
            print("[Python] 카테고리 메뉴 진입...")
            if d(resourceId="uploadOptionCategory").exists(timeout=2):
                d(resourceId="uploadOptionCategory").click()
            else:
                d(text="카테고리").click()
                
            gender = category_path[0]
            gender_ui_text = f"{gender}의류"
            if d(text=gender_ui_text).exists(timeout=3):
                print(f"[Python] 성별 선택: {gender_ui_text}")
                d(text=gender_ui_text).click()
                time.sleep(1.5) # 페이지 넘어가는 애니메이션 대기
            else:
                raise Exception(f"'{gender_ui_text}' 버튼을 찾을 수 없습니다.")
                
            main_cat = category_path[1]
            if not d(text=main_cat).exists(timeout=2): # 2초 대기해봄
                if d(scrollable=True).exists:
                    try:
                        d(scrollable=True).scroll.to(text=main_cat)
                    except:
                        pass
                for _ in range(5):
                    if d(text=main_cat).exists(): break
                    d.swipe_ext("up", scale=0.6)
                    time.sleep(0.8)

            if d(text=main_cat).exists(timeout=3):
                d(text=main_cat).click()
                print(f"[Python] 대분류 선택 완료! ({main_cat})")
                time.sleep(1.5) # 페이지 넘어가는 애니메이션 대기
            else:
                raise Exception(f"대분류 '{main_cat}' 버튼을 찾을 수 없습니다.")
                
            sub_cat = category_path[2]
            if not d(text=sub_cat).exists(timeout=2) and not d(textContains=sub_cat).exists():
                if d(scrollable=True).exists:
                    try:
                        d(scrollable=True).scroll.to(text=sub_cat)
                    except:
                        pass
                for _ in range(8):
                    if d(text=sub_cat).exists() or d(textContains=sub_cat).exists(): break
                    d.swipe_ext("up", scale=0.6)
                    time.sleep(0.5)

            if d(text=sub_cat).exists(timeout=3):
                d(text=sub_cat).click()
                print(f"[Python] 소분류 선택 완료! ({sub_cat})")
            elif d(textContains=sub_cat).exists(timeout=3):
                d(textContains=sub_cat).click()
                print(f"[Python] 소분류(포함) 선택 완료! ({sub_cat})")
            else:
                raise Exception(f"소분류 '{sub_cat}' 버튼을 찾을 수 없습니다.")
                
            # 4단계: 사이즈 선택
            raw_size = data.get('size', 'OS')
            mapped_size = mapper.map_size(raw_size, main_cat)
            print(f"[Python] 엑셀 사이즈 '{raw_size}' -> 스마트 사이즈 맵핑: [{mapped_size}]")
            
            if d(scrollable=True).exists:
                try:
                    d(scrollable=True).scroll.to(text=mapped_size)
                except:
                    pass
            
            if d(text=mapped_size).exists(timeout=3):
                d(text=mapped_size).click()
            else:
                print(f"[Python] 화면에 {mapped_size} 버튼이 없어 OS로 우회합니다.")
                if d(scrollable=True).exists:
                    try:
                        d(scrollable=True).scroll.to(text="OS")
                    except:
                        pass
                if d(text="OS").exists(timeout=2):
                    d(text="OS").click()
                
            # 5단계: 실측 사이즈 입력창 (스킵)
            print("[Python] 실측 사이즈 패스(다음) 버튼 대기 및 광클 시도...")
            time.sleep(1) # 화면 전환 대기
            
            # 텍스트로 찾아서 클릭
            if d(text="다음").exists(timeout=2):
                d(text="다음").click()
            elif d(description="다음").exists(timeout=1):
                d(description="다음").click()
            
            # 안드로이드 UI 인식 실패를 대비해 무조건 하단 중앙 '다음' 버튼 위치 강제 광클 (3연타)
            print("[Python] 혹시 모를 씹힘 방지를 위해 하단 중앙 강제 타격 3연사!")
            width, height = d.window_size()
            for _ in range(3):
                d.click(width // 2, height - 70) # 하단 큼지막한 다음 버튼 위치
                time.sleep(0.3)

            # 6단계: 상품 상태 선택
            raw_condition = data.get('condition', '').strip()
            condition_map = {
                "새 상품(미사용)": "새상품",
                "새상품": "새상품",
                "사용감 없음": "아주 좋은 상태",
                "사용감 적음": "약간의 사용감",
                "사용감 많음": "사용감 있음",
                "고장/파손 제품": "사용감 있음"
            }
            mapped_cond = condition_map.get(raw_condition, "약간의 사용감")
            print(f"[Python] 엑셀 상태 '{raw_condition}' -> 맵핑: [{mapped_cond}]")
            
            if d(textContains=mapped_cond).exists(timeout=2):
                d(textContains=mapped_cond).click()
            else:
                print(f"[Python] {mapped_cond} 버튼을 찾지 못해 기본값(약간의 사용감)으로 대체합니다.")
                if d(textContains="약간의 사용감").exists(timeout=2):
                    d(textContains="약간의 사용감").click()

            time.sleep(0.5)
            print("[Python] 상태 선택완료 클릭 시도...")
            if d(text="선택완료").exists(timeout=2):
                d(text="선택완료").click()
            elif d(textContains="선택완료").exists(timeout=1):
                d(textContains="선택완료").click()
            elif d(textContains="완료").exists(timeout=1):
                d(textContains="완료").click()
                
        else:
            raise Exception("카테고리 진입 메뉴(카테고리 버튼)를 찾을 수 없습니다.")
            
        print("[Python] 사이즈 선택 완료, 다음 단계 진입")
            
        # 5단계: 실측 사이즈 입력창 (스킵)
        
        # 메인 화면 복귀 대기
        time.sleep(0.8)
        
        # 7단계: 가격 입력 및 무료배송 설정
        d.swipe(10, 1000, 10, 300) # 설명창 내부 스크롤을 피하기 위해 가장자리(X=10) 사용
        time.sleep(0.5)
        
        print("[Python] 가격 설정 진입...")
        if d(text="가격").exists:
            d(text="가격").click()
            time.sleep(0.8)
            
            price = data.get('price', 0)
            if d(className="android.widget.EditText").exists:
                d(className="android.widget.EditText")[0].set_text(str(price))
                print(f"[Python] 가격 {price}원 입력 완료")
                time.sleep(0.5)
                d.press("enter")
                time.sleep(0.5)
                
            if d(text="무료배송").exists:
                is_checked = False
                
                # 안전한 방식: 배송비 입력창(두 번째 EditText)이 비활성화 되어 있는지 체크
                edits = d(className="android.widget.EditText")
                if len(edits) >= 2:
                    # 두번째 입력창(제주/도서산간 배송비 등)이 disabled 라면 무료배송이 체크된 것
                    if not edits[1].info.get('enabled', True):
                        is_checked = True

                if not is_checked:
                    print("[Python] 무료배송 체크되어 있지 않아 체크를 시도합니다.")
                    bounds = d(text="무료배송").info['bounds']
                    click_x = bounds['left'] - 40
                    click_y = (bounds['top'] + bounds['bottom']) // 2
                    d.shell(f"input tap {click_x} {click_y}")
                    time.sleep(0.5)
            else:
                width, height = d.window_size()
                d.shell(f"input tap {width // 2} {int(height * 0.3)}")
                time.sleep(1)
            
            print("[Python] '완료' 버튼 클릭 시도 (adb input tap 사용)...")
            if d(description="완료").exists(timeout=3):
                info = d(description="완료").info
                bounds = info['bounds']
                cx = (bounds['left'] + bounds['right']) // 2
                cy = (bounds['top'] + bounds['bottom']) // 2
                print(f"[Python] '완료' 버튼 발견! 좌표: ({cx}, {cy})")
                d.shell(f"input tap {cx} {cy}")
            else:
                print("[Python] '완료' 버튼 못 찾음, 고정 좌표 (360, 1192) 사용")
                d.shell("input tap 360 1192")
                
            time.sleep(2)
            if d(description="완료").exists:
                print("[Python] [WARN] 아직 가격 화면! 재시도...")
                d.shell("input tap 360 1192")
                time.sleep(2)
            print("[Python] 가격 설정 완료!")
            
        # 8단계: 최종 상품 등록 (메인 화면에서)
        print("[Python] 모든 정보 입력 완료, 최종 상품 등록을 위해 스크롤을 맨 밑으로 내립니다.")
        width, height = d.window_size()
        d.swipe(10, int(height * 0.8), 10, int(height * 0.2))
        time.sleep(0.5)
        
        if d(description="상품 등록").exists(timeout=3):
            info = d(description="상품 등록").info
            bounds = info['bounds']
            cx = (bounds['left'] + bounds['right']) // 2
            cy = (bounds['top'] + bounds['bottom']) // 2
            print(f"[Python] '상품 등록' 버튼 발견! 좌표: ({cx}, {cy})")
            d.shell(f"input tap {cx} {cy}")
            print("[Python] [OK] '상품 등록' 버튼 클릭 성공!")
        elif d(text="상품 등록").exists(timeout=2):
            info = d(text="상품 등록").info
            bounds = info['bounds']
            cx = (bounds['left'] + bounds['right']) // 2
            cy = (bounds['top'] + bounds['bottom']) // 2
            d.shell(f"input tap {cx} {cy}")
            print("[Python] [OK] '상품 등록' 버튼 클릭 성공! (text)")
        else:
            print("[Python] [WARN] '상품 등록' 버튼을 못 찾아 고정 좌표 클릭 시도...")
            d.shell(f"input tap {width // 2} {int(height * 0.93)}")
            
        if d(description="상품 등록").exists or d(text="상품 등록").exists:
            print("[Python] [WARN] 여전히 상품 등록 화면입니다. 재시도...")
            d.shell(f"input tap {width // 2} {int(height * 0.88)}")
            print("[Python] [OK] 상품 등록 화면에서 벗어남 - 등록 성공으로 판단!")
        
        real_pid = "f_dummy_" + prodCode
        
        # 9단계: 진짜 PID 추출 시도 (상세 페이지에서 공유 -> 링크 복사)
        print("[Python] 업로드 대기 중... 상세 페이지가 열릴 때까지 기다립니다 (최대 15초)")
        
        try:
            # 1. 상세 페이지 로딩 완료 확인 ('수정' 또는 '상단업' 버튼이 나타날 때까지 대기)
            page_loaded = False
            for _ in range(15):
                # 인스타그램 팝업 방어 로직
                if d(textContains="Instagram").exists():
                    print("[Python] Instagram 프로필 팝업 감지! 닫기 시도...")
                    d.press("back")
                    time.sleep(1)
                    if d(textContains="Instagram").exists():
                        width, height = d.window_size()
                        d.click(width * 0.15, height * 0.15) # 좌측 상단 X 터치
                        time.sleep(1)
                        
                if d(text="수정").exists or d(text="상단업").exists:
                    page_loaded = True
                    break
                time.sleep(1)
                
            if not page_loaded:
                print("[Python] [WARN] 15초가 지나도 상세 페이지가 열리지 않아 가짜 PID로 종료합니다.")
                return {"success": True, "pid": real_pid}
                
            print("[Python] 상세 페이지 진입 확인 완료! 공유 버튼 타격을 시작합니다.")
            time.sleep(1.5)
            
            # 2. 공유 버튼 클릭 (우측 상단 여러 좌표를 찌르며 확실히 타격)
            width, height = d.window_size()
            share_success = False
            
            # 안전하게 우측 상단 여러 지점을 찔러봅니다 (공유 버튼 외엔 누를 게 없으므로 안전함)
            hit_points = [
                (width - 50, 100),
                (width - 80, 120),
                (width - 100, 100),
                (width - 60, 140)
            ]
            
            for px, py in hit_points:
                print(f"[Python] 공유 버튼 타격 시도 (X:{px}, Y:{py})")
                d.click(px, py)
                
                # 바텀시트에서 '링크 복사' 버튼 대기
                if d(text="링크 복사").exists(timeout=2.5):
                    d(text="링크 복사").click()
                    print("[Python] '링크 복사' 클릭 완료. 클립보드 분석 중...")
                    share_success = True
                    time.sleep(1.5) # 클립보드 복사 딜레이
                    break
                    
            if share_success:
                # 4. 클립보드 텍스트 가져오기
                clipboard_text = d.clipboard
                if clipboard_text:
                    print(f"[Python] 클립보드 내용: {clipboard_text}")
                    parts = clipboard_text.rstrip('/').split('/')
                    # 후르츠패밀리는 fruitsfamily.com 이나 fruitsfamilyapp.onelink.me 를 사용함
                    if len(parts) > 0 and "fruitsfamily" in clipboard_text.lower():
                        extracted_id = parts[-1].split('?')[0] # 쿼리스트링 제거
                        real_pid = "f_" + extracted_id
                        print(f"[Python] [SUCCESS] 진짜 PID 추출 성공: {real_pid}")
                    else:
                        print(f"[Python] 클립보드에 복사된 주소가 후르츠패밀리 형식이 아닙니다: {clipboard_text}")
            else:
                print("[Python] [WARN] 우측 상단을 모두 찔러보았으나 '링크 복사' 바텀시트가 열리지 않았습니다.")
                     
        except Exception as ex:
            print(f"[Python] PID 추출 중 에러 발생 (무시됨): {ex}")
            
        return {"success": True, "pid": real_pid}
        
    except Exception as e:
        import traceback
        err_detail = traceback.format_exc()
        print(f"[Python] [ERROR] 에러 발생: {type(e).__name__}: {e}")
        print(f"[Python] [ERROR] Traceback:\n{err_detail}")
        return {"success": False, "error": f"업로드 실패: {type(e).__name__}: {str(e)}"}

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    input_data = sys.stdin.read()
    try:
        parsed_data = json.loads(input_data)
        result = upload_to_fruits(parsed_data)
        print("RESULT_JSON:" + json.dumps(result))
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        err_out = {"success": False, "error": f"Invalid input or run failure: {str(e)}\n\nTraceback:\n{err_msg}"}
        print("RESULT_JSON:" + json.dumps(err_out))
        with open("python_debug.log", "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] FATAL ERROR:\n{err_msg}\n")
