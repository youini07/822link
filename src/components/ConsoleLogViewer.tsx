import { useEffect, useRef, useState } from 'react'
import { Terminal, Camera, Send } from 'lucide-react'
import { useFileStore } from '../stores/fileStore'


export default function ConsoleLogViewer() {
  const consoleLogs = useFileStore((state) => state.consoleLogs)
  const isAnalyzing = useFileStore((state) => state.isAnalyzing)
  const isTelegramActive = useFileStore((state) => state.isTelegramActive)
  const consoleEndRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [consoleLogs])

  return (
    <div className="h-60 bg-slate-800 text-slate-200 border border-slate-700 rounded-xl overflow-hidden shadow-lg shadow-black/20 flex flex-col font-mono shrink-0 relative">
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 flex items-center justify-between shrink-0 relative z-10">
        <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1.5">
          <Terminal size={12} className="text-blue-500" />
          <span>822 AI CORE SYSTEM LOGS</span>
        </span>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#e81123]" />
          <span className="w-2 h-2 rounded-full bg-[#ffb900]" />
          <span className="w-2 h-2 rounded-full bg-[#107c10]" />
        </div>
      </div>
      

      {/* 메인 로그 뷰 (항상 표시, 배경 위에 투명하게 올라감) */}
      <div className="flex-1 overflow-y-auto p-4 text-[10px] leading-relaxed space-y-2 text-slate-200 select-text relative z-10 bg-transparent font-medium drop-shadow-lg shadow-black/20">
        {consoleLogs.length === 0 ? (
          <div className="text-slate-500 italic">[대기] 대표 사진 지정 완료 및 그룹 확정 후 분석을 개시하세요.</div>
        ) : (
          consoleLogs.map((log, idx) => {
            let colorClass = 'text-slate-300'
            if (log.startsWith('[에러]')) colorClass = 'text-red-500 font-medium'
            else if (log.startsWith('🤖') || log.startsWith('⚙️')) colorClass = 'text-blue-600'
            else if (log.startsWith('📊') || log.startsWith('🎉')) colorClass = 'text-amber-600 font-medium'
            else if (log.startsWith('💡')) colorClass = 'text-slate-100 font-bold'
            else if (log.startsWith('──')) colorClass = 'text-slate-500'

            return (
              <div key={idx} className={`${colorClass} whitespace-pre-wrap`}>
                {log}
              </div>
            )
          })
        )}
        <div ref={consoleEndRef} />
      </div>
    </div>
  )
}
