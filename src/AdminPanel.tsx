import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, CheckCircle, XCircle, Clock, Trash2, Copy, Play, Package, Truck, User, MessageCircle, Edit2, Settings, StopCircle, CheckSquare, Lock, Unlock } from 'lucide-react';
import type { AdminTask, BandSetting, Member, PurchaseItem, TaskResult } from './types';
import { BandSettingsModal } from './BandSettingsModal';

interface GroupedResultItem extends TaskResult {
  taskId: string;
}

export function AdminPanel({ isActive }: { isActive?: boolean }) {
  const isProUnlocked = 
    localStorage.getItem('bandadmin_role') === 'admin' || 
    localStorage.getItem('bandadmin_auto_settlement_enabled') === 'true' ||
    localStorage.getItem('bandadmin_ai_enabled') === 'true' ||
    localStorage.getItem('bandadmin_auto_upload_enabled') === 'true';

  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const paidWinners = useMemo(() => {
    const map: Record<string, boolean> = {};
    tasks.forEach(task => {
      if (task.status === 'SUCCESS' && task.results) {
        task.results.forEach(result => {
          if (result.winnerName && result.winnerName !== '유찰(입찰자 없음)') {
            if (map[result.winnerName] === undefined) {
              map[result.winnerName] = true;
            }
            if (!result.isPaid) {
              map[result.winnerName] = false;
            }
          }
        });
      }
    });
    return map;
  }, [tasks]);
  const [bandSettings, setBandSettings] = useState<BandSetting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [startUrl, setStartUrl] = useState('');
  const [endUrl, setEndUrl] = useState('');
  const [newSettingId, setNewSettingId] = useState('');
  const [targetTimeStr, setTargetTimeStr] = useState('');
  const [autoSendChat, setAutoSendChat] = useState(false);
  const [restoreCommentPermission, setRestoreCommentPermission] = useState(false);

  // 채팅 상태
  const [chatSending, setChatSending] = useState<Record<string, boolean>>({});
  const [chatSentWinners, setChatSentWinners] = useState<Record<string, boolean>>({});
  const [chatFailedWinners, setChatFailedWinners] = useState<Record<string, boolean>>({});
  const [chatLogs, setChatLogs] = useState<string[]>([]);
  const [bulkChatSelection, setBulkChatSelection] = useState<Record<string, boolean>>({});
  // 일괄 전송 진행 상태 (브라우저 재사용 방식)
  const [bulkChatSending, setBulkChatSending] = useState(false);
  const [bulkChatProgress, setBulkChatProgress] = useState<{ current: number; total: number; winnerName: string; status: string } | null>(null);

  const [editingItem, setEditingItem] = useState<GroupedResultItem | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const getTaskSettlementSummary = (task: AdminTask) => {
    if (task.status !== 'SUCCESS' || !task.results || task.results.length === 0) return null;
    
    let totalBids = 0;
    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;
    
    task.results.forEach(result => {
      if (result.winnerName && result.winnerName !== '유찰(입찰자 없음)') {
        totalBids++;
        const amount = result.winningBid * 1000;
        totalAmount += amount;
        
        // DB에 저장된 각 낙찰건의 입금 여부를 기반으로 계산합니다.
        if (result.isPaid) {
          paidAmount += amount;
        } else {
          unpaidAmount += amount;
        }
      }
    });
    
    return { totalBids, totalAmount, paidAmount, unpaidAmount };
  };
  
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  useEffect(() => {
    // Initial fetch
    if (window.electron && isActive !== false) {
      window.electron.getAdminTasks().then(setTasks);
      window.electron.getBandSettings().then(setBandSettings);
      window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default').then(setMembers);
      
      const removeTaskUpdate = window.electron.onAdminTaskUpdate((updatedTask: AdminTask) => {
        setTasks((prev: AdminTask[]) => {
          const idx = prev.findIndex((t: AdminTask) => t.id === updatedTask.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updatedTask;
            return next;
          }
          return [...prev, updatedTask];
        });
      });
      return removeTaskUpdate;
    }
  }, [isActive]);

  useEffect(() => {
    if (isAddModalOpen && window.electron) {
      window.electron.getBandSettings().then(setBandSettings);
    }
  }, [isAddModalOpen]);

  const handleAddTask = () => {
    if (!startUrl || !endUrl || !newSettingId) return;
    
    // Parse URLs
    const startMatch = startUrl.match(/(.*\/post\/)(\d+)$/);
    const endMatch = endUrl.match(/(.*\/post\/)(\d+)$/);
    
    if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) {
      alert('유효하지 않은 게시물 URL이거나 밴드가 다릅니다. URL 끝이 숫자 형태인지 확인하세요.');
      return;
    }
    
    const baseUrl = startMatch[1];
    const startNum = parseInt(startMatch[2], 10);
    const endNum = parseInt(endMatch[2], 10);
    
    if (startNum > endNum) {
      alert('시작 번호가 끝 번호보다 클 수 없습니다.');
      return;
    }
    
    if (endNum - startNum > 100) {
      alert('한 번에 100개 이상의 게시물을 등록할 수 없습니다.');
      return;
    }

    const urls: string[] = [];
    for (let i = startNum; i <= endNum; i++) {
      urls.push(`${baseUrl}${i}`);
    }

    let targetTime = 0;
    if (targetTimeStr) {
      const [hours, minutes, seconds] = targetTimeStr.split(':').map(Number);
      const d = new Date();
      d.setHours(hours || 0, minutes || 0, seconds || 0, 0);
      targetTime = d.getTime();
      if (targetTime < Date.now()) {
        targetTime += 24 * 60 * 60 * 1000;
      }
    }

    if (editingTaskId) {
      window.electron.updateAdminTask(editingTaskId, {
        urls,
        bandSettingId: newSettingId,
        targetTime,
        autoSendChat,
        restoreCommentPermission
      });
    } else {
      const newTask: AdminTask = {
        id: Math.random().toString(36).substring(7),
        urls,
        bandSettingId: newSettingId,
        status: 'WAITING',
        targetTime,
        autoSendChat,
        restoreCommentPermission
      };
      window.electron.addAdminTask(newTask);
    }
    
    setIsAddModalOpen(false);
    setEditingTaskId(null);
    setStartUrl('');
    setEndUrl('');
    setTargetTimeStr('');
    setRestoreCommentPermission(false);
  };

  const handleRemoveTask = (id: string) => {
    if (window.confirm('이 경매 기록을 정말 삭제하시겠습니까?')) {
      window.electron.removeAdminTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case 'WAITING':
        return <span className="flex items-center text-yellow-500"><Clock size={16} className="mr-1"/>대기중</span>;
      case 'CLOSING':
        return <span className="flex items-center text-blue-400 animate-pulse"><Play size={16} className="mr-1"/>진행중</span>;
      case 'SUCCESS':
        return <span className="flex items-center text-green-500"><CheckCircle size={16} className="mr-1"/>완료</span>;
      case 'FAILED':
      case 'ABORTED':
        return <span className="flex items-center text-red-500"><XCircle size={16} className="mr-1"/>실패</span>;
      default:
        return <span>{status}</span>;
    }
  };

  const groupedTasksByDate = useMemo(() => {
    const groups: Record<string, AdminTask[]> = {};
    const filtered = tasks.filter(task => {
      if (selectedDate === 'all') return true;
      if (task.targetTime) {
        const d = new Date(task.targetTime);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}` === selectedDate;
      }
      return false;
    });

    filtered.forEach(task => {
      let dateStr = '날짜 미지정';
      if (task.targetTime) {
        const d = new Date(task.targetTime);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      }
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(task);
    });
    return groups;
  }, [tasks, selectedDate]);

  const sortedDates = Object.keys(groupedTasksByDate).sort((a, b) => b.localeCompare(a));

  // 낙찰 결과 그룹화 헬퍼 (카드 렌더링 및 복사용)
  const getGroupedResults = (taskArray: AdminTask[] = tasks) => {
    const grouped: Record<string, { results: GroupedResultItem[]; bandSettingId: string }> = {};
    
    taskArray.forEach(task => {
      if (task.status === 'SUCCESS' && task.results) {
        task.results.forEach(result => {
          if (result.winnerName && result.winnerName !== '유찰(입찰자 없음)') {
             if (!grouped[result.winnerName]) grouped[result.winnerName] = { results: [], bandSettingId: task.bandSettingId || '' };
             grouped[result.winnerName].results.push({ ...result, taskId: task.id });
          }
        });
      }
    });
    return grouped;
  };



  const getSettlementText = (winner: string, results: TaskResult[], bandSettingId: string) => {
    const today = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]})`;

    let text = `${dateStr}\n\n[낙찰 정산서 - ${winner}님 (${results.length}개)]\n\n`;
    let total = 0;
    const setting = bandSettings.find(s => s.id === bandSettingId);
    
    results.forEach(item => {
      const realAmount = item.winningBid * 1000;
      text += `- ${item.postTitle || '상품명 없음'} : ${realAmount.toLocaleString()}원\n`;
      total += realAmount;
    });
    text += `\n총 합계: ${total.toLocaleString()}원\n`;
    if (setting && setting.bankAccount) {
      text += `입금 계좌: ${setting.bankAccount}\n`;
    } else {
      text += `입금 계좌: [설정에서 계좌정보를 입력해주세요]\n`;
    }
    text += `-----------------------------------\n`;
    if (setting && setting.settlementMessage) {
      text += `${setting.settlementMessage}\n`;
    }
    text += `\n`;
    return text;
  };

  const copySingleSettlement = (winner: string, results: TaskResult[], bandSettingId: string) => {
    navigator.clipboard.writeText(getSettlementText(winner, results, bandSettingId).trim());
    alert(`${winner}님의 정산서가 복사되었습니다.`);
  };

  const sendChatSettlement = async (winner: string, results: TaskResult[], bandSettingId: string, isBulk = false) => {
    const bandIdMatch = results[0]?.url.match(/band\/(\d+)/);
    const bandId = bandIdMatch ? bandIdMatch[1] : '';
    
    if (!bandId) {
       if (!isBulk) alert('해당 밴드의 ID를 찾을 수 없습니다.');
       return false;
    }

    setChatSending(prev => ({ ...prev, [winner]: true }));
    setChatLogs([`${winner}님에게 정산 채팅 전송 시작...`]);
    try {
      const text = getSettlementText(winner, results, bandSettingId).trim();
      const thumbnailPaths = results.map(r => r.thumbnailPath).filter(Boolean) as string[];
      
      const success = await window.electron.sendSettlementChat({
         bandId: bandId,
         winnerName: winner,
         thumbnailPaths,
         settlementText: text
      });

      if (!isBulk) {
        if (success) {
           alert(`${winner}님에게 채팅 전송이 완료되었습니다.`);
           setChatSentWinners(prev => ({ ...prev, [winner]: true }));
        }
        else alert(`채팅 전송 실패. 콘솔을 확인해주세요.`);
      } else {
        if (success) setChatSentWinners(prev => ({ ...prev, [winner]: true }));
      }
      return success;
    } catch (e: any) {
      if (!isBulk) alert(`오류: ${e.message}`);
      return false;
    } finally {
      setChatSending(prev => ({ ...prev, [winner]: false }));
    }
  };

  const sendBulkChatSettlement = async () => {
    // UI에 보여지는 날짜들에 해당하는 모든 태스크에 대해 글로벌하게 처리
    const allFilteredTasks = sortedDates.flatMap(d => groupedTasksByDate[d]);
    const globalGrouped = getGroupedResults(allFilteredTasks);
    
    const winnersToSend = Object.keys(globalGrouped).filter(w => bulkChatSelection[w] && !chatSentWinners[w]);
    if (winnersToSend.length === 0) {
       alert('선택된 인원이 없습니다.');
       return;
    }
    if (!confirm(`총 ${winnersToSend.length}명에게 순차적으로 채팅 톡을 전송하시겠습니까?\n(브라우저가 1회만 열리고 순차 진행됩니다. 각 전송 간 5초 대기가 포함됩니다.)`)) return;

    // 전송 요청 데이터 구성
    const requests = winnersToSend.map(winner => {
      const data = globalGrouped[winner];
      const bandIdMatch = data.results[0]?.url.match(/band\/(\d+)/);
      const bandId = bandIdMatch ? bandIdMatch[1] : '';
      const text = getSettlementText(winner, data.results, data.bandSettingId).trim();
      const thumbnailPaths = data.results.map(r => r.thumbnailPath).filter(Boolean) as string[];
      return { bandId, winnerName: winner, thumbnailPaths, settlementText: text };
    }).filter(r => r.bandId); // bandId를 찾을 수 없는 건은 제외

    if (requests.length === 0) {
      alert('유효한 밴드 ID를 가진 낙찰자가 없습니다.');
      return;
    }

    setBulkChatSending(true);
    setBulkChatProgress(null);
    setChatLogs([`📨 ${requests.length}명에게 일괄 전송 시작...`]);

    // 진행 상황 이벤트 리스너 등록
    const removeProgress = window.electron.onChatBotProgress?.((progress: any) => {
      setBulkChatProgress(progress);
      if (progress.status === 'success' || progress.status.includes('성공')) {
         setChatSentWinners(prev => ({ ...prev, [progress.winnerName]: true }));
         setChatFailedWinners(prev => {
           const next = { ...prev };
           delete next[progress.winnerName];
           return next;
         });
      } else if (progress.status === 'failed' || progress.status.includes('실패')) {
         setChatFailedWinners(prev => ({ ...prev, [progress.winnerName]: true }));
      }
    });

    try {
      // 브라우저를 한 번만 열고 여러 고객에게 순차 전송
      const result = await window.electron.sendBulkSettlementChat(requests);
      alert(`일괄 채팅 전송 완료!\n성공: ${result.successCount}명\n실패: ${result.failCount}명`);
    } catch (e: any) {
      alert(`일괄 전송 오류: ${e.message}`);
    } finally {
      setBulkChatSending(false);
      setBulkChatProgress(null);
      if (removeProgress) removeProgress();
    }
  };

  // 일괄 전송 중지 핸들러
  const stopBulkChatSettlement = async () => {
    if (!confirm('일괄 전송을 중지하시겠습니까?\n(현재 진행 중인 1건은 마무리 후 중지됩니다)')) return;
    await window.electron.stopSettlementChat();
    setChatLogs(prev => [...prev, '🛑 중지 요청을 보냈습니다...']);
  };

  
  const saveEditResult = (url: string, taskId: string, finalName: string, finalBid: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.results) return;

    const newResults = [...task.results];
    const idx = newResults.findIndex(r => r.url === url);
    if (idx >= 0) {
       newResults[idx] = { ...newResults[idx], winnerName: finalName, winningBid: finalBid };

       const settingId = task.bandSettingId;
       if (settingId && window.electron && window.electron.updateGoogleSheetWinner) {
          window.electron.updateGoogleSheetWinner(settingId, newResults[idx].url, finalName, finalBid)
            .then((res: any) => {
               if (!res.success) {
                   if (res.error && res.error.includes('client_secret.json')) {
                       console.warn('구글 시트 연동 파일이 없어 시트 업데이트는 스킵되었습니다.');
                   } else {
                       alert(`구글 시트 업데이트 실패: ${res.error}`);
                   }
               }
               else alert(`구글 시트에 낙찰 정보가 성공적으로 반영되었습니다! (시트 ${res.updatedRow}번째 줄)`);
            })
            .catch((err: any) => {
                if (String(err).includes('client_secret.json')) {
                    console.warn('구글 시트 연동 파일이 없어 시트 업데이트는 스킵되었습니다.');
                } else {
                    alert(`구글 시트 오류: ${err}`);
                }
            });
       }
       window.electron.updateAdminTask(taskId, { results: newResults });
       setEditingItem(null);
    }
  };

  const handlePaymentComplete = async (winnerName: string) => {
    const isCurrentlyPaid = paidWinners[winnerName];
    if (isCurrentlyPaid) {
      if (!confirm(`${winnerName}님의 입금 확인 상태를 취소하시겠습니까?`)) return;
    }

    if (!window.electron) return;

    // 1. TaskResult에 isPaid 업데이트
    const nextTasks = tasks.map(t => {
      let modified = false;
      const newResults = t.results?.map(r => {
        if (r.winnerName === winnerName) {
          modified = true;
          return { ...r, isPaid: !isCurrentlyPaid };
        }
        return r;
      });
      if (modified) {
        window.electron.updateAdminTask(t.id, { results: newResults });
        return { ...t, results: newResults };
      }
      return t;
    });
    setTasks(nextTasks);

    // 2. 입금확인(true) 시 멤버가 없으면 임시 등록
    if (!isCurrentlyPaid) {
      const currentMembers = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
      let member = currentMembers.find((m: Member) => m.nickname === winnerName);
      
      if (!member) {
        member = { nickname: winnerName, items: [] };
        await window.electron.saveMember(localStorage.getItem('bandadmin_username') || 'default', member);
        alert(`${winnerName}님이 회원관리에 임시 등록되었습니다. (나중에 회원관리 탭에서 추가 정보를 기입해주세요)`);
      }
      const updatedMembers = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
      setMembers(updatedMembers);
    }
  };


  const handleKeepItems = async (winnerName: string, results: TaskResult[]) => {
    if (!window.electron) return;
    if (results.length === 0) {
      alert('킵 처리할 항목이 없습니다. (이미 처리되었거나 항목이 없습니다)');
      return;
    }
    
    const members: Member[] = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
    let member = members.find(m => m.nickname === winnerName);
    
    if (!member) {
      member = {
        nickname: winnerName,
        items: []
      };
    }
    
    const newItems: PurchaseItem[] = results.map(r => ({
      id: Math.random().toString(36).substring(7),
      postTitle: r.postTitle,
      thumbnailUrl: r.thumbnailUrl,
      winningBid: r.winningBid,
      dateAdded: Date.now(),
      url: r.url,
      status: 'KEEP',
      isPaid: true
    }));
    
    member.items = [...(member.items || []), ...newItems];
    await window.electron.saveMember(localStorage.getItem('bandadmin_username') || 'default', member);
    const updatedMembersKeep = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
    setMembers(updatedMembersKeep);
    
    // UI 업데이트용 - 상태 마킹 (간단하게 구현하기 위해 전체 tasks 복제 후 업데이트)
    const nextTasks = tasks.map(t => {
      if (t.status === 'SUCCESS' && t.results) {
        t.results.forEach(r => {
          if (r.winnerName === winnerName && results.some(res => res.url === r.url)) {
            r.processedStatus = 'KEEP';
          }
        });
      }
      return t;
    });
    
    // 백엔드 tasks에 업데이트 반영
    nextTasks.forEach(t => {
      window.electron.updateAdminTask(t.id, { results: t.results });
    });
    setTasks(nextTasks);
    
    alert(`${winnerName}님의 물품 ${newItems.length}개가 킵(보관) 처리되었습니다!`);
  };

  const handleShipItems = async (winnerName: string, results: TaskResult[]) => {
    if (!window.electron) return;
    if (results.length === 0) {
      alert('배송 처리할 항목이 없습니다. (이미 처리되었거나 항목이 없습니다)');
      return;
    }
    
    const members: Member[] = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
    let member = members.find(m => m.nickname === winnerName);
    
    if (!member) {
      member = {
        nickname: winnerName,
        items: []
      };
    }
    
    const newItems: PurchaseItem[] = results.map(r => ({
      id: Math.random().toString(36).substring(7),
      postTitle: r.postTitle,
      thumbnailUrl: r.thumbnailUrl,
      winningBid: r.winningBid,
      dateAdded: Date.now(),
      url: r.url,
      status: 'SHIPPED',
      isPaid: true
    }));
    
    member.items = [...(member.items || []), ...newItems];
    await window.electron.saveMember(localStorage.getItem('bandadmin_username') || 'default', member);
    const updatedMembersShip = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
    setMembers(updatedMembersShip);

    const nextTasks = tasks.map(t => {
      if (t.status === 'SUCCESS' && t.results) {
        t.results.forEach(r => {
          if (r.winnerName === winnerName && results.some(res => res.url === r.url)) {
            r.processedStatus = 'SHIPPED';
          }
        });
      }
      return t;
    });
    
    nextTasks.forEach(t => {
      window.electron.updateAdminTask(t.id, { results: t.results });
    });
    setTasks(nextTasks);
    
    alert(`${winnerName}님의 물품이 바로 배송처리 되며 기록에 추가되었습니다.`);
  };

  const handleUndoItems = async (winnerName: string, resultsToUndo: TaskResult[]) => {
    if (!window.electron) return;
    if (!confirm(`${winnerName}님의 킵/배송 처리를 취소하시겠습니까? (구매 기록에서도 삭제됩니다)`)) return;

    // 1. Remove from member's items
    const members: Member[] = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
    let member = members.find(m => m.nickname === winnerName);
    
    if (member && member.items) {
      const urlsToRemove = resultsToUndo.map(r => r.url);
      member.items = member.items.filter(item => !urlsToRemove.includes(item.url));
      await window.electron.saveMember(localStorage.getItem('bandadmin_username') || 'default', member);
    }

    // 2. Reset tasks processedStatus
    const nextTasks = tasks.map(t => {
      if (t.status === 'SUCCESS' && t.results) {
        t.results.forEach(r => {
          if (r.winnerName === winnerName && resultsToUndo.some(res => res.url === r.url)) {
            r.processedStatus = undefined;
          }
        });
      }
      return t;
    });

    nextTasks.forEach(t => {
      window.electron.updateAdminTask(t.id, { results: t.results });
    });
    setTasks(nextTasks);
  };

  useEffect(() => {
    if (sortedDates.length > 0) {
      setBulkChatSelection(prev => {
        const next = { ...prev };
        let changed = false;
        const allFilteredTasks = sortedDates.flatMap(d => groupedTasksByDate[d]);
        const globalGrouped = getGroupedResults(allFilteredTasks);
        
        for (const winner of Object.keys(globalGrouped)) {
          if (next[winner] === undefined) {
            next[winner] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [groupedTasksByDate]);

  // 자동 일괄 채팅 전송 모니터링
  // ★ 중복 실행 방지: useRef로 현재 전송 중인 task ID를 추적
  // - forEach(async) 패턴 → 순차 처리(IIFE + for...of)로 변경
  // - tasks state가 연속 변경되어도 이미 처리된/처리 중인 task는 건너뜀
  const autoSendingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const tasksToAutoSend = tasks.filter(
      t => t.status === 'SUCCESS' && t.autoSendChat && !t.autoChatSent && !autoSendingRef.current.has(t.id)
    );
    if (tasksToAutoSend.length === 0) return;

    // 즉시 함수 실행(IIFE)으로 순차 처리 — forEach(async)의 병렬 실행 문제 해결
    (async () => {
      for (const task of tasksToAutoSend) {
        // 이미 다른 렌더 사이클에서 처리 중이면 건너뜀
        if (autoSendingRef.current.has(task.id)) continue;
        autoSendingRef.current.add(task.id);

        // 백엔드에 즉시 전송 완료 마킹 (중복 실행 방지)
        window.electron.updateAdminTask(task.id, { autoChatSent: true });

        // 이 task 하나에 대해서만 그룹화하여 전송 데이터 생성
        const grouped = getGroupedResults([task]);
        const winnersToSend = Object.keys(grouped);
        
        if (winnersToSend.length === 0) continue;

        const requests = winnersToSend.map(winner => {
          const data = grouped[winner];
          const bandIdMatch = data.results[0]?.url.match(/band\/(\d+)/);
          const bandId = bandIdMatch ? bandIdMatch[1] : '';
          const text = getSettlementText(winner, data.results, data.bandSettingId).trim();
          const thumbnailPaths = data.results.map(r => r.thumbnailPath).filter(Boolean) as string[];
          return { bandId, winnerName: winner, thumbnailPaths, settlementText: text };
        }).filter(r => r.bandId);

        if (requests.length > 0) {
          console.log(`[AutoSend] Task ${task.id} 채팅 전송 시작 (${requests.length}명)`, requests);
          try {
            await window.electron.sendBulkSettlementChat(requests);
          } catch (e) {
            console.error('[AutoSend] 에러:', e);
          }
        }
      }
    })();
  }, [tasks]);


  return (
    <div className="flex-1 bg-slate-900 p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-white">경매 대시보드</h2>
          <div className="flex items-center bg-slate-800 rounded-lg px-2 border border-slate-700">
            <input
              type="date"
              value={selectedDate === 'all' ? '' : selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || 'all')}
              className="bg-transparent text-slate-300 text-sm py-2 px-2 outline-none cursor-pointer"
            />
            <button 
              onClick={() => {
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                setSelectedDate(`${year}-${month}-${day}`);
              }}
              className={`text-xs px-2 py-1 ml-2 rounded ${
                selectedDate !== 'all' && selectedDate === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` 
                ? 'bg-purple-600 text-white' 
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              오늘
            </button>
            <button 
              onClick={() => setSelectedDate('all')}
              className={`text-xs px-2 py-1 ml-2 rounded ${selectedDate === 'all' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
            >
              전체
            </button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {sortedDates.length > 0 && (
             bulkChatSending ? (
                <>
                  {bulkChatProgress && (
                    <span className="text-emerald-400 text-sm font-mono animate-pulse mr-2">
                      📨 {bulkChatProgress.current + 1}/{bulkChatProgress.total} ({bulkChatProgress.winnerName})
                    </span>
                  )}
                  <button 
                    onClick={stopBulkChatSettlement}
                    className="bg-red-600 hover:bg-red-500 text-white px-3 py-2 rounded flex items-center shadow-lg transition-colors text-sm font-bold"
                  >
                    <StopCircle size={16} className="mr-1.5" /> 전송 중지
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => {
                      const allFilteredTasks = sortedDates.flatMap(d => groupedTasksByDate[d]);
                      const globalGrouped = getGroupedResults(allFilteredTasks);
                      const activeWinners = Object.keys(globalGrouped).filter(w => !chatSentWinners[w]);
                      const allSelected = activeWinners.length > 0 && activeWinners.every(w => bulkChatSelection[w]);
                      const next = { ...bulkChatSelection };
                      for (const w of activeWinners) {
                        next[w] = !allSelected;
                      }
                      setBulkChatSelection(next);
                    }}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded flex items-center shadow-lg transition-colors text-sm font-bold"
                  >
                    <CheckSquare size={16} className="mr-1.5" /> 전체 선택/해제
                  </button>
                  <button 
                    onClick={() => {
                      if (!isProUnlocked) {
                        alert('일괄 채팅톡 기능은 PRO 버전부터 이용 가능합니다.');
                        return;
                      }
                      sendBulkChatSettlement();
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded flex items-center shadow-lg transition-colors text-sm font-bold"
                  >
                    <MessageCircle size={16} className="mr-1.5" /> 선택 인원 일괄 톡 ({Object.keys(getGroupedResults(sortedDates.flatMap(d => groupedTasksByDate[d]))).filter(w => !chatSentWinners[w] && bulkChatSelection[w]).length}명)
                    {isProUnlocked ? <Unlock size={14} className="ml-1.5 text-emerald-200" /> : <Lock size={14} className="ml-1.5 text-red-300" />}
                  </button>
                </>
              )
          )}

          <button onClick={() => {
            setEditingTaskId(null);
            let defaultBandId = '';
            if (tasks.length > 0) {
              defaultBandId = tasks[tasks.length - 1].bandSettingId || '';
            }
            if (!defaultBandId && bandSettings.length > 0) {
              defaultBandId = bandSettings[0].id;
            }
            setNewSettingId(defaultBandId);
            const setting = bandSettings.find(s => s.id === defaultBandId);
            setTargetTimeStr(setting?.defaultCloseTime || '');
            setAutoSendChat(false);
            setRestoreCommentPermission(false);
            
            setIsAddModalOpen(true);
          }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center shadow-lg transition-colors text-sm font-bold">
            <Plus size={18} className="mr-2 stroke-2" /> 경매 추가
          </button>
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-2 ml-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all border border-slate-700 hover:border-slate-500 shadow-sm"
            title="경매 설정 관리"
          >
            <Settings size={20} />
          </button>
          {/* 나중에 테스트가 필요할 때 아래 false를 true로 변경하거나 주석을 해제하세요 */}
          {false && (
            <button
              onClick={async () => {
                let testBandId = '94361005';
                if (bandSettings.length > 0 && bandSettings[0].bandUrl) {
                  const match = bandSettings[0].bandUrl.match(/band\/(\d+)/);
                  if (match) testBandId = match[1];
                }
                const confirmed = window.confirm(`[테스트 발송]\n현재 설정된 밴드 ID(${testBandId})에서 '관리자'님에게 5연속 텍스트+이미지 테스트 메시지를 보냅니다.\n진행하시겠습니까?`);
                if (!confirmed) return;
                
                // 저장소에서 아무 이미지나 5장 가져오기
                let testImages: string[] = [];
                if (window.electron.getTestImages) {
                  testImages = await window.electron.getTestImages();
                }
                
                if (testImages.length === 0) {
                   alert('경고: 로컬 저장소에 테스트로 보낼 이미지가 한 장도 없습니다.\n텍스트로만 테스트를 진행합니다.');
                }
                
                const testRequests = Array(5).fill(null).map((_, i) => ({
                  bandId: testBandId,
                  winnerName: '관리자',
                  thumbnailPaths: testImages,
                  settlementText: `[테스트 ${i + 1}/5] 자동 정산 전송 테스트입니다.\n무시하셔도 됩니다.`
                }));
                
                try {
                  await window.electron.sendBulkSettlementChat(testRequests);
                } catch (e) {
                  console.error('Test chat error:', e);
                }
              }}
              className="p-2 ml-1 text-pink-400 hover:text-white hover:bg-pink-900 rounded-lg transition-all border border-pink-900 hover:border-pink-500 shadow-sm flex items-center gap-1"
              title="관리자 채팅 테스트 (5연속)"
            >
              <MessageCircle size={20} />
              <span className="text-sm font-semibold">채팅 테스트</span>
            </button>
          )}
        </div>
      </div>

      {sortedDates.length === 0 ? (
        <div className="flex-1 bg-slate-800 rounded-xl flex items-center justify-center shadow-xl border border-slate-700">
          <div className="text-center py-12 text-slate-500">{selectedDate === 'all' ? '등록된 경매 내역이 없습니다.' : '선택한 날짜에 등록된 경매 내역이 없습니다.'}</div>
        </div>
      ) : sortedDates.map((dateStr, dateIndex) => {
        const tasksForDate = groupedTasksByDate[dateStr];
        const groupedResultsForDate = getGroupedResults(tasksForDate);
        const hasResultsForDate = Object.keys(groupedResultsForDate).length > 0;
        
        return (
          <div key={dateStr} className={`mb-12 ${dateIndex < sortedDates.length - 1 ? 'border-b border-slate-700/50 pb-12' : ''}`}>
            {sortedDates.length > 1 && (
              <h3 className="text-xl font-bold text-white mb-4 bg-slate-800 inline-block px-4 py-2 rounded-lg border border-slate-700 shadow-sm text-purple-400">
                ------ {dateStr} ------
              </h3>
            )}
            
            <div className="bg-slate-800 rounded-xl overflow-hidden shadow-xl border border-slate-700">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-700 text-xs uppercase font-semibold text-slate-400">
                  <tr>
                    <th className="px-4 py-4 w-1/4">게시물 개수 / URL 범위</th>
                    <th className="px-4 py-4">마감 시간</th>
                    <th className="px-4 py-4">상태</th>
                    <th className="px-4 py-4">낙찰 요약</th>
                    <th className="px-4 py-4">정산</th>
                    <th className="px-4 py-4 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {tasksForDate.map(task => (
                    <tr key={task.id} className="hover:bg-slate-750 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-medium text-white mb-1">총 {task.urls?.length || 0}개 게시물</div>
                        <div className="text-xs text-slate-500 truncate max-w-xs" title={task.urls?.[0]}>
                          {task.urls?.[0]} ~ 끝
                        </div>
                      </td>
                      <td className="px-4 py-4 font-mono">
                        {task.targetTime ? new Date(task.targetTime).toLocaleString('ko-KR', { hour: 'numeric', minute: 'numeric', second: 'numeric' }) : '시간 없음'}
                      </td>
                      <td className="px-4 py-4">
                        {renderStatus(task.status)}
                      </td>
                      <td className="px-4 py-4">
                        {task.results ? (
                          <>
                            <span className="text-slate-300 font-medium block mb-1">총 {task.results.length}건 경매</span>
                            <span className="text-green-400 font-medium text-sm block mb-1">{task.results.filter(r => r.winnerName && r.winnerName !== '유찰(입찰자 없음)').length}건 낙찰완료</span>
                          </>
                        ) : task.resultMsg ? (
                          <span className="text-slate-400 text-sm">{task.resultMsg}</span>
                        ) : (
                          <span className="text-slate-500 text-sm">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {task.results ? (
                          (() => {
                            const summary = getTaskSettlementSummary(task);
                            if (!summary) return <span className="text-slate-500 text-sm">-</span>;
                            return (
                              <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-xs text-slate-300 space-y-1 min-w-[120px]">
                                <div className="flex justify-between gap-4">
                                  <span>총 낙찰액:</span>
                                  <strong className="text-emerald-400">{summary.totalAmount.toLocaleString()}원</strong>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>입금 완료:</span>
                                  <strong className="text-blue-400">{summary.paidAmount.toLocaleString()}원</strong>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>미입금:</span>
                                  <strong className="text-red-400">{summary.unpaidAmount.toLocaleString()}원</strong>
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-slate-500 text-sm">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button onClick={() => {
                          setEditingTaskId(task.id);
                          setStartUrl(task.urls?.[0] || '');
                          setEndUrl(task.urls?.[(task.urls?.length || 1) - 1] || '');
                          setNewSettingId(task.bandSettingId || '');
                          if (task.targetTime) {
                            const d = new Date(task.targetTime);
                            setTargetTimeStr(d.toTimeString().split(' ')[0]);
                          } else {
                            setTargetTimeStr('');
                          }
                          setAutoSendChat(task.autoSendChat || false);
                          setRestoreCommentPermission(task.restoreCommentPermission ?? false);
                          setIsAddModalOpen(true);
                        }} className="text-slate-500 hover:text-blue-400 transition-colors mr-3" title="수정">
                          <Edit2 size={18} />
                        </button>
                        <button onClick={() => handleRemoveTask(task.id)} className="text-slate-500 hover:text-red-400 transition-colors" title="삭제">
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasResultsForDate && (
              <div className="mt-6 bg-slate-800 rounded-xl overflow-hidden shadow-xl border border-slate-700 p-6">
                 <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                   <h3 className="text-lg font-bold text-white flex items-center">
                      <CheckCircle className="mr-2 text-emerald-400" size={20} /> 
                      {dateStr} 낙찰 요약 및 정산
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-sm">총 {Object.keys(groupedResultsForDate).length}명의 낙찰자</span>
                    </div>
                  </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                   {Object.entries(groupedResultsForDate)
               .sort(([winnerA, dataA], [winnerB, dataB]) => {
                 const isCompleteA = paidWinners[winnerA] && dataA.results.length > 0 && dataA.results.filter(r => !r.processedStatus).length === 0;
                 const isCompleteB = paidWinners[winnerB] && dataB.results.length > 0 && dataB.results.filter(r => !r.processedStatus).length === 0;
                 if (isCompleteA === isCompleteB) return 0;
                 return isCompleteA ? 1 : -1;
               })
               .map(([winner, data]) => {
               // 미처리 항목(킵/배송 안된것) 필터링
               const unprocessed = data.results.filter(r => !r.processedStatus);
               const isAllProcessed = data.results.length > 0 && unprocessed.length === 0;
               const isComplete = paidWinners[winner] && isAllProcessed;
               const totalAmount = data.results.reduce((sum, r) => sum + (r.winningBid * 1000), 0);
               
               return (
                 <div key={winner} className={`relative border p-4 rounded-lg flex flex-col transition-all ${isComplete ? 'bg-blue-900/20 border-blue-800/50 opacity-75' : isAllProcessed ? 'bg-slate-900 border-emerald-900/50 opacity-90' : 'bg-slate-900 border-slate-600 shadow-lg'}`}>
                    <div className="flex justify-between items-start mb-3 relative z-10">
                      <h4 className="font-bold text-lg text-green-300 flex items-center">
                        {!chatSentWinners[winner] && (
                          <input 
                            type="checkbox" 
                            className="mr-2 w-4 h-4 cursor-pointer accent-emerald-500"
                            checked={bulkChatSelection[winner] || false}
                            onChange={(e) => {
                              setBulkChatSelection(prev => ({ ...prev, [winner]: e.target.checked }));
                            }}
                          />
                        )}
                        <User size={18} className="mr-1" /> {winner}
                       {chatSentWinners[winner] && (
                         <span className="ml-2 text-green-400 text-xs font-bold">정산서전송완료</span>
                       )}
                       {chatFailedWinners[winner] && (
                         <span className="ml-2 text-red-400 text-xs font-bold">전송실패(건너뜀)</span>
                       )}
                       {paidWinners[winner] && !isComplete && (
                         <span className="ml-2 text-slate-400 text-xs font-bold">입금확인완료</span>
                       )}
                       {isComplete && (
                         <span className="ml-2 bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-500/30">COMPLETE</span>
                       )}
                     </h4>
                     <div className="text-emerald-400 font-bold">{totalAmount.toLocaleString()}원</div>
                   </div>
                   
                   <div className="flex-1 bg-slate-800 rounded p-2 mb-4 max-h-40 overflow-y-auto space-y-1">
                     {data.results.map((r, idx) => (
                       <div key={idx} className="flex justify-between text-xs items-center group">
                         <span className="text-slate-300 truncate pr-2 flex-1" title={r.postTitle}>{r.postTitle || '상품명 없음'}</span>
                         <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => { setEditingItem(r); }} className="text-slate-400 hover:text-blue-400 p-0.5 rounded">
                             <Edit2 size={12} />
                           </button>
                           <button onClick={() => { 
                               // 즉시 유찰 처리
                               const newResults = [...data.results];
                               const rIdx = newResults.findIndex(res => res.url === r.url);
                               if (rIdx >= 0) {
                                 newResults[rIdx] = { ...newResults[rIdx], winnerName: '유찰(입찰자 없음)', winningBid: 0 };
                                 const settingId = data.bandSettingId;
                                 if (settingId && window.electron && window.electron.updateGoogleSheetWinner) {
                                    window.electron.updateGoogleSheetWinner(settingId, r.url, '유찰(입찰자 없음)', 0)
                                      .catch((err: any) => console.error(err));
                                 }
                                 window.electron.updateAdminTask(r.taskId, { results: newResults });
                               }
                             }} className="text-slate-400 hover:text-red-400 p-0.5 rounded mr-2" title="낙찰 취소(무효) 처리">
                             <Trash2 size={12} />
                           </button>
                         </div>
                         <span className="text-slate-400 whitespace-nowrap">{(r.winningBid * 1000).toLocaleString()}원</span>
                         {r.processedStatus && (
                           <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${r.processedStatus === 'KEEP' ? 'bg-green-900/50 text-green-300' : 'bg-emerald-900/50 text-emerald-300'}`}>
                             {r.processedStatus === 'KEEP' ? '킵완료' : '배송완료'}
                           </span>
                         )}
                       </div>
                     ))}
                   </div>
                   
                   <div className="flex flex-col gap-2 mt-auto">
                     {chatLogs.length > 0 && chatSending[winner] && (
                       <div className="bg-slate-900 border border-slate-700 p-2 rounded text-xs text-slate-300 font-mono">
                         {chatLogs.map((log, i) => <div key={i}>{log}</div>)}
                       </div>
                     )}

                     <div className="flex gap-2">
                       <button onClick={() => copySingleSettlement(winner, data.results, data.bandSettingId)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-1.5 rounded text-sm transition-colors flex justify-center items-center">
                         <Copy size={14} className="mr-1" /> 복사
                       </button>
                       <button 
                         onClick={() => {
                           if (!isProUnlocked) {
                             alert('개별 채팅톡 기능은 PRO 버전부터 이용 가능합니다.');
                             return;
                           }
                           sendChatSettlement(winner, data.results, data.bandSettingId);
                         }} 
                         disabled={chatSending[winner]}
                         className={`flex-1 flex justify-center items-center py-1.5 rounded text-sm transition-colors ${chatSending[winner] ? 'bg-slate-600 text-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                       >
                         {chatSending[winner] ? <Clock size={14} className="animate-spin mr-1" /> : <MessageCircle size={14} className="mr-1" />}
                         {chatSending[winner] ? '전송중...' : '채팅 톡'}
                         {!chatSending[winner] && (isProUnlocked ? <Unlock size={12} className="ml-1 text-emerald-200" /> : <Lock size={12} className="ml-1 text-red-300" />)}
                       </button>
                     </div>
                     
                     <button 
                       onClick={() => handlePaymentComplete(winner)} 
                       className={`w-full py-1.5 rounded text-sm transition-colors flex justify-center items-center shadow-md font-medium ${paidWinners[winner] ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                     >
                       {paidWinners[winner] ? <><CheckCircle size={14} className="mr-1" /> 입금확인완료</> : (
                         <>
                           입금확인필요 
                           {!members.some(m => m.nickname === winner) && <span className="text-xs text-slate-400 font-normal ml-1">(회원자동등록)</span>}
                         </>
                       )}
                     </button>

                     {!isAllProcessed ? (
                       <div className="grid grid-cols-2 gap-2">
                         <button 
                           disabled={!paidWinners[winner]}
                           onClick={() => handleKeepItems(winner, unprocessed)} 
                           className={`${paidWinners[winner] ? 'bg-green-600 hover:bg-green-500 text-white cursor-pointer' : 'bg-slate-600 text-slate-400 cursor-not-allowed'} py-1.5 rounded text-sm transition-colors flex justify-center items-center shadow-md`}
                         >
                           <Package size={14} className="mr-1" /> 남은 항목 킵
                         </button>
                         <button 
                           disabled={!paidWinners[winner]}
                           onClick={() => handleShipItems(winner, unprocessed)} 
                           className={`${paidWinners[winner] ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer' : 'bg-slate-600 text-slate-400 cursor-not-allowed'} py-1.5 rounded text-sm transition-colors flex justify-center items-center shadow-md`}
                         >
                           <Truck size={14} className="mr-1" /> 남은 항목 배송
                         </button>
                       </div>
                     ) : (
                       <div className="text-center text-xs text-emerald-400 py-1.5 bg-emerald-900/20 rounded font-medium flex justify-between items-center px-4">
                         <span className="flex-1">모든 항목 처리 완료</span>
                       </div>
                     )}
                     
                     {data.results.filter(r => r.processedStatus).length > 0 && (
                        <button onClick={() => handleUndoItems(winner, data.results.filter(r => r.processedStatus))} className="text-xs text-slate-400 hover:text-red-400 mt-1 underline text-center w-full">
                          처리 내역 되돌리기 (취소)
                        </button>
                     )}
                   </div>
                 </div>
                );
              })}
            </div>
           </div>
          )}
          </div>
        );
      })}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl border border-slate-700">
            <h3 className="text-xl font-bold text-white mb-6">{editingTaskId ? '경매 수정' : '+ 경매 추가'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">밴드 선택</label>
                <select 
                  value={newSettingId} 
                  onChange={e => {
                    const val = e.target.value;
                    setNewSettingId(val);
                    if (val) {
                      const setting = bandSettings.find(s => s.id === val);
                      if (setting && setting.defaultCloseTime) {
                        setTargetTimeStr(setting.defaultCloseTime);
                      }
                    }
                  }} 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                >
                  <option value="">밴드를 선택하세요</option>
                  {bandSettings.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">시작 게시물 URL</label>
                <input type="text" value={startUrl} onChange={e => setStartUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="https://band.us/band/1234/post/100" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">마지막 게시물 URL</label>
                <input type="text" value={endUrl} onChange={e => setEndUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="https://band.us/band/1234/post/105" />
                <p className="text-xs text-slate-500 mt-1">시작부터 마지막 번호까지 모든 주소를 차례대로 스캔합니다.</p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">마감 시간 (HH:mm:ss)</label>
                <input type="text" value={targetTimeStr} onChange={e => setTargetTimeStr(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono" placeholder="21:00:00" />
              </div>
              <div className="pt-2">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={restoreCommentPermission}
                    onChange={(e) => setRestoreCommentPermission(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm">경매 마감 후 댓글 권한 '전체'로 다시 변경하기</span>
                </label>
                <label className={`flex items-center space-x-2 text-slate-300 ${!isProUnlocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={autoSendChat}
                    onChange={(e) => {
                      if (!isProUnlocked) {
                        alert('자동 정산메시지 전송 기능은 유료 서비스입니다.\n사용을 원하시면 관리자에게 문의해주세요.');
                        return;
                      }
                      setAutoSendChat(e.target.checked);
                    }}
                    disabled={!isProUnlocked}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-800 disabled:opacity-50"
                  />
                  <span className="text-sm">경매 마감 후 자동 정산 메시지 보내기</span>
                  {isProUnlocked ? (
                    <Unlock size={14} className="text-emerald-500" />
                  ) : (
                    <Lock size={14} className="text-red-500" />
                  )}
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-8">
              <button onClick={() => { setIsAddModalOpen(false); setEditingTaskId(null); }} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">취소</button>
              <button onClick={handleAddTask} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded shadow-lg transition-colors font-medium">{editingTaskId ? '수정하기' : '추가하기'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {editingItem && (
        <EditResultModal 
          item={editingItem}
          onCancel={() => setEditingItem(null)}
          onSave={(name, bid) => saveEditResult(editingItem.url, editingItem.taskId, name, bid)}
        />
      )}

      {isSettingsModalOpen && (
        <BandSettingsModal
          isOpen={isSettingsModalOpen}
          settings={bandSettings}
          onClose={() => setIsSettingsModalOpen(false)}
          onSave={(setting) => {
            window.electron.saveBandSetting(setting);
            setBandSettings(prev => {
              const exists = prev.find(s => s.id === setting.id);
              if (exists) return prev.map(s => s.id === setting.id ? setting : s);
              return [...prev, setting];
            });
          }}
          onDelete={(id) => {
            window.electron.deleteBandSetting(id);
            setBandSettings(prev => prev.filter(s => s.id !== id));
          }}
        />
      )}
    </div>
  );
}

function EditResultModal({ item, onCancel, onSave }: { item: GroupedResultItem, onCancel: () => void, onSave: (name: string, bid: number) => void }) {
  const [name, setName] = useState(item.winnerName || '');
  const [bid, setBid] = useState(item.winningBid ? item.winningBid.toString() : '0');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-4">낙찰 정보 수정</h3>
        <div className="mb-4 text-sm text-slate-400 bg-slate-900 p-3 rounded">
          {item.postTitle}
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">낙찰자 닉네임</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">낙찰가 (단위: 천원, 예: 1.5)</label>
            <input 
              type="number" 
              step="0.1" 
              value={bid} 
              onChange={e => setBid(e.target.value)} 
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white" 
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onCancel} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors">
            취소
          </button>
          <button 
            onClick={() => {
              const finalName = name.trim();
              const finalBid = Number(bid) || 0;
              onSave(finalName, finalBid);
            }} 
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold transition-colors"
          >
            저장 및 이동
          </button>
        </div>
      </div>
    </div>
  );
}

