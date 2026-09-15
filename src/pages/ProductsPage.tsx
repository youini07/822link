import { useEffect, useState, useRef } from 'react'
import { Package, Settings, ExternalLink, Loader2, TerminalSquare, Play, X, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

export default function ProductsPage() {
  const [sheetUrl, setSheetUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [terminalLogs, setTerminalLogs] = useState<string[]>([])
  const [deleteCode, setDeleteCode] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  
  const { uploadTarget } = useUIStore()

  // Listen to terminal logs
  useEffect(() => {
    if (window.electronAPI?.on) {
      window.electronAPI.on('batch:output', (log: string) => {
        setTerminalLogs((prev) => {
          const newLogs = [...prev, log]
          if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500)
          return newLogs
        })
      })
    }
    return () => {
      if (window.electronAPI?.removeListener) {
        window.electronAPI.removeListener('batch:output')
      }
    }
  }, [])

  // Auto-scroll terminal
  useEffect(() => {
    if (isTerminalOpen) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [terminalLogs, isTerminalOpen])

  const handleRunAutoSheet = async () => {
    setIsTerminalOpen(true)
    setTerminalLogs(prev => [...prev, '\n[시스템] 이미지 정리, 드라이브 업로드 및 오토시트 통합 실행 중...\n'])

    if (window.electronAPI?.batch) {
      await window.electronAPI.batch.runAutoSheet()
    }
  }

  const handleRunDataReflect = async () => {
    setIsTerminalOpen(true)
    setTerminalLogs(prev => [...prev, '\n[명령어] 데이터반영 실행 중...\n'])
    if (window.electronAPI?.batch) {
      await window.electronAPI.batch.runDataReflect()
    }
  }

  const handleDeleteEntirely = async () => {
    if (!deleteCode.trim()) {
      alert('삭제할 상품번호를 입력해주세요.');
      return;
    }
    
    // 콤마(,)로 구분된 여러 상품번호 처리
    const codes = deleteCode.split(',').map(c => c.trim()).filter(c => c);
    if (codes.length === 0) return;

    const confirmMsg = codes.length > 1 
      ? `[경고] 상품번호 ${codes.length}개 (${codes.join(', ')}) 를 정말로 일괄 완전 삭제하시겠습니까?\n\n이 작업은 구글 스프레드시트, 구글 드라이브 폴더, 그리고 PC에 저장된 로컬 이미지까지 모두 일괄 삭제하며 복구할 수 없습니다.`
      : `[경고] 상품번호 '${codes[0]}' 를 정말로 완전 삭제하시겠습니까?\n\n이 작업은 구글 스프레드시트, 구글 드라이브 폴더, 그리고 PC에 저장된 로컬 이미지까지 모두 일괄 삭제하며 복구할 수 없습니다.`;
      
    const confirmDelete = window.confirm(confirmMsg);
    if (!confirmDelete) return;

    setIsDeleting(true);
    setIsTerminalOpen(true);
    
    let successCount = 0;
    let failCount = 0;
    
    try {
      for (const code of codes) {
        setTerminalLogs(prev => [...prev, `\n[시스템] 상품번호 '${code}' 삭제 시작...`]);
        const result = await window.electronAPI.google.deleteProductEntirely(code, uploadTarget);
        if (result.success) {
          successCount++;
          setTerminalLogs(prev => [...prev, `[시스템] 상품번호 '${code}' 완전 삭제 완료.`]);
        } else {
          failCount++;
          setTerminalLogs(prev => [...prev, `[오류] 상품번호 '${code}' 삭제 실패: ${result.error}`]);
        }
      }
      
      const alertMsg = codes.length > 1
        ? `총 ${codes.length}개 중 ${successCount}개 삭제 성공, ${failCount}개 삭제 실패했습니다.`
        : (successCount > 0 ? `'${codes[0]}' 상품이 성공적으로 완전 삭제되었습니다.` : `삭제 중 오류가 발생했습니다.`);
        
      setDeleteCode('');
      
      // alert가 React 상태 업데이트(finally의 setIsDeleting)를 막는 현상 방지
      setTimeout(() => {
        alert(alertMsg);
      }, 100);
    } catch (error: any) {
      setTimeout(() => {
        alert(`시스템 오류: ${error.message}`);
      }, 100);
    } finally {
      setIsDeleting(false);
    }
  }

  useEffect(() => {
    const fetchUrl = async () => {
      try {
        if (window.electronAPI?.settings) {
          const key = uploadTarget === 'dreamstudio' ? 'googleSpreadsheetUrl_dreamstudio' : 'googleSpreadsheetUrl_822shop'
          let url = await window.electronAPI.settings.get(key)
          
          // Fallback to the generic spreadsheet URL set in SettingsPage
          if (!url) {
            url = await window.electronAPI.settings.get('googleSpreadsheetUrl')
          }
          
          setSheetUrl(url || null)
        }
      } catch (err) {
        console.error('스프레드시트 URL을 가져오는데 실패했습니다', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchUrl()
  }, [uploadTarget])

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
          <span>스프레드시트 정보를 불러오는 중...</span>
        </div>
      </div>
    )
  }

  // URL이 없는 경우 안내 화면
  if (!sheetUrl) {
    return (
      <div className="h-full flex flex-col p-8 bg-slate-900">
        <h2 className="text-xl font-bold text-slate-200">상품 관리</h2>
        <p className="text-sm mt-1 mb-8 text-slate-400">
          AI가 분석한 상품 데이터를 실시간으로 조회하고 편집합니다.
        </p>
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 border border-slate-700 rounded-xl shadow-lg shadow-black/20">
          <div className="text-center space-y-4 animate-fade-in p-8">
            <div className="mx-auto w-16 h-16 bg-blue-50 text-[#0078d4] rounded-full flex items-center justify-center mb-4">
              <Package size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-200">구글 스프레드시트가 연결되지 않았습니다</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              상품 정보를 실시간으로 관리하려면 먼저 설정 페이지에서 데이터베이스로 사용할 <strong>구글 스프레드시트 주소</strong>를 연동해 주세요.
            </p>
            <div className="pt-4">
              <Link 
                to="/settings"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-black/20"
              >
                <Settings size={16} />
                <span>설정으로 이동하여 URL 입력하기</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 구글 스프레드시트 Iframe 렌더링
  return (
    <div className="h-full flex flex-col bg-slate-800">
      {/* 커스텀 헤더바 (옵션) */}
      <div className="px-5 py-3 border-b border-slate-700 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-[#0078d4]" />
          <h2 className="text-sm font-bold text-slate-200">상품 관리 (Google Sheets)</h2>
        </div>
        <div className="flex items-center gap-2">
          
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-600 rounded-md px-2 py-1 mr-2 shadow-lg shadow-black/20">
            <input
              type="text"
              placeholder="삭제 상품번호 (예: 123,456)"
              value={deleteCode}
              onChange={(e) => setDeleteCode(e.target.value)}
              className="text-[12px] outline-none w-[150px] bg-transparent placeholder-slate-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDeleteEntirely();
              }}
            />
            <button
              onClick={handleDeleteEntirely}
              disabled={isDeleting}
              className={`flex items-center justify-center p-1 rounded-md transition-colors ${isDeleting ? 'text-slate-500 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}`}
              title="완전삭제"
            >
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>

          <button
            onClick={handleRunAutoSheet}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors px-3 py-1.5 rounded-md shadow-lg shadow-black/20"
          >
            <Play size={14} />
            <span>사입품목업로드</span>
          </button>
          <button
            onClick={handleRunDataReflect}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors px-3 py-1.5 rounded-md shadow-lg shadow-black/20"
          >
            <Play size={14} />
            <span>데이터반영 실행</span>
          </button>
          
          <div className="w-[1px] h-4 bg-slate-600 mx-1"></div>

          <a 
            href={sheetUrl} 
            target="_blank" 
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white transition-colors bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-700"
            title="새 창(브라우저)에서 열기"
          >
            <ExternalLink size={14} />
            <span>외부 브라우저에서 열기</span>
          </a>

          <button
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            className={`flex items-center gap-1.5 text-[12px] font-semibold transition-colors px-3 py-1.5 rounded-md border ${isTerminalOpen ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-700' : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-900'}`}
          >
            <TerminalSquare size={14} />
            <span>터미널</span>
          </button>
        </div>
      </div>
      
      {/* 메인 컨테이너 (Iframe + 터미널) */}
      <div className="flex-1 w-full bg-slate-900 relative flex overflow-hidden">
        
        {/* Iframe 컨테이너 */}
        <div className="flex-1 h-full relative">
          <iframe 
            src={sheetUrl} 
            className="absolute inset-0 w-full h-full border-none"
            title="Google Spreadsheet Products DB"
            allow="clipboard-read; clipboard-write"
          />
        </div>

        {/* 터미널 패널 */}
        {isTerminalOpen && (
          <div className="w-[400px] h-full bg-gray-900 border-l border-gray-700 flex flex-col shadow-xl z-10 shrink-0">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <TerminalSquare size={14} className="text-slate-500" />
                <span className="text-xs font-semibold text-gray-200">작업 내역 (터미널)</span>
              </div>
              <button 
                onClick={() => setTerminalLogs([])}
                className="text-slate-500 hover:text-white transition-colors text-xs mr-2 border border-gray-600 px-2 py-0.5 rounded"
              >
                지우기
              </button>
              <button 
                onClick={() => setIsTerminalOpen(false)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 bg-gray-900 font-mono text-xs text-gray-300 whitespace-pre-wrap break-all custom-scrollbar">
              {terminalLogs.length === 0 ? (
                <div className="text-slate-400 italic">대기 중...</div>
              ) : (
                terminalLogs.map((log, i) => (
                  <span key={i} className={log.includes('[ERROR]') ? 'text-red-400' : 'text-gray-300'}>
                    {log}
                  </span>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
