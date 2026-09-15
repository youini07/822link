/**
 * 822 Link - Google Cloud API 업로더 코어 모듈 (Drive & Sheets)
 * - 기존 Service Account 방식을 폐기하고, 파이썬 원본 앱과 동일한 OAuth 2.0 (User Consent) 방식으로 롤백합니다.
 */
import { app, shell, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { URL } from 'url'
import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
]

// 전역 변수로 OAuth2 클라이언트를 캐싱하여 인증 속도 비약적 개선
let cachedOAuth2Client: any = null

function getCredentialsPath(): string {
  const possiblePaths = [
    'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\client_secret.json',
    path.join(app.getAppPath(), 'client_secret.json'),
    path.join(app.getPath('userData'), 'client_secret.json')
  ]
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

function getTokenPath(): string {
  return 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\token.json'
}

async function authenticateWithOAuth(onProgress: (log: string) => void) {
  if (cachedOAuth2Client) {
    return cachedOAuth2Client
  }

  const credentialsPath = getCredentialsPath()
  if (!credentialsPath) {
    throw new Error('client_secret.json 파일을 찾을 수 없습니다. 바탕화면 catalog_app 폴더에 파일을 넣어주세요.')
  }

  const content = fs.readFileSync(credentialsPath, 'utf8')
  const credentials = JSON.parse(content)
  const { client_secret, client_id } = credentials.installed || credentials.web
  
  // redirect_uri는 구글 콘솔에 등록된 값과 일치해야 함. 데스크톱 앱의 경우 주로 http://localhost 사용.
  const redirectUri = 'http://localhost'
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri)

  const tokenPath = getTokenPath()

  if (fs.existsSync(tokenPath)) {
    try {
      const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'))
      oAuth2Client.setCredentials(token)
      const tokenInfo = await oAuth2Client.getAccessToken()
      if (tokenInfo.token) {
        cachedOAuth2Client = oAuth2Client
        return oAuth2Client
      }
    } catch (err) {
      console.warn('저장된 token.json을 읽지 못했거나 만료되었습니다. 재인증을 진행합니다.')
    }
  }

  return new Promise<any>((resolve, reject) => {
    onProgress('[인증] 구글 로그인이 필요합니다. 앱 내부에 뜨는 로그인 창에서 인증을 완료해주세요.')
    
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    })

    const authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      title: 'Google 계정으로 로그인',
      autoHideMenuBar: true
    })

    // 구글 로그인 URL 로드
    authWindow.loadURL(authUrl)
    authWindow.show()

    // 페이지 이동(리다이렉트) 가로채기
    const handleNavigation = async (urlStr: string) => {
      try {
        const parsedUrl = new URL(urlStr)
        // 구글이 localhost (redirect_uri)로 리다이렉트하면 가로챔
        if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
          const code = parsedUrl.searchParams.get('code')
          const error = parsedUrl.searchParams.get('error')

          if (error) {
            authWindow.close()
            return reject(new Error('구글 로그인 취소 또는 에러: ' + error))
          }

          if (code) {
            onProgress('[인증] 인증 코드 수신 성공! 토큰을 생성합니다...')
            oAuth2Client.getToken(code)
              .then(res => {
                const token = res.tokens
                oAuth2Client.setCredentials(token)
                fs.writeFileSync(tokenPath, JSON.stringify(token))
                onProgress('[인증] 토큰 저장 완료!')
                
                authWindow.close()
                cachedOAuth2Client = oAuth2Client
                return resolve(oAuth2Client)
              })
              .catch(err => {
                authWindow.close()
                reject(err)
              })
          }
        }
      } catch (err) {
        // 무시 (일반적인 구글 내부 이동)
      }
    }

    authWindow.webContents.on('will-redirect', (event, url) => {
      handleNavigation(url)
    })
    
    authWindow.webContents.on('did-navigate', (event, url) => {
      handleNavigation(url)
    })

    authWindow.on('closed', () => {
      reject(new Error('로그인 창이 닫혀서 인증이 취소되었습니다.'))
    })
  })
}

// ──────────────────────────────────────────────
// 2. URL 파서 유틸리티 (ID 추출용)
// ──────────────────────────────────────────────

