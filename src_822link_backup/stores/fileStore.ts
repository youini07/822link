/**
 * 822 Link - 로컬 파일 목록 및 제품 그룹화/AI 분석 상태 관리 스토어 (Zustand)
 * 
 * 왜 이렇게 설계했는가:
 * - 사용자가 콕 집어 선택한 "대표 이미지"를 기준으로 시간상 뒤따르는 5개의 이미지를 자동 세트 그룹화
 * - 드래그 앤 드롭을 통한 수동 보정 액션을 실시간 전역 상태와 직접 연동
 * - 그룹화 확정 및 1부터 순차적으로 제품 코드를 발급하는 AI 분석 및 구글드라이브 업로드 프로세스의 가상 시뮬레이션 구동
 * - 순차적 상태 변화(pending -> processing -> completed)와 AI 가공 데이터(제목, 설명, 누끼, 합성) 바인딩 지원
 */
import { create } from 'zustand'
import { useUIStore } from './uiStore'

export interface FileItem {
  id: string
  name: string
  path: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  platform: string
  size: number
  date: string
  type: string
  timestamp: number             // 시간순 1+5 그룹화를 위한 원천 타임스탬프 (ms)
  groupId?: string              // 묶인 제품 그룹 ID ("group_대표이미지경로")
  isRepresentative?: boolean    // 사용자가 지정한 메인 대표 이미지 여부
  
  // AI 분석 가공 데이터 (시뮬레이션 바인딩용)
  aiTitle?: string              // AI 추천 업로드 제목
  aiDescription?: string        // AI 생성 제품 상세 설명
  aiCategory?: string           // AI 자동 분류 카테고리
  prodCode?: string             // 생성된 순차 제품 코드 (예: "PROD-001")
  hasCleaned?: boolean          // 누끼(배경 제거) 완료 여부
  hasSynthesized?: boolean      // 가상 합성 이미지 생성 완료 여부
}

// 대표 이미지 기준 1+5 이미지 그룹화 핵심 알고리즘
const groupImagesByRepresentative = (
  files: FileItem[],
  representativePaths: string[]
): FileItem[] => {
  const imageFiles = files.filter((f) => f.type.includes('이미지'))
  const nonImageFiles = files.filter((f) => !f.type.includes('이미지'))
  
  // 모든 이미지 파일을 타임스탬프 오름차순으로 정렬
  const sortedImages = [...imageFiles].sort((a, b) => a.timestamp - b.timestamp)
  const repSet = new Set(representativePaths)

  // 1. 모든 이미지의 그룹 매핑 초기화
  const resetImages: FileItem[] = sortedImages.map((f) => ({
    ...f,
    isRepresentative: repSet.has(f.path),
    groupId: undefined,
  }))

  // 2. 대표 이미지를 시간 오름차순으로 정렬
  const sortedReps = [...representativePaths].sort((a, b) => {
    const fileA = files.find((f) => f.path === a)
    const fileB = files.find((f) => f.path === b)
    return (fileA?.timestamp || 0) - (fileB?.timestamp || 0)
  })

  // 3. 각 대표 이미지마다 차례대로 1+5 탐색 시작
  sortedReps.forEach((repPath) => {
    const groupId = `group_${repPath}`
    const headIdx = resetImages.findIndex((f) => f.path === repPath)
    if (headIdx === -1) return

    // 대표 이미지 본인에게 그룹 아이디 할당
    resetImages[headIdx].groupId = groupId

    // 헤드 바로 뒤의 파일 중 '다른 대표 이미지가 아닌' 사진을 최대 5장까지 납치
    let count = 0
    for (let i = headIdx + 1; i < resetImages.length; i++) {
      if (count >= 5) break

      // 다른 대표 이미지 장벽을 만나면 탐색 중단 (그룹 침범 방지)
      if (resetImages[i].isRepresentative) {
        break
      }

      // 아직 아무 그룹에도 들어가지 않은 상태인 경우에만 편입
      if (!resetImages[i].groupId) {
        resetImages[i].groupId = groupId
        count++
      }
    }
  })

  return [...resetImages, ...nonImageFiles]
}

interface FileState {
  files: FileItem[]
  representativePaths: string[]
  isRepresentativeMode: boolean // 대표 이미지 지정 모드 스위치
  isConfirmed: boolean          // 그룹 최종 확정 여부
  isAnalyzing: boolean          // AI 분석 실행 중인지 여부
  analysisProgress: number      // 전체 분석 진행률 (0-100)
  currentAnalyzingGroupId: string | null // 현재 처리 중인 제품군 ID
  isPaused: boolean             // 일시중지 여부
  isStopped: boolean            // 작업종료 여부
  isTelegramActive: boolean     // 텔레그램 진행 여부
  consoleLogs: string[]         // 우하단 AI 진행 콘솔 로그 출력창 연동
  
  // 기능 옵션 (누끼/합성 생성 여부)
  enableRemoveBg: boolean
  enableSynthesis: boolean
  
  // 그룹별 실측 사이즈, 결함, 상태, 누끼 제외 옵션 (key: groupId)
  measuredSizes: Record<string, { width?: string; length?: string; defect?: string; condition?: string; skipNukki?: boolean }>

  setFiles: (files: FileItem[]) => void
  addFile: (file: FileItem) => void
  removeFile: (filePath: string) => void
  updateFile: (filePath: string, updates: Partial<FileItem>) => void
  
