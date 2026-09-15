/**
 * 822 Link - 대시보드 페이지 (대표 이미지 지정 모드, 1+5 제품 그룹화, 드래그 앤 드롭 보정, AI 분석 시뮬레이터)
 * 
 * 왜 이렇게 설계했는가:
 * - 대표 이미지 지정 모드를 온오프하여 사용자가 직관적으로 첫 사진(대표)을 콕 집어 선택할 수 있도록 설계
 * - 선택된 대표를 기준으로 뒤따르는 5개 이미지가 테두리가 쳐진 1+5 고급 제품 블록을 즉시 형성
 * - HTML5 Native Drag & Drop API를 탑재하여 남거나 잘못 묶인 사진을 다른 제품 박스나 미분류 보관함으로 자유롭게 조율 가능
 * - AI 분석 버튼 클릭 시, 각 제품군 카드가 테두리 그라데이션 회전 효과와 함께 순차적으로 분석되며,
 *   누끼 완료 마스킹 및 입체 배경 합성 완료 화보가 썸네일에 실시간 갱신되는 극강의 몰입감 제공
 * - 진행 상태를 텍스트 타이핑 효과와 함께 보여주고, 우하단에 실시간 개발용 시스템 콘솔 뷰어를 장착하여 동작을 완벽히 투명하게 시각화
 */
import { useState, useEffect, useRef } from 'react'
import { 
  Image, 
  ImageOff, 
  CheckCircle2, 
  Clock, 
  Crown, 
  Play, 
  Pause,
  Square,
  Lock, 
  Unlock, 
  RotateCcw, 
  Info, 
  Check, 
  Terminal, 
  Move,
  Layers,
  Sparkles,
  Wand2,
  Trash2,
  Send
} from 'lucide-react'
import { useFileStore } from '../stores/fileStore'
import { useUIStore } from '../stores/uiStore'
import ConsoleLogViewer from '../components/ConsoleLogViewer'
import MeasuredSizeInputs from '../components/MeasuredSizeInputs'

function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return '0 KB'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  if (i === 0) return bytes + ' Bytes'
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

const SUB_LABELS = ['측면', '후면', '라벨(M)', '라벨(C)', '디테일']