function parseDriveFolderId(url: string): string {
  if (!url) return ''
  const match = url.match(/[?&]id=([a-zA-Z0-9-_]+)/) || url.match(/\/folders\/([a-zA-Z0-9-_]+)/)
  if (match && match[1]) return match[1]
  return url.trim()
}

function parseSpreadsheetId(url: string): string {
  if (!url) return ''
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match && match[1]) return match[1]
  return url.trim()
}

// ──────────────────────────────────────────────
// 3. 구글 연동 비즈니스 API 메소드 정의
// ──────────────────────────────────────────────

export interface UploadProductPayload {
  aiTitle: string
  aiBrand: string
  aiCategory: string
  aiSize: string
  aiGender?: string
  aiRealSize?: string
  aiDefect?: string
  aiCondition?: string // 상품 상태 (새상품, 사용감 없음 등)
  aiDescription: string
  aiNameEN?: string
  aiNameTH?: string
  aiDescEN?: string
  aiDescTH?: string
  aiSns: string
  aiHashtags: string
  aiStyle?: string
  aiSeason?: string
  aiOriginalPrice?: string
  localFilePaths: string[] // 원본 6장
  nukkiFilePath?: string   // 전면 누끼
  synthesisFilePath?: string // 합성 이미지
  googleDriveUrl: string
  googleSpreadsheetUrl: string
  predefinedProdCode?: string // 미리 채번된 정식 코드
}

// 안전한 일차원 문자열 보장 헬퍼 함수 (Google Sheets API 전용 예외 방어막)
const safeString = (val: any): string => {
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') {
    const possibleStr = val.string_value || val.value || val.Name || val.Brand || val.Category || val.Description || ''
    if (possibleStr && typeof possibleStr === 'string') return possibleStr
    return JSON.stringify(val)
  }
  return String(val)
}