  // 그룹화 및 대표 지정 비즈니스 액션
  setRepresentativeMode: (enabled: boolean) => void
  toggleRepresentative: (filePath: string) => void
  swapRepresentative: (oldRepPath: string, newRepPath: string) => void
  swapFileOrder: (pathA: string, pathB: string) => void
  moveFileToGroup: (filePath: string, targetGroupId: string | undefined) => void
  confirmGrouping: (confirmed: boolean) => void
  resetGrouping: () => void
  autoGroupBySix: () => void
  addConsoleLog: (log: string) => void
  
  // 옵션 토글 및 세팅
  setOptions: (rmbg: boolean, synth: boolean) => void
  toggleRemoveBg: () => void
  toggleSynthesis: () => void
  
  // 실측 사이즈, 결함, 상태, 누끼 제외 업데이트 액션
  updateMeasuredSize: (groupId: string, field: 'width' | 'length' | 'defect' | 'condition', value: string) => void
  setGroupSkipNukki: (groupId: string, skip: boolean) => void
  
  // AI 시퀀스 제어 액션
  startAIAnalysis: () => void
  stopAnalysis: () => void
  pauseAnalysis: () => void
  resumeAnalysis: () => void
  setTelegramActive: (active: boolean) => void
  
  initializeFileListener: () => () => void
}

// AI 생성 데이터 후보군 (시뮬레이션 완성도 극대화용)
const AI_TITLES = [
  '빈티지 헤비 오버핏 맨투맨 그레이',
  '스트릿 로고 프린팅 루즈핏 티셔츠 블랙',
  '캐주얼 카고 아웃도어 조거팬츠 네이비',
  '헤리티지 후드 윈드브레이커 재킷 블랙',
  '스트라이프 포켓 데일리 셔츠 블루',
  '뉴에라 클래식 로고 자수 볼캡 차콜',
]

const AI_DESCRIPTIONS = [
  '탄탄한 3단 쮸리 원단으로 제작되어 자연스러운 핏이 유지되는 베이직 긴팔 맨투맨입니다. 세탁 후 변형이 적어 데일리웨어로 추천합니다.',
  '코튼 100% 싱글 저지 원단을 사용하여 통기성이 우수하고, 전면의 감각적인 빈티지 그래픽 프린팅이 캐주얼한 무드를 더해줍니다.',
  '입체적인 카고 포켓 디테일과 밑단 시보리 밴딩 처리로 활동성을 극대화한 캐주얼 팬츠입니다. 다양한 아웃도어 및 일상 활동에 매치 가능합니다.',
  '방수 가공 코팅을 거친 경량 쉘 원단으로 가벼운 비바람을 완벽히 막아주며, 오버사이즈 실루엣으로 트렌디함을 뽐내는 기능성 바람막이입니다.',
  '부드러운 피치 가공 코튼으로 쾌적한 피팅감을 자랑하며, 단독 혹은 이너로 레이어드하여 활용하기 용이한 정통 어반 캐주얼 셔츠입니다.',
  '머리형태를 예쁘게 감싸주는 안정적인 깊이감의 크라운 피트와 오리지널 자수 엠블럼으로 세련된 원 포인트를 더한 캐주얼 캡입니다.',
]

const AI_CATEGORIES = [
  '의류 > 상의 > 맨투맨/스웨트셔츠',
  '의류 > 상의 > 반소매 티셔츠',
  '의류 > 하의 > 트레이닝/조거팬츠',
  '의류 > 아우터 > 바람막이/집업',
  '의류 > 상의 > 캐주얼 셔츠',
  '패션잡화 > 모자 > 볼캡/야구모자',
]

