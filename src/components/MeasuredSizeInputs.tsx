import { useState, useEffect } from 'react'
import { useFileStore } from '../stores/fileStore'

interface MeasuredSizeInputsProps {
  groupId: string
  isAnalyzing: boolean
}

/**
 * [Zustand Selector 무한 루프 해결 버전]
 * 
 * - 하얀 화면 크래시(White Screen) 원인 규명:
 *   Zustand Selector 내에서 `return state.measuredSizes[groupId] || {}` 형태로 
 *   매번 새로운 객체 리터럴 `{}`을 반환하면, 얕은 비교(Shallow Comparison)에 의해 스토어의 
 *   아무 상태가 바뀔 때마다 무한 리렌더링 루프에 빠져 렌더러 스레드가 뻗어버립니다.
 * 
 * - 해결 방안:
 *   1. Selector는 오직 기존 스토어에 보존되어 있는 안전한 고정 참조(`state.measuredSizes?.[groupId]`)만 리턴하게 합니다.
 *      (없을 경우 고유한 `undefined`가 반환되어 렌더러 무한 루프가 발생하지 않습니다.)
 *   2. 컴포넌트 내부 연산 및 useState 초기화 시에 비로소 폴백 연산(`|| {}`) 및 널 가드를 통제합니다.
 */
export default function MeasuredSizeInputs({ groupId, isAnalyzing }: MeasuredSizeInputsProps) {
  // 1. Selector는 매번 새로운 객체 참조를 생성하지 않도록 순수 객체 참조(또는 undefined)만 리턴
  const measuredSize = useFileStore((state) => state.measuredSizes?.[groupId])
  const updateMeasuredSize = useFileStore((state) => state.updateMeasuredSize)

  // 2. 초기 렌더링 시 measuredSize가 undefined일 경우를 완벽 방어
  const [width, setWidth] = useState(() => measuredSize?.width || '')
  const [length, setLength] = useState(() => measuredSize?.length || '')
  const [defect, setDefect] = useState(() => measuredSize?.defect || '')
  const [condition, setCondition] = useState(() => measuredSize?.condition || '사용감 적음')

  // 3. 외부 업데이트 연동 (세부 속성이 변경될 때만 로컬 state 동기화)
  useEffect(() => {
    setWidth(measuredSize?.width || '')
    setLength(measuredSize?.length || '')
    setDefect(measuredSize?.defect || '')
    setCondition(measuredSize?.condition || '사용감 적음')
  }, [
    measuredSize?.width,
    measuredSize?.length,
    measuredSize?.defect,
    measuredSize?.condition
  ])

  // 4. 스토어 업데이트 방어막
  const handleBlur = (field: 'width' | 'length' | 'defect', currentValue: string) => {
    if (updateMeasuredSize && (!measuredSize || measuredSize[field] !== currentValue)) {
      updateMeasuredSize(groupId, field, currentValue)
    }
  }

  const handleConditionChange = (value: string) => {
    setCondition(value)
    if (updateMeasuredSize) {
      updateMeasuredSize(groupId, 'condition', value)
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-6 px-5 py-4 bg-[#fdfdfd] border border-slate-700/80 rounded-xl shadow-lg shadow-black/20 animate-fade-in transition-all">
      {/* 1. 가슴(허리)단면 입력 필드 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-400">가슴(허리)단면:</span>
        <input 
          type="text" 
          placeholder="예: 65"
          value={width} 
          onChange={(e) => setWidth(e.target.value)}
          onBlur={() => handleBlur('width', width)}
          disabled={isAnalyzing}
          className="w-16 border-b-2 border-slate-600 focus:border-[#0078d4] bg-transparent text-center text-sm font-semibold text-slate-200 outline-none transition-colors disabled:opacity-50"
        />
      </div>

      {/* 2. 총장 입력 필드 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-400">총장:</span>
        <input 
          type="text" 
          placeholder="예: 44"
          value={length} 
          onChange={(e) => setLength(e.target.value)}
          onBlur={() => handleBlur('length', length)}
          disabled={isAnalyzing}
          className="w-16 border-b-2 border-slate-600 focus:border-[#0078d4] bg-transparent text-center text-sm font-semibold text-slate-200 outline-none transition-colors disabled:opacity-50"
        />
      </div>

      <div className="w-full h-px bg-gray-200 mt-2 mb-1" />

      {/* 4. 제품 결함 (하자) 입력 필드 */}
      <div className="flex items-center gap-2 w-full">
        <span className="text-xs font-bold text-slate-400 shrink-0">제품 결함 (하자):</span>
        <input 
          type="text" 
          placeholder="예: 뒤쪽 얼룩 (비워두면 하자가 없는 것으로 인식합니다)"
          value={defect} 
          onChange={(e) => setDefect(e.target.value)}
          onBlur={() => handleBlur('defect', defect)}
          disabled={isAnalyzing}
          className="flex-1 border-b-2 border-slate-600 focus:border-[#0078d4] bg-transparent text-sm font-medium text-slate-200 outline-none transition-colors disabled:opacity-50 px-1 py-0.5"
        />
      </div>

      {/* 5. 상품 상태 선택 셀렉트 */}
      <div className="flex items-center gap-2 w-full mt-2">
        <span className="text-xs font-bold text-slate-400 shrink-0">상품 상태:</span>
        <select 
          value={condition} 
          onChange={(e) => handleConditionChange(e.target.value)}
          disabled={isAnalyzing}
          className="flex-1 border-b-2 border-slate-600 focus:border-[#0078d4] bg-transparent text-sm font-medium text-slate-200 outline-none transition-colors disabled:opacity-50 px-1 py-0.5"
        >
          <option value="새 상품(미사용)">새 상품(미사용)</option>
          <option value="사용감 없음">사용감 없음</option>
          <option value="사용감 적음">사용감 적음</option>
          <option value="사용감 많음">사용감 많음</option>
          <option value="고장/파손 상품">고장/파손 상품</option>
        </select>
      </div>
    </div>
  )
}