export async function getNextProdCode(
  spreadsheetUrl: string,
  onProgress?: (log: string) => void
): Promise<string> {
  try {
    const authClient = await authenticateWithOAuth(onProgress || (() => {}))
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)
    if (!spreadsheetId) {
      throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.')
    }
    
    let sheetName = 'Sheet1'
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      const firstSheet = sheetInfo.data.sheets?.[0].properties
      if (firstSheet) {
        sheetName = firstSheet.title || 'Sheet1'
      }
    } catch (err) {
      console.warn('시트 이름 조회 실패, 기본값 사용.')
    }

    let nextProdCode = '1'
    const aColData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`
    })
    const rows = aColData.data.values
    if (rows && rows.length > 1) {
      let maxNum = 0
      for (let i = 1; i < rows.length; i++) {
        const val = rows[i][0]
        const num = parseInt(val, 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
      nextProdCode = (maxNum + 1).toString()
    }
    return nextProdCode
  } catch (err: any) {
    console.error('[getNextProdCode Error]', err)
    // 실패 시 타임스탬프 기반 임시 번호 폴백 제공
    return Date.now().toString().slice(-4)
  }
}

export async function uploadProductToGoogle(
  payload: UploadProductPayload,
  onProgress: (log: string) => void
): Promise<{ success: boolean; driveFolderPath?: string; error?: string; prodCode?: string }> {
  try {
    const authClient = await authenticateWithOAuth(onProgress)

    const drive = google.drive({ version: 'v3', auth: authClient })
    const sheets = google.sheets({ version: 'v4', auth: authClient })

    const parentFolderId = parseDriveFolderId(payload.googleDriveUrl)
    const spreadsheetId = parseSpreadsheetId(payload.googleSpreadsheetUrl)

    if (!parentFolderId) {
      throw new Error('올바르지 않은 Google Drive 주소 형식입니다.')
    }
    if (!spreadsheetId) {
      throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.')
    }

    onProgress(`[구글연동] 인증 완료. 대상 드라이브 폴더 ID: ${parentFolderId}`)

    // 1. 스프레드시트 이름 및 채번(ProdCode) 확보
    onProgress(`[스프레드시트] 제품정보 기입 준비 및 채번... 대상 시트 ID: ${spreadsheetId}`)
    
    let sheetName = 'Sheet1'
    let targetSheetId = 0
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      const firstSheet = sheetInfo.data.sheets?.[0].properties
      if (firstSheet) {
        sheetName = firstSheet.title || 'Sheet1'
        targetSheetId = firstSheet.sheetId || 0
      }
      onProgress(`[스프레드시트] 조회된 시트 이름: ${sheetName}`)
    } catch (err: any) {
      console.warn('시트 메타데이터 조회 실패, 기본값(Sheet1)을 사용합니다.', err)
      onProgress(`[경고] 시트 이름 조회 실패. 기본값(Sheet1) 사용.`)
    }

    // A열 읽어서 다음 제품 번호 채번
    let nextProdCode = payload.predefinedProdCode || '1'
    if (!payload.predefinedProdCode) {
      try {
        const aColData = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A:A`
        })
        const rows = aColData.data.values
        if (rows && rows.length > 1) { // 1행은 헤더라고 가정
          let maxNum = 0
          for (let i = 1; i < rows.length; i++) {
            const val = rows[i][0]
            const num = parseInt(val, 10)
            if (!isNaN(num) && num > maxNum) {
              maxNum = num
            }
          }
          nextProdCode = (maxNum + 1).toString()
        }
      } catch (err) {
        console.warn('A열 번호 읽기 실패, 기본값(1)을 사용합니다.', err)
      }
    }
    
    onProgress(`[구글연동] 새 제품 코드(폴더명) 채번: ${nextProdCode}`)

    // 2. Google Drive에 신규 제품 서브 폴더 생성
    onProgress(`[드라이브] 제품 서브 폴더 생성 중... 폴더명: ${nextProdCode}`)
    const folderMetadata = {
      name: nextProdCode,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    }
    
    const folderRes = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id, webViewLink'
    })
    
    const createdFolderId = folderRes.data.id
    if (!createdFolderId) {
      throw new Error('제품 폴더를 구글 드라이브에 생성하는 데 실패했습니다.')
    }

    // 3. 파일 업로드 헬퍼 함수
    const uploadSingleFile = async (filePath: string, indexLog: string, overrideName?: string) => {
      if (!filePath || !fs.existsSync(filePath)) return ''
      
      const originalFileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const fileName = overrideName ? `${overrideName}${ext}` : originalFileName
      
      let mimeType = 'image/jpeg'
      if (ext === '.png') mimeType = 'image/png'
      else if (ext === '.webp') mimeType = 'image/webp'

      onProgress(`[업로드] ${indexLog} ${fileName} 드라이브 업로드 중...`)

      const fileMetadata = { name: fileName, parents: [createdFolderId] }
      const media = { mimeType, body: fs.createReadStream(filePath) }

      const fileRes = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id'
      })

      try {
        await drive.permissions.create({
          fileId: fileRes.data.id!,
          requestBody: { role: 'reader', type: 'anyone' }
        })
      } catch (permissionErr) {
        console.warn(`[Google Uploader] 파일 권한 공유 실패: ${fileName}`, permissionErr)
      }

      return fileRes.data.id ? `https://drive.google.com/uc?id=${fileRes.data.id}` : ''
    }

    // 원본 이미지 6장 업로드 (1.jpg ~ 6.jpg 넘버링 적용)
    const originLinks: string[] = []
    for (let i = 0; i < 6; i++) {
      if (payload.localFilePaths[i]) {
        // overrideName을 주어 1, 2, 3... 으로 변경하여 드라이브에 저장
        const link = await uploadSingleFile(payload.localFilePaths[i], `[원본 ${i+1}/6]`, `${i+1}`)
        if (link) originLinks.push(link)
      }
    }
    const combinedOriginLinks = originLinks.join(', ')
    
    const nukkiLink = payload.nukkiFilePath ? await uploadSingleFile(payload.nukkiFilePath, `[누끼]`, `main${nextProdCode}`) : ''
    const synthesisLink = payload.synthesisFilePath ? await uploadSingleFile(payload.synthesisFilePath, `[합성]`, `${nextProdCode}`) : ''

    onProgress(`[드라이브] 전체 파일 업로드 및 링크 추출 완료!`)

    // 홈페이지서버이미지 (AB열) 생성 (넘버링된 파일명 1.jpg~6.jpg 기반)
    const numericCode = nextProdCode.replace(/[^0-9]/g, '')
    const staticImagesArr = payload.localFilePaths
      .filter(p => p) // 혹시 모를 undefined 방지
      .map((p, index) => {
        const fileExt = require('path').extname(p) || '.jpg'
        return `"/static/images/${numericCode}/${index + 1}${fileExt}"`
      })
    const staticImagesStr = `[${staticImagesArr.join(', ')}]`

    const dateStr = `'${new Date().getMonth() + 1}. ${new Date().getDate()}`

    const generateSkuPrefix = (genderText: string, categoryText: string) => {
      let gCode = (genderText.includes('여성') || genderText.includes('Women') || genderText.includes('W')) ? 'W' : 'M';
      if (categoryText.includes('원피스')) gCode = 'W';
      let subCat = categoryText.includes(' > ') ? categoryText.split(' > ').pop()?.trim() || categoryText : categoryText.trim();
      subCat = subCat.replace(/\s+\/\s+/g, '/').replace(/\s+/g, ' ').trim(); // Normalize spaces around slash
      
      const prefixMap: Record<string, string> = {
        "반팔티": "TS", "긴팔티": "TL", "맨투맨/스웨트셔츠": "TM", "후드티": "TH", "셔츠/남방": "TC", "니트/스웨터": "TK", "슬리브리스(나시)": "TN",
        "바람막이/윈드브레이커": "OW", "바람막이": "OW", "져지": "OJ", "자켓": "OJ", "가디건": "OC", "코트": "OT", "패딩/푸퍼": "OP", "점퍼/블루종": "OB", "조끼/베스트": "OV", "플리스/뽀글이": "OF",
        "데님/청바지": "BD", "면바지/치노팬츠": "BC", "슬랙스": "BS", "트레이닝팬츠/스웨트팬츠": "BT", "반바지/쇼츠": "BH", "스커트/치마 (여성)": "BK", "스커트/치마": "BK",
        "미니 원피스": "DM", "미디/롱 원피스": "DL", "투피스 세트": "DT",
        "스니커즈/운동화": "SS", "구두/로퍼": "SL", "부츠/워커": "SB", "샌들/슬리퍼": "SD",
        "백팩": "GB", "크로스백": "GC", "숄더백": "GS", "토트백": "GT", "에코백": "GE", "클러치/파우치": "GP",
        "캡": "AH", "비니": "AH", "버킷햇": "AH", "모자": "AH", "목걸이/팔찌/반지": "AJ", "안경/선글라스": "AG", "지갑/벨트": "AW", "넥타이": "AT", "머플러/스카프": "AM"
      };
      const pCode = prefixMap[subCat] || "XX";
      return `${gCode}${pCode}-`;
    };

    const skuPrefix = generateSkuPrefix(payload.aiGender || "", payload.aiCategory || "");

    let finalAiSns = payload.aiSns || "";
    try {
      const configPath = require('path').join(app.getPath('userData'), 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.googleSpreadsheetUrl_dreamstudio && payload.googleSpreadsheetUrl === config.googleSpreadsheetUrl_dreamstudio) {
          finalAiSns = finalAiSns.replace(/822샵|822SHOP|822shop|822\s*shop|822\s*샵/gi, '드림스튜디오 입니다');
        }
      }
    } catch (e) {
      console.error('Failed to process finalAiSns replacement', e);
    }

    const rowValues = [
      safeString(nextProdCode),            // 0 (A): 제품코드
      safeString(skuPrefix),               // 1 (B): 관리코드 (NEW)
      dateStr,                             // 2 (C): 등록일
      "",                      // 3 (D): 구분
      "판매중",                 // 4 (E): 위치
      "onsale",                // 5 (F): 상태
      "",                      // 6 (G): 사입가
      safeString(payload.aiOriginalPrice || ""), // 7 (H): 출고가
      "",                      // 8 (I): 가격
      "",                      // 9 (J): 실제판매가격(정산용)
      safeString(payload.aiBrand),         // 10 (K): 브랜드
      safeString(payload.aiGender || ""),  // 11 (L): 성별
      safeString(payload.aiCategory),      // 12 (M): 카테고리
      safeString(payload.aiTitle),         // 13 (N): 제품명
      safeString(payload.aiSize),          // 14 (O): 사이즈
      safeString(payload.aiRealSize || ""),// 15 (P): 실측사이즈
      safeString(payload.aiCondition || "사용감 적음"), // 16 (Q): 상품상태
      safeString(payload.aiDefect || ""),  // 17 (R): 제품결함
      safeString(payload.aiDescription),   // 18 (S): 제품설명
      safeString(finalAiSns),              // 19 (T): 제품설명(sns)
      safeString(combinedOriginLinks),     // 20 (U): 이미지
      safeString(nukkiLink),               // 21 (V): 전면누끼
      safeString(synthesisLink),           // 22 (W): 전체합성
      safeString(payload.aiHashtags),      // 23 (X): 해시태그
      safeString(payload.aiStyle),         // 24 (Y): style
      "",                      // 25 (Z): 예상도착일
      "",                      // 26 (AA): 아카이브
      safeString(payload.aiSeason),        // 27 (AB): season
      staticImagesStr,         // 28 (AC): 홈페이지서버이미지
      "",                      // 29 (AD): 번개장터
      "",                      // 30 (AE): 당근마켓
      "",                      // 31 (AF): 후르츠
      "",                      // 32 (AG): 중고나라
      safeString(payload.aiNameEN || ""),  // 33 (AH): 영문제품명
      safeString(payload.aiNameTH || ""),  // 34 (AI): 태국어제품명
      safeString(payload.aiDescEN || ""),  // 35 (AJ): 영문제품설명
      safeString(payload.aiDescTH || "")   // 36 (AK): 태국어제품설명
    ]

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:AK`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] }
    })

    // 셀 줄바꿈(WRAP) 해제하여 셀 높이 고정
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: targetSheetId
                },
                cell: {
                  userEnteredFormat: {
                    wrapStrategy: 'CLIP'
                  }
                },
                fields: 'userEnteredFormat.wrapStrategy'
              }
            },
            {
              updateDimensionProperties: {
                range: {
                  sheetId: targetSheetId,
                  dimension: 'ROWS'
                },
                properties: {
                  pixelSize: 21
                },
                fields: 'pixelSize'
              }
            }
          ]
        }
      })
      onProgress(`[스프레드시트] 셀 텍스트 넘침 방지(CLIP) 포맷 적용 완료`)
    } catch (formatErr) {
      console.warn('[스프레드시트] 포맷 적용 실패:', formatErr)
    }

    onProgress(`[스프레드시트] 제품코드 [${nextProdCode}] 20개 열 맵핑 완료!`)

    return { success: true, driveFolderPath: folderRes.data.webViewLink || '', prodCode: nextProdCode }
  } catch (err: any) {
    console.error('[Google Uploader Error]', err)
    onProgress(`[에러] 구글 연동 중 치명적 오류가 발생했습니다: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * 특정 제품 코드(ProdCode)에 해당하는 스프레드시트 행 데이터를 읽어옵니다.
 * 번개장터 다이렉트 업로드 봇 등에서 사용됩니다.
 */