export const useFileStore = create<FileState>((set, get) => ({
  files: [],
  representativePaths: [],
  isRepresentativeMode: false,
  isConfirmed: false,
  isAnalyzing: false,
  analysisProgress: 0,
  currentAnalyzingGroupId: null,
  isPaused: false,
  isStopped: false,
  isTelegramActive: false,
  consoleLogs: [],
  enableRemoveBg: false,
  enableSynthesis: false,
  measuredSizes: {},

  setFiles: (files) => {
    const state = get()
    
    // 파일명 기반 오름차순 정렬
    const sortedByName = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    
    // 1. 기존 파일들의 수동 조작 상태(timestamp, groupId 등) 병합 보존
    const mergedFiles = sortedByName.map((newFile, index) => {
      const existing = state.files.find(f => f.path === newFile.path)
      if (existing) {
        return {
          ...newFile,
          timestamp: existing.timestamp,
          groupId: existing.groupId,
          isRepresentative: existing.isRepresentative
        }
      }
      // 신규 파일은 이름 정렬된 순서를 기반으로 가상 timestamp 부여 (OS 시간 무시)
      return {
        ...newFile,
        timestamp: Date.now() + index * 1000 // 순서 보장을 위해 간격을 둠
      }
    })

    // 2. 확정 상태(isConfirmed)이거나 수동 보정 중이라면 전체 1+5 자동 묶기를 강제 실행하지 않음
    if (state.isConfirmed) {
      set({ files: mergedFiles })
      return
    }

    const reps = state.representativePaths
    const updated = reps.length > 0 ? groupImagesByRepresentative(mergedFiles, reps) : mergedFiles
    set({ files: updated })
  },

  addFile: (file) => set((state) => {
    if (state.files.some((f) => f.path === file.path)) {
      return state
    }
    
    // 새 파일의 timestamp를 이름 순서에 맞게 적절히 끼워넣기 위해 계산
    const allFilesSortedByName = [...state.files, file].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const targetIndex = allFilesSortedByName.findIndex(f => f.path === file.path)
    
    let virtualTimestamp = Date.now()
    if (targetIndex > 0 && targetIndex < allFilesSortedByName.length - 1) {
      const prevTs = allFilesSortedByName[targetIndex - 1].timestamp
      const nextTs = allFilesSortedByName[targetIndex + 1].timestamp
      virtualTimestamp = prevTs + (nextTs - prevTs) / 2
    } else if (targetIndex > 0) {
      virtualTimestamp = allFilesSortedByName[targetIndex - 1].timestamp + 1000
    } else if (targetIndex < allFilesSortedByName.length - 1) {
      virtualTimestamp = allFilesSortedByName[targetIndex + 1].timestamp - 1000
    }

    const newFileWithVirtualTs = { ...file, timestamp: virtualTimestamp }
    const newFiles = [...state.files, newFileWithVirtualTs]
    
    // 확정 상태면 자동 그룹화 우회
    if (state.isConfirmed) {
      return { files: newFiles }
    }
    
    const updated = state.representativePaths.length > 0 
      ? groupImagesByRepresentative(newFiles, state.representativePaths)
      : newFiles
    return { files: updated }
  }),

  removeFile: (filePath) => set((state) => {
    const remainingFiles = state.files.filter((f) => f.path !== filePath)
    const newReps = state.representativePaths.filter((p) => p !== filePath)
    
    // 확정 상태면 자동 그룹화 우회
    if (state.isConfirmed) {
      return { 
        files: remainingFiles,
        representativePaths: newReps
      }
    }

    const updated = newReps.length > 0 
      ? groupImagesByRepresentative(remainingFiles, newReps)
      : remainingFiles
    return { 
      files: updated,
      representativePaths: newReps
    }
  }),

  updateFile: (filePath, updates) => set((state) => ({
    files: state.files.map((f) => 
      f.path === filePath ? { ...f, ...updates } : f
    )
  })),

  setRepresentativeMode: (enabled) => set({ isRepresentativeMode: enabled }),

  toggleRepresentative: (filePath) => set((state) => {
    const isExists = state.representativePaths.includes(filePath)
    const newReps = isExists
      ? state.representativePaths.filter((p) => p !== filePath)
      : [...state.representativePaths, filePath]

    const updated = groupImagesByRepresentative(state.files, newReps)
    
    // 대표 지정이 완료되면 콘솔창에 로그 출력
    const fileName = filePath.split(/[/\\]/).pop() || ''
    const actionText = isExists ? '대표 지정 해제' : '메인 대표 이미지로 지정'
    const newLogs = [...state.consoleLogs, `[대표 매핑] ${fileName} 파일이 ${actionText}되었습니다.`].slice(-100)

    return {
      representativePaths: newReps,
      files: updated,
      consoleLogs: newLogs
    }
  }),

  swapRepresentative: (oldRepPath, newRepPath) => set((state) => {
    // 1. files에서 두 파일을 찾아서 타임스탬프 교환 (위치 완전 교체)
    const oldRepFile = state.files.find(f => f.path === oldRepPath)
    const newRepFile = state.files.find(f => f.path === newRepPath)
    
    let updatedFiles = state.files
    if (oldRepFile && newRepFile) {
      const tempTimestamp = oldRepFile.timestamp
      updatedFiles = state.files.map(f => {
        if (f.path === oldRepPath) return { ...f, timestamp: newRepFile.timestamp }
        if (f.path === newRepPath) return { ...f, timestamp: tempTimestamp }
        return f
      })
    }

    // 2. 기존 대표 경로를 새 대표 경로로 교체
    const newReps = state.representativePaths.map(p => p === oldRepPath ? newRepPath : p)
    
    // 3. 만약 새 경로가 기존 목록에 없었다면 예외처리로 그냥 추가
    if (!state.representativePaths.includes(oldRepPath) && !newReps.includes(newRepPath)) {
      newReps.push(newRepPath)
    }

    const updated = groupImagesByRepresentative(updatedFiles, newReps)
    const fileName = newRepPath.split(/[/\\]/).pop() || ''
    const newLogs = [...state.consoleLogs, `[대표 교체] ${fileName} 파일이 새 대표 이미지로 지정되었습니다.`].slice(-100)

    return {
      representativePaths: newReps,
      files: updated,
      consoleLogs: newLogs
    }
  }),

  swapFileOrder: (pathA, pathB) => set((state) => {
    const fileA = state.files.find(f => f.path === pathA)
    const fileB = state.files.find(f => f.path === pathB)
    
    if (!fileA || !fileB) return state
    
    const tempTimestamp = fileA.timestamp
    const tempGroupId = fileA.groupId
    
    const updatedFiles = state.files.map(f => {
      if (f.path === pathA) return { ...f, timestamp: fileB.timestamp, groupId: fileB.groupId }
      if (f.path === pathB) return { ...f, timestamp: tempTimestamp, groupId: tempGroupId }
      return f
    })
    
    const nameA = pathA.split(/[/\\]/).pop() || ''
    const nameB = pathB.split(/[/\\]/).pop() || ''
    const newLogs = [...state.consoleLogs, `[수동 보정] ${nameA} 파일과 ${nameB} 파일의 위치가 교체되었습니다.`].slice(-100)

    return {
      files: updatedFiles,
      consoleLogs: newLogs
    }
  }),

  moveFileToGroup: (filePath, targetGroupId) => set((state) => {
    // 수동 이동 시 대표 이미지 여부를 해제해 안전을 도모
    const updated = state.files.map((f) => {
      if (f.path === filePath) {
        return { 
          ...f, 
          groupId: targetGroupId,
          isRepresentative: targetGroupId === undefined ? false : f.isRepresentative
        }
      }
      return f
    })
    
    // 만약 이동하는 파일이 원래 대표 리스트에 있었다면 제거 처리
    let newReps = state.representativePaths
    if (targetGroupId === undefined && state.representativePaths.includes(filePath)) {
      newReps = state.representativePaths.filter(p => p !== filePath)
    }

    const fileName = filePath.split(/[/\\]/).pop() || ''
    const targetText = targetGroupId ? `제품 블록 [${targetGroupId.replace('group_', '').split(/[/\\]/).pop()}]` : '미분류 영역'
    const newLogs = [...state.consoleLogs, `[수동 보정] ${fileName} 파일이 ${targetText}으로 수동 이동되었습니다.`].slice(-100)

    return { 
      files: updated,
      representativePaths: newReps,
      consoleLogs: newLogs
    }
  }),

  confirmGrouping: (confirmed) => set((state) => {
    const actionText = confirmed ? '이미지 그룹화가 확정되었습니다.' : '그룹화 확정이 취소되고 보정 모드로 진입했습니다.'
    const newLogs = [...state.consoleLogs, `[그룹 상태] ${actionText}`].slice(-100)
    return {
      isConfirmed: confirmed,
      consoleLogs: newLogs
    }
  }),

  resetGrouping: () => {
    const reset = get().files.map(f => ({
      ...f,
      groupId: undefined,
      isRepresentative: false,
      status: 'pending' as const,
      aiTitle: undefined,
      aiDescription: undefined,
      aiCategory: undefined,
      prodCode: undefined,
      hasCleaned: undefined,
      hasSynthesized: undefined,
    }))
    return set({ 
      representativePaths: [],
      files: reset,
      isConfirmed: false,
      isAnalyzing: false,
      analysisProgress: 0,
      consoleLogs: [...get().consoleLogs, '🔄 [재설정] 그룹화 및 대표 지정이 초기화되었습니다.'].slice(-100)
    })
  },

  autoGroupBySix: () => set((state) => {
    // 1. 미분류(그룹이 없는) 이미지들을 추출
    const unclassifiedImages = state.files.filter(f => f.type.includes('이미지') && !f.groupId && !f.isRepresentative)
    if (unclassifiedImages.length === 0) return state

    // 2. 타임스탬프 순으로 정렬
    const sorted = [...unclassifiedImages].sort((a, b) => a.timestamp - b.timestamp)
    
    // 3. 6장 단위로 쪼개고, 각 묶음의 첫 번째 파일을 새 대표로 지정
    const newReps = [...state.representativePaths]
    let newGroupCount = 0
    for (let i = 0; i < sorted.length; i += 6) {
      newReps.push(sorted[i].path)
      newGroupCount++
    }

    // 4. 기존 로직을 태워 순차적으로 1+5 그룹핑 완료
    const updated = groupImagesByRepresentative(state.files, newReps)

    return {
      representativePaths: newReps,
      files: updated,
      consoleLogs: [...state.consoleLogs, `[자동 그룹] ${newGroupCount}개의 새로운 제품 그룹이 생성되었습니다.`].slice(-100)
    }
  }),

  addConsoleLog: (log) => set((state) => ({
    consoleLogs: [...state.consoleLogs, log].slice(-100)
  })),

  setOptions: (rmbg, synth) => set({ enableRemoveBg: rmbg, enableSynthesis: synth }),

  toggleRemoveBg: () => set((state) => {
    const newVal = !state.enableRemoveBg
    if (window.electronAPI?.settings) {
      window.electronAPI.settings.set('enableRemoveBg', newVal.toString())
    }
    return { enableRemoveBg: newVal }
  }),

  toggleSynthesis: () => set((state) => {
    const newVal = !state.enableSynthesis
    if (window.electronAPI?.settings) {
      window.electronAPI.settings.set('enableSynthesis', newVal.toString())
    }
    return { enableSynthesis: newVal }
  }),

  updateMeasuredSize: (groupId, field, value) => set((state) => ({
    measuredSizes: {
      ...state.measuredSizes,
      [groupId]: {
        ...(state.measuredSizes[groupId] || {}),
        [field]: value
      }
    }
  })),

  setGroupSkipNukki: (groupId, skip) => set((state) => ({
    measuredSizes: {
      ...state.measuredSizes,
      [groupId]: {
        ...(state.measuredSizes[groupId] || {}),
        skipNukki: skip
      }
    }
  })),

  // 1부터 순차적으로 제품코드를 발급하고 실제 구글 드라이브 및 스프레드시트 연동 업로드를 실행하는 코어 파이프라인
  
  pauseAnalysis: () => set((state) => ({ 
    isPaused: true,
    consoleLogs: [...state.consoleLogs, '⏸️ [작업 보류] 진행 중인 제품이 완료된 후 작업을 일시 중지합니다.'].slice(-100)
  })),

  stopAnalysis: () => set((state) => ({
    isStopped: true,
    consoleLogs: [...state.consoleLogs, '⏹️ [작업 종료] 진행 중인 제품이 완료된 후 작업을 완전히 종료합니다.'].slice(-100)
  })),

  resumeAnalysis: () => {
    set((state) => ({
      isPaused: false,
      isStopped: false,
      consoleLogs: [...state.consoleLogs, '▶️ [작업 재개] 대기 중인 제품의 분석 및 업로드를 다시 시작합니다.'].slice(-100)
    }))
    get().startAIAnalysis()
  },

  setTelegramActive: (active: boolean) => {
    set({ isTelegramActive: active })
  },

  startAIAnalysis: async () => {
    let state = get()
    
    // 만약 이미 실행 중인데 호출되었다면 방어 (isPaused로 재개하는 경우는 제외)
    if (state.isAnalyzing && !state.isPaused) return;

    // 만약 isStopped 상태였다면 리셋
    if (state.isStopped) {
      set({ isStopped: false })
    }
    
    // 대표 사진이 지정되지 않았으나 파일이 존재하는 경우 (주로 텔레그램 자동 연동 시 발생), 가장 오래된 첫 번째 사진을 자동으로 대표 지정
    if (state.representativePaths.length === 0 && state.files.length > 0) {
      const sortedFiles = [...state.files].sort((a, b) => a.timestamp - b.timestamp)
      if (sortedFiles[0]) {
        get().toggleRepresentative(sortedFiles[0].path)
        state = get() // 상태 갱신
      }
    }

    if (state.representativePaths.length === 0) {
      set({ consoleLogs: [...state.consoleLogs, '[에러] 생성된 제품 그룹이 존재하지 않습니다. 먼저 대표 사진을 지정해주세요.'] })
      return
    }

    set({ 
      isAnalyzing: true, 
      analysisProgress: 0,
      consoleLogs: [...state.consoleLogs, '[분석 시작] 822 AI 대량 이미지 분석 및 구글 업로드 파이프라인 가동 시작...'] 
    })

    // 구글 연동 설정 경로 비동기 조회
    let gdUrl = ''
    let gsUrl = ''
    let uploadTarget = '822shop'
    try {
      uploadTarget = useUIStore.getState().uploadTarget || '822shop'
      if (window.electronAPI?.settings) {
        if (uploadTarget === 'dreamstudio') {
          gdUrl = await window.electronAPI.settings.get('googleDriveUrl_dreamstudio') || ''
          gsUrl = await window.electronAPI.settings.get('googleSpreadsheetUrl_dreamstudio') || ''
        } else {
          gdUrl = await window.electronAPI.settings.get('googleDriveUrl_822shop') || ''
          gsUrl = await window.electronAPI.settings.get('googleSpreadsheetUrl_822shop') || ''
        }
      }
    } catch (e) {
      console.error('[Settings Load Error]', e)
    }

    const isRealGoogleMode = gdUrl !== '' && gsUrl !== ''

    if (isRealGoogleMode) {
      set((s) => ({
        consoleLogs: [...s.consoleLogs, `🔗 [구글 연동 감지] 실제 구글 클라우드 업로드 파이프라인을 개시합니다.`]
      }))
    } else {
      set((s) => ({
        consoleLogs: [
          ...s.consoleLogs, 
          `💡 [시뮬레이션 모드] 구글 연동 주소가 비어 있어 시뮬레이션 가상 모드로 자동 구동됩니다.`,
          `💡 (실제 구글 드라이브/시트에 올리시려면 우측 상단 설정 톱니바퀴에서 URL 경로를 입력하세요)`
        ]
      }))
    }

    // 대표 이미지들의 시간순 오름차순(가장 오래된 것 먼저) 정렬 후 그룹 리스트 생성
    const groups = state.representativePaths
      .map((repPath) => {
        const fileObj = state.files.find(f => f.path === repPath)
        return {
          repPath,
          timestamp: fileObj?.timestamp || 0
        }
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((item, index) => ({
        groupId: `group_${item.repPath}`,
        repPath: item.repPath,
        name: item.repPath.split(/[/\\]/).pop() || '',
        index: index + 1
      }))

    let groupIdx = 0
    // 재시작 시, 이미 완료된(completed) 그룹은 건너뜁니다.
    while (groupIdx < groups.length) {
      const gMembers = state.files.filter(f => f.groupId === groups[groupIdx].groupId)
      if (gMembers.length > 0 && gMembers.every(f => f.status === 'completed')) {
        groupIdx++
      } else {
        break
      }
    }

    const checkHaltAndRollback = (activeGroupId: string) => {
      const s = get()
      if (s.isPaused || s.isStopped) {
        set((st) => ({
          files: st.files.map(f => f.groupId === activeGroupId ? {
            ...f,
            status: 'pending',
            aiTitle: undefined,
            aiDescription: undefined,
            aiCategory: undefined,
            hasCleaned: undefined,
            hasSynthesized: undefined,
          } : f),
          currentAnalyzingGroupId: null,
          isAnalyzing: st.isStopped ? false : st.isAnalyzing
        }))
        return true
      }
      return false
    }

    const runNextGroup = async () => {
      if (groupIdx >= groups.length) {
        // 모든 그룹 분석 완료!
        set({ 
          isAnalyzing: false, 
          isPaused: false,
          isStopped: false,
          currentAnalyzingGroupId: null,
          analysisProgress: 100,
          consoleLogs: [...get().consoleLogs, '🎉 [분석 완료] 모든 제품 그룹에 대한 AI 처리 및 구글 클라우드 업로드를 완료했습니다!']
        })
        return
      }

      const activeGroup = groups[groupIdx]
      
      if (checkHaltAndRollback(activeGroup.groupId)) return

      let realProdCodeNum = String(activeGroup.index).padStart(3, '0')
      try {
        if (isRealGoogleMode && window.electronAPI.google?.getNextProdCode) {
          const nextCode = await window.electronAPI.google.getNextProdCode(gsUrl)
          if (nextCode) realProdCodeNum = nextCode
        }
      } catch (err) {
        console.error('Failed to get next prod code', err)
      }
      const prodCode = `PROD-${realProdCodeNum}` // 동적 제품코드 생성
      set({ 
        currentAnalyzingGroupId: activeGroup.groupId,
        consoleLogs: [
          ...get().consoleLogs, 
          `──────────────────────────────────────────────`,
          `⚙️ [제품 ${activeGroup.index}] 신규 제품코드 생성: ${prodCode}`,
          `🤖 [AI 가공] ${activeGroup.name} 헤드 세트 - 업로드용 제목 및 상세설명 분석 중...`
        ] 
      })

      // 1. AI 데이터 분석 (진짜 Gemini Vision 연동)
      let aiData = {
        title: '분석 실패',
        brand: '',
        category: '의류 > 알 수 없음',
        size: '',
        gender: '',
        style: '',
        season: 'sl',
        description: 'AI 분석에 실패했습니다.',
        sns: '',
        hashtags: '',
        nameEN: '',
        nameTH: '',
        descEN: '',
        descTH: '',
        originalPrice: ''
      }

      try {
        let gKey = ''
        let prompt = ''
        if (window.electronAPI?.settings) {
          gKey = await window.electronAPI.settings.get('geminiKey') || ''
          prompt = await window.electronAPI.settings.get('aiPrompt') || ''
        }

        if (!gKey) {
          throw new Error('설정 화면에서 Gemini API Key를 먼저 등록해주세요.')
        }

        // 대표 이미지를 무조건 0번째 인덱스로 정렬
        const groupMembers = get().files.filter(f => f.groupId === activeGroup.groupId)
        groupMembers.sort((a, b) => {
          if (a.path === activeGroup.repPath) return -1
          if (b.path === activeGroup.repPath) return 1
          return 0
        })
        const localFilePaths = groupMembers.map(m => m.path)

        // 결함 정보 및 상태 정보 동적 프롬프트 주입
        const measured = get().measuredSizes[activeGroup.groupId] || {}
        let finalPrompt = prompt

        // [신규] 상태 정보 프롬프트 주입 (제품명 강조 용도)
        const conditionText = measured.condition || '사용감 적음'
        if (conditionText === '새상품') {
          finalPrompt += `\n\n[중요 지시사항: 제품 상태]\n이 제품은 '새상품'입니다.\n`
          finalPrompt += `모든 언어의 제품명(Name, Name_EN, Name_TH)에서 성별 표기 바로 뒤에 새상품임을 강조하는 문구를 괄호로 넣어주세요. (예: "(남성) (새상품) L 아디다스...", 영어: "(Men's) (New) L Adidas...", 태국어: "(ผู้ชาย) (ของใหม่) L Adidas...")\n`
        }

        if (measured.defect && measured.defect.trim() !== '') {
          finalPrompt += `\n\n[중요 지시사항: 제품 결함 정보]\n제품에 다음과 같은 결함이 있습니다: "${measured.defect}"\n제품 설명(Description)에 이 결함 내용을 언급하되, 절대 포장하거나 과장하지 말고(예: "자연스러운 세월의 흔적" 등 사용 금지) 있는 그대로 매우 담백하고 명확하게 팩트만 기재해 주세요.`
        } else {
          finalPrompt += `\n\n[중요 지시사항: 제품 결함 정보]\n이 제품은 특별한 결함이나 하자가 없습니다.\n제품 설명(Description)에 반드시 "하자가 없는 깨끗한 상품입니다." 라는 멘트를 추가해주세요.`
        }

        const response = await window.electronAPI.ai.analyze({
          imagePaths: localFilePaths,
          apiKey: gKey,
          prompt: finalPrompt,
          target: uploadTarget
        })
        
        if (checkHaltAndRollback(activeGroup.groupId)) return

        if (response.success && response.data) {
          const d = response.data
          const safeString = (val: any) => typeof val === 'string' ? val : (val ? JSON.stringify(val) : '')
          
          aiData.brand = safeString(d.Brand)
          aiData.gender = safeString(d.Gender)
          aiData.size = safeString(d.Size)
          aiData.title = safeString(d.Name) || `${aiData.brand} 빈티지 의류`.trim()
          aiData.gender = safeString(d.Gender) || '공용'
          aiData.description = safeString(d.Description) || safeString(d.Description_KR)
          aiData.sns = safeString(d.SNS) || safeString(d.Korean_Sales_Description) || ''
          aiData.hashtags = safeString(d.Hashtags)
          aiData.nameEN = safeString(d.Name_EN)
          aiData.nameTH = safeString(d.Name_TH)
          aiData.descEN = safeString(d.Description_EN)
          aiData.descTH = safeString(d.Description_TH)
          aiData.style = safeString(d.Style)
          aiData.season = safeString(d.Season) || 'sl'
          aiData.originalPrice = safeString(d.OriginalPrice)
          // AI가 이미 "대분류 > 소분류" 형식으로 반환하므로 그대로 사용
          // (기존에 Upper_Category를 앞에 붙이던 방식은 "Others > 상의 > 후드티"처럼 3단계가 되는 버그 유발)
          const rawCategory = safeString(d.Category) || 'Unknown'
          aiData.category = rawCategory
        } else {
          throw new Error(response.error || '분석 데이터가 올바르지 않습니다.')
        }
      } catch (error: any) {
        if (checkHaltAndRollback(activeGroup.groupId)) return
        const errMsg = error.message || String(error)
        set({ consoleLogs: [...get().consoleLogs, `❌ [AI 분석 실패] 제품 ${activeGroup.index}번 - 사유: ${errMsg}`] })
        aiData.description = `❌ [AI 분석 실패] 사유: ${errMsg}\n\n이 제품은 빈티지 제품으로 자연스러운 사용감이나 미세하자는 있을 수 있습니다. 구매에 참고해 주시길 바랍니다.`
        try {
          new Notification('AI 분석 실패 알림', {
            body: `${activeGroup.index}번 제품 분석 중 에러가 발생했습니다.\n${errMsg}`
          })
        } catch (e) {}
      }

      // 실측 사이즈 및 상태 텍스트 병합
      const measured = get().measuredSizes[activeGroup.groupId] || {}
      const sizeParts: string[] = []
      if (measured.width) {
        const wVal = parseFloat(measured.width)
        const wCm = isNaN(wVal) ? '' : ` (${Math.round(wVal * 2.54)}cm)`
        sizeParts.push(`가슴(허리)단면 : ${measured.width}"${wCm}`)
      }
      if (measured.length) {
        const lVal = parseFloat(measured.length)
        const lCm = isNaN(lVal) ? '' : ` (${Math.round(lVal * 2.54)}cm)`
        sizeParts.push(`총장 : ${measured.length}"${lCm}`)
      }
      
      const realSizeStr = sizeParts.join(' / ')
      const conditionText = measured.condition || '사용감 적음'

      let krHeader = ''
      if (realSizeStr) {
        krHeader += `${realSizeStr}\n`
      }
      krHeader += `제품상태 : ${conditionText}\n\n`
      aiData.description = `${krHeader}${aiData.description}`

      if (aiData.descEN) {
        let enCond = conditionText === '새상품' ? 'New' : conditionText === '사용감 없음' ? 'Excellent' : 'Used'
        let enHeader = `Condition : ${enCond}\n\n`
        aiData.descEN = `${enHeader}${aiData.descEN}`
      }

      if (aiData.descTH) {
        let thCond = conditionText === '새상품' ? 'ของใหม่' : conditionText === '사용감 없음' ? 'สภาพดีมาก' : 'สินค้ามือสอง'
        let thHeader = `สภาพสินค้า : ${thCond}\n\n`
        aiData.descTH = `${thHeader}${aiData.descTH}`
      }
      
      // 고정 멘트 추가 (모든 제품 설명 맨 아래)
      const vintageNotice = "이 제품은 빈티지 제품으로 자연스러운 사용감이나 미세하자는 있을 수 있습니다. 구매에 참고해 주시길 바랍니다."
      aiData.description = `${aiData.description}\n\n${vintageNotice}`

      set((s) => ({
        files: s.files.map(f => f.groupId === activeGroup.groupId ? {
          ...f,
          status: 'processing',
          aiTitle: aiData.title,
          aiDescription: aiData.description,
          aiCategory: aiData.category,
        } : f),
        consoleLogs: [
          ...s.consoleLogs,
          `💡 [AI 완료] 카테고리: ${aiData.category}`,
          `💡 [AI 완료] 제목: "${aiData.title}"`,
          `🤖 [이미지 프로세싱] 누끼 및 합성 처리 준비 중...`
        ]
      }))

      // 2. 파이썬 기반 진짜 누끼 및 합성 엔진 실행
      let pyNukkiPath = ''
      let pySynthesisPath = ''
      
      const enableRmbg = get().enableRemoveBg
      const enableSynth = get().enableSynthesis
      
      if (enableRmbg || enableSynth) {
        set((s) => ({ consoleLogs: [...s.consoleLogs, `⏳ [이미지 엔진] 파이썬 기반 화보 렌더링 구동 중... (수 초 정도 소요될 수 있습니다)`] }))
        const groupMembers = get().files.filter(f => f.groupId === activeGroup.groupId)
        groupMembers.sort((a, b) => {
          if (a.path === activeGroup.repPath) return -1
          if (b.path === activeGroup.repPath) return 1
          return 0
        })
        const localFilePaths = groupMembers.map(m => m.path)
        
        try {
          const cpText = uploadTarget === 'dreamstudio' ? 'dreamstudiovtg' : '822shop'
          const groupSettings = get().measuredSizes[activeGroup.groupId] || {}
          const pyRes = await window.electronAPI.python.processImages({
            imagePaths: localFilePaths,
            outputDir: 'temp_will_be_handled_in_main',
            brand: aiData.brand,
            title: aiData.nameEN || aiData.title,
            prodCode: prodCode.replace('PROD-', ''), // '001' 같은 순수 숫자만
            copyright: cpText,
            skipNukki: groupSettings.skipNukki || false
          })
          
          if (pyRes.success) {
            pyNukkiPath = pyRes.nukkiPath || ''
            pySynthesisPath = pyRes.synthesisPath || ''
            
            if (checkHaltAndRollback(activeGroup.groupId)) return

            set((s) => ({
              files: s.files.map(f => f.groupId === activeGroup.groupId ? { 
                ...f, 
                hasCleaned: !!pyNukkiPath,
                hasSynthesized: !!pySynthesisPath
              } : f),
              consoleLogs: [
                ...s.consoleLogs,
                `🎨 [이미지 완료] 누끼 및 화보 합성 처리 완료!`
              ]
            }))
          } else {
            set((s) => ({ consoleLogs: [...s.consoleLogs, `❌ [이미지 에러] 파이썬 처리 중 오류 발생: ${pyRes.error}`] }))
          }
        } catch (pyErr: any) {
          set((s) => ({ consoleLogs: [...s.consoleLogs, `❌ [이미지 에러] 파이썬 연결 오류: ${pyErr.message}`] }))
        }
      } else {
        set((s) => ({ consoleLogs: [...s.consoleLogs, `⏩ [옵션 스킵] 이미지 추가 생성 옵션이 꺼져 있습니다.`] }))
      }

      // 4. 구글 클라우드 실제 업로드 및 스프레드시트 갱신 혹은 시뮬레이션 실행
      if (isRealGoogleMode) {
        set((s) => ({
          consoleLogs: [...s.consoleLogs, `🤖 [구글 전송] Google API 연쇄 업로드 요청 전송 완료. 파일 스트림 수집 중...`]
        }))

        // 그룹 멤버들의 로컬 이미지 경로 수집 (대표 이미지 우선 정렬)
        const groupMembers = get().files.filter(f => f.groupId === activeGroup.groupId)
        groupMembers.sort((a, b) => {
          if (a.path === activeGroup.repPath) return -1
          if (b.path === activeGroup.repPath) return 1
          return 0
        })
        const localFilePaths = groupMembers.map(m => m.path)

        try {
          const res = await window.electronAPI.google.uploadProduct({
            predefinedProdCode: realProdCodeNum,
            aiTitle: aiData.title,
            aiBrand: aiData.brand,
            aiCategory: aiData.category,
            aiSize: aiData.size,
            aiGender: aiData.gender,
            aiRealSize: [measured?.width, measured?.length].filter(Boolean).join(','),
            aiDefect: measured?.defect || '',
            aiCondition: measured?.condition || '사용감 적음',
            aiDescription: aiData.description,
            aiNameEN: aiData.nameEN,
            aiNameTH: aiData.nameTH,
            aiDescEN: aiData.descEN,
            aiDescTH: aiData.descTH,
            aiSns: aiData.sns,
            aiHashtags: aiData.hashtags,
            aiStyle: aiData.style,
            aiSeason: aiData.season,
            aiOriginalPrice: aiData.originalPrice,
            localFilePaths,
            nukkiFilePath: pyNukkiPath,
            synthesisFilePath: pySynthesisPath,
            googleDriveUrl: gdUrl,
            googleSpreadsheetUrl: gsUrl,
            target: uploadTarget
          })

          if (checkHaltAndRollback(activeGroup.groupId)) return

          if (res.success) {
            // 업로드 완료 후 로컬 파일들을 static/images 폴더로 아카이빙(이동)
            try {
              if (window.electronAPI.file?.archive && res.prodCode) {
                await window.electronAPI.file.archive({
                  prodCode: res.prodCode,
                  localFilePaths,
                  nukkiFilePath: pyNukkiPath,
                  synthesisFilePath: pySynthesisPath,
                  target: uploadTarget
                })
              }
            } catch (err) {
              console.warn('static/images 아카이빙 실패', err)
            }

            set((s) => ({
              files: s.files.map(f => f.groupId === activeGroup.groupId ? { ...f, status: 'completed' } : f),
              analysisProgress: Math.round(((groupIdx + 1) / groups.length) * 100),
              consoleLogs: [
                ...s.consoleLogs,
                `✅ [완료] 제품 ${activeGroup.index} 구글 드라이브 및 스프레드시트 최종 기입 완료!`,
                `📁 [아카이빙] 원본 및 생성 이미지를 static/images/${res.prodCode} 폴더에 정리했습니다.`,
                `📊 [결과폴더] ${res.driveFolderPath}`
              ]
            }))
          } else {
            set((s) => ({
              files: s.files.map(f => f.groupId === activeGroup.groupId ? { ...f, status: 'error' } : f),
              analysisProgress: Math.round(((groupIdx + 1) / groups.length) * 100),
              consoleLogs: [
                ...s.consoleLogs,
                `❌ [구글 전송 실패] 제품 ${activeGroup.index} 처리 오류: ${res.error}`
              ]
            }))
          }
        } catch (uploadErr: any) {
          set((s) => ({
            files: s.files.map(f => f.groupId === activeGroup.groupId ? { ...f, status: 'error' } : f),
            consoleLogs: [...s.consoleLogs, `❌ [에러] 업로드 프로세스 예외 발생: ${uploadErr.message}`]
          }))
        }
      } else {
        // 시뮬레이션 모드 구글 업로드 완료 시뮬레이션
        await new Promise(resolve => setTimeout(resolve, 1500))
        set((s) => ({
          files: s.files.map(f => f.groupId === activeGroup.groupId ? { ...f, status: 'completed' } : f),
          analysisProgress: Math.round(((groupIdx + 1) / groups.length) * 100),
          consoleLogs: [
            ...s.consoleLogs,
            `📤 [드라이브 업로드] (시뮬레이션) 원본 6장 + 누끼 1장 + 합성 1장 전송 성공!`,
            `📊 [스프레드시트] (시뮬레이션) 행 추가 성공 -> 제품코드: (동적채번) | 제목: "${aiData.title}"`,
            `✅ [완료] 제품 ${activeGroup.index} 최종 등록 완료.`
          ]
        }))
      }

      groupIdx++
      runNextGroup() // 재귀적으로 다음 제품군 연동
    }

    runNextGroup()
  },

  initializeFileListener: () => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return () => {}
    }

    window.electronAPI.on('file:initial', (files: unknown) => {
      get().setFiles(files as FileItem[])
    })

    window.electronAPI.on('file:added', (file: unknown) => {
      get().addFile(file as FileItem)
    })

    window.electronAPI.on('file:removed', (filePath: unknown) => {
      get().removeFile(filePath as string)
    })

    window.electronAPI.on('file:changed', (file: unknown) => {
      const fileItem = file as FileItem
      set((state) => {
        const updated = state.files.map((f) => 
          f.path === fileItem.path ? { ...f, ...fileItem } : f
        )
        const mapped = state.representativePaths.length > 0
          ? groupImagesByRepresentative(updated, state.representativePaths)
          : updated
        return { files: mapped }
      })
    })

    // 구글 업로드 실시간 진행 상태 이벤트 리스너 연동
    window.electronAPI.on('google:upload-progress', (data: unknown) => {
      const progressData = data as { groupId: string; log: string }
      set((state) => ({
        consoleLogs: [...state.consoleLogs, progressData.log].slice(-100)
      }))
    })

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeListener('file:initial')
        window.electronAPI.removeListener('file:added')
        window.electronAPI.removeListener('file:removed')
        window.electronAPI.removeListener('file:changed')
        window.electronAPI.removeListener('google:upload-progress')
      }
    }
  }
}))

