import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, CheckSquare, Square, Image as ImageIcon, Zap, Ban, Store, Trash2, ArrowUp, ArrowDown, Upload, Layers, ChevronDown } from 'lucide-react';
import type { SpreadsheetRow } from './types';
import { FruitsIcon, DaangnIcon } from './PlatformIcons';

type MarketStatus = '대기' | '업로드 중' | '완료' | '실패' | '삭제 중' | '삭제 완료';
type SortKey = 'code' | 'price' | 'date';
type StatusFilter = 'all' | 'onsale' | 'sold';

/** "8. 25" 형식 등록일을 비교 가능한 숫자로 변환 */
function parseRegDate(s: string): number {
  const m = String(s).match(/(\d+)\.\s*(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10);
}

/**
 * [MarketUploadPanel.tsx]
 * 오픈마켓(번개장터/후르츠패밀리) 업로드 패널
 * - /오픈마켓업로드 로 등록된 전용 시트(openMarketSpreadsheetUrl)를 사용
 * - T열(마켓용 제품설명), G열(성별) 데이터를 기반으로 업로드
 */
export function MarketUploadPanel({ isActive }: { isActive?: boolean }) {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [uploadStatus, setUploadStatus] = useState<Record<number, MarketStatus>>({});
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [ldGuideOpen, setLdGuideOpen] = useState(false);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const deleteMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target as Node)) {
        setUploadMenuOpen(false);
      }
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(event.target as Node)) {
        setDeleteMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 정렬 토글 (같은 키 재클릭 시 방향 전환, 다른 키 클릭 시 내림차순 시작)
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // 상태 필터 3단 순환: 전체 → onsale만 → sold만 → 전체
  const cycleStatusFilter = () => {
    setStatusFilter(prev => (prev === 'all' ? 'onsale' : prev === 'onsale' ? 'sold' : 'all'));
  };

  // 필터 + 정렬 적용된 행 목록
  const displayedRows = useMemo(() => {
    let list = [...rows];
    if (statusFilter !== 'all') {
      list = list.filter(r => (r.status || '').toLowerCase().includes(statusFilter));
    }
    const num = (v?: string) => parseInt(String(v || '').replace(/[^0-9]/g, ''), 10) || 0;
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'code') {
        cmp = num(a.productCode) - num(b.productCode);
      } else if (sortKey === 'price') {
        cmp = num(a.finalPrice) - num(b.finalPrice);
      } else if (sortKey === 'date') {
        cmp = parseRegDate(a.registrationDate || '') - parseRegDate(b.registrationDate || '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortDir, statusFilter]);

  useEffect(() => {
    // 밴드와 동일한 스프레드시트를 공유하고, 시트탭(오픈마켓)으로만 구분합니다.
    window.electron.getCatalogSettings().then((saved: any) => {
      if (saved?.googleSpreadsheetUrl) setSpreadsheetUrl(saved.googleSpreadsheetUrl);
    });
  }, []);

  // 마켓 진행 이벤트 → 로그 + 행별 상태 반영
  useEffect(() => {
    const cleanup = window.electron.onMarketProgress((data: { prodCode: string; platform: string; status: string; error?: string }) => {
      const { prodCode, platform, status, error } = data;
      const label = platform === 'bunjang' ? '번개장터' : '후르츠패밀리';
      const ts = new Date().toLocaleTimeString('ko-KR');
      const statusMap: Record<string, MarketStatus> = {
        uploading: '업로드 중', success: '완료', failed: '실패',
        deleting: '삭제 중', delete_success: '삭제 완료', delete_failed: '실패',
      };

      if (status === 'failed' || status === 'delete_failed') {
        setLogs(prev => [...prev.slice(-200), `[${ts}] ❌ [${label}] ${prodCode}: ${error || '실패'}`]);
      } else if (status === 'success') {
        setLogs(prev => [...prev.slice(-200), `[${ts}] ✅ [${label}] ${prodCode} 업로드 성공!`]);
        // 업로드 현황 컬럼 즉시 갱신
        setRows(prev => prev.map(r =>
          String(r.productCode).replace(/[^0-9]/g, '') === String(prodCode).replace(/[^0-9]/g, '')
            ? { ...r, bunjangPid: platform === 'bunjang' ? '업로드됨' : r.bunjangPid, fruitsPid: platform === 'fruits' ? '업로드됨' : r.fruitsPid }
            : r
        ));
      } else if (status === 'uploading' || status === 'deleting') {
        setLogs(prev => [...prev.slice(-200), `[${ts}] ⏳ [${label}] ${prodCode} 작업 시작...`]);
      }

      const target = statusMap[status];
      if (target) {
        setUploadStatus(prev => {
          const row = rows.find(r => String(r.productCode).replace(/[^0-9]/g, '') === String(prodCode).replace(/[^0-9]/g, ''));
          if (!row) return prev;
          return { ...prev, [row.rowIndex]: target };
        });
      }
    });
    return cleanup;
  }, [rows]);

  // 마켓 상세 로그 (이미지 수집 등)
  useEffect(() => {
    const cleanup = window.electron.onMarketLog((msg: string) => {
      setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`]);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (isActive && spreadsheetUrl) handleLoadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, spreadsheetUrl]);

  const handleBunjangCheckSession = async () => {
    setIsWorking(true);
    setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ⚡ 번개장터 세션 체크 (창 열기 요청...)`]);
    try {
      await window.electron.checkBunjangSession();
      setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 번개장터 창을 열었습니다. 로그인이 되어있는지 확인해주세요.`]);
    } catch (e: any) {
      alert(`번개장터 창 열기 실패: ${e.message}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleLoadData = async () => {
    if (!spreadsheetUrl) {
      setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ⚠️ AI 분석봇 설정에서 구글 스프레드시트 URL을 먼저 저장해주세요.`]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await window.electron.fetchSpreadsheetData(spreadsheetUrl, 'market');
      if (data && Array.isArray(data)) {
        const sorted = data.sort((a: SpreadsheetRow, b: SpreadsheetRow) => {
          const numA = parseInt(String(a.productCode).replace(/[^0-9]/g, '') || '0', 10);
          const numB = parseInt(String(b.productCode).replace(/[^0-9]/g, '') || '0', 10);
          return numB - numA;
        });
        setRows(sorted);
        setSelectedRows(new Set());
        const initial: Record<number, MarketStatus> = {};
        data.forEach((r: SpreadsheetRow) => initial[r.rowIndex] = '대기');
        setUploadStatus(initial);
        setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 오픈마켓 시트 ${data.length}건 로드 완료`]);
      } else {
        throw new Error('데이터 형식이 올바르지 않습니다.');
      }
    } catch (err: any) {
      setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 데이터 불러오기 실패: ${err.message}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRowSelection = (rowIndex: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === displayedRows.length && displayedRows.length > 0) setSelectedRows(new Set());
    else setSelectedRows(new Set(displayedRows.map(r => r.rowIndex)));
  };



  const handleUpload = async (platform: 'all' | 'bunjang' | 'fruits' | 'joongna') => {
    const selectedRowsData = rows.filter(r => selectedRows.has(r.rowIndex));
    if (selectedRowsData.length === 0) return alert('업로드할 상품을 선택해주세요.');

    const isUploaded = (pid?: string) => {
      if (!pid) return false;
      const t = pid.trim().toUpperCase();
      return t !== '' && !t.startsWith('D') && !t.startsWith('#') && t !== 'FALSE' && t !== '삭제됨' && t !== '미등록' && t !== '개발중';
    };

    const normalize = (c?: string | number) => String(c).replace(/[^0-9]/g, '');

    const bunjangCodes = selectedRowsData.filter(r => !isUploaded(r.bunjangPid)).map(r => normalize(r.productCode)).filter(Boolean);
    const fruitsCodes = selectedRowsData.filter(r => !isUploaded(r.fruitsPid)).map(r => normalize(r.productCode)).filter(Boolean);
    const joongnaCodes = selectedRowsData.filter(r => !isUploaded(r.joongnaPid)).map(r => normalize(r.productCode)).filter(Boolean);

    let msg = '이미 등록된 마켓은 제외하고 미등록 마켓에만 업로드합니다.\n\n';
    let willUploadAnything = false;

    if (platform === 'all' || platform === 'bunjang') {
       msg += `번개장터: ${bunjangCodes.length}개 업로드 예정\n`;
       if (bunjangCodes.length > 0) willUploadAnything = true;
    }
    if (platform === 'all' || platform === 'fruits') {
       msg += `후르츠패밀리: ${fruitsCodes.length}개 업로드 예정\n`;
       if (fruitsCodes.length > 0) willUploadAnything = true;
    }
    if (platform === 'all' || platform === 'joongna') {
       msg += `중고나라: ${joongnaCodes.length}개 업로드 예정\n`;
       if (joongnaCodes.length > 0) willUploadAnything = true;
    }

    if (!willUploadAnything) {
       return alert('선택하신 상품들은 해당 마켓에 이미 모두 등록되어 있어 새로 업로드할 내용이 없습니다.');
    }

    if (!confirm(`${msg}\n계속하시겠습니까?`)) return;
    
    setIsWorking(true);
    
    const fruitsPromise = (async () => {
      if ((platform === 'all' || platform === 'fruits') && fruitsCodes.length > 0) {
        try {
          const res = await window.electron.uploadFruitsMulti(fruitsCodes, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [후르츠] 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        } catch (e: any) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [후르츠] 실패: ${e.message}`]);
        }
      }
    })();

    const pcMarketsPromise = (async () => {
      if ((platform === 'all' || platform === 'bunjang') && bunjangCodes.length > 0) {
        try {
          const res = await window.electron.uploadBunjangMulti(bunjangCodes, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [번개장터] 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        } catch (e: any) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [번개장터] 실패: ${e.message}`]);
        }
      }
      
      if ((platform === 'all' || platform === 'joongna') && joongnaCodes.length > 0) {
        try {
          const res = await window.electron.uploadJoongnaMulti(joongnaCodes, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [중고나라] 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        } catch (e: any) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ❌ [중고나라] 실패: ${e.message}`]);
        }
      }
    })();

    Promise.all([fruitsPromise, pcMarketsPromise]).finally(() => {
      setIsWorking(false);
    });
  };

  // 일괄 상단업 (UP) 핸들러
  const handleBulkUp = async () => {
    const selected = rows.filter(r => selectedRows.has(r.rowIndex));
    const itemsToUp: { rowIndex: number; platform: string; pid: string }[] = [];

    const isUploaded = (pid?: string) => {
      if (!pid) return false;
      const t = pid.trim().toUpperCase();
      return t !== '' && !t.startsWith('D') && !t.startsWith('#') && t !== 'FALSE' && t !== '삭제됨' && t !== '미등록' && t !== '개발중';
    };

    selected.forEach(r => {
      if (isUploaded(String(r.bunjangPid))) itemsToUp.push({ rowIndex: r.rowIndex, platform: 'bunjang', pid: String(r.bunjangPid) });
      if (isUploaded(String(r.joongnaPid))) itemsToUp.push({ rowIndex: r.rowIndex, platform: 'joongna', pid: String(r.joongnaPid) });
      if (isUploaded(String(r.fruitsPid)))  itemsToUp.push({ rowIndex: r.rowIndex, platform: 'fruits',  pid: String(r.fruitsPid) });
    });

    if (itemsToUp.length === 0) {
      alert('상단업을 진행할 업로드 완료 상품이 없습니다.');
      setUploadMenuOpen(false);
      return;
    }

    if (!confirm(`선택된 상품들의 마켓 상단업(UP) 작업을 시작하시겠습니까?\n총 ${itemsToUp.length}건의 작업이 예상됩니다.`)) return;
    
    setUploadMenuOpen(false);
    setIsWorking(true);
    setLogs(prev => [...prev, `[System] 일괄 상단업(UP) 작업 시작...`]);
    try {
      await window.electron.startBulkUp(itemsToUp);
    } catch (e: any) {
      setLogs(prev => [...prev, `[오류] 상단업 시작 실패: ${e.message}`]);
    }
    setIsWorking(false);
  };

  const handleCancel = async () => {
    await window.electron.cancelMarketUpload();
    setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🛑 마켓 업로드 중단 요청됨`]);
  };

  const handleDelete = async (platform: 'all' | 'bunjang' | 'fruits' | 'joongna') => {
    const rowsToDelete = rows.filter(r => selectedRows.has(r.rowIndex));
    const normalize = (r: SpreadsheetRow) => String(r.productCode).replace(/[^0-9]/g, '');
    const isUploaded = (pid?: string) => {
      if (!pid) return false;
      const t = pid.trim().toUpperCase();
      return t !== '' && !t.startsWith('D') && !t.startsWith('#') && t !== 'FALSE';
    };

    const bunjangTargets = (platform === 'all' || platform === 'bunjang') 
      ? rowsToDelete.filter(r => isUploaded(r.bunjangPid)).map(normalize)
      : [];
    const fruitsTargets = (platform === 'all' || platform === 'fruits')
      ? rowsToDelete.filter(r => isUploaded(r.fruitsPid)).map(normalize)
      : [];
    const joongnaTargets = (platform === 'all' || platform === 'joongna')
      ? rowsToDelete.filter(r => isUploaded(r.joongnaPid)).map(normalize)
      : [];

    if (bunjangTargets.length === 0 && fruitsTargets.length === 0 && joongnaTargets.length === 0) {
      return alert('선택한 상품 중 업로드된(삭제 가능한) 상품이 없습니다.\n해당 플랫폼에 업로드된 상품만 삭제할 수 있습니다.');
    }

    const parts: string[] = [];
    if (bunjangTargets.length > 0) parts.push(`번개장터 ${bunjangTargets.length}개`);
    if (fruitsTargets.length > 0) parts.push(`후르츠패밀리 ${fruitsTargets.length}개`);
    if (joongnaTargets.length > 0) parts.push(`중고나라 ${joongnaTargets.length}개`);
    
    const actionName = platform === 'all' ? '동시 삭제' : '삭제';
    if (!confirm(`선택한 상품 중 업로드된 상품을 ${actionName}합니다.\n(${parts.join(' · ')})\n계속하시겠습니까?`)) return;

    setIsWorking(true);
    
    Promise.allSettled([
      (async () => {
        if (bunjangTargets.length > 0) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🗑️ [번개장터] 삭제 시작`]);
          const res = await window.electron.deleteBunjangMulti(bunjangTargets, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [번개장터] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        }
      })(),
      (async () => {
        if (fruitsTargets.length > 0) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🗑️ [후르츠] 삭제 시작`]);
          const res = await window.electron.deleteFruitsMulti(fruitsTargets, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [후르츠] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        }
      })(),
      (async () => {
        if (joongnaTargets.length > 0) {
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🗑️ [중고나라] 삭제 시작`]);
          const res = await window.electron.deleteJoongnaMulti(joongnaTargets, spreadsheetUrl);
          setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [중고나라] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
        }
      })()
    ]).finally(async () => {
      await handleLoadData();
      setSelectedRows(new Set());
      setIsWorking(false);
    });
  };

  const handleHardDelete = async () => {
    const rowsToDelete = rows.filter(r => selectedRows.has(r.rowIndex));
    if (rowsToDelete.length === 0) return;
    
    const normalize = (r: SpreadsheetRow) => String(r.productCode).replace(/[^0-9]/g, '');
    const isUploaded = (pid?: string) => {
      if (!pid) return false;
      const t = pid.trim().toUpperCase();
      return t !== '' && !t.startsWith('D') && !t.startsWith('#') && t !== 'FALSE';
    };

    const bunjangTargets = rowsToDelete.filter(r => isUploaded(r.bunjangPid)).map(normalize);
    const fruitsTargets = rowsToDelete.filter(r => isUploaded(r.fruitsPid)).map(normalize);
    const joongnaTargets = rowsToDelete.filter(r => isUploaded(r.joongnaPid)).map(normalize);
    
    const parts: string[] = [];
    if (bunjangTargets.length > 0) parts.push(`번개장터 ${bunjangTargets.length}건`);
    if (fruitsTargets.length > 0) parts.push(`후르츠패밀리 ${fruitsTargets.length}건`);
    if (joongnaTargets.length > 0) parts.push(`중고나라 ${joongnaTargets.length}건`);

    let warningMsg = `[경고] 선택한 ${rowsToDelete.length}개의 상품을 완전 삭제합니다.\n(구글 시트 데이터 및 로컬 이미지 폴더 영구 삭제)\n\n`;
    if (parts.length > 0) {
      warningMsg += `※ 현재 오픈마켓에 등록된 게시물(${parts.join(', ')})이 감지되었습니다.\n게시물을 먼저 삭제한 뒤 데이터를 완전히 지웁니다.\n\n`;
    }
    warningMsg += `정말로 완전 삭제하시겠습니까?`;

    if (!confirm(warningMsg)) return;
    
    setIsWorking(true);
    setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🚨 완전 삭제 작업 시작...`]);
    try {
      if (bunjangTargets.length > 0 || fruitsTargets.length > 0 || joongnaTargets.length > 0) {
        setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🗑️ 오픈마켓 게시물 선행 삭제 진행 중...`]);
        await Promise.allSettled([
          (async () => {
            if (bunjangTargets.length > 0) {
              const res = await window.electron.deleteBunjangMulti(bunjangTargets, spreadsheetUrl);
              setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [번개장터] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
            }
          })(),
          (async () => {
            if (fruitsTargets.length > 0) {
              const res = await window.electron.deleteFruitsMulti(fruitsTargets, spreadsheetUrl);
              setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [후르츠] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
            }
          })(),
          (async () => {
            if (joongnaTargets.length > 0) {
              const res = await window.electron.deleteJoongnaMulti(joongnaTargets, spreadsheetUrl);
              setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] 🏁 [중고나라] 삭제 완료 — 성공 ${res.summary.success} / 실패 ${res.summary.failed}`]);
            }
          })()
        ]);
      }

      const res = await window.electron.deleteSpreadsheetRows({ googleSpreadsheetUrl: spreadsheetUrl }, rowsToDelete, 'market');
      if (res.success) {
        setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 완전 삭제 성공: ${res.message}`]);
        await handleLoadData();
        setSelectedRows(new Set());
      } else {
        throw new Error(res.message);
      }
    } catch (e: any) {
      setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ❌ 완전 삭제 실패: ${e.message}`]);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 h-full overflow-hidden bg-slate-900 gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/30 shrink-0">
            <Store className="w-5 h-5 text-orange-400" />
          </div>
          <h2 className="text-lg font-bold text-slate-100 whitespace-nowrap shrink-0">오픈마켓 업로드</h2>
          
          <button 
            onClick={() => setLdGuideOpen(true)}
            className="ml-0 sm:ml-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-600 whitespace-nowrap shrink-0"
          >
            <span className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">?</span>
            LD플레이어 세팅 가이드
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mr-0 xl:mr-4 justify-start sm:justify-end">
          <div className="flex items-center gap-2">
            {/* 1. 새로고침 */}
            <button
              onClick={handleLoadData}
              disabled={isLoading}
              title="오픈마켓 시트 데이터 새로고침"
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 shrink-0" />
              새로고침
            </button>

            {/* 2. 번개세션 */}
            <button
              onClick={handleBunjangCheckSession}
              disabled={isWorking}
              title="번개장터 로그인 세션을 확인합니다. (크롬 창이 열립니다)"
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 text-yellow-500 border border-yellow-500/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Zap className="w-4 h-4 shrink-0" />
              번개세션
            </button>

            {/* 3. 중고세션 */}
            <button
              onClick={async () => {
                setIsWorking(true);
                setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ⚡ 중고나라 세션 체크 중...`]);
                try {
                  await window.electron.checkJoongnaSession();
                  setLogs(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString('ko-KR')}] ✅ 중고나라 홈을 열었습니다. 로그인 여부를 확인해주세요.`]);
                } catch (e: any) {
                  alert(`중고나라 세션 체크 실패: ${e.message}`);
                } finally {
                  setIsWorking(false);
                }
              }}
              disabled={isWorking}
              title="중고나라 로그인 세션을 확인합니다."
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 text-green-400 border border-green-500/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Store className="w-4 h-4 shrink-0" />
              중고세션
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            {/* 4. 일괄 UP (독립 버튼) */}
            <button
              onClick={handleBulkUp}
              disabled={selectedRows.size === 0 || isWorking}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border shadow-sm whitespace-nowrap shrink-0 ${
                selectedRows.size === 0 || isWorking
                  ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'border-indigo-600 bg-indigo-900/40 text-indigo-300 hover:bg-indigo-800/60'
              }`}
            >
              <ArrowUp className="w-4 h-4 shrink-0" />
              일괄 UP
            </button>

            {/* 5. 선택 항목 작업 드롭다운 */}
            <div className="relative" ref={uploadMenuRef}>
              <button
                onClick={() => setUploadMenuOpen(!uploadMenuOpen)}
                disabled={selectedRows.size === 0 || isWorking}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border shadow-sm whitespace-nowrap shrink-0 ${
                  selectedRows.size === 0 || isWorking
                    ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'border-emerald-600 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60'
                }`}
              >
                <Layers className="w-4 h-4 shrink-0" />
                선택 항목 작업
                <ChevronDown className="w-3 h-3 ml-1 shrink-0" />
              </button>

              {uploadMenuOpen && selectedRows.size > 0 && !isWorking && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-md shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-medium text-slate-400 bg-slate-800/50 border-b border-slate-700">
                    선택된 {selectedRows.size}개 상품
                  </div>
                  
                  <button
                    onClick={() => { setUploadMenuOpen(false); handleUpload('all'); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-emerald-900/30 hover:text-emerald-300 transition-colors flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    전체 마켓 일괄 업로드
                  </button>
                  <button
                    onClick={() => { setUploadMenuOpen(false); handleUpload('bunjang'); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-rose-900/30 hover:text-rose-300 transition-colors flex items-center gap-2"
                  >
                    <span className="text-xs">⚡</span> 번개장터 업로드
                  </button>
                  <button
                    onClick={() => { setUploadMenuOpen(false); handleUpload('joongna'); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-green-900/30 hover:text-green-300 transition-colors flex items-center gap-2"
                  >
                    <span className="text-xs">🌱</span> 중고나라 업로드
                  </button>
                  <button
                    onClick={() => { setUploadMenuOpen(false); handleUpload('fruits'); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-orange-900/30 hover:text-orange-300 transition-colors flex items-center gap-2 border-b border-slate-700"
                  >
                    <FruitsIcon size={16} /> 후르츠패밀리 업로드
                  </button>
                  <button
                    disabled
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-500 flex items-center gap-2 border-b border-slate-700 cursor-not-allowed bg-slate-800/30"
                  >
                    <DaangnIcon size={16} className="opacity-50 grayscale" /> 당근마켓 업로드 <span className="text-[10px] bg-slate-700 text-slate-400 px-1 rounded-sm ml-auto">개발중</span>
                  </button>

                  <button
                    onClick={handleCancel}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors flex items-center gap-2"
                  >
                    <Ban className="w-4 h-4" />
                    모든 작업 취소
                  </button>
                </div>
              )}
            </div>

            {/* 삭제 드롭다운 */}
            <div className="relative" ref={deleteMenuRef}>
              <button
                onClick={() => setDeleteMenuOpen(prev => !prev)}
                disabled={isLoading || isWorking || rows.length === 0 || selectedRows.size === 0}
                className="px-4 py-2 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md min-w-[100px]"
              >
                <Trash2 className="w-4 h-4" />
                삭제
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${deleteMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {deleteMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                  <button onClick={() => { setDeleteMenuOpen(false); handleDelete('all'); }} className="px-4 py-2.5 text-left text-sm font-bold text-rose-100 hover:bg-rose-900/50 flex items-center gap-3 transition-colors">
                    <Layers className="w-4 h-4 text-rose-400" />
                    통합 삭제
                  </button>
                  <div className="h-px bg-slate-700/50 my-1 mx-2" />
                  <button onClick={() => { setDeleteMenuOpen(false); handleDelete('bunjang'); }} className="px-4 py-2.5 text-left text-sm font-medium text-rose-100 hover:bg-rose-900/50 flex items-center gap-3 transition-colors">
                    <Zap className="w-4 h-4 text-yellow-500 fill-current" />
                    번개장터 삭제
                  </button>
                  <button onClick={() => { setDeleteMenuOpen(false); handleDelete('fruits'); }} className="px-4 py-2.5 text-left text-sm font-medium text-rose-100 hover:bg-rose-900/50 flex items-center gap-3 transition-colors">
                    <FruitsIcon size={16} />
                    후르츠 삭제
                  </button>
                  <button onClick={() => { setDeleteMenuOpen(false); handleDelete('joongna'); }} className="px-4 py-2.5 text-left text-sm font-medium text-rose-100 hover:bg-rose-900/50 flex items-center gap-3 transition-colors border-b border-slate-700">
                    <Store className="w-4 h-4 text-green-400" />
                    중고나라 삭제
                  </button>
                  <button onClick={() => { setDeleteMenuOpen(false); handleHardDelete(); }} className="px-4 py-2.5 text-left text-sm font-bold text-red-500 hover:bg-red-900/50 flex items-center gap-3 transition-colors bg-red-950/20">
                    <Trash2 className="w-4 h-4 text-red-500" />
                    선택 상품 완전 삭제
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {isWorking && (
            <button
              onClick={handleCancel}
              title="진행 중인 마켓 업로드 강제 중단"
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-bold transition-colors flex items-center gap-2 animate-pulse shadow-md ml-2"
            >
              <Ban className="w-4 h-4" />
              중단
            </button>
          )}
        </div>
      </div>

      {/* Main Table Area */}
      <div className="flex-1 bg-slate-950 border border-slate-700/50 rounded-xl flex flex-col overflow-hidden shadow-inner min-h-0">
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 flex-col gap-3">
              <Download className="w-8 h-8 opacity-20" />
              <p>{spreadsheetUrl ? '상단의 새로고침 버튼을 눌러 오픈마켓 시트(탭)를 불러오세요.' : 'AI 분석봇 설정에서 구글 스프레드시트 URL을 저장해주세요. (텔레그램 /오픈마켓업로드로 상품 등록)'}</p>
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 flex-col gap-3">
              <p>현재 상태 필터({statusFilter === 'onsale' ? 'onsale' : 'sold'})에 해당하는 상품이 없습니다.</p>
              <button onClick={cycleStatusFilter} className="text-orange-400 hover:text-orange-300 text-xs underline">전체 보기로 전환</button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900 sticky top-0 z-10 shadow-sm border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-12 text-center uppercase tracking-wider">
                    <button onClick={toggleAll} className="hover:text-white" title="전체 선택/해제">
                      {selectedRows.size === displayedRows.length && displayedRows.length > 0 ? <CheckSquare className="w-4 h-4 mx-auto" /> : <Square className="w-4 h-4 mx-auto" />}
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-16 text-center uppercase tracking-wider">사진</th>
                  <th className="py-3 px-4 w-24 uppercase tracking-wider">
                    <button onClick={() => toggleSort('code')} className={`flex items-center gap-1 font-semibold text-[11px] hover:text-white transition-colors ${sortKey === 'code' ? 'text-orange-400' : 'text-slate-400'}`} title="코드 정렬 (클릭 시 오름/내림차순 전환)">
                      코드
                      {sortKey === 'code' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                  <th className="py-3 px-4 w-24 uppercase tracking-wider">
                    <button onClick={() => toggleSort('date')} className={`flex items-center gap-1 font-semibold text-[11px] hover:text-white transition-colors ${sortKey === 'date' ? 'text-orange-400' : 'text-slate-400'}`} title="등록일 정렬 (내림차순=최근등록순)">
                      등록일
                      {sortKey === 'date' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 uppercase tracking-wider">제품명</th>
                  <th className="py-3 px-4 uppercase tracking-wider">
                    <button onClick={() => toggleSort('price')} className={`flex items-center gap-1 font-semibold text-[11px] hover:text-white transition-colors ${sortKey === 'price' ? 'text-orange-400' : 'text-slate-400'}`} title="판매가격 정렬 (내림차순=높은가격순)">
                      판매가격
                      {sortKey === 'price' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </button>
                  </th>
                  <th className="py-3 px-4 w-24 uppercase tracking-wider">
                    <button onClick={cycleStatusFilter} className={`font-semibold text-[11px] hover:text-white transition-colors ${statusFilter !== 'all' ? 'text-orange-400' : 'text-slate-400'}`} title="클릭 시 전체 → onsale만 → sold만 순환">
                      상태{statusFilter === 'onsale' ? ' (onsale)' : statusFilter === 'sold' ? ' (sold)' : ''}
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-28 uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1"><Zap className="w-3 h-3 text-yellow-400" fill="currentColor" /> 번개장터</span>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-28 uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1"><FruitsIcon size={12} /> 후르츠</span>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-28 uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1"><Store className="w-3 h-3 text-green-400" /> 중고나라</span>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-28 uppercase tracking-wider">
                    <span className="flex items-center justify-center gap-1"><DaangnIcon size={12} /> 당근마켓</span>
                  </th>
                  <th className="py-3 px-4 font-semibold text-[11px] text-slate-400 w-32 uppercase tracking-wider">작업 상태</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-800/60">
                {displayedRows.map((row) => {
                  const isSelected = selectedRows.has(row.rowIndex);
                  const status = uploadStatus[row.rowIndex] || '대기';
                  const thumbnailUrl = row.localThumbnailBase64 || '';
                  return (
                    <tr key={row.rowIndex} className={`hover:bg-slate-800/40 transition-colors ${isSelected ? 'bg-orange-900/10' : ''}`}>
                      <td className="py-2.5 px-4 text-center cursor-pointer" onClick={() => toggleRowSelection(row.rowIndex)}>
                        {isSelected ? <CheckSquare className="w-4 h-4 text-orange-400 mx-auto" /> : <Square className="w-4 h-4 text-slate-600 mx-auto" />}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt="thumb" className="w-10 h-10 object-cover rounded-md border border-slate-700/50 mx-auto bg-slate-800" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-slate-800 border border-slate-700/50 flex items-center justify-center mx-auto text-slate-600">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-300">{row.productCode}</td>
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">{row.registrationDate || '-'}</td>
                      <td className="py-2.5 px-4 text-slate-300 text-[11px] max-w-[240px] truncate" title={row.productName}>{row.productName || '-'}</td>
                      <td className="py-2.5 px-4">
                        {row.finalPrice ? `${Number(String(row.finalPrice).replace(/[^0-9]/g, '') || 0).toLocaleString()}원` : <span className="text-slate-600">미입력</span>}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${row.status === 'onsale' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                          {row.status || '데이터 없음'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {(() => {
                          const pid = String(row.bunjangPid || '').trim();
                          if (!pid || pid.startsWith('#') || pid.toUpperCase() === 'FALSE') return <span className="text-[11px] text-slate-600">미등록</span>;
                          if (pid.startsWith('d') || pid.startsWith('D')) return <span className="text-[11px] text-slate-500">삭제됨</span>;
                          return <span className="text-[11px] font-bold text-green-400">등록완료</span>;
                        })()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {(() => {
                          const pid = String(row.fruitsPid || '').trim();
                          if (!pid || pid.startsWith('#') || pid.toUpperCase() === 'FALSE') return <span className="text-[11px] text-slate-600">미등록</span>;
                          if (pid.startsWith('d') || pid.startsWith('D')) return <span className="text-[11px] text-slate-500">삭제됨</span>;
                          return <span className="text-[11px] font-bold text-green-400">등록완료</span>;
                        })()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {(() => {
                          const pid = String(row.joongnaPid || '').trim();
                          if (!pid || pid.startsWith('#') || pid.toUpperCase() === 'FALSE') return <span className="text-[11px] text-slate-600">미등록</span>;
                          if (pid.startsWith('d') || pid.startsWith('D')) return <span className="text-[11px] text-slate-500">삭제됨</span>;
                          return <span className="text-[11px] font-bold text-green-400">등록완료</span>;
                        })()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/50">개발중</span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          status === '완료' || status === '삭제 완료' ? 'bg-green-900/40 text-green-300' :
                          status === '실패' ? 'bg-red-900/40 text-red-300' :
                          status === '업로드 중' || status === '삭제 중' ? 'bg-yellow-900/40 text-yellow-300 animate-pulse' :
                          'bg-slate-800 text-slate-500'
                        }`}>
                          {status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Log Console */}
        <div className="h-32 border-t border-slate-800 bg-slate-900/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/50">
            <span className="text-[10px] font-bold text-slate-500 uppercase">최근 진행 로그</span>
            <button onClick={() => setLogs([])} className="text-slate-600 hover:text-slate-400" title="로그 지우기">
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-snug text-slate-400">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 italic">로그가 없습니다.</div>
            ) : (
              logs.map((log, i) => <div key={i} className="mb-0.5 break-all">{log}</div>)
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
      {/* LDPlayer Setting Guide Modal */}
      {ldGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-sm font-bold border border-indigo-500/30">LD</span>
                LD플레이어 초기 세팅 가이드
              </h2>
              <button onClick={() => setLdGuideOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <Ban className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300 flex-1">
              <p className="leading-relaxed">
                후르츠패밀리 및 자동 업로드 기능을 완벽하게 사용하려면 <strong>LD플레이어(LDPlayer 9)</strong>를 처음 설치한 후 반드시 아래와 같이 세팅해야 합니다.
              </p>

              <div className="bg-slate-900/50 rounded-lg p-5 border border-slate-700">
                <h3 className="font-bold text-orange-400 mb-3 text-base flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center text-xs">1</span>
                  해상도 및 기본 설정
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-1 text-slate-300">
                  <li>LD플레이어 우측 메뉴의 <strong>설정 (톱니바퀴 아이콘)</strong>을 클릭합니다.</li>
                  <li><strong>해상도 설정:</strong> [모바일 스마트폰 모드] 선택 후 <strong>720 x 1280 (DPI 320)</strong>으로 맞춰주세요. (가장 안정적입니다)</li>
                  <li><strong>CPU/RAM:</strong> 2코어 / 2048M 이상 (고객님의 PC 사양이 좋다면 4코어/4096M, 6코어/6144M 등으로 넉넉하게 설정하셔도 전혀 무방합니다)</li>
                </ul>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-5 border border-slate-700">
                <h3 className="font-bold text-orange-400 mb-3 text-base flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center text-xs">2</span>
                  기타 설정 (ADB 디버깅) <span className="text-red-400 text-xs ml-2">*필수*</span>
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-1 text-slate-300">
                  <li><strong>좌측 메뉴(맨아래)</strong>에서 <strong>기타 설정</strong> 탭으로 이동합니다.</li>
                  <li><strong>ADB 디버깅:</strong> <span className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded">로컬 디버깅</span> 으로 설정합니다. (이 옵션이 켜져있어야 프로그램이 LD플레이어를 제어할 수 있습니다)</li>
                  <li><strong>ROOT 권한:</strong> 필요 시 '켜기' 로 설정합니다.</li>
                </ul>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-5 border border-slate-700">
                <h3 className="font-bold text-orange-400 mb-3 text-base flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center text-xs">3</span>
                  앱 설치 및 초기화
                </h3>
                <ul className="list-disc list-inside space-y-2 ml-1 text-slate-300">
                  <li>플레이스토어에서 <strong>후르츠패밀리 (Fruits Family)</strong> 앱을 다운로드 및 설치합니다.</li>
                  <li>앱을 실행한 뒤, <strong>로그인(판매자 계정)</strong>을 미리 완료해 주세요.</li>
                  <li>각종 권한 허용(사진, 알림 등) 팝업이 뜬다면 모두 <strong>허용/확인</strong>을 눌러주세요.</li>
                  <li>세팅 완료 후 앱을 끄고 바탕화면에서 대기 상태로 두시면 준비가 끝납니다!</li>
                </ul>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 flex justify-end">
              <button 
                onClick={() => setLdGuideOpen(false)}
                className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
