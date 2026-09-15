/**
 * [CatalogPanel.tsx]
 * 카탈로그 데이터 생성 시스템 프론트엔드 패널
 * - 설정 섹션: 텔레그램 토큰, 이미지 저장 경로, 구글 시트/드라이브 URL
 * - 실시간 로그 콘솔: 파이프라인 진행 상황 표시
 */
import { useState, useEffect, useRef } from 'react';
import { Settings, Send, FolderOpen, Save, Wifi, WifiOff, Trash2, RefreshCw, ChevronRight, ChevronLeft } from 'lucide-react';

export function CatalogPanel() {
  // 설정 상태
  const [telegramToken, setTelegramToken] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [localImagePath, setLocalImagePath] = useState('');
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [googleSpreadsheetUrl, setGoogleSpreadsheetUrl] = useState('');
  const [defaultStartingBid, setDefaultStartingBid] = useState('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  
  // UI 상태
  const [isBotConnected, setIsBotConnected] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 초기 설정 로드
  useEffect(() => {
    if (window.electron?.getCatalogSettings) {
      window.electron.getCatalogSettings().then((settings: any) => {
        if (settings) {
          setTelegramToken(settings.telegramToken || '');
          setGeminiApiKey(settings.geminiApiKey || localStorage.getItem('bandadmin_gemini_api_key') || '');
          setLocalImagePath(settings.localImagePath || '');
          setGoogleDriveUrl(settings.googleDriveUrl || '');
          setGoogleSpreadsheetUrl(settings.googleSpreadsheetUrl || '');
          setDefaultStartingBid(settings.defaultStartingBid || '');
          setDescriptionTemplate(settings.descriptionTemplate || '');
        }
      });
      window.electron.getCatalogBotStatus().then((status: boolean) => {
        setIsBotConnected(status);
      });
        
      // 초기 로딩 지연 대응 및 주기적 확인
      setTimeout(() => {
        window.electron.getCatalogBotStatus().then((status: boolean) => {
          setIsBotConnected(status);
        });
      }, 1500);

      const interval = setInterval(() => {
        window.electron.getCatalogBotStatus().then((status: boolean) => {
          setIsBotConnected(status);
        });
      }, 5000);
      
      return () => clearInterval(interval);
    }
  }, []);

  // 실시간 로그 수신
  useEffect(() => {
    if (window.electron?.onCatalogLog) {
      const unsubscribe = window.electron.onCatalogLog((log: string) => {
        const timestamp = new Date().toLocaleTimeString('ko-KR');
        setLogs(prev => [...prev.slice(-200), `[${timestamp}] ${log}`]);
      });
      return unsubscribe;
    }
  }, []);

  // 로그 자동 스크롤
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 설정 저장
  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await window.electron.saveCatalogSettings({
        telegramToken,
        geminiApiKey,
        localImagePath,
        googleDriveUrl,
        googleSpreadsheetUrl,
        defaultStartingBid,
        descriptionTemplate
      });
      // 봇 상태 다시 확인
      const status = await window.electron.getCatalogBotStatus();
      setIsBotConnected(status);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 설정이 저장되었습니다.`]);
    } catch (err: any) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 설정 저장 실패: ${err.message}`]);
    } finally {
      setIsSaving(false);
    }
  };

  // 폴더 선택 다이얼로그
  const handleSelectFolder = async () => {
    const folderPath = await window.electron.selectImageFolder();
    if (folderPath) {
      setLocalImagePath(folderPath);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 overflow-auto">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-900/50 rounded-lg flex items-center justify-center border border-green-700/50">
            <Send className="text-green-400" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">AI 분석봇 설정</h2>
            <p className="text-xs text-slate-400">텔레그램 → AI 분석 → 구글 시트 자동 등록</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 봇 연결 상태 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${isBotConnected ? 'bg-green-900/30 text-green-400 border border-green-700/50' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
            {isBotConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {isBotConnected ? '봇 연결됨' : '봇 미연결'}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* 설정 패널 (접이식) */}
      {showSettings && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 shrink-0 flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Settings size={16} className="text-green-400" /> AI 분석봇 세부 설정
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {/* 텔레그램 봇 토큰 */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">텔레그램 봇 토큰</label>
              <input
                type="password"
                value={telegramToken}
                onChange={e => setTelegramToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>

            {/* Gemini API Key */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Gemini API Key</label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={e => {
                  setGeminiApiKey(e.target.value);
                  localStorage.setItem('bandadmin_gemini_api_key', e.target.value);
                }}
                placeholder="AIzaSy..."
                className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>

            {/* 이미지 저장 경로 */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">이미지 저장 폴더 경로</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localImagePath}
                  onChange={e => setLocalImagePath(e.target.value)}
                  placeholder="C:\Users\...\images"
                  className="flex-1 p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                />
                <button
                  onClick={handleSelectFolder}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            {/* 기본 경매시작가격 */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">기본 경매시작가격 (옵션)</label>
              <input
                type="text"
                value={defaultStartingBid}
                onChange={e => setDefaultStartingBid(e.target.value)}
                placeholder="예: 2 (2000원인 경우) | 비워두면 개별 세팅"
                className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>

            {/* 구글 스프레드시트 URL */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">구글 스프레드시트 URL (밴드탭 + 오픈마켓탭 공유)</label>
              <input
                type="text"
                value={googleSpreadsheetUrl}
                onChange={e => setGoogleSpreadsheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
              />
            </div>

          </div>

          {/* 제품 설명(S열) 양식 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 font-medium">제품 설명(S열) 템플릿</label>
              <span className="text-[10px] text-slate-500">사용 가능 변수: {'{제품명}'}, {'{브랜드명}'}, {'{실측사이즈}'}, {'{정가품여부}'}, {'{하자여부}'}, {'{사용감정도}'}</span>
            </div>
            <textarea
              value={descriptionTemplate}
              onChange={e => setDescriptionTemplate(e.target.value)}
              placeholder="▪ 제품명 : {제품명}&#10;▪ 브랜드명 : {브랜드명}&#10;▪ 실측사이즈 : {실측사이즈}&#10;▪ 정가품여부 : {정가품여부}&#10;▪ 하자여부 : {하자여부}&#10;▪ 사용감정도 : {사용감정도}"
              className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 transition-colors h-48 resize-y leading-tight"
            />
          </div>

          {/* 저장 버튼 */}
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className={`w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center text-sm ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <Save size={16} className="mr-2" />
            {isSaving ? '저장 중...' : '설정 저장 및 봇 (재)시작'}
          </button>
        </div>
      )}

      {/* 메인 컨텐츠 영역 (좌: 시트, 우: 로그) */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* 좌측: 연동된 구글 스프레드시트 뷰어 */}
        <div className="flex-[2] bg-slate-950 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 shrink-0">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">연동된 구글 스프레드시트</span>
            <button
              onClick={() => setSheetKey(prev => prev + 1)}
              className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 text-[11px] bg-slate-800/80 hover:bg-slate-700 px-2.5 py-1.5 rounded-md"
              title="시트 새로고침"
            >
              <RefreshCw size={12} /> 새로고침
            </button>
          </div>
          <div className="flex-1 bg-white relative">
            {googleSpreadsheetUrl ? (
              <iframe
                key={sheetKey}
                src={googleSpreadsheetUrl.includes('/edit') ? googleSpreadsheetUrl.replace(/\/edit.*$/, '/edit?rm=minimal') : googleSpreadsheetUrl}
                className="w-full h-full border-0 absolute inset-0"
                title="Google Spreadsheet"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 bg-slate-900 text-sm">
                설정에서 구글 스프레드시트 URL을 입력해주세요.
              </div>
            )}
          </div>
        </div>

        {/* 우측: 실시간 로그 콘솔 (접기 기능 추가) */}
        <div className={`${isLogExpanded ? 'flex-1' : 'w-12'} transition-all duration-300 ease-in-out bg-slate-950 border border-slate-700/50 rounded-xl flex flex-col min-h-0 shrink-0`}>
          <div className={`flex items-center ${isLogExpanded ? 'justify-between' : 'justify-center'} px-3 py-2.5 border-b border-slate-800`}>
            {isLogExpanded && (
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider pl-1 whitespace-nowrap">실시간 파이프라인 로그</span>
            )}
            <div className="flex items-center">
              {isLogExpanded && (
                <button
                  onClick={() => setLogs([])}
                  className="text-slate-500 hover:text-slate-300 transition-colors p-1.5 rounded-md hover:bg-slate-800 mr-2"
                  title="로그 지우기"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                onClick={() => setIsLogExpanded(!isLogExpanded)}
                className={`flex items-center justify-center ${isLogExpanded ? 'gap-1.5 px-3 py-1.5' : 'p-2'} bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-600 text-[11px] font-medium transition-colors shadow-sm`}
                title={isLogExpanded ? '로그 닫기 (시트 넓게 보기)' : '로그 열기'}
              >
                {isLogExpanded ? (
                  <>
                    접기 <ChevronRight size={14} />
                  </>
                ) : (
                  <ChevronLeft size={16} />
                )}
              </button>
            </div>
          </div>
          
          <div className={`flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed ${isLogExpanded ? 'block' : 'hidden'}`}>
            {logs.length === 0 ? (
              <div className="text-slate-600 text-center mt-8">
                <Send size={32} className="mx-auto mb-3 opacity-30" />
                <p>텔레그램에서 사진을 보내면 여기에 실시간 로그가 표시됩니다.</p>
                <p className="mt-1 text-slate-700">봇 명령어: /밴드업로드 · /오픈마켓업로드 → 사진 6장 → 사이즈 → 하자 → 상태</p>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`py-0.5 whitespace-pre-wrap break-words ${
                  log.includes('❌') ? 'text-red-400' :
                  log.includes('✅') || log.includes('✨') ? 'text-green-400' :
                  log.includes('🚀') ? 'text-yellow-300' :
                  log.includes('⚙️') || log.includes('🔗') || log.includes('🔍') ? 'text-blue-400' :
                  log.includes('📸') || log.includes('📥') ? 'text-cyan-400' :
                  log.includes('⚠️') ? 'text-amber-400' :
                  'text-slate-400'
                }`}>
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
          
          {!isLogExpanded && (
            <div className="flex-1 flex flex-col items-center justify-start pt-6 cursor-pointer" onClick={() => setIsLogExpanded(true)}>
              <span className="text-slate-600 font-semibold tracking-widest text-[10px]" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                실시간 파이프라인 로그
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
