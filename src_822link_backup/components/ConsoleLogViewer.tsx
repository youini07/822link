import { useEffect, useRef, useState } from 'react'
import { Terminal, Camera, Send } from 'lucide-react'
import { useFileStore } from '../stores/fileStore'

// Vite가 빌드 시 올바른 경로로 변환해주도록 import로 이미지를 가져옴
// (절대 경로 '/image.png'는 Electron 패키징 환경에서 동작하지 않음)
import telegramBg from '../assets/images/telegram_white.png'
import localBg from '../assets/images/local_white.png'

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
    <div className="h-60 bg-white text-gray-800 border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col font-mono shrink-0 relative">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0 relative z-10">
        <span className="text-[10px] text-gray-600 font-bold flex items-center gap-1.5">
          <Terminal size={12} className="text-blue-500" />
          <span>822 AI CORE SYSTEM LOGS</span>
        </span>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#e81123]" />
          <span className="w-2 h-2 rounded-full bg-[#ffb900]" />
          <span className="w-2 h-2 rounded-full bg-[#107c10]" />
        </div>
      </div>
      
      {/* 백그라운드 이미지 영역 (진행 중일 때만 표시) */}
      {(isAnalyzing || isTelegramActive) && (
        <div className="absolute inset-0 top-[33px] bg-white z-0 flex flex-col items-center justify-center overflow-hidden pointer-events-none">
          <div className="relative w-full h-full flex items-center justify-center p-8">
             <img 
               src={isTelegramActive ? telegramBg : localBg} 
               alt={isTelegramActive ? "Telegram Upload" : "AI Processing"} 
               className="w-full h-full object-contain z-0 opacity-100" 
             />
          </div>
        </div>
      )}

      {/* 메인 로그 뷰 (항상 표시, 배경 위에 투명하게 올라감) */}
      <div className="flex-1 overflow-y-auto p-4 text-[10px] leading-relaxed space-y-2 text-gray-800 select-text relative z-10 bg-transparent font-medium drop-shadow-sm">
        {consoleLogs.length === 0 ? (
          <div className="text-gray-400 italic">[대기] 대표 사진 지정 완료 및 그룹 확정 후 분석을 개시하세요.</div>
        ) : (
          consoleLogs.map((log, idx) => {
            let colorClass = 'text-gray-700'
            if (log.startsWith('[에러]')) colorClass = 'text-red-500 font-medium'
            else if (log.startsWith('🤖') || log.startsWith('⚙️')) colorClass = 'text-blue-600'
            else if (log.startsWith('📊') || log.startsWith('🎉')) colorClass = 'text-amber-600 font-medium'
            else if (log.startsWith('💡')) colorClass = 'text-gray-900 font-bold'
            else if (log.startsWith('──')) colorClass = 'text-gray-400'

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