export async function getSpreadsheetDataByProdCode(
  spreadsheetUrl: string,
  prodCode: string
) {
  try {
    const authClient = await authenticateWithOAuth(() => {})
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)

    if (!spreadsheetId) {
      throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.')
    }

    let sheetName = 'Sheet1'
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      sheetName = sheetInfo.data.sheets?.[0].properties?.title || 'Sheet1'
    } catch (err) {
      console.warn('시트 메타데이터 조회 실패, 기본값(Sheet1)을 사용합니다.')
    }

    // A~AG열 읽기
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:AG`
    })

    const rows = sheetData.data.values
    if (!rows || rows.length < 2) {
      throw new Error('스프레드시트에 데이터가 없습니다.')
    }

    // A열(인덱스 0)이 prodCode와 일치하는 행 찾기 (문자열 일치)
    const targetRow = rows.find(row => row[0]?.toString() === prodCode.toString())

    if (!targetRow) {
      throw new Error(`제품 코드 [${prodCode}]에 해당하는 데이터를 스프레드시트에서 찾을 수 없습니다.`)
    }

    return {
      success: true,
      data: {
        prodCode: targetRow[0],
        status: targetRow[5],        // F열: 상태 (onsale/sold out)
        price: targetRow[8],         // I열: 판매가
        brand: targetRow[10],        // K열: 브랜드
        gender: targetRow[11],       // L열: 성별
        category: targetRow[12],     // M열: 카테고리
        title: targetRow[13],        // N열: 제품명
        size: targetRow[14],         // O열: 사이즈
        realSize: targetRow[15],     // P열: 실측사이즈
        condition: targetRow[16],    // Q열: 상품상태
        defect: targetRow[17],       // R열: 제품결함
        description: targetRow[18],  // S열: 제품설명
        sns: targetRow[19],          // T열: 제품설명(sns)
        images: targetRow[20],       // U열: 이미지
        hashtags: targetRow[23],     // X열: 해시태그
        bunjangPid: targetRow[29],   // AD열: 번개장터 PID
        danggeunPid: targetRow[30],  // AE열: 당근마켓 PID
        fruitsPid: targetRow[31],    // AF열: 후르츠 PID
        joonggonaraPid: targetRow[32]// AG열: 중고나라 PID
      }
    }
  } catch (err: any) {
    console.error('[getSpreadsheetDataByProdCode Error]', err)
    return { success: false, error: err.message }
  }
}

/**
 * 스프레드시트의 전체 상품 목록을 요약하여 가져옵니다. (Bunjang Manager 다중 업로드용)
 */
export async function fetchSpreadsheetList(spreadsheetUrl: string) {
  try {
    const authClient = await authenticateWithOAuth(() => {})
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)

    if (!spreadsheetId) {
      throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.')
    }

    let sheetName = 'Sheet1'
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      sheetName = sheetInfo.data.sheets?.[0].properties?.title || 'Sheet1'
    } catch (err) {}

    // A~AG열 읽기
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:AG`
    })

    const rows = sheetData.data.values
    if (!rows || rows.length < 2) {
      return { success: true, data: [] }
    }

    // 첫 행(헤더)은 제외
    const items = rows.slice(1).map(row => {
      // U열(row[20])에는 구글드라이브 링크가 쉼표로 연결되어 있음. 첫 번째 경로를 썸네일로 사용
      const localPathsStr = row[20] || ''
      const firstThumbnail = localPathsStr.split(',')[0]?.trim() || ''

      return {
        prodCode: row[0] || '',
        status: row[5] || '',    // F열 (상태)
        price: row[8] || '',     // I열 (판매가)
        brand: row[10] || '',    // K열 (브랜드)
        gender: row[11] || '',   // L열 (성별)
        category: row[12] || '', // M열 (카테고리)
        title: row[13] || '',    // N열 (제품명)
        size: row[14] || '',     // O열 (사이즈)
        thumbnail: firstThumbnail,
        date: row[2] || '',      // C열 (등록일)
        bunjangPid: row[29] || '',      // AD열 (번개장터)
        danggeunPid: row[30] || '',     // AE열 (당근마켓)
        fruitsPid: row[31] || '',       // AF열 (후르츠)
        joonggonaraPid: row[32] || ''   // AG열 (중고나라)
      }
    })

    // 코드가 없는 빈 행 제거
    return { success: true, data: items.filter(i => i.prodCode !== '') }
  } catch (err: any) {
    console.error('[fetchSpreadsheetList Error]', err)
    return { success: false, error: err.message }
  }
}

