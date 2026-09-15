import sys
import os
import json
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageEnhance, ImageFilter
import io

try:
    from rembg import remove, new_session
except ImportError:
    print(json.dumps({"success": False, "error": "rembg is not installed. Please install it using 'pip install rembg'"}), flush=True)
    sys.exit(1)

def pad_and_resize(img, target_width, target_height, bg_color=(255, 255, 255), scale=1.0):
    """
    비율을 유지하며 리사이즈 후 중앙에 배치하고 남은 영역을 bg_color로 채웁니다.
    scale 매개변수를 통해 이미지 크기를 조정할 수 있습니다 (예: 0.9 = 10% 축소).
    """
    img_ratio = img.width / img.height
    target_ratio = target_width / target_height

    if img_ratio > target_ratio:
        # 가로에 맞춤
        new_width = int(target_width * scale)
        new_height = int(new_width / img_ratio)
    else:
        # 세로에 맞춤
        new_height = int(target_height * scale)
        new_width = int(new_height * img_ratio)

    resized_img = img.resize((new_width, new_height), Image.LANCZOS)
    
    new_img = Image.new("RGB", (target_width, target_height), bg_color)
    paste_x = (target_width - new_width) // 2
    paste_y = (target_height - new_height) // 2
    
    # 투명도가 있다면 마스크 적용
    if resized_img.mode in ('RGBA', 'LA'):
        new_img.paste(resized_img, (paste_x, paste_y), mask=resized_img.split()[3])
    else:
        new_img.paste(resized_img, (paste_x, paste_y))
        
    return new_img

def draw_text_with_stroke(draw, x, y, text, font, text_color, stroke_color, stroke_width):
    # 테두리 그리기
    for dx in range(-stroke_width, stroke_width + 1):
        for dy in range(-stroke_width, stroke_width + 1):
            if dx != 0 or dy != 0:
                draw.text((x + dx, y + dy), text, font=font, fill=stroke_color)
    # 실제 텍스트 그리기
    draw.text((x, y), text, font=font, fill=text_color)