export default function DashboardPage() {
  const { 
    files, 
    representativePaths, 
    isRepresentativeMode, 
    isConfirmed, 
    isAnalyzing, 
    analysisProgress,
    isPaused,
    isStopped,
    isTelegramActive,
    currentAnalyzingGroupId,
    enableRemoveBg,
    enableSynthesis,
    setRepresentativeMode,
    toggleRepresentative,
    swapRepresentative,
    swapFileOrder,
    moveFileToGroup,
    confirmGrouping,
    resetGrouping,
    startAIAnalysis,
    pauseAnalysis,
    stopAnalysis,
    resumeAnalysis,
    toggleRemoveBg,
    toggleSynthesis,
    updateMeasuredSize,
    setGroupSkipNukki,
    measuredSizes
  } = useFileStore()
  
  const { viewMode } = useUIStore()

  // 로컬 썸네일 이미지 로드 실패 상태 관리
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({})
  // 드래그 앤 드롭 시각 피드백 상태
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [activeDropGroupId, setActiveDropGroupId] = useState<string | null>(null)

  // 1. 앱 마운트 시 기존 감시 폴더 설정(localWatchPath / localImageWatchPath)을 불러와서 워처(Watcher) 명시적 재시작 요청
  // - main.ts의 ready-to-show 시점에 발송되는 file:initial 이벤트를 React 리스너 등록 전이라 놓치는 문제를 방지
  useEffect(() => {
    if (!window.electronAPI) return
    
    // 잃어버린 로컬 감시 이벤트 리스너(file:initial, file:added 등) 복구
    const cleanupFileListener = useFileStore.getState().initializeFileListener()
    
    // 우선 app-settings.json의 최신 키인 localImageWatchPath 확인
    window.electronAPI.settings.get('localImageWatchPath').then((path) => {
      if (path) {
        window.electronAPI.settings.set('localImageWatchPath', path)
      } else {
        // 없다면 레거시 키 확인
        window.electronAPI.settings.get('localWatchPath').then((legacyPath) => {
          if (legacyPath) window.electronAPI.settings.set('localWatchPath', legacyPath)
        })
      }
    })

    return () => {
      cleanupFileListener()
    }
  }, [])

  // 텔레그램 봇 연동 자동화 수신
  useEffect(() => {
    if (!window.electronAPI) return

    window.electronAPI.on('telegram:auto-start', (data: any) => {
      // 1.5초 안전 대기 시간을 부여하여 감시 폴더(Watcher)가 6장의 서브 이미지를 스토어에 온전히 등록할 시간을 줍니다.
      setTimeout(() => {
        const currentState = useFileStore.getState()
        
        // 텔레그램 진행 이미지 표시 활성화
        currentState.setTelegramActive(true)

        const repPath = data?.repPath
        const allPaths = data?.allPaths || []
        
        if (typeof repPath === 'string' && repPath) {
          // 1. 첫 번째 대표 이미지 경로를 대표 이미지 리스트에 강제 편입
          if (!currentState.representativePaths.includes(repPath)) {
            currentState.toggleRepresentative(repPath)
          }
          
          // 2. 방금 텔레그램으로 들어온 6장 전체 파일 중 대표를 제외한 나머지 파일들을 해당 그룹 ID로 쏙 정밀 배정! (광역 6장 묶기 간섭 차단)
          const groupId = `group_${repPath}`
          allPaths.forEach((filePath: string) => {
            if (filePath !== repPath) {
              currentState.moveFileToGroup(filePath, groupId)
            }
          })
          
          // 3. 정밀 바인딩이 완료되었으므로 그룹을 최종 확정 상태로 잠금!
          currentState.confirmGrouping(true)
        }
      }, 1500)
    })

    window.electronAPI.on('telegram:size-update', (sizeData: any) => {
      const currentState = useFileStore.getState()
      const reps = currentState.representativePaths
      if (sizeData && typeof sizeData === 'object' && reps.length > 0) {
        const repPath = reps[0]
        const groupId = `group_${repPath}`
        if (sizeData.width) currentState.updateMeasuredSize(groupId, 'width', sizeData.width)
        if (sizeData.length) currentState.updateMeasuredSize(groupId, 'length', sizeData.length)
      }
    })

    window.electronAPI.on('telegram:defect-update', (defectText: any) => {
      const currentState = useFileStore.getState()
      const reps = currentState.representativePaths
      if (typeof defectText === 'string' && reps.length > 0) {
        const repPath = reps[0]
        const groupId = `group_${repPath}`
        currentState.updateMeasuredSize(groupId, 'defect', defectText)
      }
    })

    // 신규 수신 리스너: 사용자가 텔레그램으로 상품 상태(Condition) 선택까지 마치면 비로소 전송 시동!
    window.electronAPI.on('telegram:condition-update', (conditionText: any) => {
      const currentState = useFileStore.getState()
      const reps = currentState.representativePaths
      if (typeof conditionText === 'string' && reps.length > 0) {
        const repPath = reps[0]
        const groupId = `group_${repPath}`
        currentState.updateMeasuredSize(groupId, 'condition', conditionText)
        
        // [중요 버그 해결] 텔레그램 백그라운드 직접 전산 파이프라인(executeDirectPipeline)이 백엔드에서 
        // 완벽하게 논스톱 직접 실행되므로, 프론트엔드 React 단에서 startAIAnalysis()를 중복 구동해
        // 이미지 다운로드 시퀀스를 가로채거나 꼬이게 만들던 충돌 코드를 완전히 제거합니다.
      }
    })

    // 백그라운드 다이렉트 전산 로그를 화면 우하단 콘솔 뷰어에 다이렉트 수송 연동
    window.electronAPI.on('telegram:direct-log', (logText: any) => {
      if (typeof logText === 'string') {
        useFileStore.getState().addConsoleLog(logText)
      }
    })

    // 백그라운드 다이렉트 전산 성공 시 화면 청소 및 리셋 연동
    window.electronAPI.on('telegram:direct-success', (finalCode: any) => {
      useFileStore.getState().addConsoleLog(`🎉 [다이렉트 완료] 전산 처리 모두 종료. [${finalCode}]`)
      useFileStore.getState().setTelegramActive(false)
      // 감시 폴더 이미지가 아카이빙 폴더로 이동했으므로 리셋을 가동하여 화면을 청소합니다.
      useFileStore.getState().resetGrouping()
    })

    window.electronAPI.on('telegram:direct-error', (errMsg: any) => {
      useFileStore.getState().addConsoleLog(`❌ [텔레그램 오류] ${errMsg}`)
      useFileStore.getState().setTelegramActive(false)
    })


    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeListener('telegram:auto-start')
        window.electronAPI.removeListener('telegram:size-update')
        window.electronAPI.removeListener('telegram:defect-update')
        window.electronAPI.removeListener('telegram:condition-update')
        window.electronAPI.removeListener('telegram:direct-log')
        window.electronAPI.removeListener('telegram:direct-success')
        window.electronAPI.removeListener('telegram:direct-error')
      }
    }
  }, [confirmGrouping, startAIAnalysis, updateMeasuredSize])

  const handleImgError = (filePath: string) => {
    setImgErrors((prev) => ({ ...prev, [filePath]: true }))
  }

  // 윈도우 로컬 경로를 커스텀 media:// 프로토콜 주소로 변환 (Hex 인코딩)
  const getImgSrc = (filePath: string) => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(filePath)
    let hex = ''
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0')
    }
    return `media://file?p=${hex}`
  }

  // 휴지통으로 영구 이동(삭제) 핸들러
  const handleTrashFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    if (isAnalyzing) return
    try {
      if (window.electronAPI?.file?.trash) {
        await window.electronAPI.file.trash(filePath)
      }
    } catch (err) {
      console.error('휴지통 이동 실패', err)
    }
  }

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent, path: string) => {
    if (isConfirmed) return
    e.dataTransfer.setData('text/plain', path)
    setDraggedPath(path)
  }

  // 번개장터 개별 업로드 상태 및 핸들러
  const [uploadProdCode, setUploadProdCode] = useState('')
  const [isUploadingBunjang, setIsUploadingBunjang] = useState(false)

  const handleBunjangUpload = async () => {
    if (!uploadProdCode) return alert('상품 코드를 입력해주세요.')
    setIsUploadingBunjang(true)
    
    const gsUrl = await window.electronAPI.settings.get('googleSpreadsheetUrl') || ''
    
    if (!gsUrl) {
      alert('스프레드시트 주소가 설정에 등록되지 않았습니다.')
      setIsUploadingBunjang(false)
      return
    }

    try {
      const res = await window.electronAPI.bunjang.uploadByCode({ prodCode: uploadProdCode, spreadsheetUrl: gsUrl })
      if (!res.success) throw new Error(res.error)
      alert(`[${uploadProdCode}] 번개장터 다이렉트 업로드 성공!`)
    } catch (err: any) {
      alert(`업로드 실패: ${err.message}`)
    } finally {
      setIsUploadingBunjang(false)
    }
  }

  const handleDragOver = (e: React.DragEvent, groupId: string | undefined) => {
    if (isConfirmed) return
    e.preventDefault()
    setActiveDropGroupId(groupId || 'unclassified')
  }

  const handleDragLeave = () => {
    setActiveDropGroupId(null)
  }

  const handleDrop = (e: React.DragEvent, targetGroupId: string | undefined) => {
    if (isConfirmed) return
    e.preventDefault()
    const path = e.dataTransfer.getData('text/plain') || draggedPath
    if (path) {
      moveFileToGroup(path, targetGroupId)
    }
    setDraggedPath(null)
    setActiveDropGroupId(null)
  }

  const handleDragOverRep = (e: React.DragEvent) => {
    if (isConfirmed) return
    e.preventDefault()
    e.stopPropagation() // 그룹 드롭 이벤트와 분리
  }

  const handleDropRep = (e: React.DragEvent, oldRepPath: string) => {
    if (isConfirmed) return
    e.preventDefault()
    e.stopPropagation()
    const draggedPath = e.dataTransfer.getData('text/plain')
    if (draggedPath && draggedPath !== oldRepPath) {
      swapRepresentative(oldRepPath, draggedPath)
    }
    setActiveDropGroupId(null)
  }

  const handleDropSubImage = (e: React.DragEvent, targetFilePath: string, targetGroupId: string | undefined) => {
    if (isConfirmed) return
    e.preventDefault()
    e.stopPropagation()
    const dropPath = e.dataTransfer.getData('text/plain') || draggedPath
    if (dropPath && dropPath !== targetFilePath) {
      swapFileOrder(dropPath, targetFilePath)
    }
    setDraggedPath(null)
    setActiveDropGroupId(null)
  }

  // 이미지 파일만 필터링
  const imageFiles = files.filter(f => f.type.includes('이미지'))
  
  // 그룹 매핑된 이미지들
  const groupedImages = imageFiles.filter(f => f.groupId !== undefined)
  // 그룹 미분류 이미지들
  const unclassifiedImages = imageFiles.filter(f => f.groupId === undefined)

  // 대표 이미지 경로 목록을 기준으로 고유 제품 그룹 리스트 구성
  const productGroups = representativePaths.map((repPath, index) => {
    const groupId = `group_${repPath}`
    const groupMembers = imageFiles.filter(f => f.groupId === groupId)
    
    // 대표 이미지가 첫 번째로 오도록 정렬 (대표 이미지가 맨 앞)
    const sortedMembers = [...groupMembers].sort((a, b) => {
      if (a.isRepresentative) return -1
      if (b.isRepresentative) return 1
      return a.timestamp - b.timestamp
    })

    return {
      groupId,
      repPath,
      repFile: files.find(f => f.path === repPath),
      members: sortedMembers,
      index: index + 1
    }
  }).sort((a, b) => (a.repFile?.timestamp || 0) - (b.repFile?.timestamp || 0))

  // 전체 요약 계산
  const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0)
  const formattedTotalSize = formatBytes(totalSizeBytes)

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-100 text-sm select-none p-2 gap-2 overflow-hidden">
      
      {/* ────────────────────────────────────────────── */}
      {/* 1. 제품 이미지 대시보드 전용 스마트 컨트롤 헤더 */}
      {/* ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl shadow-lg shadow-black/20 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-[#0078d4]/10 p-2.5 rounded-lg text-[#0078d4]">
            <Layers size={22} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-200 tracking-tight">AI 1+5 이미지 그룹화 & 분석 터미널</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">첫 대표 사진을 클릭해 지정하면 뒤따르는 5장의 제품 사진이 자동 묶음 형성됩니다.</p>
          </div>
        </div>

        {/* 컨트롤 버튼 모음 */}
        <div className="flex items-center gap-4">
          {/* A. 대표 지정 모드 토글 */}
          <button
            onClick={() => !isConfirmed && setRepresentativeMode(!isRepresentativeMode)}
            disabled={isConfirmed || isAnalyzing}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-semibold border transition-all ${
              isRepresentativeMode
                ? 'bg-[#0078d4] text-white border-transparent shadow-md shadow-blue-500/20 scale-105 animate-bounce-subtle'
                : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-900 hover:border-gray-400'
            } ${isConfirmed || isAnalyzing ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Crown size={15} className={isRepresentativeMode ? 'fill-white' : ''} />
            <span>대표 이미지 지정 {isRepresentativeMode ? '중...' : '모드'}</span>
          </button>

          {/* B. 초기화 */}
          <button
            onClick={resetGrouping}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-semibold text-slate-400 bg-slate-800 border border-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="그룹 공장초기화 원복"
          >
            <RotateCcw size={14} />
            <span>재설정</span>
          </button>

          {/* B-2. AI 자동 6장 묶기 */}
          <button
            onClick={useFileStore.getState().autoGroupBySix}
            disabled={isConfirmed || isAnalyzing}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-semibold text-purple-300 bg-purple-900/40 border border-purple-700/50 hover:bg-purple-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-black/20"
            title="미분류 이미지를 생성 시간 순으로 6장씩 자동 묶습니다"
          >
            <Wand2 size={14} />
            <span>AI 자동 6장 묶기</span>
          </button>

          {/* C. 그룹화 확정 */}
          {isConfirmed ? (
            <button
              onClick={() => !isAnalyzing && confirmGrouping(false)}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-xs font-semibold text-[#107c10] bg-[#107c10]/10 border border-[#107c10]/30 hover:bg-[#107c10]/20 transition-all disabled:opacity-40"
            >
              <Lock size={14} />
              <span>그룹 확정 상태 (보정하려면 클릭)</span>
            </button>
          ) : (
            <button
              onClick={() => representativePaths.length > 0 && confirmGrouping(true)}
              disabled={representativePaths.length === 0}
              className={`flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-xs font-semibold text-white transition-all ${
                representativePaths.length > 0
                  ? 'bg-[#107c10] hover:bg-[#0b590b] shadow-md shadow-green-500/10'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              <Unlock size={14} />
              <span>현재 그룹 배치 확정</span>
            </button>
          )}

          {/* D. AI 순차 분석 및 전송 시작 / 제어 버튼 */}
          {!isAnalyzing && !isPaused ? (
            <button
              onClick={startAIAnalysis}
              disabled={!isConfirmed || isStopped}
              className={`flex items-center gap-2 px-7 py-2.5 rounded-lg text-xs font-bold text-white transition-all ${
                isConfirmed && !isStopped
                  ? 'bg-gradient-to-r from-[#0078d4] to-[#106ebe] hover:from-[#106ebe] hover:to-[#005a9e] shadow-md shadow-blue-500/20 scale-105'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              <Play size={14} className="fill-white" />
              <span>AI 분석 및 자동 구글연동 시작</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-lg">
              {/* 일시중지 / 다시진행 */}
              {!isPaused ? (
                <button
                  onClick={pauseAnalysis}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition-colors shadow-lg shadow-black/20"
                >
                  <Pause size={14} className="fill-white" />
                  <span>일시중지</span>
                </button>
              ) : (
                <button
                  onClick={resumeAnalysis}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-[#107c10] hover:bg-[#0b590b] text-white transition-colors shadow-lg shadow-black/20"
                >
                  <Play size={14} className="fill-white" />
                  <span>다시 진행</span>
                </button>
              )}

              {/* 작업 종료 */}
              <button
                onClick={stopAnalysis}
                className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors shadow-lg shadow-black/20"
              >
                <Square size={14} className="fill-white" />
                <span>작업종료</span>
              </button>

              <div className="px-3 py-1 flex items-center gap-2 text-xs font-semibold text-slate-300">
                {!isPaused && <Clock size={14} className="animate-spin text-blue-600" />}
                <span>{isPaused ? '대기 중' : '처리 중'} ({analysisProgress}%)</span>
              </div>
            </div>
          )}
        </div>
        
      </div>

      {/* 대표 이미지 지정 모드 헬퍼 가이드 배너 */}
      {isRepresentativeMode && (
        <div className="bg-gradient-to-r from-blue-50 to-[#e9f2fc] border border-blue-200 rounded-xl px-8 py-3 flex items-center gap-2.5 text-xs text-[#0078d4] animate-fade-in shrink-0 shadow-lg shadow-black/20">
          <Crown size={15} className="fill-[#0078d4] animate-bounce-subtle" />
          <span className="font-semibold">대표 이미지 지정 모드 활성화됨:</span>
          <span>대시보드 아래의 사진들 중에서 각 제품 촬영의 첫 번째 메인 대표 사진을 클릭해 지정해주세요. 즉각 뒤의 5장과 자동 그룹 매핑됩니다.</span>
        </div>
      )}

      {/* ────────────────────────────────────────────── */}
      {/* 2. 대시보드 뷰포트 영역 (그룹 매핑 블록 & 미분류) */}
      {/* ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row gap-2 min-h-0">
        
        {/* 좌측 메인 영역: 1+5 제품군 그룹 리스트 */}
        <div className="flex-[5.5] flex flex-col gap-4 min-w-0 bg-slate-800 border border-slate-600 rounded-xl shadow-lg shadow-black/20 p-6 overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
              <Layers size={16} className="text-slate-400" />
              <span>제품 그룹화 블록 ({productGroups.length}개 제품군 형성)</span>
            </h2>
            {representativePaths.length > 0 && (
              <span className="text-[10px] font-semibold text-[#107c10] bg-[#107c10]/10 px-2 py-0.5 rounded-full">
                정상 연동 상태
              </span>
            )}
          </div>

          {files.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-700 bg-slate-800 rounded-xl p-8 text-center text-slate-500">
              <ImageOff size={44} className="text-gray-300 mb-3" />
              <p className="font-bold text-sm text-slate-400">감시 폴더 내에 감지된 이미지가 없습니다.</p>
              <p className="text-xs text-slate-500 mt-1">설정 페이지에서 제품 이미지 폴더를 연동해 주세요.</p>
            </div>
          ) : isTelegramActive ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-[#0078d4]/30 bg-[#f8fbff] rounded-xl p-8 text-center shadow-inner">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-black/20">
                <Send className="text-[#0078d4] animate-bounce" size={32} />
              </div>
              <h2 className="text-lg font-bold text-slate-200 mb-2">스마트폰 원격 연동 중</h2>
              <p className="text-sm text-slate-400 font-medium">
                텔레그램을 통한 AI 전산 파이프라인이 다이렉트로 가동되고 있습니다.
              </p>
              <div className="mt-4 bg-slate-800 px-4 py-2 rounded-lg border border-blue-200 shadow-lg shadow-black/20 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-slate-400">우측 하단의 시스템 로그를 확인해 주세요.</span>
              </div>
            </div>
          ) : productGroups.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-[#0078d4]/30 bg-slate-800 rounded-xl p-8 text-center">
              <Crown size={48} className="text-[#0078d4]/20 mb-3 animate-pulse" />
              <p className="font-bold text-sm text-slate-300">그룹핑이 시작되지 않았습니다.</p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm leading-relaxed">
                우측 상단의 <strong className="text-[#0078d4]">👑 대표 이미지 지정 모드</strong>를 켠 다음, 아래 사진들 중 제품별 메인 사진들을 하나씩 클릭하여 제품군 세트를 빠르게 형성해 보세요!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto pr-1">
              {productGroups.map((group) => {
                const isTargetAnalyzing = currentAnalyzingGroupId === group.groupId
                const isGroupCompleted = group.members.every(m => m.status === 'completed')
                const isGroupProcessing = group.members.some(m => m.status === 'processing')

                return (
                  <div
                    key={group.groupId}
                    onDragOver={(e) => handleDragOver(e, group.groupId)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, group.groupId)}
                    className={`relative bg-slate-800 border rounded-xl p-6 transition-all duration-300 ${
                      isTargetAnalyzing 
                        ? 'border-2 border-[#0078d4] shadow-lg shadow-blue-500/10 ring-2 ring-blue-400/20 scale-[1.01]' 
                        : isGroupCompleted
                        ? 'border-2 border-[#107c10] shadow-lg shadow-black/20 bg-green-50/5'
                        : activeDropGroupId === group.groupId
                        ? 'border-2 border-dashed border-[#0078d4] bg-[#e9f2fc]/50 scale-[1.01]'
                        : 'border-slate-700/90 shadow-lg shadow-black/20 hover:shadow-md hover:border-slate-600'
                    }`}
                  >
                    {/* 상단 타이틀 바 */}
                    <div className="flex items-center justify-between mb-3 border-b border-slate-700 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-bold shadow-lg shadow-black/20">
                          {group.index}
                        </span>
                        <h3 className="font-bold text-slate-300 text-sm">
                          제품 코드군 (순차 코드: <span className="text-[#0078d4] font-semibold">{group.members[0]?.prodCode || '대기 중'}</span>)
                        </h3>
                        <span className="text-[11px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded font-semibold">
                          이미지 {group.members.length}개
                        </span>
                        {/* 개별 그룹 누끼 패스 토글 (큰 로고 등 누끼가 잘못될 때 사용) */}
                        <label className="flex items-center gap-1.5 ml-3 bg-red-50 text-red-600 px-2.5 py-1 rounded-md border border-red-100 cursor-pointer hover:bg-red-100 transition-colors">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 accent-red-500 rounded cursor-pointer"
                            checked={!!measuredSizes[group.groupId]?.skipNukki}
                            onChange={(e) => setGroupSkipNukki(group.groupId, e.target.checked)}
                            disabled={isTargetAnalyzing || isGroupCompleted || isGroupProcessing}
                          />
                          <span className="text-xs font-bold">누끼 패스(원본 유지)</span>
                        </label>
                      </div>
                      
                      {/* 그룹 상태 뱃지 */}
                      <div className="flex items-center gap-2">
                        {isTargetAnalyzing && (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-[#0078d4] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full animate-pulse">
                            <Sparkles size={11} className="animate-spin text-[#0078d4]" />
                            AI 가공 진행 중...
                          </span>
                        )}
                        {isGroupCompleted && (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-[#107c10] bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full">
                            <CheckCircle2 size={11} />
                            구글 드라이브 업로드 완료
                          </span>
                        )}
                        {!isTargetAnalyzing && !isGroupCompleted && !isGroupProcessing && (
                          <span className="text-[11px] font-semibold text-slate-500 bg-slate-900 border border-slate-700 px-2.5 py-0.5 rounded-full">
                            보정 대기 중
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 블록 본문 레이아웃 (1+5 구조 구현) */}
                    <div className="flex flex-col sm:flex-row gap-6 w-full">
                      {/* [4] 좌측: 1번 대표 메인 이미지 (가장 큼) */}
                      <div 
                        className="w-full xl:w-44 flex flex-col items-center bg-slate-900 border border-slate-700/80 rounded-xl p-3 relative group/head shrink-0 shadow-inner transition-colors hover:bg-blue-50/30"
                        onDragOver={handleDragOverRep}
                        onDrop={(e) => handleDropRep(e, group.repFile?.path || '')}
                      >
                        <div className="w-28 h-28 xl:w-36 xl:h-36 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden relative shadow-lg shadow-black/20">
                          {group.repFile && !imgErrors[group.repFile.path] ? (
                            <img
                              src={getImgSrc(group.repFile.path)}
                              alt="대표 이미지"
                              onError={() => handleImgError(group.repPath)}
                              className="w-full h-full object-cover transition-transform group-hover/head:scale-105"
                            />
                          ) : (
                            <Image size={32} className="text-[#0078d4]" />
                          )}
                          <div className="absolute top-1 left-1 bg-[#0078d4] text-white rounded-md p-1 shadow-md scale-95 flex items-center gap-0.5 font-bold text-[9px]">
                            <Crown size={10} className="fill-white" />
                            <span>대표</span>
                          </div>
                          
                          {/* AI 분석 가상 데이터 연출 */}
                          {group.members[0]?.hasCleaned && (
                            <div className="absolute bottom-1 left-1 right-1 bg-green-600/90 text-white rounded py-0.5 text-[8px] font-bold shadow text-center animate-fade-in">
                              누끼완료
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-center w-full min-w-0">
                          <span className="text-[11px] font-bold text-slate-200 truncate block px-1" title={group.repFile?.name}>
                            {group.repFile?.name}
                          </span>
                          <span className="text-[9px] text-slate-500 block mt-0.5 font-medium">{formatBytes(group.repFile?.size || 0)}</span>
                          <span className="text-[12px] font-extrabold text-slate-200 block mt-2 tracking-widest">메인</span>
                        </div>
                      </div>

                      {/* [5] 우측: 서브 이미지 리스트 그리드 */}
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="text-[11px] font-bold text-slate-500 tracking-wider mb-2 uppercase flex items-center gap-1">
                            <Move size={11} className="text-slate-500" />
                            <span>서브 상세 이미지 리스트 (드래그 앤 드롭 이동 가능)</span>
                          </div>
                          
                          <div className={viewMode === 'details' ? 'flex flex-col gap-1.5' : 'grid grid-cols-4 sm:grid-cols-6 gap-3'}>
                            {/* 대표를 제외한 서브 멤버들 렌더링 */}
                            {group.members.filter(m => !m.isRepresentative).map((file, idx) => {
                              const isImgErr = imgErrors[file.path]
                              const labelText = SUB_LABELS[idx] || `서브 ${idx + 1}`
                              
                              if (viewMode === 'details') {
                                return (
                                  <div key={file.id} className="flex items-center gap-3 w-full">
                                    <div className="w-16 text-right text-[12px] font-bold text-slate-300 shrink-0">{labelText}</div>
                                    <div
                                      draggable={!isConfirmed}
                                      onDragStart={(e) => handleDragStart(e, file.path)}
                                      onDragOver={handleDragOverRep}
                                      onDrop={(e) => handleDropSubImage(e, file.path, group.groupId)}
                                      className={`flex-1 flex items-center gap-3 p-1.5 bg-slate-800 border border-slate-700 rounded-lg group shadow-lg shadow-black/20 transition-all ${
                                        isConfirmed ? 'cursor-default' : 'cursor-grab active:cursor-grabbing hover:bg-blue-50/50 hover:border-[#a3c9f7]'
                                      }`}
                                    >
                                    <div className="w-9 h-9 shrink-0 flex items-center justify-center bg-slate-900 border border-slate-700 rounded overflow-hidden relative">
                                      {!isImgErr ? (
                                        <img src={getImgSrc(file.path)} alt={file.name} onError={() => handleImgError(file.path)} className="w-full h-full object-cover" />
                                      ) : <Image size={14} className="text-slate-500" />}
                                    </div>
                                    <div className="flex-1 flex items-center min-w-0 pr-2">
                                      <div className="w-1/3 truncate text-[11px] font-semibold text-slate-300 pr-2" title={file.name}>{file.name}</div>
                                      <div className="w-1/3 truncate text-[10px] text-slate-500 pr-2">{new Date(file.timestamp).toLocaleString()}</div>
                                      <div className="w-1/6 truncate text-[10px] text-slate-500 pr-2">{file.type || 'JPG 파일'}</div>
                                      <div className="w-1/6 truncate text-[10px] text-slate-500 text-right">{formatBytes(file.size)}</div>
                                    </div>
                                    {!isConfirmed && (
                                      <Move size={13} className="text-gray-300 opacity-0 group-hover:opacity-100 mr-2" />
                                    )}
                                  </div>
                                  </div>
                                )
                              }

                              return (
                                <div key={file.id} className="flex flex-col items-center gap-1 w-full">
                                  <div
                                    draggable={!isConfirmed}
                                    onDragStart={(e) => handleDragStart(e, file.path)}
                                    onDragOver={handleDragOverRep}
                                    onDrop={(e) => handleDropSubImage(e, file.path, group.groupId)}
                                    className={`w-full flex flex-col items-center p-2 bg-slate-800 border border-slate-700 rounded-xl relative group shadow-lg shadow-black/20 transition-all ${
                                      isConfirmed 
                                        ? 'cursor-default' 
                                        : 'cursor-grab active:cursor-grabbing hover:bg-blue-50/50 hover:border-[#a3c9f7]'
                                    }`}
                                  >
                                  <div className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden relative">
                                    {!isImgErr ? (
                                      <img
                                        src={getImgSrc(file.path)}
                                        alt={file.name}
                                        onError={() => handleImgError(file.path)}
                                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                      />
                                    ) : (
                                      <Image size={20} className="text-slate-500" />
                                    )}
                                    
                                    {/* 드래그 가능 시각화 오버레이 */}
                                    {!isConfirmed && (
                                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 flex items-center justify-center transition-colors">
                                        <Move size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-[10px] font-semibold text-slate-300 truncate w-full text-center mt-1.5 px-0.5" title={file.name}>
                                    {file.name}
                                  </span>
                                  </div>
                                  <span className="text-[11px] font-extrabold text-slate-200 mt-1">{labelText}</span>
                                </div>
                              )
                            })}
                            
                            {/* 서브 이미지가 하나도 없을 때의 가이드 */}
                            {group.members.length <= 1 && (
                              <div className="col-span-3 sm:col-span-5 h-20 flex flex-col items-center justify-center border border-dashed border-slate-700 rounded-xl text-slate-500 bg-slate-900/30 text-xs">
                                <span>서브 이미지가 아직 배정되지 않았습니다.</span>
                                <span className="text-[10px] text-slate-500/80 mt-0.5">우측 미분류 이미지를 이곳으로 드래그해 넣으세요!</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 실측 사이즈 수동 입력란 (isConfirmed 시에만 활성화됨) */}
                        {isConfirmed && group.groupId && (
                          <MeasuredSizeInputs
                            groupId={group.groupId}
                            isAnalyzing={isAnalyzing}
                          />
                        )}

                        {/* AI 생성 제품 데이터 카드 정보 연출 */}
                        {group.members[0]?.aiTitle && (
                          <div className="mt-5 bg-[#e9f2fc]/50 border border-[#0078d4]/10 rounded-xl p-5 animate-fade-in">
                            <div className="flex items-center gap-2 text-xs font-bold text-[#0078d4] mb-3">
                              <Sparkles size={13} className="text-[#0078d4]" />
                              <span>AI 메타데이터 분석 결과</span>
                              {group.members[0]?.hasSynthesized && (
                                <span className="ml-auto text-[9px] font-bold text-[#107c10] bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                                  배경합성 완료
                                </span>
                              )}
                            </div>
                            <div className="text-xs space-y-1.5 text-slate-300">
                              <div><span className="font-semibold text-slate-500 w-16 inline-block">카테고리:</span> {group.members[0].aiCategory}</div>
                              <div className="flex"><span className="font-semibold text-slate-500 w-16 shrink-0">생성 제목:</span> <span className="flex-1 break-words">{group.members[0].aiTitle}</span></div>
                              <div className="flex"><span className="font-semibold text-slate-500 w-16 shrink-0">제품 설명:</span> <div className="flex-1 break-words whitespace-pre-wrap max-h-24 overflow-y-auto pr-2 custom-scrollbar">{group.members[0].aiDescription}</div></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 우측 영역: 미분류 이미지 보관함 및 AI 진행로그 */}
        <div className="w-full md:w-96 flex flex-col gap-2 shrink-0 min-h-0">
          
          {/* 미분류 이미지 보관함 */}
          <div
            onDragOver={(e) => handleDragOver(e, undefined)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, undefined)}
            className={`flex-1 flex flex-col bg-slate-800 border rounded-xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 min-h-[250px] ${
              activeDropGroupId === 'unclassified'
                ? 'border-2 border-dashed border-red-400 bg-red-50/20 scale-[1.01]'
                : 'border-slate-700'
            }`}
          >
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-700 flex items-center justify-between shrink-0">
              <span className="font-bold text-slate-300 text-xs flex items-center gap-1.5">
                <Info size={14} className="text-slate-400" />
                <span>미분류 대기 이미지 ({unclassifiedImages.length}개)</span>
              </span>
              {unclassifiedImages.length > 0 && !isConfirmed && (
                <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                  {isRepresentativeMode ? '대표선택' : '드래그가능'}
                </span>
              )}
            </div>

            {unclassifiedImages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                <Check size={28} className="text-green-500 mb-2 bg-green-50 p-1 rounded-full border border-green-200" />
                <p className="font-bold text-xs text-slate-400">모든 이미지가 그룹에 배정됨</p>
                <p className="text-[10px] text-slate-500 mt-0.5">남은 미분류 이미지가 없습니다.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 bg-slate-900/20">
                <div className={viewMode === 'details' ? 'flex flex-col gap-1.5' : 'grid gap-2.5 grid-cols-4 sm:grid-cols-5'}>
                  {unclassifiedImages.map((file) => {
                    const isImgErr = imgErrors[file.path]
                    const isRepModeActive = isRepresentativeMode && !isConfirmed
                    
                    if (viewMode === 'details') {
                      return (
                        <div
                          key={file.id}
                          draggable={!isConfirmed && !isRepresentativeMode}
                          onDragStart={(e) => handleDragStart(e, file.path)}
                          onClick={() => isRepModeActive && toggleRepresentative(file.path)}
                          className={`flex items-center gap-3 p-1.5 rounded-lg border bg-slate-800 relative transition-all group ${
                            isRepModeActive 
                              ? 'cursor-pointer border-blue-200 hover:border-blue-500 hover:bg-blue-50/70 shadow-lg shadow-black/20' 
                              : isConfirmed 
                              ? 'cursor-default border-slate-700'
                              : 'cursor-grab active:cursor-grabbing border-slate-700 hover:bg-blue-50/40 hover:border-blue-200 hover:shadow-lg shadow-black/20'
                          }`}
                        >
                          <div className="w-9 h-9 shrink-0 flex items-center justify-center bg-slate-900 border border-slate-700/80 rounded overflow-hidden relative">
                            {!isImgErr ? (
                              <img src={getImgSrc(file.path)} alt={file.name} onError={() => handleImgError(file.path)} className="w-full h-full object-cover" />
                            ) : <Image size={14} className="text-slate-500" />}
                            {isRepModeActive && (
                              <div className="absolute inset-0 bg-blue-500/10 hover:bg-blue-500/20 flex items-center justify-center transition-colors">
                                <Crown size={12} className="text-white fill-[#0078d4] animate-bounce-subtle" />
                              </div>
                            )}
                          </div>
                          
                          <div className="flex-1 flex items-center min-w-0 pr-8">
                            <div className="w-1/3 truncate text-[11px] font-semibold text-slate-300 pr-2" title={file.name}>{file.name}</div>
                            <div className="w-1/3 truncate text-[10px] text-slate-500 pr-2">{new Date(file.timestamp).toLocaleString()}</div>
                            <div className="w-1/6 truncate text-[10px] text-slate-500 pr-2">{file.type || 'JPG 파일'}</div>
                            <div className="w-1/6 truncate text-[10px] text-slate-500 text-right">{formatBytes(file.size)}</div>
                          </div>

                          {!isConfirmed && (
                            <button
                              onClick={(e) => handleTrashFile(e, file.path)}
                              className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white rounded transition-all"
                              title="휴지통으로 이동"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )
                    }

                    return (
                      <div
                        key={file.id}
                        draggable={!isConfirmed && !isRepresentativeMode}
                        onDragStart={(e) => handleDragStart(e, file.path)}
                        onClick={() => isRepModeActive && toggleRepresentative(file.path)}
                        className={`flex flex-col items-center p-2 rounded-xl border bg-slate-800 relative transition-all group ${
                          isRepModeActive 
                            ? 'cursor-pointer border-blue-200 hover:border-blue-500 hover:bg-blue-50/70 hover:scale-105 shadow-lg shadow-black/20' 
                            : isConfirmed 
                            ? 'cursor-default border-slate-700'
                            : 'cursor-grab active:cursor-grabbing border-slate-700 hover:bg-blue-50/40 hover:border-blue-200 hover:shadow'
                        }`}
                      >
                        <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center bg-slate-900 border border-slate-700/80 rounded-lg overflow-hidden relative">
                          {!isImgErr ? (
                            <img
                              src={getImgSrc(file.path)}
                              alt={file.name}
                              onError={() => handleImgError(file.path)}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Image size={18} className="text-slate-500" />
                          )}
                          
                          {/* 대표 지정 모드 시 호버 가이드 및 뱃지 */}
                          {isRepModeActive && (
                            <div className="absolute inset-0 bg-blue-500/10 hover:bg-blue-500/20 flex items-center justify-center transition-colors">
                              <Crown size={16} className="text-white fill-[#0078d4] drop-shadow-md animate-bounce-subtle" />
                            </div>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-300 truncate w-full text-center mt-1 px-0.5 font-medium" title={file.name}>
                          {file.name}
                        </span>

                        {!isConfirmed && (
                          <button
                            onClick={(e) => handleTrashFile(e, file.path)}
                            className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 p-1 bg-slate-800 border border-red-200 text-red-500 hover:bg-red-500 hover:text-white rounded-full shadow-lg shadow-black/20 transition-all"
                            title="휴지통으로 이동"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* AI 진행 로그 터미널 창 (리렌더링 격리 최적화 컴포넌트) */}
          <ConsoleLogViewer />

        </div>
      </div>

      {/* ────────────────────────────────────────────── */}
      {/* 3. 윈도우 스타일 탐색기 하단 상태 표시줄 */}
      {/* ────────────────────────────────────────────── */}
      <div className="px-6 py-2 bg-slate-900 border-t border-slate-600 text-xs text-slate-400 flex justify-between font-medium shrink-0">
        <div className="flex items-center gap-4">
          <span>전체 파일: {files.length}개 항목</span>
          <span>감시 폴더 이미지: {imageFiles.length}장 감지</span>
          <span>그룹 배정: {groupedImages.length}장 / 미분류: {unclassifiedImages.length}장</span>
        </div>
        <span>총 업로드 감시 용량: {formattedTotalSize}</span>
      </div>
    </div>
  )
}