/**
 * 특정 제품 코드의 행을 찾아 지정된 열(예: S열)에 플랫폼 상품 번호(PID)를 기록합니다.
 */
export async function updateSpreadsheetPID(
  spreadsheetUrl: string,
  prodCode: string,
  targetColumn: string, // 예: 'S' (번개장터), 'T' (당근마켓)
  pid: string
) {
  try {
    const authClient = await authenticateWithOAuth(() => {})
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)

    let sheetName = 'Sheet1'
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      sheetName = sheetInfo.data.sheets?.[0].properties?.title || 'Sheet1'
    } catch (err) {}

    // A열만 읽어서 해당 제품 코드의 행 번호를 찾음
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`
    })

    const rows = sheetData.data.values
    if (!rows) throw new Error('스프레드시트가 비어있습니다.')

    // A열에서 prodCode 찾기 (1-indexed, 배열은 0-indexed)
    const rowIndex = rows.findIndex(row => row[0]?.toString() === prodCode.toString())
    if (rowIndex === -1) {
      throw new Error(`제품 코드 [${prodCode}]를 찾을 수 없어 PID를 기록할 수 없습니다.`)
    }

    // 대상 셀 (예: S2)
    const targetCell = `'${sheetName}'!${targetColumn}${rowIndex + 1}`

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetCell,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[pid]] }
    })

    console.log(`[Google Uploader] 제품 [${prodCode}] 의 ${targetColumn}열에 PID(${pid}) 기록 완료`)
    return { success: true }
  } catch (err: any) {
    console.error('[updateSpreadsheetPID Error]', err)
    return { success: false, error: err.message }
  }
}

/**
 * 특정 제품의 I열(판매가) 값을 새로운 가격으로 업데이트합니다.
 */
export async function updateSpreadsheetPrice(
  spreadsheetUrl: string,
  prodCode: string,
  newPrice: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authClient = await authenticateWithOAuth(() => {})
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)

    if (!spreadsheetId) {
      throw new Error('올바르지 않은 Google Spreadsheet 주소 형식입니다.')
    }

    let sheetName = 'Sheet1'
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      sheetName = sheetInfo.data.sheets?.[0].properties?.title || 'Sheet1'
    } catch (err) {}

    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`
    })

    const rows = sheetData.data.values
    if (!rows || rows.length === 0) {
      throw new Error('스프레드시트에 데이터가 없습니다.')
    }

    const rowIndex = rows.findIndex(row => row[0]?.toString() === prodCode.toString())
    if (rowIndex === -1) {
      throw new Error(`제품 코드 [${prodCode}]를 찾을 수 없습니다.`)
    }

    // I열 (판매가) 셀 (예: I2)
    const targetCell = `'${sheetName}'!I${rowIndex + 1}`

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetCell,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newPrice]] }
    })

    console.log(`[Google Uploader] 제품 [${prodCode}] 의 I열 가격(${newPrice}) 기록 완료`)
    return { success: true }
  } catch (err: any) {
    console.error('[updateSpreadsheetPrice Error]', err)
    return { success: false, error: err.message }
  }
}

