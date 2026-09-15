
import { X, Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface UpdaterModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: any;
  isDownloading: boolean;
  downloadProgress: any;
  isDownloaded: boolean;
  error: string | null;
  onDownload: () => void;
  onInstall: () => void;
}

export function UpdaterModal({
  isOpen,
  onClose,
  updateInfo,
  isDownloading,
  downloadProgress,
  isDownloaded,
  error,
  onDownload,
  onInstall
}: UpdaterModalProps) {
  if (!isOpen) return null;

  // Format release notes (often HTML from GitHub)
  const renderReleaseNotes = () => {
    if (!updateInfo?.releaseNotes) return <p className="text-slate-400 italic">업데이트 내역이 없습니다.</p>;
    
    // electron-updater sometimes returns string, sometimes array of objects
    let notes = updateInfo.releaseNotes;
    if (Array.isArray(notes)) {
      notes = notes.map((n: any) => n.note || n).join('\n');
    }
    
    // Strip HTML tags if it's HTML, or just render it safely
    // A simple approach is using dangerouslySetInnerHTML if we trust GitHub notes, 
    // but for safety we can just render text or simple HTML.
    return (
      <div 
        className="prose prose-invert max-w-none text-sm text-slate-300" 
        dangerouslySetInnerHTML={{ __html: typeof notes === 'string' ? notes : JSON.stringify(notes) }} 
      />
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-700 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
              <RefreshCw size={18} />
            </div>
            <h2 className="text-lg font-bold text-white">새로운 업데이트 가능</h2>
          </div>
          <button 
            onClick={onClose}
            disabled={isDownloading && !isDownloaded}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          {error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex gap-3 text-red-400">
              <AlertCircle className="shrink-0" size={20} />
              <div>
                <h4 className="font-semibold text-red-300 mb-1">업데이트 오류</h4>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                <div>
                  <div className="text-xs text-slate-400 mb-1 font-medium">새 버전</div>
                  <div className="text-2xl font-bold text-emerald-400">v{updateInfo?.version || 'Unknown'}</div>
                </div>
                {updateInfo?.releaseDate && (
                  <div className="text-right border-l border-slate-700/50 pl-6">
                    <div className="text-xs text-slate-400 mb-1 font-medium">출시일</div>
                    <div className="text-sm font-medium text-slate-300">
                      {new Date(updateInfo.releaseDate).toLocaleDateString()}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/80 rounded-lg border border-slate-700/50 p-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <span>업데이트 내역</span>
                </h3>
                <div className="bg-slate-950/50 rounded p-4 border border-slate-700/30 max-h-60 overflow-y-auto custom-scrollbar">
                  {renderReleaseNotes()}
                </div>
              </div>
            </>
          )}

          {/* Progress */}
          {isDownloading && !isDownloaded && !error && (
            <div className="mt-6 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
              <div className="flex justify-between text-xs text-slate-400 mb-2 font-medium">
                <span className="flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin text-blue-400" />
                  다운로드 중...
                </span>
                <span className="text-blue-400 font-bold">{downloadProgress?.percent ? Math.round(downloadProgress.percent) : 0}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50 shadow-inner">
                <div 
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300 relative"
                  style={{ width: `${downloadProgress?.percent || 0}%` }}
                >
                  <div className="absolute inset-0 bg-white/20" style={{ backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)', backgroundSize: '1rem 1rem' }}></div>
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 mt-2 font-mono">
                <span>{downloadProgress?.transferred ? (downloadProgress.transferred / 1024 / 1024).toFixed(1) : 0} MB / {downloadProgress?.total ? (downloadProgress.total / 1024 / 1024).toFixed(1) : 0} MB</span>
                <span>{downloadProgress?.bytesPerSecond ? (downloadProgress.bytesPerSecond / 1024 / 1024).toFixed(1) : 0} MB/s</span>
              </div>
            </div>
          )}

          {isDownloaded && !error && (
            <div className="mt-6 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 flex items-center gap-3 text-emerald-400 shadow-inner shadow-emerald-500/10">
              <CheckCircle2 size={24} className="shrink-0" />
              <div>
                <div className="font-bold mb-0.5">다운로드 완료!</div>
                <div className="text-xs text-emerald-500/80">앱을 재시작하여 새로운 버전을 설치합니다.</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/50 flex justify-end gap-3 shrink-0">
          {!isDownloading && !isDownloaded && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                나중에
              </button>
              <button
                onClick={onDownload}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20"
              >
                <Download size={16} />
                다운로드 및 업데이트
              </button>
            </>
          )}
          {isDownloaded && (
            <button
              onClick={onInstall}
              className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors shadow-lg shadow-emerald-500/20 animate-pulse"
            >
              재시작 및 설치
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
