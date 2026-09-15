import { useState, useEffect, useRef } from 'react';
import { Settings, Play, Download, Trash2, CheckSquare, Square, Image as ImageIcon, ChevronUp, ChevronDown, Square as StopIcon } from 'lucide-react';
import type { UploadSettings, SpreadsheetRow } from './types';
import { BandIcon } from './PlatformIcons';

export function UploadPanel({ isActive }: { isActive?: boolean }) {
  const [settings, setSettings] = useState<UploadSettings>({
    bandUrl: '',
    googleSpreadsheetUrl: '',
    delaySeconds: 0,
  });

  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isScheduledWait, setIsScheduledWait] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState<Record<number, '대기' | '⏰ 예약 대기중' | '⏳ 즉시 업로드 대기중' | '업로드 중' | '완료' | '실패' | '삭제 중' | '삭제 완료'>>({});
  const [postUrls, setPostUrls] = useState<Record<number, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showUploadOptionsModal, setShowUploadOptionsModal] = useState(false);
  const [uploadType, setUploadType] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledTime, setScheduledTime] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const deleteMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electron.getUploadSettings().then((saved: UploadSettings | null) => {
      if (saved) {
        setSettings(saved);
      } else {
        window.electron.getCatalogSettings().then((catalogSaved: any) => {
          if (catalogSaved && catalogSaved.googleSpreadsheetUrl) {
            setSettings(prev => ({ ...prev, googleSpreadsheetUrl: catalogSaved.googleSpreadsheetUrl }));
          }
        });
      }
    });

    const cleanupLog = window.electron.onUploadLog((msg: string) => {
      setLogs(prev => [...prev.slice(-100), `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`]);
      
      const startMatch = msg.match(/\[행 (\d+)\] .*업로드 시작/);
      if (startMatch) setUploadStatus(prev => ({ ...prev, [parseInt(startMatch[1])]: '업로드 중' }));
      
      const completeMatch = msg.match(/\[행 (\d+)\] 업로드 완료/);
      if (completeMatch) setUploadStatus(prev => ({ ...prev, [parseInt(completeMatch[1])]: '완료' }));
      
      const deleteStartMatch = msg.match(/\[행 (\d+)\] 게시물 삭제 시작/);
      if (deleteStartMatch) setUploadStatus(prev => ({ ...prev, [parseInt(deleteStartMatch[1])]: '삭제 중' }));
      
      const deleteCompleteMatch = msg.match(/\[행 (\d+)\] 밴드 게시물이 성공적으로 삭제/);
      if (deleteCompleteMatch) setUploadStatus(prev => ({ ...prev, [parseInt(deleteCompleteMatch[1])]: '삭제 완료' }));
      
      const failMatch = msg.match(/\[행 (\d+)\] (?:게시물 삭제 실패|업로드 실패)/);
      if (failMatch) setUploadStatus(prev => ({ ...prev, [parseInt(failMatch[1])]: '실패' }));
    });

    const handleClickOutside = (event: MouseEvent) => {
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(event.target as Node)) {
        setDeleteMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const cleanupStatus = window.electron.onUploadStatus((status: string) => {
      if (status === 'started') { setIsUploading(true); setIsScheduledWait(false); }
      if (status === 'scheduled') { setIsUploading(false); setIsScheduledWait(true); }
      if (status === 'stopped' || status === 'finished' || status === 'error') { setIsUploading(false); setIsScheduledWait(false); }
    });

    let cleanupSuccess: () => void;
    if (window.electron.onUploadRowSuccess) {
      cleanupSuccess = window.electron.onUploadRowSuccess((data: { rowIndex: number, postUrl: string }) => {
        if (data.postUrl) {
          setPostUrls(prev => ({ ...prev, [data.rowIndex]: data.postUrl }));
        }
      });
    }

    return () => {
      cleanupLog();
      cleanupStatus();
      if (cleanupSuccess) cleanupSuccess();
    };
  }, []);

  // Auto load data when settings are ready or tab becomes active
  useEffect(() => {
    if (isActive && settings.googleSpreadsheetUrl) {
      handleLoadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, settings.googleSpreadsheetUrl]);

  // 큐 카운트 폴링
  useEffect(() => {
    let queueTimer: any;
    if (isActive) {
      const fetchQueue = async () => {
        try {
          const queue = await window.electron.getUploadQueue();
          if (queue) {
            setQueueCount(queue.filter((q: any) => q.status === 'PENDING').length);
            
            setUploadStatus(prev => {
              const newStatus = { ...prev };
              let changed = false;
              rows.forEach(r => {
                const qItem = queue.find((q: any) => String(q.prodCode) === String(r.productCode));
                if (qItem && qItem.status === 'PENDING') {
                  const now = Date.now();
                  const isImmediate = qItem.scheduledTime <= now + 60000;
                  const targetStatus = isImmediate ? '⏳ 즉시 업로드 대기중' : '⏰ 예약 대기중';
                  if (newStatus[r.rowIndex] !== targetStatus) {
                    newStatus[r.rowIndex] = targetStatus;
                    changed = true;
                  }
                } else if ((newStatus[r.rowIndex] === '⏰ 예약 대기중' || newStatus[r.rowIndex] === '⏳ 즉시 업로드 대기중') && (!qItem || qItem.status !== 'PENDING')) {
                  newStatus[r.rowIndex] = '대기';
                  changed = true;
                }
              });
              return changed ? newStatus : prev;
            });
          }
        } catch (e) {}
      };
      fetchQueue();
      queueTimer = setInterval(fetchQueue, 1000); // 1초마다 갱신
    }
    
    return () => {
      if (queueTimer) clearInterval(queueTimer);
    };
  }, [isActive, rows]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleSaveSettings = async () => {
    await window.electron.saveUploadSettings(settings);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 설정이 저장되었습니다.`]);
    setShowSettings(false);
  };

  const handleLoadData = async () => {
    if (!settings.googleSpreadsheetUrl) {
      alert('스프레드시트 URL을 입력해주세요.');
      return;
    }
    
    setIsLoading(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ⏳ 구글 스프레드시트 데이터 불러오는 중...`]);
    try {
      const data = await window.electron.fetchSpreadsheetData(settings.googleSpreadsheetUrl, 'band');
      if (data && Array.isArray(data)) {
        const sortedData = data.sort((a: SpreadsheetRow, b: SpreadsheetRow) => {
           const numA = parseInt(String(a.productCode).replace(/[^0-9]/g, '') || '0', 10);
           const numB = parseInt(String(b.productCode).replace(/[^0-9]/g, '') || '0', 10);
           return numA - numB;
        });
        setRows(sortedData);
        setSelectedRows(new Set());
        // 초기 상태 설정
        const initialStatus: Record<number, '대기'> = {};
        data.forEach((r: SpreadsheetRow) => initialStatus[r.rowIndex] = '대기');
        setUploadStatus(initialStatus);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 데이터 ${data.length}건을 성공적으로 불러왔습니다.`]);
      } else {
        throw new Error('데이터 형식이 올바르지 않습니다.');
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 데이터 불러오기 실패: ${err.message}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRowSelection = (rowIndex: number) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(rowIndex)) {
      newSet.delete(rowIndex);
    } else {
      newSet.add(rowIndex);
    }
    setSelectedRows(newSet);
  };

  const toggleAll = () => {
    const unuploadedRows = rows.filter(r => {
      const loc = r.location || '';
      return !(loc === '밴드등록' || loc.startsWith('http') || postUrls[r.rowIndex]);
    });

    const isAllUnuploadedSelected = unuploadedRows.length > 0 && unuploadedRows.every(r => selectedRows.has(r.rowIndex));

    if (isAllUnuploadedSelected || (selectedRows.size > 0 && unuploadedRows.length === 0)) {
      setSelectedRows(new Set());
    } else {
      if (unuploadedRows.length === 0) {
        alert('업로드할 미등록 항목이 없습니다.');
      } else {
        setSelectedRows(new Set(unuploadedRows.map(r => r.rowIndex)));
      }
    }
  };

  const startUpload = (scheduledTimeStr?: string) => {
    if (selectedRows.size === 0) {
      alert('업로드할 항목을 선택해주세요.');
      return;
    }
    if (!settings.bandUrl) {
      alert('업로드할 밴드 URL을 입력해주세요.');
      setShowSettings(true);
      return;
    }
    
    const rowsToUpload = rows.filter(r => selectedRows.has(r.rowIndex));
    window.electron.startAutoUpload({ settings, rows: rowsToUpload, scheduledTime: scheduledTimeStr });
  };

  const stopUpload = () => {
    window.electron.stopAutoUpload();
  };

  const stopDelete = () => {
    window.electron.stopBulkBandPosts();
  };

  const handleHardDelete = async () => {
    if (selectedRows.size === 0) return;

    const rowsToDelete = rows.filter(r => selectedRows.has(r.rowIndex));
    const registeredRows = rowsToDelete.filter(r => r.location === '밴드등록' || r.location?.startsWith('http') || postUrls[r.rowIndex]);

    let warningMsg = `🚨 [강력 경고] 선택한 ${rowsToDelete.length}개의 상품을 완전 삭제합니다.\n(구글 시트 데이터 및 로컬 이미지 폴더 영구 삭제)\n\n`;
    if (registeredRows.length > 0) {
      warningMsg += `※ 현재 밴드에 등록된 게시글(${registeredRows.length}개)이 감지되었습니다.\n밴드 게시글을 먼저 삭제한 뒤 데이터를 완전히 지웁니다.\n\n`;
    }
    warningMsg += `정말로 삭제하시겠습니까? (되돌릴 수 없습니다!)`;

    if (!window.confirm(warningMsg)) return;

    setIsLoading(true);
    setIsDeleting(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] 🚨 완전 삭제 작업 시작...`]);
    try {
      if (registeredRows.length > 0) {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] 🗑️ 밴드 게시글 선행 삭제 중...`]);
        const requests = registeredRows.map(row => ({
          postUrl: postUrls[row.rowIndex] || (row.location?.startsWith('http') ? row.location : ''),
          rowIndex: row.rowIndex,
          productCode: row.productCode
        }));
        await window.electron.deleteBulkBandPosts(requests, settings);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 밴드 삭제 완료`]);
      }

      const result = await window.electron.deleteSpreadsheetRows(settings, rowsToDelete, 'band');
      if (result.success) {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 완전 삭제 성공: ${result.message}`]);
        alert(result.message);
        setSelectedRows(new Set());
        await handleLoadData();
      } else {
        throw new Error(result.message);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 완전 삭제 실패: ${err.message}`]);
      alert(`삭제 실패: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsDeleting(false);
    }
  };
  const handleDeleteBandSelected = async () => {
    const rowsToDelete = rows.filter(r => selectedRows.has(r.rowIndex));
    
    // 등록된 항목만 필터링
    const registeredRows = rowsToDelete.filter(r => r.location === '밴드등록' || r.location?.startsWith('http') || postUrls[r.rowIndex]);
    
    if (registeredRows.length === 0) {
      alert('밴드에 등록된 항목이 선택되지 않았습니다.');
      return;
    }

    const confirmDelete = window.confirm(
      `선택한 ${registeredRows.length}개의 게시물을 밴드에서 삭제하시겠습니까?\n\n(구글 시트의 밴드등록 상태는 '데이터 없음'으로 변경됩니다)`
    );

    if (!confirmDelete) return;

    setIsLoading(true);
    setIsDeleting(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ⏳ 선택한 상품 밴드에서 삭제 중...`]);
    try {
      const requests = registeredRows.map(row => ({
        postUrl: postUrls[row.rowIndex] || (row.location?.startsWith('http') ? row.location : ''),
        rowIndex: row.rowIndex,
        productCode: row.productCode
      }));
      await window.electron.deleteBulkBandPosts(requests, settings);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 선택한 상품의 밴드 삭제 작업이 모두 완료되었습니다.`]);
      alert('선택한 항목의 밴드 삭제 작업이 완료되었습니다.');
      // 데이터 다시 불러오기
      await handleLoadData();
      setSelectedRows(new Set());
    } catch (err: any) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 밴드 삭제 작업 중단: ${err.message}`]);
      alert(`삭제 중단: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 h-full overflow-hidden bg-slate-900 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
            <Play className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              밴드 업로드 봇
            </h2>
            {queueCount > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500 text-white animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.6)]">⏰ 대기열: {queueCount}건 진행중</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadData}
            disabled={isLoading}
            title="시트 데이터 새로고침"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            데이터 새로고침
          </button>
          <button
            onClick={isUploading || isScheduledWait ? stopUpload : () => setShowUploadOptionsModal(true)}
            disabled={isLoading || rows.length === 0 || (!isUploading && !isScheduledWait && selectedRows.size === 0)}
            title={isUploading ? '밴드 업로드 중지' : isScheduledWait ? '예약 대기 취소' : '선택 상품 밴드 업로드'}
            className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
              isUploading || isScheduledWait
                ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 animate-pulse'
                : 'bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-900/20'
            }`}
          >
            {isUploading || isScheduledWait ? (
              <>
                <StopIcon className="w-4 h-4" />
                {isUploading ? '업로드 중지' : '예약 취소'}
              </>
            ) : (
              <>
                <BandIcon size={18} />
                밴드 업로드
              </>
            )}
          </button>
          
          <div className="relative" ref={deleteMenuRef}>
            <button
              onClick={() => {
                if (isDeleting) stopDelete();
                else setDeleteMenuOpen(prev => !prev);
              }}
              disabled={(isLoading && !isDeleting) || rows.length === 0 || isUploading || (!isDeleting && selectedRows.size === 0)}
              title={isDeleting ? '삭제 중지' : '삭제 메뉴 열기'}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors min-w-[100px] ${
                isDeleting
                  ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 animate-pulse'
                  : 'bg-rose-900 hover:bg-rose-800 text-rose-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-md'
              }`}
            >
              {isDeleting ? (
                <>
                  <StopIcon className="w-4 h-4" />
                  삭제 중지
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  삭제
                  <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${deleteMenuOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>
            
            {deleteMenuOpen && !isDeleting && (
              <div className="absolute top-full right-0 mt-2 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                <button onClick={() => { setDeleteMenuOpen(false); handleDeleteBandSelected(); }} className="px-4 py-2.5 text-left text-sm font-medium text-rose-100 hover:bg-rose-900/50 flex items-center gap-3 transition-colors border-b border-slate-700">
                  <BandIcon size={16} />
                  선택 상품 밴드 삭제
                </button>
                <button onClick={() => { setDeleteMenuOpen(false); handleHardDelete(); }} className="px-4 py-2.5 text-left text-sm font-bold text-red-500 hover:bg-red-900/50 flex items-center gap-3 transition-colors bg-red-950/20">
                  <Trash2 className="w-4 h-4 text-red-500" />
                  선택 상품 완전 삭제
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="업로드 설정"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Settings Modal/Panel */}
      {showSettings && (
        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-5 shadow-lg shrink-0">
          <div className="flex justify-between items-center mb-4">
             <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Settings className="w-4 h-4 text-purple-400" /> 업로드 설정
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-slate-300">
              <ChevronUp size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">게시글을 올릴 밴드 URL</label>
              <input
                type="text"
                value={settings.bandUrl}
                onChange={e => setSettings({...settings, bandUrl: e.target.value})}
                placeholder="https://band.us/band/..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">구글 스프레드시트 URL</label>
              <input
                type="text"
                value={settings.googleSpreadsheetUrl}
                onChange={e => setSettings({...settings, googleSpreadsheetUrl: e.target.value})}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">업로드 대기 시간 (초)</label>
              <input
                type="number"
                min="0"
                value={settings.delaySeconds}
                onChange={e => setSettings({...settings, delaySeconds: parseInt(e.target.value) || 0})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="flex items-end pt-2">
              <button
                onClick={handleSaveSettings}
                className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                설정 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Area */}
      <div className="flex-1 bg-slate-950 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden shadow-inner min-h-0">
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 flex-col gap-3">
              <Download className="w-8 h-8 opacity-20" />
              <p>우측 상단의 [데이터 새로고침] 버튼을 눌러 스프레드시트를 불러오세요.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900 sticky top-0 z-10 shadow-sm border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-12 text-center uppercase tracking-wider">
                    <button onClick={toggleAll} className="hover:text-white" title="미등록 항목 전체 선택/해제">
                      {selectedRows.size > 0 ? (
                        <CheckSquare className="w-4 h-4 mx-auto text-purple-400" />
                      ) : (
                        <Square className="w-4 h-4 mx-auto" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-16 text-center uppercase tracking-wider">사진</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-24 uppercase tracking-wider">코드</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-24 uppercase tracking-wider">등록일</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 uppercase tracking-wider">제품명</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 uppercase tracking-wider">시작가격</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 uppercase tracking-wider">낙찰가격</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 uppercase tracking-wider">낙찰자</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-24 uppercase tracking-wider">상태</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-32 uppercase tracking-wider">밴드등록</th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-32 uppercase tracking-wider">작업 상태</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-800/60">
                {rows.map((row) => {
                  const isSelected = selectedRows.has(row.rowIndex);
                  const status = uploadStatus[row.rowIndex] || '대기';
                  
                  // 썸네일 URL 생성 (로컬 이미지 우선)
                  let thumbnailUrl = row.localThumbnailBase64 || '';
                  if (!thumbnailUrl && row.imageLinks && row.imageLinks.length > 0) {
                    const match = row.imageLinks[0].match(/[-\w]{25,}/);
                    if (match) {
                      thumbnailUrl = `https://drive.google.com/uc?export=view&id=${match[0]}`;
                    }
                  }

                  return (
                    <tr 
                      key={row.rowIndex} 
                      className={`hover:bg-slate-800/40 transition-colors ${isSelected ? 'bg-purple-900/10' : ''}`}
                    >
                      <td className="py-2.5 px-4 text-center cursor-pointer" onClick={() => toggleRowSelection(row.rowIndex)}>
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-purple-400 mx-auto" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 mx-auto" />
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt="thumb" className={`w-10 h-10 object-cover rounded-md border border-slate-700/50 mx-auto bg-slate-800`} />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-slate-800 border border-slate-700/50 flex items-center justify-center mx-auto text-slate-600">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-300">{row.productCode}</td>
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">{row.registrationDate || '-'}</td>
                      <td className="py-2.5 px-4 text-slate-300 text-[11px] max-w-[200px] truncate" title={row.productName}>
                        {(() => {
                          const url = postUrls[row.rowIndex] || (row.location?.startsWith('http') ? row.location : null);
                          return url ? (
                            <button 
                              onClick={() => window.electron.openExternal(url)}
                              className="text-blue-400 hover:text-blue-300 hover:underline text-left truncate w-full"
                            >
                              {row.productName || '-'}
                            </button>
                          ) : (
                            <>{row.productName || '-'}</>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">{row.startingBid || '-'}</td>
                      <td className="py-2.5 px-4 text-slate-300">{row.finalPrice || '-'}</td>
                      <td className="py-2.5 px-4 text-slate-300">{row.winnerName || '-'}</td>
                      <td className="py-2.5 px-4">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${row.status === 'onsale' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                          {row.status || '데이터 없음'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        {(() => {
                          const loc = row.location || '';
                          const isRegistered = loc === '밴드등록' || loc.startsWith('http');
                          return isRegistered ? (
                            <span className="text-green-500 font-bold">밴드등록</span>
                          ) : (
                            <span className="text-slate-500 text-xs font-medium">{loc || '데이터 없음'}</span>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          {status === '대기' && <span className="w-2 h-2 rounded-full bg-slate-600"></span>}
                          {status === '⏰ 예약 대기중' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>}
                          {status === '업로드 중' && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>}
                          {status === '삭제 중' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>}
                          {(status === '완료' || status === '삭제 완료') && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
                          {status === '실패' && <span className="w-2 h-2 rounded-full bg-red-500"></span>}
                          <span className={`text-[11px] font-medium ${
                            (status === '완료' || status === '삭제 완료') ? 'text-green-400' :
                            status === '⏰ 예약 대기중' ? 'text-blue-400' :
                            status === '업로드 중' ? 'text-yellow-400' :
                            status === '삭제 중' ? 'text-red-400' :
                            status === '실패' ? 'text-red-400' :
                            'text-slate-400'
                          }`}>
                            {status}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Small Log Footer */}
        <div className="h-32 border-t border-slate-800 bg-slate-900/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/50">
            <span className="text-[10px] font-bold text-slate-500 uppercase">최근 진행 로그</span>
            <button onClick={() => setLogs([])} className="text-slate-600 hover:text-slate-400">
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-snug text-slate-400">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 italic">로그가 없습니다.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="mb-0.5 break-all">{log}</div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Upload Options Modal */}
      {showUploadOptionsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 p-6 rounded-xl shadow-2xl w-96 max-w-[90vw]">
            <h3 className="text-lg font-bold text-slate-100 mb-4">업로드 방식 선택</h3>
            
            <div className="space-y-3 mb-6">
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${uploadType === 'immediate' ? 'bg-purple-900/30 border-purple-500' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}>
                <input type="radio" name="uploadType" className="hidden" checked={uploadType === 'immediate'} onChange={() => setUploadType('immediate')} />
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${uploadType === 'immediate' ? 'border-purple-400' : 'border-slate-500'}`}>
                  {uploadType === 'immediate' && <div className="w-2 h-2 rounded-full bg-purple-400" />}
                </div>
                <div className="text-sm font-medium text-slate-200">즉시 업로드</div>
              </label>

              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${uploadType === 'scheduled' ? 'bg-purple-900/30 border-purple-500' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}>
                <input type="radio" name="uploadType" className="hidden" checked={uploadType === 'scheduled'} onChange={() => setUploadType('scheduled')} />
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${uploadType === 'scheduled' ? 'border-purple-400' : 'border-slate-500'}`}>
                  {uploadType === 'scheduled' && <div className="w-2 h-2 rounded-full bg-purple-400" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-200">예약 업로드</div>
                  {uploadType === 'scheduled' && (
                    <input 
                      type="datetime-local" 
                      value={scheduledTime}
                      onChange={e => setScheduledTime(e.target.value)}
                      className="mt-2 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  )}
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowUploadOptionsModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowUploadOptionsModal(false);
                  startUpload(uploadType === 'scheduled' ? scheduledTime : undefined);
                }}
                disabled={uploadType === 'scheduled' && !scheduledTime}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                업로드 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