/**
 * 특정 제품 코드를 찾아 스프레드시트 행 삭제 및 드라이브 폴더 완전 삭제를 수행합니다.
 */
export async function deleteProductEntirely(
  prodCode: string,
  spreadsheetUrl: string,
  driveUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const authClient = await authenticateWithOAuth(() => {})
    const sheets = google.sheets({ version: 'v4', auth: authClient })
    const drive = google.drive({ version: 'v3', auth: authClient })

    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl)
    const parentFolderId = parseDriveFolderId(driveUrl)

    if (!spreadsheetId) throw new Error('올바르지 않은 스프레드시트 주소입니다.')
    if (!parentFolderId) throw new Error('올바르지 않은 구글 드라이브 주소입니다.')

    let sheetName = 'Sheet1'
    let sheetId = 0
    try {
      const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId })
      const firstSheet = sheetInfo.data.sheets?.[0]
      if (firstSheet && firstSheet.properties) {
        sheetName = firstSheet.properties.title || 'Sheet1'
        sheetId = firstSheet.properties.sheetId || 0
      }
    } catch (err) {}

    // 1. 스프레드시트 행 삭제
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`
    })

    const rows = sheetData.data.values
    if (rows && rows.length > 0) {
      const rowIndex = rows.findIndex(row => row[0]?.toString() === prodCode.toString())
      if (rowIndex !== -1) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                  }
                }
              }
            ]
          }
        })
        console.log(`[Google Uploader] 스프레드시트 행 ${rowIndex + 1} 삭제 완료`)
      } else {
        console.warn(`[Google Uploader] 제품 코드 [${prodCode}] 를 스프레드시트에서 찾을 수 없습니다.`)
      }
    }

    // 2. 구글 드라이브 폴더 삭제
    const query = `name='${prodCode}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const driveRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    })

    if (driveRes.data.files && driveRes.data.files.length > 0) {
      for (const targetFolder of driveRes.data.files) {
        if (targetFolder.id) {
          // 완전 삭제를 위해 휴지통(trashed=true)이 아닌 영구 삭제 API 사용 (delete)
          await drive.files.delete({ fileId: targetFolder.id })
          console.log(`[Google Uploader] 드라이브 폴더 [${prodCode}] 삭제 완료 (ID: ${targetFolder.id})`)
        }
      }
    } else {
      console.warn(`[Google Uploader] 드라이브 폴더 [${prodCode}] 를 찾을 수 없습니다.`)
    }

    return { success: true }
  } catch (err: any) {
    console.error('[deleteProductEntirely Error]', err)
    return { success: false, error: err.message }
  }
}