def process_images(image_paths, output_dir, brand, title, prod_code, copyright_text, skip_nukki=False):
    try:
        # 1. 경로 검증 및 로드
        if not image_paths or len(image_paths) == 0:
            raise Exception("No image paths provided.")
            
        main_img_path = image_paths[0]
        if not os.path.exists(main_img_path):
            raise Exception(f"Main image not found at {main_img_path}")

        # 2. 누끼 (rembg) 처리
        main_img = Image.open(main_img_path)
        # EXIF 정보에 의한 회전 문제 방지
        main_img = ImageOps.exif_transpose(main_img)
        main_img = main_img.convert("RGBA")
        
        if skip_nukki:
            # 누끼 건너뛰기: 원본 이미지를 그대로 사용 (회전 방지 및 RGBA 변환된 상태)
            white_bg = Image.new("RGB", main_img.size, (255, 255, 255))
            if main_img.mode in ('RGBA', 'LA'):
                white_bg.paste(main_img, mask=main_img.split()[3])
            else:
                white_bg = main_img.convert('RGB')
        else:
            # 최상급 해상도 및 정확도를 지원하는 최신 엔진 (birefnet-general) 적용
            session = new_session("birefnet-general")
            nukki_img_data = remove(main_img, session=session, post_process_mask=True)
            # 리턴값이 Pillow Image 객체일 수도 있고 바이트일수도 있으므로 분기
            if isinstance(nukki_img_data, bytes):
                nukki_img = Image.open(io.BytesIO(nukki_img_data))
            else:
                nukki_img = nukki_img_data

            # --- 이미지 보정 (다림질 효과 및 대비 강화) ---
            # 1. 약간의 다림질 효과 (부드럽게)
            nukki_img = nukki_img.filter(ImageFilter.SMOOTH)
            # 2. 명암(대비) 증가: 검은색은 더 검게, 흰색은 더 희게 (1.15배 정도로 자연스럽게)
            enhancer = ImageEnhance.Contrast(nukki_img)
            nukki_img = enhancer.enhance(1.15)
            # -----------------------------------------------

            # 배경을 하얀색으로 채우기 (jpg 저장을 위해)
            # 2-1. 투명 영역을 제거하여 옷이 최대한 크게 보이도록 바운딩 박스로 크롭
            bbox = nukki_img.getbbox()
            if bbox:
                nukki_img = nukki_img.crop(bbox)

            white_bg = Image.new("RGB", nukki_img.size, (255, 255, 255))
            if nukki_img.mode in ('RGBA', 'LA') or (nukki_img.mode == 'P' and 'transparency' in nukki_img.info):
                white_bg.paste(nukki_img, mask=nukki_img.split()[3])
            else:
                white_bg = nukki_img.convert('RGB')
            
        # 누끼 파일 저장 경로
        base_name = os.path.splitext(os.path.basename(main_img_path))[0]
        nukki_path = os.path.join(output_dir, f"{base_name}_nukki.jpg")
        white_bg.save(nukki_path, "JPEG", quality=95)

        # 3. 레이아웃 캔버스 생성 (가로 1080 x 세로 1920)
        canvas_width = 1080
        canvas_height = 1920
        canvas = Image.new("RGB", (canvas_width, canvas_height), (255, 255, 255))

        # 3-1. 상단 (0~960): 전면 누끼 이미지 배치 (비율 유지, 여백 추가, 10% 축소)
        top_half_img = pad_and_resize(white_bg, 1080, 960, scale=0.9)
        canvas.paste(top_half_img, (0, 0))

        # 3-2. 상단 텍스트 렌더링
        draw = ImageDraw.Draw(canvas)
        try:
            # 윈도우 환경 폰트 로드 시도
            font_brand = ImageFont.truetype("malgunbd.ttf", 60)
            font_title = ImageFont.truetype("malgun.ttf", 36)
            font_code = ImageFont.truetype("malgunbd.ttf", 40)
        except IOError:
            # 실패 시 기본 폰트 사용 (테두리 두께 조절 어려울 수 있음)
            font_brand = ImageFont.load_default()
            font_title = ImageFont.load_default()
            font_code = ImageFont.load_default()

        # 좌상단 텍스트 (브랜드, 타이틀)
        margin_x = 40
        margin_y = 40
        draw_text_with_stroke(draw, margin_x, margin_y, brand, font_brand, (0, 0, 0), (255, 255, 255), 3)
        
        # title 줄바꿈 (길 경우, 중간에서 줄 넘김)
        # 40글자 이상일 경우 중간에서 자르기
        if len(title) > 25:
            # 대략 절반 지점에서 가장 가까운 띄어쓰기를 찾음
            mid = len(title) // 2
            split_idx = title.find(' ', mid)
            if split_idx == -1:
                split_idx = title.rfind(' ', 0, mid)
            if split_idx != -1:
                title = title[:split_idx] + '\n' + title[split_idx+1:]
        draw_text_with_stroke(draw, margin_x, margin_y + 80, title, font_title, (80, 80, 80), (255, 255, 255), 2)

        # 우상단 텍스트 (코드)
        code_text = f"Code : {prod_code}"
        # 텍스트 크기 측정 (pillow >= 8.0.0)
        if hasattr(font_code, 'getbbox'):
            bbox = font_code.getbbox(code_text)
            code_w = bbox[2] - bbox[0]
        else:
            code_w = 200 # fallback
        draw_text_with_stroke(draw, canvas_width - code_w - margin_x, margin_y, code_text, font_code, (0, 0, 0), (255, 255, 255), 3)

        # 3-3. 하단 (960~1920): 원본 6장 그리드 (3열 x 2행)
        # 여백 설정
        padding = 15
        grid_width = canvas_width - (padding * 4) # 좌, 1, 2, 우
        grid_height = 960 - (padding * 3) - 40 # 카피라이트를 그리기 위해 40px의 하단 마진을 줍니다.
        
        cell_width = grid_width // 3
        cell_height = grid_height // 2
        
        # 6장 맞추기 (부족하면 메인 이미지로 대체)
        padded_images = image_paths[:]
        while len(padded_images) < 6:
            padded_images.append(main_img_path)
            
        for i in range(6):
            row = i // 3
            col = i % 3
            
            img_path = padded_images[i]
            if os.path.exists(img_path):
                img = Image.open(img_path)
                img = ImageOps.exif_transpose(img)
                # 하단 셀은 중앙 꽉채움 유지하되 패딩 뺀 크기로
                # 중앙 크롭(center crop)
                img_ratio = img.width / img.height
                target_ratio = cell_width / cell_height
                if img_ratio > target_ratio:
                    new_w = int(img.height * target_ratio)
                    left = (img.width - new_w) / 2
                    img = img.crop((left, 0, left + new_w, img.height))
                else:
                    new_h = int(img.width / target_ratio)
                    img = img.crop((0, 0, img.width, new_h))
                    
                cell_img = img.resize((cell_width, cell_height), Image.LANCZOS)
                
                # 좌표 계산
                x = padding + col * (cell_width + padding)
                y = 960 + padding + row * (cell_height + padding)
                
                canvas.paste(cell_img, (x, y))

        # 3-4. 카피라이트 텍스트 그리기 (하단에 확보된 여백에 중앙 정렬 드로잉)
        if copyright_text:
            try:
                font_copyright = ImageFont.truetype("arial.ttf", 22)
            except IOError:
                font_copyright = ImageFont.load_default()
                
            if hasattr(font_copyright, 'getbbox'):
                c_bbox = font_copyright.getbbox(copyright_text)
                copyright_w = c_bbox[2] - c_bbox[0]
                copyright_h = c_bbox[3] - c_bbox[1]
            else:
                copyright_w = 400
                copyright_h = 20
                
            c_x = (canvas_width - copyright_w) // 2
            # 1920 - 40 = 1880 (하단 40px 여백 영역)
            c_y = 1880 + (40 - copyright_h) // 2 - 5
            draw.text((c_x, c_y), copyright_text, font=font_copyright, fill=(120, 120, 120))

        # 합성 파일 저장 경로
        synthesis_path = os.path.join(output_dir, f"{base_name}_synthesis.jpg")
        canvas.save(synthesis_path, "JPEG", quality=95)

        # 4. 결과 반환
        result = {
            "success": True,
            "nukkiPath": nukki_path,
            "synthesisPath": synthesis_path
        }
        print(json.dumps(result), flush=True)

    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(error_result), flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 8:
        print(json.dumps({"success": False, "error": "Insufficient arguments. Usage: python processor.py <output_dir> <brand> <title> <prodCode> <copyright> <skipNukki> <img1> <img2> ..."}))
        sys.exit(1)
        
    output_dir = sys.argv[1]
    brand = sys.argv[2]
    title = sys.argv[3]
    prod_code = sys.argv[4]
    copyright_text = sys.argv[5]
    skip_nukki = sys.argv[6].lower() == 'true'
    input_images = sys.argv[7:]
    
    # 출력 폴더가 없다면 생성
    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
        
    process_images(input_images, output_dir, brand, title, prod_code, copyright_text, skip_nukki)
