import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Play, CheckCircle2, AlertCircle, Clock, ExternalLink, Trash2, Filter, ArrowUp } from 'lucide-react'
import { useUIStore } from '../stores/uiStore'

// JSX Intrinsics를 위해 webview만 JSX 선언에 등록해 줍니다.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }
}

interface ProductItem {
  prodCode: string
  title: string
  brand: string
  status: string
  category: string
  size: string
  price: string
  thumbnail: string
  date: string
  bunjangPid?: string
  danggeunPid?: string
  joonggonaraPid?: string
  fruitsPid?: string
  uploadStatus: 'pending' | 'uploading' | 'success' | 'failed' | 'deleting' | 'delete_success' | 'delete_failed'
  errorMessage?: string
}

const getThumbnailUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) {
    // 구글 드라이브 링크 파싱
    const match = url.match(/[?&]id=([a-zA-Z0-9-_]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w200-h200`;
    }
    return url;
  }
  return `media://${url}`;
}

const getLocalThumbnailUrl = (prodCode: string) => {
  const localPath = `c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static\\thumbnails\\${prodCode}.jpg`
  const encoder = new TextEncoder()
  const bytes = encoder.encode(localPath)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return `media://file?p=${hex}`
}

const ProductRow = React.memo(({ item, isSelected, editedPrice, onToggle, onPriceChange, renderPlatformStatus }: { 
  item: ProductItem, 
  isSelected: boolean, 
  editedPrice?: string,
  onToggle: (id: string) => void, 
  onPriceChange: (id: string, newPrice: string) => void,
  renderPlatformStatus: (pid?: string) => React.ReactNode 
}) => {
  return (
    <tr className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
      <td className="p-3 text-center">
        <input 
          type="checkbox" 
          checked={isSelected}
          onChange={() => onToggle(item.prodCode)}
        />
      </td>
      <td className="p-3 border-r border-gray-100 text-center">
        <img 
          src={getThumbnailUrl(item.thumbnail)} 
          alt="썸네일" 
          className="w-12 h-12 object-cover border border-gray-200 rounded bg-white shadow-sm mx-auto"
          onError={(e) => { 
            const target = e.target as HTMLImageElement;
            // 구글 드라이브 썸네일 실패 시, 로컬 media 프로토콜로 폴백
            if (!target.src.includes('media://') && !target.src.startsWith('data:image')) {
              target.src = getLocalThumbnailUrl(item.prodCode);
            } else {
              target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
            }
          }}
        />
      </td>
      <td className="p-3 border-r border-gray-100 font-bold text-gray-800">{item.prodCode}</td>
      <td className="p-3 border-r border-gray-100">
        <input
          type="text"
          value={editedPrice !== undefined ? editedPrice : (item.price || '')}
          onChange={(e) => onPriceChange(item.prodCode, e.target.value)}
          className={`w-24 px-2 py-1 text-right text-sm border rounded outline-none transition-colors ${
            editedPrice !== undefined && editedPrice !== item.price
              ? 'border-orange-400 bg-orange-50 font-bold text-orange-700'
              : 'border-gray-200 bg-white focus:border-blue-500'
          }`}
          placeholder="가격"
        />
      </td>
      <td className="p-3 border-r border-gray-100">
        <span className={`px-2 py-1.5 rounded-md text-xs font-medium shadow-sm ${
          (() => {
            const s = (item.status || '').toLowerCase().replace(/\s+/g, '')
            if (s === 'onsale') return 'bg-[#edf7ed] text-gray-800 border border-[#c8e6c9]'
            if (s === 'soldout' || s === '판매완료') return 'bg-[#fbeae9] text-gray-800 border border-[#ffcdd2]'
            return 'bg-gray-50 text-gray-700 border border-gray-200'
          })()
        }`}>
          {item.status || '-'}
        </span>
      </td>
      <td className="p-3 border-r border-gray-100 text-center text-xs">{renderPlatformStatus(item.bunjangPid)}</td>
      <td className="p-3 border-r border-gray-100 text-center text-xs">{renderPlatformStatus(item.danggeunPid)}</td>
      <td className="p-3 border-r border-gray-100 text-center text-xs">{renderPlatformStatus(item.joonggonaraPid)}</td>
      <td className="p-3 border-r border-gray-100 text-center text-xs">{renderPlatformStatus(item.fruitsPid)}</td>
      <td className="p-3 text-center">
        {item.uploadStatus === 'pending' && <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-1 rounded-full text-xs font-medium"><Clock size={12}/> 대기</span>}
        {item.uploadStatus === 'uploading' && <span className="inline-flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-1 rounded-full text-xs font-medium animate-pulse"><RefreshCw size={12} className="animate-spin"/> 등록중</span>}
        {item.uploadStatus === 'deleting' && <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-medium animate-pulse"><Trash2 size={12} className="animate-pulse"/> 삭제중</span>}
        {item.uploadStatus === 'success' && <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full text-xs font-medium"><CheckCircle2 size={12}/> 등록완료</span>}
        {item.uploadStatus === 'delete_success' && <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-medium"><Trash2 size={12}/> 삭제완료</span>}
        {(item.uploadStatus === 'failed' || item.uploadStatus === 'delete_failed') && <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded-full text-xs font-medium" title={item.errorMessage}><AlertCircle size={12}/> 실패: {item.errorMessage}</span>}
      </td>
    </tr>
  )
})

export default function BunjangManagerPage() {
  const [sheetUrl, setSheetUrl] = useState('')
  const [items, setItems] = useState<ProductItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({})

  // 필터 상태
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [codeSearch, setCodeSearch] = useState<string>('')
  const [appliedSearch, setAppliedSearch] = useState<string>('')
  
  const { uploadTarget } = useUIStore()

  // 앱 설정에서 타겟에 맞는 시트 주소 가져오기
  useEffect(() => {
    const key = uploadTarget === 'dreamstudio' ? 'googleSpreadsheetUrl_dreamstudio' : 'googleSpreadsheetUrl_822shop'
    window.electronAPI.settings.get(key).then((url) => {
      if (url) {
        setSheetUrl(url)
      } else {
        setSheetUrl('')
        setItems([])
      }
    }).catch(console.error)
  }, [uploadTarget])

  // sheetUrl이 로드되면 자동으로 데이터를 불러옴
  useEffect(() => {
    if (sheetUrl) {
      handleFetchList()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetUrl])

  const handleFetchList = async () => {
    if (!sheetUrl) return alert('스프레드시트 주소를 입력해주세요.')
    
    setIsLoading(true)
    try {
      const res = await window.electronAPI.google.fetchSpreadsheetList(sheetUrl)
      if (res.success && res.data) {
        // 받아온 데이터에 UI 상태(uploadStatus) 추가
        const newItems = res.data.map(item => ({
          ...item,
          uploadStatus: 'pending' as const
        }))
        setItems(newItems)
      } else {
        alert('데이터를 불러오지 못했습니다: ' + res.error)
      }
    } catch (err: any) {
      alert('오류 발생: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredItems = items.filter(item => {
    if (statusFilter !== 'all') {
      const itemStatus = (item.status || '').toLowerCase().replace(/\s+/g, '')
      const targetStatus = statusFilter.toLowerCase().replace(/\s+/g, '')
      if (itemStatus !== targetStatus) return false
    }
    if (appliedSearch.trim() !== '') {
      // 쉼표, 띄어쓰기, 줄바꿈 모두 완벽하게 분리되도록 정규식 적용
      const searchCodes = appliedSearch.split(/[\s,]+/).filter(c => c)
      // 상품 코드에서 공백이나 숨겨진 특수문자를 모두 제거하고 소문자로 변환하여 비교
      const itemCodeStr = String(item.prodCode).replace(/\s+/g, '').toLowerCase()
      
      const isMatch = searchCodes.some(code => {
        const cleanCode = code.replace(/\s+/g, '').toLowerCase()
        if (!cleanCode) return false
        // 정확하게 딱 떨어지는 것만 일치 (150 검색시 1150 제외)
        return itemCodeStr === cleanCode
      })
      
      if (!isMatch) return false
    }
    return true
  })

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.prodCode)))
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      return newSet
    })
  }, [])

  const handlePriceChange = useCallback((id: string, newPrice: string) => {
    // 숫자만 입력 가능하도록 정제 (필요시 콤마 포맷 추가 가능)
    const numericVal = newPrice.replace(/[^0-9]/g, '')
    setEditedPrices(prev => ({ ...prev, [id]: numericVal }))
  }, [])

  const handleOpenDebugBrowser = async () => {
    try {
      await window.electronAPI.bunjang.openDebugBrowser()
    } catch (err: any) {
      alert('크롬 창 열기 실패: ' + err.message)
    }
  }

  // 백그라운드 진행 상태 모니터링
  useEffect(() => {
    if (window.electronAPI?.bunjang?.onProgress) {
      const cleanup = window.electronAPI.bunjang.onProgress((_, data) => {
        setItems(prev => prev.map(item => {
          if (item.prodCode === data.prodCode) {
            return { ...item, uploadStatus: data.status as any, errorMessage: data.error }
          }
          return item
        }))
      })
      return cleanup
    }
  }, [])

  const renderPlatformStatus = useCallback((pid?: string) => {
    if (!pid || pid.trim() === '') return <span className="text-gray-400">데이터 없음</span>
    if (pid.startsWith('d')) return <span className="text-red-500 font-bold">삭제 완료</span>
    return <span className="text-emerald-600 font-bold">업로드 완료</span>
  }, [])

  const handleStartUpload = async () => {
    if (selectedIds.size === 0) return alert('업로드할 상품을 선택해주세요.')
    
    const confirm = window.confirm(`선택한 ${selectedIds.size}개 상품을 번개장터에 일괄 업로드 하시겠습니까?\n(백그라운드에서 순차적으로 진행되며, 성공 시 시트 S열에 PID가 기록됩니다.)`)
    if (!confirm) return

    try {
      const prodCodes = Array.from(selectedIds)
      
      // 프론트엔드 상태 초기화
      setItems(prev => prev.map(item => {
        if (selectedIds.has(item.prodCode)) {
          return { ...item, uploadStatus: 'pending' }
        }
        return item
      }))

      setIsProcessing(true)
      const res = await window.electronAPI.bunjang.uploadMulti({
        prodCodes,
        spreadsheetUrl: sheetUrl,
        uploadTarget
      })
      setIsProcessing(false)

      if (res.success) {
        alert(`일괄 업로드가 완료되었습니다.\n성공: ${res.summary?.success}개, 실패: ${res.summary?.failed}개`)
      } else {
        alert('업로드 중 오류 발생: ' + res.error)
      }
    } catch (err: any) {
      alert('치명적 오류: ' + err.message)
    }
  }

  const handleStartFruitsUpload = async () => {
    if (selectedIds.size === 0) return alert('업로드할 상품을 선택해주세요.')
    
    const confirm = window.confirm(`선택한 ${selectedIds.size}개 상품을 후르츠패밀리에 일괄 업로드 하시겠습니까?\n(로컬 모바일 에뮬레이터를 통해 진행됩니다.)`)
    if (!confirm) return

    try {
      const prodCodes = Array.from(selectedIds)
      
      setItems(prev => prev.map(item => {
        if (selectedIds.has(item.prodCode)) {
          return { ...item, uploadStatus: 'pending' }
        }
        return item
      }))

      setIsProcessing(true)
      // 나중에 preload.ts 에 fruits.uploadMulti 를 추가할 예정
      const res = await (window as any).electronAPI.fruits.uploadMulti({
        prodCodes,
        spreadsheetUrl: sheetUrl,
        uploadTarget
      })
      setIsProcessing(false)

      if (res.success) {
        alert(`후르츠패밀리 업로드가 완료되었습니다.\n성공: ${res.summary?.success}개, 실패: ${res.summary?.failed}개`)
      } else {
        alert('업로드 중 오류 발생: ' + res.error)
      }
    } catch (err: any) {
      alert('치명적 오류: ' + err.message)
    }
  }

  const handleStartUpdatePrice = async () => {
    if (selectedIds.size === 0) return alert('업데이트할 상품을 선택해주세요.')

    // 선택된 항목 중 실제로 가격이 변경된 항목만 추출
    const updates: Record<string, string> = {}
    let changedCount = 0
    for (const code of selectedIds) {
      const originalItem = items.find(i => i.prodCode === code)
      const edited = editedPrices[code]
      if (originalItem && edited !== undefined && edited !== originalItem.price) {
        updates[code] = edited
        changedCount++
      }
    }

    if (changedCount === 0) {
      return alert('선택한 항목 중 변경된 가격이 없습니다.')
    }

    const confirm = window.confirm(`선택한 상품 중 가격이 변경된 ${changedCount}건의 번개장터 가격을 업데이트하시겠습니까?\n(수정 후 시트에도 자동 반영됩니다.)`)
    if (!confirm) return

    try {
      const prodCodes = Object.keys(updates)
      setItems(prev => prev.map(item => {
        if (prodCodes.includes(item.prodCode)) {
          return { ...item, uploadStatus: 'uploading' } // 가격 업데이트도 uploading 상태로 표현
        }
        return item
      }))

      setIsProcessing(true)
      const res = await (window as any).electronAPI.bunjang.updatePriceMulti({
        prodCodes,
        newPrices: updates,
        spreadsheetUrl: sheetUrl
      })
      setIsProcessing(false)

      if (res.success) {
        alert(`번개장터 가격 업데이트가 완료되었습니다.\n성공: ${res.summary?.success}개, 실패: ${res.summary?.failed}개`)
        // 가격 수정 완료 상태를 UI에 반영하고 edited 상태 제거
        setEditedPrices(prev => {
          const next = { ...prev }
          prodCodes.forEach(c => delete next[c])
          return next
        })
        handleFetchList() // 리프레시하여 새 가격 표시
      } else {
        alert('가격 업데이트 중 오류 발생: ' + res.error)
      }
    } catch (err: any) {
      alert('치명적 오류: ' + err.message)
    }
  }

  const handleStartDelete = async () => {
    if (selectedIds.size === 0) return alert('선택된 상품이 없습니다.')

    const confirm = window.confirm(`총 ${selectedIds.size}개 상품을 번장 삭제하시겠습니까?\n(삭제 완료 시 시트에 d 접두어가 추가됩니다.)`)
    if (!confirm) return

    try {
      const prodCodes = Array.from(selectedIds)

      setItems(prev => prev.map(item => {
        if (selectedIds.has(item.prodCode)) {
          return { ...item, uploadStatus: 'deleting' }
        }
        return item
      }))

      setIsProcessing(true)
      const res = await window.electronAPI.bunjang.deleteMulti({
        prodCodes,
        spreadsheetUrl: sheetUrl,
        uploadTarget
      })

      if (res.success) {
        alert(`번장 삭제 처리가 완료되었습니다.\n성공: ${res.summary?.success}건, 실패: ${res.summary?.failed}건\n시트를 다시 불러와 확인하세요.`)
      } else {
        alert('삭제 중 에러 발생: ' + res.error)
      }
    } catch (err: any) {
      alert('치명적 에러: ' + err.message)
    }
  }

  const handleStartAutoUp = async () => {
    const confirm = window.confirm(`전체 상품을 대상으로 '번개장터 일괄 UP' 로봇을 실행하시겠습니까?\n(로봇 전용 창이 열려있어야 하며, 내 상품 관리 페이지를 스캔하며 누를 수 있는 모든 UP 버튼을 누릅니다.)`)
    if (!confirm) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (window as any).electronAPI.bunjang.autoUp()

      if (res.success) {
        alert(`자동 UP 작업이 완료되었습니다.\n성공: ${res.summary?.success}건, 실패: ${res.summary?.failed}건`)
      } else {
        alert(`작업 실패: ${res.error}`)
      }
    } catch (err: any) {
      alert('치명적 에러: ' + err.message)
    }
  }

  const handleStartFruitsDelete = async () => {
    if (selectedIds.size === 0) return alert('선택된 상품이 없습니다.')

    const confirm = window.confirm(`총 ${selectedIds.size}개 상품을 후르츠패밀리 삭제하시겠습니까?\n(삭제 완료 시 시트에 d_ 접두어가 추가됩니다.)`)
    if (!confirm) return

    try {
      const prodCodes = Array.from(selectedIds)

      setItems(prev => prev.map(item => {
        if (selectedIds.has(item.prodCode)) {
          return { ...item, uploadStatus: 'deleting' }
        }
        return item
      }))

      setIsProcessing(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (window as any).electronAPI.fruits.deleteMulti({
        prodCodes,
        spreadsheetUrl: sheetUrl
      })

      if (res.success) {
        alert(`후르츠 삭제 처리가 완료되었습니다.\n성공: ${res.summary?.success}건, 실패: ${res.summary?.failed}건\n시트를 다시 불러와 확인하세요.`)
      } else {
        alert('삭제 중 에러 발생: ' + res.error)
      }
    } catch (err: any) {
      alert('치명적 에러: ' + err.message)
    }
  }

  const handleStartDeleteEntirely = async () => {
    if (selectedIds.size === 0) return alert('선택된 상품이 없습니다.')

    const confirm = window.confirm(`선택된 ${selectedIds.size}개의 제품 데이터를 [구글 시트], [드라이브], [로컬 폴더]에서 완전히 영구 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다!`)
    if (!confirm) return

    try {
      const prodCodes = Array.from(selectedIds)
      
      setItems(prev => prev.map(item => {
        if (selectedIds.has(item.prodCode)) {
          return { ...item, uploadStatus: 'deleting' }
        }
        return item
      }))

      let successCount = 0
      let failCount = 0
      
      for (const prodCode of prodCodes) {
        const res = await window.electronAPI.google.deleteProductEntirely(prodCode, uploadTarget)
        if (res.success) {
          successCount++
        } else {
          failCount++
          console.error(`삭제 실패 [${prodCode}]:`, res.error)
        }
      }

      alert(`완전 삭제 작업 완료!\n성공: ${successCount}건, 실패: ${failCount}건`)
      // 삭제 성공 후 목록 갱신을 위해 데이터 다시 가져오기
      if (successCount > 0) {
        setSelectedIds(new Set())
        handleFetchList()
      }
    } catch (err: any) {
      alert('완전 삭제 중 치명적 에러: ' + err.message)
    }
  }

  const handleStopProcess = () => {
    window.electronAPI.bunjang.cancelUpload()
    window.electronAPI.fruits.cancelUpload()
    setIsProcessing(false)
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#fafafa]">
      {/* 상단 컨트롤 바 */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white flex flex-col gap-5 shrink-0 z-20 relative">
        {/* 첫 번째 줄: 제목, 검색, 새로고침, 디버그창 */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-5 flex-1">
            <h2 className="text-2xl font-bold text-gray-900 shrink-0 tracking-tight">멀티 마켓 봇</h2>
            <div className="relative flex-1 max-w-xl">
              <input 
                type="text" 
                placeholder="코드 번호로 검색 (예: 456, 243, 156...)" 
                value={codeSearch}
                onChange={e => setCodeSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setAppliedSearch(codeSearch) }}
                className="w-full pl-4 pr-16 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:bg-white focus:border-gray-400 focus:ring-4 focus:ring-gray-100 transition-all"
              />
              <button
                onClick={() => setAppliedSearch(codeSearch)}
                className="absolute right-1.5 top-1.5 bottom-1.5 px-4 bg-white border border-gray-200 text-gray-700 rounded-md text-xs font-semibold hover:bg-gray-50 transition-colors"
              >
                검색
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-4 shrink-0">
            <button
              onClick={handleFetchList}
              disabled={isLoading || !sheetUrl}
              className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium border border-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
              새로고침
            </button>
            <button
              onClick={handleOpenDebugBrowser}
              className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium border border-gray-200 transition-colors flex items-center gap-2"
            >
              <ExternalLink size={15} />
              로봇 전용 창
            </button>
          </div>
        </div>

        {/* 두 번째 줄: 미니멀 액션 툴바 */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center text-sm text-gray-500 font-medium">
            선택된 상품 <span className="text-gray-900 font-bold ml-2 mr-1">{selectedIds.size}</span> / {filteredItems.length}
          </div>
          
          <div className="flex items-center gap-3">
            {/* 삭제 버튼 그룹 */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartDeleteEntirely}
                disabled={selectedIds.size === 0}
                title="시트/드라이브/로컬에서 영구 삭제"
                className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-50 text-red-500 border border-gray-200 hover:border-red-200 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-200 rounded-lg font-medium transition-all text-sm"
              >
                <Trash2 size={14} /> 완전 삭제
              </button>
              <button
                onClick={handleStartDelete}
                disabled={selectedIds.size === 0}
                className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 disabled:opacity-40 rounded-lg font-medium transition-all text-sm"
              >
                <Trash2 size={14} /> 번개 삭제
              </button>
              <button
                onClick={handleStartFruitsDelete}
                disabled={selectedIds.size === 0}
                className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 disabled:opacity-40 rounded-lg font-medium transition-all text-sm"
              >
                <Trash2 size={14} /> 후르츠 삭제
              </button>
            </div>

            <div className="w-px h-5 bg-gray-200 mx-2"></div> {/* 구분선 */}

            {/* 업로드 버튼 그룹 */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartAutoUp}
                className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium transition-all text-sm"
              >
                <ArrowUp size={14} className="text-yellow-300" /> 전체상품 UP
              </button>
              {isProcessing && (
                <button
                  onClick={handleStopProcess}
                  className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-all text-sm shadow-md animate-pulse"
                >
                  <span className="text-xl leading-none -mt-0.5">&times;</span> 작업 중단
                </button>
              )}
              <button
                onClick={handleStartUpdatePrice}
                disabled={selectedIds.size === 0 || Object.keys(editedPrices).length === 0}
                className="min-w-[100px] flex justify-center items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-all text-sm"
              >
                <RefreshCw size={14} className={selectedIds.size > 0 && Object.keys(editedPrices).length > 0 ? "animate-pulse" : ""} /> 번개 가격수정
              </button>
              <button
                onClick={handleStartFruitsUpload}
                disabled={selectedIds.size === 0}
                className="min-w-[120px] flex justify-center items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-all text-sm"
              >
                <Play size={14} fill="currentColor" /> 후르츠 등록
              </button>
              <button
                onClick={handleStartUpload}
                disabled={selectedIds.size === 0}
                className="min-w-[120px] flex justify-center items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-all text-sm"
              >
                <Play size={14} fill="currentColor" /> 번개 등록
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 상품 목록 테이블 영역 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden h-full flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
              <thead className="sticky top-0 bg-gray-100 shadow-sm z-10">
                <tr className="text-gray-600 border-b border-gray-200">
                  <th className="p-3 w-10 text-center"><input type="checkbox" checked={filteredItems.length > 0 && selectedIds.size === filteredItems.length} onChange={toggleSelectAll} /></th>
                  <th className="p-3 border-r border-gray-200"><div className="resize-x overflow-hidden min-w-[50px] w-[60px]">사진</div></th>
                  <th className="p-3 border-r border-gray-200"><div className="resize-x overflow-hidden min-w-[50px] w-[80px]">코드</div></th>
                  <th className="p-3 border-r border-gray-200"><div className="resize-x overflow-hidden min-w-[70px] w-[90px]">가격</div></th>
                  <th className="p-3 border-r border-gray-200">
                    <div className="flex items-center justify-between resize-x overflow-hidden min-w-[70px] w-[80px] relative group cursor-pointer pr-1">
                      <span>상태</span>
                      <Filter size={14} className={`text-gray-400 group-hover:text-gray-600 transition-colors ${statusFilter !== 'all' ? 'text-emerald-500 fill-emerald-100' : ''}`} />
                      <select 
                        className="absolute inset-0 opacity-0 cursor-pointer w-full"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <option value="all">전체보기</option>
                        <option value="onsale">onsale</option>
                        <option value="sold out">Sold Out</option>
                      </select>
                    </div>
                  </th>
                  <th className="p-3 border-r border-gray-200 text-center"><div className="resize-x overflow-hidden min-w-[80px] w-[100px]">번개장터</div></th>
                  <th className="p-3 border-r border-gray-200 text-center"><div className="resize-x overflow-hidden min-w-[80px] w-[100px]">당근마켓</div></th>
                  <th className="p-3 border-r border-gray-200 text-center"><div className="resize-x overflow-hidden min-w-[80px] w-[100px]">중고나라</div></th>
                  <th className="p-3 border-r border-gray-200 text-center"><div className="resize-x overflow-hidden min-w-[80px] w-[100px]">후르츠</div></th>
                  <th className="p-3 w-32 text-center">작업 상태</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-400">
                      표시할 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map(item => (
                    <ProductRow
                      key={item.prodCode}
                      item={item}
                      isSelected={selectedIds.has(item.prodCode)}
                      editedPrice={editedPrices[item.prodCode]}
                      onToggle={toggleSelect}
                      onPriceChange={handlePriceChange}
                      renderPlatformStatus={renderPlatformStatus}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>


    </div>
  )
}
