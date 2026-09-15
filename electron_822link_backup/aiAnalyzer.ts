import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 이미지 파일에서 MIME 타입을 추론하는 헬퍼 함수
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.heic') return 'image/heic'
  if (ext === '.heif') return 'image/heif'
  return 'image/jpeg' // 기본값 (jpg, jpeg 등)
}

/**
 * 로컬 이미지 파일을 Generative AI가 인식할 수 있는 파트로 변환
 */
function fileToGenerativePart(filePath: string, mimeType: string) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType
    },
  }
}

/**
 * 제품 이미지들을 Gemini Vision 모델로 분석
 */
export async function analyzeProductWithAI(
  imagePaths: string[],
  apiKey: string,
  prompt?: string,
  target?: string
) {
  if (!apiKey) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.')
  }
  if (!imagePaths || imagePaths.length === 0) {
    throw new Error('분석할 이미지가 없습니다.')
  }

  try {
    // Gemini 클라이언트 초기화
    const genAI = new GoogleGenerativeAI(apiKey)
    
    // Safety 설정 (카탈로그 이미지 분석에 방해되지 않도록 완화)
    const safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ]

    // 모델 인스턴스 생성 (최신 멀티모달 모델 사용)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      safetySettings 
    })

    // 이미지 파트 생성 (최대 6장까지 사용하여 메인택, 케어라벨 등 디테일 전부 확인)
    const maxImages = Math.min(imagePaths.length, 6)
    const imageParts: any[] = []

    // ✅ 핵심 수정: 실제 이미지 파일을 읽어 imageParts 배열에 추가
    // 이 루프가 없으면 AI는 이미지를 전혀 받지 못하고 텍스트만으로 분석하게 됨
    for (let i = 0; i < maxImages; i++) {
      const filePath = imagePaths[i]
      if (fs.existsSync(filePath)) {
        imageParts.push(fileToGenerativePart(filePath, getMimeType(filePath)))
      } else {
        console.warn(`[AI Analyzer] 이미지 파일 없음 (건너뜀): ${filePath}`)
      }
    }

    if (imageParts.length === 0) {
      throw new Error('유효한 이미지 파일이 하나도 없습니다. 파일 경로를 확인해주세요.')
    }

    console.log(`[AI Analyzer] 이미지 ${imageParts.length}장 로드 완료 (요청: ${imagePaths.length}장)`)

    // 통합 카테고리(Unified Taxonomy) 하드코딩 적용 (대분류 > 소분류 형식)
    const allowedCategoriesList = [
      "상의 > 반팔티", "상의 > 긴팔티", "상의 > 맨투맨/스웨트셔츠", "상의 > 후드티", "상의 > 셔츠/남방", "상의 > 니트/스웨터", "상의 > 슬리브리스(나시)",
      "아우터 > 바람막이 / 윈드브레이커", "아우터 > 져지", "아우터 > 자켓", "아우터 > 가디건", "아우터 > 코트", "아우터 > 패딩/푸퍼", "아우터 > 점퍼/블루종", "아우터 > 조끼/베스트", "아우터 > 플리스/뽀글이",
      "하의 > 데님/청바지", "하의 > 면바지/치노팬츠", "하의 > 슬랙스", "하의 > 트레이닝팬츠/스웨트팬츠", "하의 > 반바지/쇼츠", "하의 > 스커트/치마 (여성)",
      "원피스 > 미니 원피스", "원피스 > 미디/롱 원피스", "원피스 > 투피스 세트",
      "신발 > 스니커즈/운동화", "신발 > 구두/로퍼", "신발 > 부츠/워커", "신발 > 샌들/슬리퍼",
      "가방 > 백팩", "가방 > 크로스백", "가방 > 숄더백", "가방 > 토트백", "가방 > 에코백", "가방 > 클러치/파우치",
      "액세서리 > 목걸이/팔찌/반지", "액세서리 > 안경/선글라스", "액세서리 > 지갑/벨트", "액세서리 > 넥타이",
      "모자 > 캡", "모자 > 비니", "모자 > 버킷햇"
    ];
    const allowedCategoriesText = allowedCategoriesList.join(", ");

    const currencyRule = "통화 기준은 반드시 '대한민국 원화(KRW)'여야 합니다. 달러 등 타 통화일 경우 원화로 환산하여 적어주세요.";

    let finalPrompt = prompt || '정품 보장, 세탁 완료, 실측 치수 기입란 기입, 하자 여부 기입란 기입, 가격 및 배송비 안내 문구를 포함하여 세련되게 작성해주세요.';
    if (target === 'dreamstudio') {
      finalPrompt += "\n[필수 지시사항] SNS 멘트 작성 시 자신을 소개하거나 인사할 때, 사용자가 가이드라인에서 '822SHOP 매니저입니다' 혹은 '822SHOP'이라고 지시했더라도 절대 무시하고 무조건 '드림스튜디오 입니다' 로 변경해서 작성해야 합니다. 절대 822SHOP 이라는 단어를 포함하지 마세요.";
    }

    const systemPrompt = `
당신은 최고의 빈티지 의류 전문가이자 마케팅 전문가입니다.
첨부된 의류 사진들을 바탕으로 다음 정보를 추출하거나 생성하세요.

[사용자 제공 SNS 가이드라인]: 
${finalPrompt}

1. 성별 판별 및 제품명(Name): 정면 제품 사진 전체 핏과 목 뒤 메인라벨, 케어라벨 정보를 통합해서 남성용인지 여성용인지 판별하세요. (참고: 대한민국 기준 남자M=95, 여자M=90, 남자L=100). 
   **[중요] 번개장터에는 '공용' 카테고리가 없으므로, 확실한 여성 제품이 아니라면 무조건 '남성'으로 판별하세요!**
   판별된 성별과 표기 사이즈를 조합하여 제품명을 작성하세요. 양식: '(성별) 핵심키워드 표기사이즈' 
   (예: "(남성) 엄브로 인터내셔널 블랙 후드 95M"). 사이즈 정보는 반드시 제품명 맨 뒤에 기입하세요. 전체 길이는 25자 이내로 직관적으로 작성하세요.
   **[매우 중요] 사진 어디에도 '100', '105' 같은 숫자가 적혀있지 않다면, 절대 '105L'처럼 임의로 환산하거나 추측해서 적지 마세요. 라벨에 'L'만 있다면 그냥 'L'만 적고, '90'만 있다면 '90'만 적으세요.**
2. 브랜드(Brand): 텍스트/라벨을 분석하여 브랜드명을 추출하세요. 모르면 'Unknown'
3. 사이즈(Size): 케어라벨이나 목 탭에 적힌 숫자의류사이즈(예: 95, 100, 105)나 영문사이즈(예: S, M, L, XL)를 '최우선'으로 찾아내서 그대로 표기하세요. M이라고 적혀있으면 무조건 'M'이라고 적고, 절대 임의로 'Free'로 퉁치지 마세요. 정말 도저히 알 수 없을 때만 'Free'를 씁니다.
4. 카테고리(Category): 반드시 아래에 나열된 <상세 카테고리 키워드 풀> 중에서 가장 일치하는 항목을 찾아 **'대분류 > 소분류' 형식으로 정확하게** 반환하세요. (예: "상의 > 맨투맨/스웨트셔츠", "아우터 > 바람막이 / 윈드브레이커" 등. 단일 카테고리명만 적지 말고 반드시 대분류와 소분류를 '>' 기호로 연결하세요.)
   **[특수 분류 규칙 - 매우 중요] 아디다스, 나이키, 퓨마 등 스포츠 브랜드의 '트랙탑(옆면 삼선 라인, 신축성 있는 폴리에스테르 소재의 스포티한 짚업)'은 무조건 '아우터 > 져지'로 분류해야 합니다. 단, 바스락거리는 나일론 소재의 얇은 자켓(윈드브레이커)은 반드시 '아우터 > 바람막이 / 윈드브레이커'로 분류하세요.**
<상세 카테고리 키워드 풀>
${allowedCategoriesText}
</상세 카테고리 키워드 풀>

5. 제품설명(Description): 제품 생산년도(시대), 스타일, 색상, 디자인, 소재 등에 집중해서 '간결하게' 작성하세요. 위에서 추출한 패션 스타일(예: 아메카지, y2k 등)을 자연스럽게 설명에 녹여내세요. 구구절절한 스토리텔링은 배제하세요.
   **중요:** 작성된 제품 설명(한국어)을 바탕으로, 영어와 태국어로 각각 번역하여 별도의 JSON 필드(Description_KR, Description_EN, Description_TH)로 반환하세요.
   **중요:** 제공된 여러 이미지 중, 목 뒤 라벨(메인택)과 허리 라인 라벨(케어라벨)을 꼼꼼하게 살피세요. 케어라벨에 가슴둘레, 신장(예: 140-155cm), 허리둘레 등의 신체 정보가 적혀있다면, 이를 파악하여 "140~155cm의 키에 잘 맞을 것 같아요" 와 같이 추천 체형 멘트를 제품 설명 첫 줄에 자연스럽게 녹여내세요.
6. 스타일(Style): 제품의 패션 스타일을 반드시 **영어**로 분류하세요. (예: Amekaji, Y2K, Streetwear, Old Money, Old School, Sportswear, Minimal 등)
7. 계절(Season): 제품의 계절감을 판별하세요. 여름의류(반팔, 반바지 등)는 무조건 "s", 겨울의류(패딩, 플리스 등)는 무조건 "w", 그 외의 나머지 모든 의류는 "sl"로만 반환하세요.
8. 해시태그(Hashtags): 제품과 관련된 해시태그를 반드시 **영어**로 5개 작성하세요. (예: #Vintage #Nike #90s #OOTD)
9. SNS 멘트(SNS): 위의 [사용자 제공 SNS 가이드라인]을 바탕으로, 이 제품에 맞는 인스타그램 판매용 피드 멘트를 작성하세요.

10. 출고가(OriginalPrice): 해당 브랜드와 카테고리의 제품이 출시될 당시의 대략적인 소비자가(원가/발매가)를 검색 및 추정하여 '숫자'만 반환하세요. ${currencyRule} 정확한 가격을 모른다면 해당 브랜드/카테고리의 평균적인 출고가를 추정해서 적어주세요.
11. 결함 번역(Defect_KR): 사용자가 제공한 결함(Defect) 내역이 있다면, 그 내용을 바탕으로 한국어로 정확히 번역/작성하세요. (외국어일 경우 한국어로 번역, 없으면 빈 문자열)

반드시 아래 JSON 형식으로만 응답하세요. 백틱이나 마크다운 없이 순수 JSON만 반환해야 합니다.
{
  "Gender": "남성 또는 여성",
  "Name": "한국어 제품명",
  "Name_EN": "영어 제품명 (예: (Men's) L Adidas Colorful Pattern Pique Shirt)",
  "ShortName_EN": "성별, 사이즈, 브랜드를 제외한 순수 영문 제품명 (예: Colorful Pattern Pique Shirt)",
  "Name_TH": "태국어 제품명",
  "Brand": "브랜드명",
  "Category": "카테고리명 (예: 바람막이)",
  "Size": "사이즈",
  "Style": "아메카지, y2k 등",
  "Season": "s, w, 또는 sl",
  "Description_KR": "한국어 제품 설명",
  "Description_EN": "영어 제품 설명",
  "Description_TH": "태국어 제품 설명",
  "SNS": "SNS 판매 멘트",
  "Hashtags": "#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5",
  "OriginalPrice": "출시 당시 대략적인 소비자가 (숫자만, 예: 150000)",
  "Defect_KR": "한국어 제품 결함 정보 (입력된 결함 정보가 외국어인 경우 한국어로 번역, 없으면 빈 문자열)"
}
`
    console.log(`[AI Analyzer] Gemini API 호출 시작 (이미지 ${imageParts.length}장)`)
    
    // API 호출
    const result = await model.generateContent([systemPrompt, ...imageParts])
    const responseText = result.response.text()
    
    // 마크다운 백틱 및 불필요한 문자열 제거 후 JSON 파싱
    const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim()
    let parsedData
    
    try {
      parsedData = JSON.parse(cleanText)
      
      // 만약 AI가 리스트 [ { ... } ] 형태로 반환했다면 첫 번째 객체 추출
      if (Array.isArray(parsedData) && parsedData.length > 0) {
        parsedData = parsedData[0]
      }
      
      // ✅ [강제 교정 로직] AI가 대분류를 생략하고 소분류만 반환했을 때 방어
      if (parsedData.Category && typeof parsedData.Category === 'string') {
        const aiCat = parsedData.Category.trim();
        // 대분류 구분자 '>'가 없으면
        if (!aiCat.includes('>')) {
          // 허용된 카테고리 목록에서 해당 소분류를 포함하는 항목을 찾습니다.
          const matchedCategory = allowedCategoriesList.find(fullCat => {
            const subCat = fullCat.split('>')[1].trim();
            // 정확히 일치하거나 (예: '져지' === '져지')
            // AI가 '바람막이'라고 줬을 때 '바람막이 / 윈드브레이커'에 포함되는지 확인
            return subCat === aiCat || subCat.includes(aiCat) || aiCat.includes(subCat);
          });
          
          if (matchedCategory) {
            console.log(`[AI Analyzer] 카테고리 교정됨: '${aiCat}' -> '${matchedCategory}'`);
            parsedData.Category = matchedCategory;
          } else {
            console.warn(`[AI Analyzer] 매칭되는 대분류를 찾을 수 없는 단일 카테고리: '${aiCat}'`);
          }
        }
      }

      // (수정) AI가 '대분류 > 소분류' 형식으로 응답하므로, 더 이상 성별을 강제로 앞에 붙이지 않고 그대로 반환합니다.

      console.log(`[AI Analyzer] 분석 성공: ${parsedData.Brand} / ${parsedData.Category}`)
      return { success: true, data: parsedData }
      
    } catch (parseError) {
      console.error('[AI Analyzer] JSON 파싱 에러:', cleanText)
      const snippet = cleanText.substring(0, 200).replace(/\n/g, ' ')
      throw new Error(`AI가 올바른 JSON 형식을 반환하지 않았습니다. (응답 내용 일부: ${snippet}...)`)
    }
    
  } catch (error: any) {
    console.error('[AI Analyzer Error]', error)
    return { success: false, error: error.message || String(error) }
  }
}
