import { useState, useEffect } from 'react';
import { User, Phone, MapPin, Edit3, Trash2, Package, Check, Archive, Plus, Truck, Calendar, RotateCcw, Search } from 'lucide-react';
import type { Member } from './types';
import { MemberEditModal } from './MemberEditModal';

export function MemberManagement({ isActive }: { isActive?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [maxKeepDays, setMaxKeepDays] = useState<number | null>(null);
  
  // Editing & Creating state
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Member>>({});

  const loadMembers = async () => {
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      const data = await window.electron.getMembers(username);
      data.sort((a: Member, b: Member) => a.nickname.localeCompare(b.nickname));
      setMembers(data);
      if (selectedMember) {
        const updated = data.find((m: Member) => m.nickname === selectedMember.nickname);
        if (updated) setSelectedMember(updated);
      }
    }
  };

  const loadSettings = async () => {
    if (window.electron) {
      const settings = await window.electron.getBandSettings();
      if (settings && settings.length > 0 && settings[0].maxKeepDays) {
        setMaxKeepDays(settings[0].maxKeepDays);
      }
    }
  };

  useEffect(() => {
    if (isActive !== false) {
      loadMembers();
      loadSettings();
    }
  }, [isActive]);

  const handleAddNewMember = () => {
    setSelectedMember(null);
    setIsCreating(true);
    setIsEditing(false);
    setEditForm({ nickname: '', items: [] });
  };

  const handleSaveMember = async (memberData: Partial<Member>) => {
    if (isCreating && !memberData.nickname) {
      alert('아이디(닉네임)를 입력해주세요.');
      return;
    }

    const memberToSave = isCreating 
      ? { ...memberData, items: [] } as Member 
      : { ...selectedMember, ...memberData } as Member;

    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, memberToSave);
      await loadMembers();
      
      // 방금 저장한 멤버를 선택 상태로
      setSelectedMember(memberToSave);
      setIsEditing(false);
      setIsCreating(false);
    }
  };

  const handleDeleteMember = async (nickname: string) => {
    if (!confirm(`${nickname} 회원을 정말 삭제하시겠습니까? (구매 이력도 모두 삭제됩니다)`)) return;
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.deleteMember(username, nickname);
      if (selectedMember?.nickname === nickname) setSelectedMember(null);
      await loadMembers();
    }
  };

  const handleShipItems = async (itemIds: string[]) => {
    if (!selectedMember) return;
    if (!confirm(`선택한 ${itemIds.length}개 물품을 배송 완료 처리하시겠습니까?`)) return;
    
    // 삭제하지 않고 상태만 SHIPPED로 변경
    const updatedItems = (selectedMember.items || []).map(item => {
      if (itemIds.includes(item.id)) {
        return { ...item, status: 'SHIPPED' as const };
      }
      return item;
    });
    
    const updatedMember = { ...selectedMember, items: updatedItems };
    
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, updatedMember);
      await loadMembers();
    }
  };
  const handleToggleShippingReservation = async () => {
    if (!selectedMember) return;
    const updatedMember = { ...selectedMember, shippingReservation: !selectedMember.shippingReservation };
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, updatedMember);
      await loadMembers();
    }
  };

  const handleUndoShip = async (itemId: string) => {
    if (!selectedMember) return;
    if (!confirm('이 물품을 다시 "보관 중(KEEP)" 상태로 되돌리시겠습니까?')) return;
    
    const updatedItems = (selectedMember.items || []).map(item => {
      if (item.id === itemId) {
        return { ...item, status: 'KEEP' as const };
      }
      return item;
    });
    
    const updatedMember = { ...selectedMember, items: updatedItems };
    
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, updatedMember);
      await loadMembers();
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!selectedMember) return;
    if (!confirm('이 낙찰 상품을 정말 삭제하시겠습니까? (삭제된 상품은 복구할 수 없습니다)')) return;
    
    const updatedItems = (selectedMember.items || []).filter(item => item.id !== itemId);
    const updatedMember = { ...selectedMember, items: updatedItems };
    
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, updatedMember);
      await loadMembers();
    }
  };

  const handleShipAll = async () => {
    if (!selectedMember) return;
    const keepItems = (selectedMember.items || []).filter(i => i.status !== 'SHIPPED');
    if (keepItems.length === 0) return;
    
    if (!confirm(`${selectedMember.nickname}님의 모든 킵 물품(${keepItems.length}개)을 배송 완료 처리하시겠습니까?`)) return;
    
    const updatedItems = (selectedMember.items || []).map(item => ({
      ...item,
      status: item.status !== 'SHIPPED' ? 'SHIPPED' as const : item.status
    }));
    
    const updatedMember = { ...selectedMember, items: updatedItems, shippingReservation: false };
    if (window.electron) {
      const username = localStorage.getItem('bandadmin_username') || 'default';
      await window.electron.saveMember(username, updatedMember);
      await loadMembers();
    }
  };

  const filteredMembers = members.filter(member => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const phoneRaw = member.phone ? member.phone.replace(/-/g, '') : '';
    // 마지막 4자리 혹은 번호 전체 중에 검색어가 포함되어 있는지 확인
    const phoneMatch = phoneRaw.includes(query) || (phoneRaw.length >= 4 && phoneRaw.slice(-4).includes(query));
    return member.nickname.toLowerCase().includes(query) || phoneMatch;
  }).sort((a, b) => {
    if (a.shippingReservation && !b.shippingReservation) return -1;
    if (!a.shippingReservation && b.shippingReservation) return 1;
    return 0;
  });

  const checkKeepLimitExceeded = (member: Member) => {
    if (!maxKeepDays) return false;
    const oldestKeepItem = (member.items || []).filter(i => i.status !== 'SHIPPED').sort((a,b) => a.dateAdded - b.dateAdded)[0];
    if (oldestKeepItem) {
        const daysKept = (Date.now() - oldestKeepItem.dateAdded) / (1000 * 60 * 60 * 24);
        if (daysKept > maxKeepDays) return true;
    }
    return false;
  };

  return (
    <div className="flex w-full h-full bg-slate-900 text-slate-300">
      {/* Sidebar: Member List */}
      <div className="w-1/3 border-r border-slate-700 flex flex-col bg-slate-800/50">
        <div className="p-4 border-b border-slate-700 bg-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-white flex items-center">
            <User className="mr-2 text-green-400" size={20} />
            회원 목록 ({filteredMembers.length}명)
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={loadMembers} className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1.5 rounded transition-colors shadow text-sm" title="새로고침">
              <RotateCcw size={16} /> 새로고침
            </button>
            <button onClick={handleAddNewMember} className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded transition-colors shadow" title="새 회원 등록">
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="p-3 bg-slate-800 border-b border-slate-700">
          <div className="relative">
            <input 
              type="text" 
              placeholder="아이디 또는 연락처 검색..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-green-500 transition-colors"
            />
            <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredMembers.length === 0 && (
            <div className="p-4 text-center text-slate-500">
              {searchQuery ? '검색 결과가 없습니다.' : '등록된 회원이 없습니다.'}
            </div>
          )}
          {filteredMembers.map(member => {
            const isSelected = selectedMember?.nickname === member.nickname;
            const keepCount = (member.items || []).filter(i => i.status !== 'SHIPPED').length;
            const isKeepExceeded = checkKeepLimitExceeded(member);
            
            return (
              <button
                key={member.nickname}
                onClick={() => {
                  setSelectedMember(member);
                  setIsEditing(false);
                  setIsCreating(false);
                  setEditForm({});
                }}
                className={`w-full text-left p-3 rounded-lg flex justify-between items-center transition-colors ${isSelected && !isCreating ? 'bg-green-600 text-white' : member.shippingReservation ? 'bg-indigo-900/40 hover:bg-indigo-800/60' : 'hover:bg-slate-700'}`}
              >
                <div className="truncate pr-2">
                  <div className="font-semibold truncate flex items-center gap-2">
                    {member.nickname}
                    {member.shippingReservation && <span className="text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded">배송예약</span>}
                  </div>
                  {member.realName && <div className="text-xs opacity-80">{member.realName}</div>}
                  {isKeepExceeded && <div className="text-[10px] text-red-400 font-bold mt-0.5">! 킵 기간 초과</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isSelected && !isCreating ? 'bg-green-500 text-white' : keepCount > 0 ? 'bg-green-900/50 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                    킵 {keepCount}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content: Member Details */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-900 relative">
        {selectedMember ? (
          <>
            {/* Member Info Header */}
            <div className="p-6 border-b border-slate-700 bg-slate-800 shrink-0 overflow-y-auto max-h-[50%]">
              <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center">
                    <div className="w-16 h-16 bg-green-900 text-green-300 rounded-full flex items-center justify-center text-2xl font-bold mr-4">
                      {selectedMember?.nickname.substring(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">{selectedMember?.nickname}</h2>
                      <div className="flex flex-col gap-1 mt-1">
                        <p className="text-slate-400 text-sm">
                          총 누적 구매: <strong className="text-emerald-400 text-lg">{((selectedMember?.items || []).reduce((sum, item) => sum + item.winningBid * 1000, 0)).toLocaleString()}원</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleToggleShippingReservation}
                      className={`px-3 py-1.5 rounded flex items-center text-sm font-medium transition-colors shadow-sm border ${selectedMember.shippingReservation ? 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500' : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'}`}
                      title="배송예약 시 목록 최상단으로 정렬됩니다"
                    >
                      <Truck size={16} className="mr-2" /> 
                      {selectedMember.shippingReservation ? '배송예약 됨 (클릭 시 해제)' : '배송예약 (목록 상단 고정)'}
                    </button>
                    <button 
                      onClick={() => {
                        setIsEditing(true);
                        setEditForm(selectedMember || {});
                      }}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded flex items-center text-sm transition-colors"
                    >
                      <Edit3 size={16} className="mr-2" /> 정보 수정
                    </button>
                    <button 
                      onClick={() => selectedMember && handleDeleteMember(selectedMember.nickname)}
                      className="px-3 py-1.5 bg-red-900/50 hover:bg-red-800/80 text-red-300 rounded flex items-center text-sm transition-colors"
                    >
                      <Trash2 size={16} className="mr-2" /> 삭제
                    </button>
                  </div>
                </div>
              
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 mt-4 text-sm bg-slate-900 p-4 rounded-lg border border-slate-700">
                  <div className="flex items-center text-slate-300">
                    <User size={16} className="mr-3 text-slate-500" />
                    <span className="w-20 text-slate-500">실명:</span>
                    <span className="font-medium text-white">{selectedMember.realName || '-'}</span>
                  </div>
                  <div className="flex items-center text-slate-300">
                    <Phone size={16} className="mr-3 text-slate-500" />
                    <span className="w-20 text-slate-500">연락처:</span>
                    <span className="font-medium text-white">{selectedMember.phone || '-'}</span>
                  </div>
                  <div className="col-span-2 flex items-center text-slate-300">
                    <MapPin size={16} className="mr-3 text-slate-500" />
                    <span className="w-20 text-slate-500 shrink-0">배송지:</span>
                    <span className="truncate font-medium text-white">{selectedMember.address || '입력된 주소가 없습니다.'}</span>
                  </div>
                  {selectedMember.memo && (
                    <div className="col-span-2 mt-2 p-3 bg-slate-800 rounded border border-slate-700 text-slate-400 whitespace-pre-wrap">
                      <span className="font-semibold text-slate-300 mb-1 block">📝 특이사항:</span>
                      {selectedMember.memo}
                    </div>
                  )}
                </div>
              </div>

            {/* Purchase History List */}
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center">
                    <Package className="mr-2 text-green-400" size={20} />
                    구매 물품 기록 ({selectedMember.items?.length || 0}건)
                  </h3>
                  {(selectedMember.items || []).some(i => i.status !== 'SHIPPED') && (
                    <button onClick={handleShipAll} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded flex items-center text-sm font-medium shadow-lg transition-colors">
                      <Archive size={16} className="mr-2" /> 남은 킵 전체 배송 완료 처리
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 p-2">
                  {(!selectedMember.items || selectedMember.items.length === 0) ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                      <Package size={48} className="mb-4 opacity-20" />
                      <p>아직 등록된 구매 기록이 없습니다.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {[...selectedMember.items].sort((a,b) => b.dateAdded - a.dateAdded).map((item, idx) => (
                        <div key={item.id || idx} className={`border p-4 rounded-lg flex justify-between items-center transition-colors ${item.status === 'SHIPPED' ? 'bg-slate-900 border-slate-700/50 opacity-70' : 'bg-slate-850 border-slate-600'}`}>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                               <Calendar size={12} className="text-slate-500" />
                               <span className="text-xs text-slate-400">{new Date(item.dateAdded).toLocaleString('ko-KR')}</span>
                             <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${item.status === 'SHIPPED' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-green-900/50 text-green-400'}`}>
                               {item.status === 'SHIPPED' ? '배송 완료' : '보관 중 (KEEP)'}
                             </span>
                            </div>
                            <div className="font-medium text-white mb-1 flex items-center gap-3">
                              {item.thumbnailUrl && (
                                <img src={item.thumbnailUrl} alt="thumb" className="w-10 h-10 object-cover rounded bg-slate-800 border border-slate-700 shrink-0" />
                              )}
                              <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-green-400 transition-colors line-clamp-2">
                                {item.postTitle || '상품명 없음'}
                              </a>
                            </div>
                            <div className="text-slate-300 font-bold">{(item.winningBid * 1000).toLocaleString()}원</div>
                          </div>
                          {item.status !== 'SHIPPED' ? (
                            <div className="flex gap-2">
                              <button onClick={() => handleDeleteItem(item.id)} className="px-3 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded transition-colors flex items-center border border-red-900/50">
                                <Trash2 size={14} className="mr-1" /> 삭제
                              </button>
                              <button onClick={() => handleShipItems([item.id])} className="px-3 py-1.5 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded transition-colors flex items-center border border-emerald-900/50">
                                <Truck size={14} className="mr-1" /> 배송 처리
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleDeleteItem(item.id)} className="text-[10px] text-red-400 hover:text-red-300 underline flex items-center px-1">
                                  <Trash2 size={10} className="mr-1" /> 삭제
                                </button>
                                <div className="px-3 py-1.5 text-xs font-medium text-slate-500 flex items-center bg-slate-800/50 rounded">
                                  <Check size={14} className="mr-1" /> 처리됨
                                </div>
                              </div>
                              <button onClick={() => handleUndoShip(item.id)} className="text-[10px] text-slate-400 hover:text-green-400 underline flex items-center mt-1">
                                <RotateCcw size={10} className="mr-1" /> 되돌리기(킵)
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 flex-col">
            <User size={64} className="mb-4 opacity-20" />
            <p className="text-lg">좌측에서 회원을 선택하거나 새 회원을 등록해주세요.</p>
          </div>
        )}
        
        {/* Modal for Creating / Editing */}
        <MemberEditModal
          isOpen={isCreating || isEditing}
          isCreating={isCreating}
          initialData={editForm}
          onClose={() => {
            setIsCreating(false);
            setIsEditing(false);
          }}
          onSave={handleSaveMember}
        />
      </div>
    </div>
  );
}
