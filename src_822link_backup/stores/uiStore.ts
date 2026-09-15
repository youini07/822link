import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'large-icon' | 'small-icon' | 'list' | 'details'
export type SortKey = 'name' | 'date' | 'type' | 'size'
export type SortOrder = 'asc' | 'desc'
export type UploadTarget = '822shop' | 'dreamstudio'

interface UIState {
  uploadTarget: UploadTarget
  setUploadTarget: (target: UploadTarget) => void

  zoomLevel: number // 1, 1.1, 1.2 등등
  setZoomLevel: (zoom: number) => void
  
  /** 파일 보기 모드 (윈도우 탐색기 4개 보기 연동) */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  /** 정렬 기준 키 및 정렬 방향 (기본값: 수정한 날짜 최신순) */
  sortKey: SortKey
  sortOrder: SortOrder
  setSort: (key: SortKey, order: SortOrder) => void
  toggleSort: (key: SortKey) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      uploadTarget: '822shop',
      setUploadTarget: (target) => set({ uploadTarget: target }),

      zoomLevel: 1.2, // 기본 120%
      setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
      
      viewMode: 'details', // 기본은 자세히 보기
      setViewMode: (mode) => set({ viewMode: mode }),

      sortKey: 'date', // 기본 수정한 날짜 정렬
      sortOrder: 'desc', // 기본 내림차순(최신순)
      setSort: (key, order) => set({ sortKey: key, sortOrder: order }),
      toggleSort: (key) => set((state) => {
        if (state.sortKey === key) {
          // 동일한 키 클릭 시 방향 전환
          return { sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' }
        } else {
          // 새로운 키 클릭 시 해당 키로 교체하고, 날짜는 desc, 나머지는 asc를 디폴트로 적용
          const defaultOrder = key === 'date' || key === 'size' ? 'desc' : 'asc'
          return { sortKey: key, sortOrder: defaultOrder }
        }
      }),
    }),
    {
      name: 'ui-settings',
    }
  )
)
