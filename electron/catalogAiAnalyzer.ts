// @ts-nocheck
/**
 * [catalogAiAnalyzer.ts]
 * 822-link의 aiAnalyzer.ts를 기반으로 한 Gemini Vision 기반 상품 AI 분석 모듈
 *
 * - 이미지 6장을 Gemini 3.8 Flash에 전송하여 브랜드/카테고리/설명 등을 자동 추출
 * - 누끼/합성 없이 순수 텍스트 데이터 생성에 집중
 */
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import fs from 'node:fs';
import path from 'node:path';
/** MIME 타입 추론 헬퍼 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png')
        return 'image/png';
    if (ext === '.webp')
        return 'image/webp';
    if (ext === '.heic')
        return 'image/heic';
    if (ext === '.heif')
        return 'image/heif';
    return 'image/jpeg';
}
/** 로컬 이미지 → Gemini inlineData 변환 */
function fileToGenerativePart(filePath, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
            mimeType
        },
    };
}
/**
 * Gemini 3.8 Flash Vision으로 제품 이미지 6장을 분석
 * 822-link의 동일한 프롬프트를 사용하여 일관된 데이터를 생성합니다.
 */
export async function analyzeProductWithAI(imagePaths, apiKey, defectInfo) {
    if (!apiKey) {
        return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
    }
    if (!imagePaths || imagePaths.length === 0) {
        return { success: false, error: '분석할 이미지가 없습니다.' };
    }
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // 카탈로그 이미지 분석에 방해되지 않도록 Safety 완화
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ];
        const model = genAI.getGenerativeModel({
            model: 'gemini-3.8-flash',
            safetySettings
        });
        // 이미지 파트 생성 (최대 6장)
        const maxImages = Math.min(imagePaths.length, 6);
        const imageParts = [];
        for (let i = 0; i < maxImages; i++) {
            const filePath = imagePaths[i];
            if (fs.existsSync(filePath)) {
                imageParts.push(fileToGenerativePart(filePath, getMimeType(filePath)));
            }
        }
        if (imageParts.length === 0) {
            return { success: false, error: '유효한 이미지 파일이 없습니다.' };
        }
        console.log(`[CatalogAI] 이미지 ${imageParts.length}장 로드 완료`);
        // 822-link와 동일한 카테고리 풀
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
        // 하자 정보를 프롬프트에 반영
        let defectPrompt = '';
        if (defectInfo && defectInfo.trim() !== '') {
            defectPrompt = `\n\n[중요 지시사항: 제품 결함 정보]\n제품에 다음과 같은 결함이 있습니다: "${defectInfo}"\n이 결함 내용이 외국어로 작성되었다면 반드시 정확한 한국어로 번역하여 'Defect_KR' 필드에 넣고, 제품 설명(Description)에도 이 한국어 결함 내용을 담백하고 명확하게 기재해 주세요.`;
        }
        else {
            defectPrompt = `\n\n[중요 지시사항: 제품 결함 정보]\n이 제품은 특별한 결함이나 하자가 없습니다.\n제품 설명(Description)에 반드시 "하자가 없는 깨끗한 상품입니다." 라는 멘트를 추가해주세요.`;
        }
        // 822-link와 동일한 시스템 프롬프트
        const systemPrompt = `
당신은 최고의 빈티지 의류 전문가이자 마케팅 전문가입니다.
첨부된 의류 사진들을 바탕으로 다음 정보를 추출하거나 생성하세요.

${defectPrompt}

0. 성별(Gender): 정면 제품 사진 전체 핏과 목 뒤 메인라벨, 케어라벨 정보를 통합해서 남성용인지 여성용인지 판별하세요. (참고: 대한민국 기준 남자M=95, 여자M=90, 남자L=100).
   **[중요] 애매하거나 모호하면 무조건 '남성'으로 판별하고, 확실한 여성 제품(스커트, 원피스, 여성컷 라벨 90 사이즈 표기 등)만 '여성'으로 판별하세요!**
   판별된 성별은 반드시 JSON의 Gender 필드에만 기입하고, 제품명(Name)에는 절대 포함하지 마세요.
1. 제품명(Name): 제품 사진과 라벨을 바탕으로 핵심키워드와 표기사이즈를 조합하여 제품명을 작성하세요. 양식: '핵심키워드 표기사이즈' 
   (예: "나이키 스포츠 바람막이 100L"). 사이즈 정보는 반드시 제품명 맨 뒤에 기입하세요. 성별(남성/여성/공용)은 절대 제품명에 포함하지 마세요. 전체 길이는 25자 이내로 직관적으로 작성하세요.
   **[매우 중요] 사진 어디에도 '100', '105' 같은 숫자가 적혀있지 않다면, 절대 '105L'처럼 임의로 환산하거나 추측해서 적지 마세요.**
2. 브랜드(Brand): 텍스트/라벨을 분석하여 브랜드명을 추출하세요. 모르면 'Unknown'
3. 사이즈(Size): 케어라벨이나 목 탭에 적힌 숫자사이즈나 영문사이즈를 '최우선'으로 찾아내서 그대로 표기하세요.
4. 카테고리(Category): 반드시 아래 카테고리 풀에서 가장 일치하는 항목을 '대분류 > 소분류' 형식으로 반환하세요.
   **[특수 분류 규칙] 아디다스, 나이키 등 스포츠 브랜드의 '트랙탑'은 '아우터 > 져지', 바스락거리는 나일론 자켓은 '아우터 > 바람막이 / 윈드브레이커'로 분류.**
<상세 카테고리 키워드 풀>
${allowedCategoriesText}
</상세 카테고리 키워드 풀>

5. 제품설명(Description): 제품에 대한 과한 설명은 절대 하지 마시고, 아주 심플하고 짧게 한 줄로만 작성하세요. (최소한의 텍스트만 유지)
5-1. 마켓용 제품설명(Market_Description): 번개장터/후르츠패밀리 등 중고마켓에 업로드할 제품 포장용 설명입니다. 제품 생산년도(시대), 스타일, 색상, 디자인, 소재 등에 집중해서 '간결하게' 작성하세요. 위에서 추출한 패션 스타일(예: 아메카지, y2k 등)을 자연스럽게 설명에 녹여내세요. 구구절절한 스토리텔링은 배제하세요.
   **[중요] 제공된 여러 이미지 중, 목 뒤 라벨(메인택)과 허리 라인 라벨(케어라벨)을 꼼꼼하게 살피세요. 케어라벨에 가슴둘레, 신장(예: 140-155cm), 허리둘레 등의 신체 정보가 적혀있다면, 이를 파악하여 "140~155cm의 키에 잘 맞을 것 같아요" 와 같이 추천 체형 멘트를 마켓용 제품 설명 첫 줄에 자연스럽게 녹여내세요.**
6. 스타일(Style): 영어로 분류 (예: Amekaji, Y2K, Streetwear 등)
7. 계절(Season): 여름="s", 겨울="w", 그 외="sl"
8. 해시태그(Hashtags): 제품과 관련된 해시태그를 반드시 **한글**로 5개 작성하세요. (예: #빈티지자켓 #아디다스트랙탑 #오버핏 #아메카지 #90s)
9. SNS 멘트(SNS): 인스타그램 판매용 피드 멘트
10. 출고가(OriginalPrice): 대략적인 소비자가(KRW) 숫자만
11. 결함 번역(Defect_KR): 결함 내역을 한국어로 번역/작성

반드시 아래 JSON 형식으로만 응답하세요. 백틱이나 마크다운 없이 순수 JSON만 반환해야 합니다.
{
  "Gender": "남성 또는 여성",
  "Name": "한국어 제품명",
  "Name_EN": "영어 제품명",
  "ShortName_EN": "순수 영문 제품명",
  "Name_TH": "태국어 제품명",
  "Brand": "브랜드명",
  "Category": "카테고리명",
  "Size": "사이즈",
  "Style": "스타일",
  "Season": "s, w, 또는 sl",
  "Description_KR": "한국어 제품 설명 (밴드 업로드용 짧은 설명)",
  "Market_Description_KR": "마켓 업로드용 한국어 제품 설명 (포장용)",
  "Description_EN": "영어 제품 설명",
  "Description_TH": "태국어 제품 설명",
  "SNS": "SNS 판매 멘트",
  "Hashtags": "#한글해시태그1 #한글해시태그2 #한글해시태그3 #한글해시태그4 #한글해시태그5",
  "OriginalPrice": "숫자만",
  "Defect_KR": "한국어 결함 정보"
}
`;
        console.log(`[CatalogAI] Gemini API 호출 시작`);
        const result = await model.generateContent([systemPrompt, ...imageParts]);
        const responseText = result.response.text();
        // JSON 파싱
        const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        let parsedData;
        try {
            parsedData = JSON.parse(cleanText);
            if (Array.isArray(parsedData) && parsedData.length > 0) {
                parsedData = parsedData[0];
            }
            // 카테고리 교정: 대분류가 누락된 경우 자동 보완
            if (parsedData.Category && typeof parsedData.Category === 'string') {
                const aiCat = parsedData.Category.trim();
                if (!aiCat.includes('>')) {
                    const matchedCategory = allowedCategoriesList.find(fullCat => {
                        const subCat = fullCat.split('>')[1].trim();
                        return subCat === aiCat || subCat.includes(aiCat) || aiCat.includes(subCat);
                    });
                    if (matchedCategory) {
                        console.log(`[CatalogAI] 카테고리 교정: '${aiCat}' -> '${matchedCategory}'`);
                        parsedData.Category = matchedCategory;
                    }
                }
            }
            // 성별 강제 교정: 확실한 '여성'이 아니면 무조건 '남성'
            if (parsedData.Gender) {
                const g = String(parsedData.Gender);
                parsedData.Gender = (g.includes('여성') || g.includes('Female') || g.includes('W')) ? '여성' : '남성';
            }
            else {
                parsedData.Gender = '남성';
            }
            console.log(`[CatalogAI] 분석 성공: ${parsedData.Brand} / ${parsedData.Category}`);
            return { success: true, data: parsedData };
        }
        catch (parseError) {
            console.error('[CatalogAI] JSON 파싱 에러:', cleanText.substring(0, 200));
            return { success: false, error: 'AI가 올바른 JSON 형식을 반환하지 않았습니다.' };
        }
    }
    catch (error) {
        console.error('[CatalogAI Error]', error);
        return { success: false, error: error.message || String(error) };
    }
}
