
import { DownloadCloud, Key, X, FileText, Megaphone } from 'lucide-react';
import changelog from './changelog.json';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckUpdates: () => void;
  isCheckingUpdate: boolean;
  updateInfo: any;
  isDownloaded: boolean;
  onOpenChangePassword: () => void;
  onOpenNotice: () => void;
}

export function GlobalSettingsModal({
  isOpen,
  onClose,
  onCheckUpdates,
  isCheckingUpdate,
  updateInfo,
  isDownloaded,
  onOpenChangePassword,
  onOpenNotice
}: GlobalSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-xl w-full max-w-2xl shadow-2xl border border-slate-700 flex flex-col overflow-hidden relative max-h-[85vh]">
        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-100">프로그램 설정</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 flex flex-col md:flex-row gap-6 overflow-hidden">
          {/* 좌측: 버튼 영역 */}
          <div className="flex flex-col space-y-4 md:w-1/3 shrink-0">
            <button 
              onClick={() => {
                onClose();
                onOpenNotice();
              }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 px-4 rounded-lg flex justify-center items-center gap-2 font-bold transition-colors shadow-sm"
            >
              <Megaphone size={20} />
              공지사항 (게시판)
            </button>
            <button 
              onClick={onCheckUpdates}
              disabled={isCheckingUpdate}
              className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-3 px-4 rounded-lg flex justify-center items-center gap-2 font-medium transition-colors"
            >
              <DownloadCloud size={20} className={isCheckingUpdate ? "animate-pulse" : ""} />
              {isCheckingUpdate ? "확인 중.." : updateInfo && !isDownloaded ? "업데이트 가능" : isDownloaded ? "설치 대기중" : "업데이트 확인"}
            </button>
            <button 
              onClick={() => {
                onClose();
                onOpenChangePassword();
              }}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3 px-4 rounded-lg flex justify-center items-center gap-2 font-medium transition-colors"
            >
              <Key size={20} />
              비밀번호 변경
            </button>
          </div>

          {/* 우측: 업데이트 히스토리 */}
          <div className="flex-1 flex flex-col bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden">
            <div className="p-3 border-b border-slate-700 bg-slate-800/80 flex items-center gap-2">
              <FileText size={16} className="text-slate-400" />
              <h3 className="text-sm font-bold text-slate-300">업데이트 히스토리 (패치 내역)</h3>
            </div>
            <div className="p-4 overflow-y-auto space-y-6 flex-1 custom-scrollbar" style={{ maxHeight: '60vh' }}>
              {changelog.map((log, index) => (
                <div key={index} className="relative pl-4 border-l-2 border-slate-700">
                  <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-lg font-bold text-blue-400">v{log.version}</span>
                    <span className="text-xs text-slate-500 font-medium">{log.date}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {log.changes.map((change, cIdx) => (
                      <li key={cIdx} className="text-sm text-slate-300 flex items-start">
                        <span className="text-slate-500 mr-2 mt-0.5">•</span>
                        <span className="leading-relaxed">{change}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
