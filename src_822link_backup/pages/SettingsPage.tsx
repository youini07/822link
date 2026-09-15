/**
 * 822 Link - 설정 페이지 (Windows 11 Settings Style)
 * 
 * 왜 이렇게 설계했는가:
 * - 윈도우 11 설정 앱과 유사한 깔끔하고 여백이 많은 리스트형 폼 디자인
 * - '찾아보기' 버튼 클릭 시 Electron 네이티브 폴더 다이얼로그 호출
 */
import { useState, useEffect } from 'react'
import { FolderOpen, Settings, Save, Search, Info, RotateCcw, ImageIcon, UserPlus, Trash2, Shield } from 'lucide-react'
import { useFileStore } from '../stores/fileStore'

// 허용된 텔레그램 사용자 설정 구조
interface AllowedTelegramUser {
  id: number
  label: string
  uploadTarget: string // '822shop' | 'dreamstudio'
  language?: string    // 'ko' | 'th'
}

const DEFAULT_AI_PROMPT = `[SNS 작성 가이드라인]
정품 보장
세탁 완료
실측 치수 기입란 기입
하자 여부 기입란 기입
가격 및 배송비 안내 문구를 포함하여 인스타그램 피드에 올릴 법한 세련된 멘트로 작성해주세요.`



export default function SettingsPage() {
  const [localWatchPath, setLocalWatchPath] = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramChannel, setTelegramChannel] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [googleDriveUrl_822shop, setGoogleDriveUrl_822shop] = useState('')
  const [googleSpreadsheetUrl_822shop, setGoogleSpreadsheetUrl_822shop] = useState('')
  const [googleDriveUrl_dreamstudio, setGoogleDriveUrl_dreamstudio] = useState('')
  const [googleSpreadsheetUrl_dreamstudio, setGoogleSpreadsheetUrl_dreamstudio] = useState('')
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_AI_PROMPT)
  const [copyrightText, setCopyrightText] = useState('© 822 Vintage. All rights reserved.')
  const [isLoading, setIsLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState('')

  // 텔레그램 허용 사용자 관리 상태
  const [allowedTelegramUsers, setAllowedTelegramUsers] = useState<AllowedTelegramUser[]>([])
  const [newUserId, setNewUserId] = useState('')
  const [newUserLabel, setNewUserLabel] = useState('')
  const [newUserTarget, setNewUserTarget] = useState('822shop')
  const [newUserLanguage, setNewUserLanguage] = useState('ko')

  const { enableRemoveBg, enableSynthesis, toggleRemoveBg, toggleSynthesis } = useFileStore()

  // 앱 시작 시 설정값 불러오기
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI?.settings) {
          const path = await window.electronAPI.settings.get('localWatchPath')
          const token = await window.electronAPI.settings.get('telegramToken')
          const channel = await window.electronAPI.settings.get('telegramChannel')
          const gKey = await window.electronAPI.settings.get('geminiKey')
          const gdUrl_822shop = await window.electronAPI.settings.get('googleDriveUrl_822shop')
          const gsUrl_822shop = await window.electronAPI.settings.get('googleSpreadsheetUrl_822shop')
          const gdUrl_dreamstudio = await window.electronAPI.settings.get('googleDriveUrl_dreamstudio')
          const gsUrl_dreamstudio = await window.electronAPI.settings.get('googleSpreadsheetUrl_dreamstudio')
          const prompt = await window.electronAPI.settings.get('aiPrompt')
          const cpText = await window.electronAPI.settings.get('copyrightText')
          const telegramUsers = await window.electronAPI.settings.get('allowedTelegramUsers')
          
          if (path) setLocalWatchPath(path)
          if (token) setTelegramToken(token)
          if (channel) setTelegramChannel(channel)
          if (gKey) setGeminiKey(gKey)
          if (gdUrl_822shop) setGoogleDriveUrl_822shop(gdUrl_822shop)
          if (gsUrl_822shop) setGoogleSpreadsheetUrl_822shop(gsUrl_822shop)
          if (gdUrl_dreamstudio) setGoogleDriveUrl_dreamstudio(gdUrl_dreamstudio)
          if (gsUrl_dreamstudio) setGoogleSpreadsheetUrl_dreamstudio(gsUrl_dreamstudio)
          if (prompt) setAiPrompt(prompt)
          if (cpText) setCopyrightText(cpText)
          if (telegramUsers && Array.isArray(telegramUsers)) setAllowedTelegramUsers(telegramUsers)
        }
      } catch (err) {
        console.error('설정 불러오기 실패:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [])

  // 폴더 찾아보기 다이얼로그 호출
  const handleSelectFolder = async () => {
    if (window.electronAPI?.settings?.selectFolder) {
      const result = await window.electronAPI.settings.selectFolder()
      if (result.success && result.path) {
        setLocalWatchPath(result.path)
      }
    } else {
      alert('데스크톱 앱 환경에서만 폴더 선택 기능이 지원됩니다.')
    }
  }

  // 설정 저장
  const handleSave = async () => {
    try {
      if (window.electronAPI?.settings) {
        await window.electronAPI.settings.set('localWatchPath', localWatchPath)
        await window.electronAPI.settings.set('telegramToken', telegramToken)
        await window.electronAPI.settings.set('telegramChannel', telegramChannel)
        await window.electronAPI.settings.set('geminiKey', geminiKey)
        await window.electronAPI.settings.set('googleDriveUrl_822shop', googleDriveUrl_822shop)
        await window.electronAPI.settings.set('googleSpreadsheetUrl_822shop', googleSpreadsheetUrl_822shop)
        await window.electronAPI.settings.set('googleDriveUrl_dreamstudio', googleDriveUrl_dreamstudio)
        await window.electronAPI.settings.set('googleSpreadsheetUrl_dreamstudio', googleSpreadsheetUrl_dreamstudio)
        await window.electronAPI.settings.set('aiPrompt', aiPrompt)
        await window.electronAPI.settings.set('copyrightText', copyrightText)
        await window.electronAPI.settings.set('allowedTelegramUsers', allowedTelegramUsers)
        
        setSaveMessage('설정이 성공적으로 저장되었습니다.')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        alert('데스크톱 앱 환경에서만 설정 저장이 지원됩니다.')
      }
    } catch (err) {
      console.error('설정 저장 실패:', err)
      alert('설정 저장 중 오류가 발생했습니다.')
    }
  }

  if (isLoading) return <div className="p-8">설정 불러오는 중...</div>

  return (
    <div className="h-full bg-white text-[#202020] overflow-y-auto animate-fade-in p-8">
      {/* 타이틀 영역 */}
      <div className="flex items-center gap-3 mb-8">
        <Settings size={28} className="text-[#0078d4]" />
        <div>
          <h2 className="text-2xl font-semibold">설정</h2>
          <p className="text-sm text-gray-500 mt-1">앱 동작 환경 및 외부 서비스 연동을 구성합니다.</p>
        </div>
      </div>

      <div className="max-w-3xl space-y-8">
        {/* 1. 로컬 환경 설정 */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2">로컬 환경 설정</h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-3">
            <label className="block text-sm font-medium text-gray-700">이미지 감시 폴더 경로</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <FolderOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={localWatchPath}
                  onChange={(e) => setLocalWatchPath(e.target.value)}
                  placeholder="예: C:\Users\Username\Pictures\업로드_대기"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
                />
              </div>
              <button
                onClick={handleSelectFolder}
                className="px-4 py-2 bg-[#f3f3f3] hover:bg-[#e5e5e5] border border-gray-300 rounded text-sm font-medium transition-colors whitespace-nowrap"
              >
                찾아보기...
              </button>
            </div>
            <p className="text-xs text-gray-500">지정된 폴더에 새 이미지가 추가되면 자동으로 인식하여 업로드 큐에 등록합니다.</p>
          </div>
        </section>

        {/* 2. 텔레그램 연동 */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2">텔레그램 연동 설정</h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Bot Token (봇 토큰)</label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="텔레그램 BotFather에서 발급받은 HTTP API Token"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Channel ID (채널 아이디)</label>
              <input
                type="text"
                value={telegramChannel}
                onChange={(e) => setTelegramChannel(e.target.value)}
                placeholder="예: @my_product_channel 또는 -100123456789"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
            </div>

            {/* 허용된 텔레그램 사용자 관리 */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-[#0078d4]" />
                <label className="block text-sm font-medium text-gray-700">허용된 텔레그램 사용자 (화이트리스트)</label>
              </div>
              <p className="text-xs text-gray-500">
                등록된 사용자만 봇을 통해 업로드할 수 있습니다. 비워두면 모든 사용자가 이용 가능합니다.
                사용자의 텔레그램 ID는 봇에서 <code className="bg-gray-100 px-1 rounded">/start</code> 명령어로 확인할 수 있습니다.
              </p>

              {/* 등록된 사용자 목록 */}
              {allowedTelegramUsers.length > 0 && (
                <div className="space-y-2">
                  {allowedTelegramUsers.map((user, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2.5">
                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono font-bold text-[#0078d4] bg-blue-50 px-2 py-1 rounded shrink-0">
                          {user.id}
                        </span>
                        <span className="text-sm text-gray-700 font-medium truncate">{user.label || '이름 없음'}</span>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                        user.uploadTarget === 'dreamstudio'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-green-50 text-green-700 border border-green-200'
                      }`}>
                        {user.uploadTarget === 'dreamstudio' ? '🎨 Dreamstudio' : '🏪 822shop'}
                      </span>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0 bg-gray-100 text-gray-700 border border-gray-300">
                        {user.language === 'th' ? '🇹🇭 태국어' : '🇰🇷 한국어'}
                      </span>
                      <button
                        onClick={() => setAllowedTelegramUsers(prev => prev.filter((_, i) => i !== idx))}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="사용자 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 새 사용자 추가 입력 */}
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-gray-500">텔레그램 ID (숫자)</label>
                  <input
                    type="text"
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="예: 7123456789"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-gray-500">이름표 (메모용)</label>
                  <input
                    type="text"
                    value={newUserLabel}
                    onChange={(e) => setNewUserLabel(e.target.value)}
                    placeholder="예: 직원A"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
                  />
                </div>
                <div className="w-28 space-y-1">
                  <label className="text-xs text-gray-500">언어</label>
                  <select
                    value={newUserLanguage}
                    onChange={(e) => setNewUserLanguage(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4] bg-white"
                  >
                    <option value="ko">🇰🇷 한국어</option>
                    <option value="th">🇹🇭 태국어</option>
                  </select>
                </div>
                <div className="w-40 space-y-1">
                  <label className="text-xs text-gray-500">업로드 대상</label>
                  <select
                    value={newUserTarget}
                    onChange={(e) => setNewUserTarget(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4] bg-white"
                  >
                    <option value="822shop">🏪 822shop</option>
                    <option value="dreamstudio">🎨 Dreamstudio</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    const id = parseInt(newUserId)
                    if (!id || isNaN(id)) return alert('올바른 텔레그램 ID(숫자)를 입력해주세요.')
                    if (allowedTelegramUsers.some(u => u.id === id)) return alert('이미 등록된 ID입니다.')
                    setAllowedTelegramUsers(prev => [...prev, { id, label: newUserLabel || `사용자 ${id}`, uploadTarget: newUserTarget, language: newUserLanguage }])
                    setNewUserId('')
                    setNewUserLabel('')
                    setNewUserTarget('822shop')
                    setNewUserLanguage('ko')
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#0078d4] hover:bg-[#005a9e] text-white rounded text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <UserPlus size={14} />
                  추가
                </button>
              </div>

              {allowedTelegramUsers.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
                  ⚠️ 화이트리스트가 비어있어 현재 <strong>모든 사용자</strong>가 봇을 이용할 수 있습니다. 보안을 위해 허용할 사용자를 등록해주세요.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 3. 이미지 프로세싱 설정 */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2 flex items-center gap-2">
            <ImageIcon size={18} className="text-[#0078d4]" />
            이미지 프로세싱 설정
          </h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">메인 이미지 누끼 자동 생성</label>
                <p className="text-xs text-gray-500 mt-1">업로드 시 제품의 배경을 투명하게 제거합니다.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={enableRemoveBg} onChange={toggleRemoveBg} />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0078d4]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <div>
                <label className="block text-sm font-medium text-gray-700">카탈로그 화보 합성 이미지 생성</label>
                <p className="text-xs text-gray-500 mt-1">브랜드 텍스트 and 6분할 컷이 들어간 합성 화보를 생성합니다.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={enableSynthesis} onChange={toggleSynthesis} />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0078d4]"></div>
              </label>
            </div>

            <div className="space-y-1.5 pt-3 border-t border-gray-100 animate-fade-in">
              <label className="block text-sm font-medium text-gray-700">전체합성 화보 카피라이트 문구</label>
              <input
                type="text"
                value={copyrightText}
                onChange={(e) => setCopyrightText(e.target.value)}
                placeholder="예: © 822 Vintage. All rights reserved."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
              />
              <p className="text-xs text-gray-500">6분할 합성 화보 이미지 최하단에 정갈하게 삽입될 저작권 표시 텍스트입니다.</p>
            </div>

            <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
              이 옵션은 대시보드 화면 상단 툴바에서도 즉시 변경 가능하며, 변경된 값은 앱 재시작 후에도 저장되어 유지됩니다.
            </p>
          </div>
        </section>

        {/* 4. Gemini AI 설정 */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2">Gemini AI 설정</h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Google Gemini API Key</label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AI 프롬프트 생성용 API 키"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
              <p className="text-xs text-gray-500">이미지 분석 및 설명 텍스트 자동 생성을 위해 필요합니다.</p>
            </div>

            <div className="space-y-2 pt-2 border-t border-gray-100">
              <div className="flex justify-between items-end">
                <label className="block text-sm font-medium text-gray-700">AI 상품 분석 프롬프트 (성격 지시문)</label>
                <button
                  onClick={() => setAiPrompt(DEFAULT_AI_PROMPT)}
                  className="flex items-center gap-1.5 text-xs text-[#0078d4] hover:text-[#005a9e] bg-[#f0f8ff] hover:bg-[#e0f0ff] px-2 py-1 rounded transition-colors"
                >
                  <RotateCcw size={12} />
                  기본 프롬프트로 초기화
                </button>
              </div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4] font-mono text-gray-700 bg-[#fafafa] resize-y"
                placeholder="AI에게 상품 이미지를 어떻게 분석하고 어떤 말투로 적을지 지시합니다."
              />
              <p className="text-xs text-gray-500">
                AI의 톤앤매너, 말투, 필수 포함 항목 등을 자유롭게 수정할 수 있습니다. 
                <strong className="font-semibold text-gray-700 ml-1">주의: JSON 응답 포맷 규칙은 변경하지 마세요.</strong>
              </p>
            </div>
          </div>
        </section>

        {/* 4. Google 클라우드 연동 설정 */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2">Google 클라우드 연동 설정 (822shop)</h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-4 mb-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Google Drive 폴더 주소 (URL)</label>
              <input
                type="text"
                value={googleDriveUrl_822shop}
                onChange={(e) => setGoogleDriveUrl_822shop(e.target.value)}
                placeholder="예: https://drive.google.com/drive/folders/1a2b3c4d5e6f..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
              <p className="text-xs text-gray-500">제품 원본 및 가공 이미지가 업로드될 822shop용 구글 드라이브 폴더의 브라우저 주소를 입력해주세요.</p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Google Spreadsheet 주소 (URL)</label>
              <input
                type="text"
                value={googleSpreadsheetUrl_822shop}
                onChange={(e) => setGoogleSpreadsheetUrl_822shop(e.target.value)}
                placeholder="예: https://docs.google.com/spreadsheets/d/1x2y3z4w5v6u.../edit"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
              <p className="text-xs text-gray-500">AI 상품정보 분석 데이터를 기입할 822shop용 구글 시트 주소를 입력해주세요.</p>
            </div>
          </div>

          <h3 className="text-lg font-semibold border-b border-gray-200 pb-2">Google 클라우드 연동 설정 (Dreamstudio)</h3>
          
          <div className="bg-[#fdfdfd] border border-gray-200 rounded-md p-5 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Google Drive 폴더 주소 (URL)</label>
              <input
                type="text"
                value={googleDriveUrl_dreamstudio}
                onChange={(e) => setGoogleDriveUrl_dreamstudio(e.target.value)}
                placeholder="예: https://drive.google.com/drive/folders/1CMr_0S..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
              <p className="text-xs text-gray-500">제품 원본 및 가공 이미지가 업로드될 Dreamstudio용 구글 드라이브 폴더의 브라우저 주소를 입력해주세요.</p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Google Spreadsheet 주소 (URL)</label>
              <input
                type="text"
                value={googleSpreadsheetUrl_dreamstudio}
                onChange={(e) => setGoogleSpreadsheetUrl_dreamstudio(e.target.value)}
                placeholder="예: https://docs.google.com/spreadsheets/d/..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#0078d4]"
              />
              <p className="text-xs text-gray-500">AI 상품정보 분석 데이터를 기입할 Dreamstudio용 구글 시트 주소를 입력해주세요.</p>
            </div>
            <div className="bg-[#f3f3f3] p-3.5 rounded border border-gray-200 flex gap-2 text-xs text-gray-600">
                <Info size={16} className="text-[#0078d4] shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block text-gray-700 mb-0.5">💡 구글 로그인 방식 (기존 카탈로그 메이커와 100% 동일)</span>
                  기존 파이썬 프로그램에서 쓰시던 <strong>client_secret.json</strong> 파일을 바탕화면 catalog_app 폴더에 그대로 두고 쓰시면 됩니다. <br/>
                  업로드를 시작하면 <strong>웹 브라우저가 열리며 사용자님의 구글 계정으로 로그인</strong>하는 창이 뜹니다.
                </div>
              </div>
          </div>
        </section>

        {/* 하단 저장 버튼 */}
        <div className="flex items-center gap-4 pt-4">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#0078d4] hover:bg-[#005a9e] text-white rounded font-semibold text-sm transition-colors"
          >
            <Save size={16} />
            변경사항 저장
          </button>
          
          {saveMessage && (
            <span className="text-sm font-medium text-[#107c10] animate-fade-in">
              {saveMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
