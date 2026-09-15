# coding: utf-8
import uiautomator2 as u2
import sys
import time
import json

def delete_product(pid):
    try:
        # pid가 f_7t6bp656 형태라면 앞의 f_를 제거
        if pid.startswith("f_"):
            real_pid = pid[2:]
        else:
            real_pid = pid

        if "dummy" in real_pid:
            return {"success": False, "error": "더미 PID는 삭제할 수 없습니다."}

        print("[Python] 앱 종료 후 딥링크 실행...")
        d = u2.connect("127.0.0.1:5555")
        
        d.app_stop("com.fruitsfamily")
        time.sleep(1)

        # 저장된 ID는 onelink의 해시값이므로 원래 주소체계 사용
        url = f"https://fruitsfamilyapp.onelink.me/Agm2/{real_pid}"
        print(f"[Python] 딥링크 호출: {url}")
        
        # 패키지 지정 없이 실행 (크롬을 거쳐 리다이렉트 되도록 허용)
        d.shell(f'am start -a android.intent.action.VIEW -d "{url}"')

        # 1. 상세 페이지 로딩 대기
        print("[Python] 상세 페이지(리다이렉트) 로딩 대기 중...")
        page_loaded = False
        for _ in range(25): # 대기 시간을 좀 더 길게 줌 (브라우저 경유 고려)
            if d(text="수정").exists or d(text="상단업").exists or d(text="끌어올리기").exists or d(text="판매완료").exists:
                page_loaded = True
                break
                
            # 브라우저에 머물러 있는 경우 '앱 열기' 버튼이 있으면 눌러줌
            if d(text="앱에서 보기").exists:
                d(text="앱에서 보기").click()
            elif d(text="앱에서 열기").exists:
                d(text="앱에서 열기").click()
                
            time.sleep(1)

        if not page_loaded:
            return {"success": False, "error": "25초 내에 상품 상세 페이지가 로딩되지 않았거나 딥링크 연결에 실패했습니다."}

        time.sleep(1.5)

        # 팝업 방해 방지
        if d(text="취소").exists(timeout=1):
            d(text="취소").click()
            time.sleep(1)

        # 2. 하단 '수정' 버튼 클릭
        print("[Python] '수정' 버튼 클릭...")
        if d(text="수정").exists:
            d(text="수정").click()
            time.sleep(2.0)  # 팝업창이 완전히 올라올 때까지 여유있게 대기
        else:
            return {"success": False, "error": "수정 버튼을 찾을 수 없습니다."}

        # 3. 바텀시트에서 '삭제' 버튼 클릭
        print("[Python] 바텀시트 메뉴 대기...")
        if d(text="삭제").exists(timeout=3):
            d(text="삭제").click()
            time.sleep(1.5)  # 확인 팝업창 뜰 때까지 대기
        else:
            return {"success": False, "error": "바텀시트의 삭제 버튼을 찾을 수 없습니다."}

        # 4. '상품을 삭제하시겠습니까?' 팝업에서 '삭제' 클릭
        print("[Python] 삭제 확인 팝업 대기 중...")
        if d(textContains="삭제하시겠습니까").exists(timeout=3):
            # 우측 하단 삭제 버튼 클릭
            delete_btns = d(text="삭제")
            if len(delete_btns) > 1:
                delete_btns[1].click()
            elif len(delete_btns) == 1:
                delete_btns[0].click()
            else:
                width, height = d.window_size()
                d.click(int(width * 0.75), int(height * 0.6))
        else:
            return {"success": False, "error": "삭제 확인 팝업이 나타나지 않았습니다."}

        print("[Python] 상품 삭제 완료!")
        time.sleep(2)
        return {"success": True, "pid": pid}

    except Exception as e:
        import traceback
        err_detail = traceback.format_exc()
        return {"success": False, "error": str(e), "detail": err_detail}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "PID 인자가 필요합니다."}))
        sys.exit(1)

    pid_arg = sys.argv[1]
    
    result = delete_product(pid_arg)
        
    print("###RESULT_START###")
    print(json.dumps(result, ensure_ascii=False))
    print("###RESULT_END###")
