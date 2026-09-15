import { useState, useEffect } from 'react';
import { X, Trash2, Save } from 'lucide-react';
import type { BandSetting, ScheduledMessage } from './types';

interface Props {
  isOpen: boolean;
  settings: BandSetting[];
  onClose: () => void;
  onSave: (setting: BandSetting) => void;
  onDelete: (id: string) => void;
}

export function BandSettingsModal({ isOpen, settings, onClose, onSave, onDelete }: Props) {
  const [selectedSetting, setSelectedSetting] = useState<BandSetting | null>(null);
  
  const [name, setName] = useState('');
  const [deadlineType, setDeadlineType] = useState<'TIME' | 'OBSERVER'>('TIME');
  const [observerOrder, setObserverOrder] = useState<'CHRONO' | 'REVERSE'>('CHRONO');
  const [adminId, setAdminId] = useState('');
  const [myNickname, setMyNickname] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [newBidLimitMinutes, setNewBidLimitMinutes] = useState<number | ''>('');
  const [maxKeepDays, setMaxKeepDays] = useState<number | ''>('');
  const [initialStartingBid, setInitialStartingBid] = useState('');
  const [defaultCloseTime, setDefaultCloseTime] = useState('');
  const [settlementMessage, setSettlementMessage] = useState('');
  const [bandUrl, setBandUrl] = useState('');
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);

  useEffect(() => {
    if (isOpen && settings.length > 0 && !selectedSetting) {
      handleSelect(settings[0]);
    } else if (!isOpen) {
      setSelectedSetting(null); // 모달 닫힐 때 선택 초기화
    }
  }, [isOpen, settings]);

  const handleSelect = (setting: BandSetting) => {
    setSelectedSetting(setting);
    setName(setting.name);
    setDeadlineType(setting.deadlineType);
    setObserverOrder(setting.observerOrder || 'CHRONO');
    setAdminId(setting.adminId || '');
    setMyNickname(setting.myNickname || '');
    setBankAccount(setting.bankAccount || '');
    setNewBidLimitMinutes(setting.newBidLimitMinutes || '');
    setMaxKeepDays(setting.maxKeepDays || '');
    setInitialStartingBid(setting.initialStartingBid || '');
    setDefaultCloseTime(setting.defaultCloseTime || '');
    setSettlementMessage(setting.settlementMessage || '');
    setBandUrl(setting.bandUrl || '');
    setScheduledMessages(setting.scheduledMessages || []);
  };

  const handleAddNew = () => {
    setSelectedSetting(null);
    setName('');
    setDeadlineType('TIME');
    setObserverOrder('CHRONO');
    setAdminId('');
    setMyNickname('');
    setBankAccount('');
    setNewBidLimitMinutes('');
    setMaxKeepDays('');
    setInitialStartingBid('');
    setDefaultCloseTime('');
    setSettlementMessage('');
    setBandUrl('');
    setScheduledMessages([]);
  };

  const handleSave = () => {
    if (!name) return alert('설정 이름을 입력해주세요.');
    
    const newSetting: BandSetting = {
      id: selectedSetting ? selectedSetting.id : Math.random().toString(36).substring(7),
      name,
      deadlineType,
      observerOrder: deadlineType === 'OBSERVER' ? observerOrder : undefined,
      adminId,
      myNickname,
      bankAccount,
      newBidLimitMinutes: typeof newBidLimitMinutes === 'number' ? newBidLimitMinutes : undefined,
      maxKeepDays: typeof maxKeepDays === 'number' ? maxKeepDays : undefined,
      initialStartingBid: initialStartingBid || undefined,
      defaultCloseTime: defaultCloseTime || undefined,
      settlementMessage: settlementMessage || undefined,
      bandUrl: bandUrl || undefined,
      scheduledMessages: scheduledMessages.length > 0 ? scheduledMessages : undefined
    };
    
    onSave(newSetting);
    handleSelect(newSetting);
    alert('저장되었습니다.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-xl w-full max-w-4xl shadow-2xl border border-slate-700 flex overflow-hidden max-h-[90vh]">
        
        {/* Left sidebar: List of settings */}
        <div className="w-1/3 border-r border-slate-700 bg-slate-850 flex flex-col">
          <div className="p-4 border-b border-slate-700 bg-slate-900/50">
            <h2 className="text-sm font-bold text-slate-400">밴드 설정 관리</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {settings.map(s => (
              <div 
                key={s.id} 
                className={`p-3 rounded cursor-pointer transition-colors flex justify-between items-center ${selectedSetting?.id === s.id ? 'bg-green-600 text-white' : 'hover:bg-slate-750 text-slate-300'}`}
                onClick={() => handleSelect(s)}
              >
                <span className="font-medium truncate">{s.name}</span>
                <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="text-slate-400 hover:text-red-400 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

          </div>
          <div className="p-4 border-t border-slate-700">
            <button onClick={handleAddNew} className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded transition-colors text-sm font-medium">
              + 새 설정 추가
            </button>
          </div>
        </div>

        {/* Right side: Edit form */}
        <div className="w-2/3 flex flex-col bg-slate-800 relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
          
          <div className="p-8 flex-1 overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-6">
              {selectedSetting ? '설정 수정' : '새 설정 작성'}
            </h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">설정 이름 (밴드명 등)</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">마감 방식</label>
                  <select value={deadlineType} onChange={e => setDeadlineType(e.target.value as any)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white">
                    <option value="TIME">시간 마감 (TIME)</option>
                    <option value="OBSERVER">순차 마감 (OBSERVER)</option>
                  </select>
                </div>
                
                {deadlineType === 'OBSERVER' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">순차 마감 기준</label>
                    <select value={observerOrder} onChange={e => setObserverOrder(e.target.value as any)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white">
                      <option value="CHRONO">등록순 (위에서 아래로)</option>
                      <option value="REVERSE">역순 (아래서 위로)</option>
                    </select>
                  </div>
                )}
              </div>
              


              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">밴드 고유 URL</label>
                <input type="text" value={bandUrl} onChange={e => setBandUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="예: https://band.us/band/1234567" />
                <p className="text-xs text-slate-500 mt-1">텔레그램 봇으로 이 밴드에 경매를 등록할 때 주소 조합용으로 사용됩니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">정산용 입금 계좌정보</label>
                <input type="text" value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="예: 국민 123456-78-901234 홍길동" />
                <p className="text-xs text-slate-500 mt-1">이 계좌번호는 정산서 복사 시 자동으로 포함됩니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">정산서 하단 추가 메시지</label>
                <textarea value={settlementMessage} onChange={e => setSettlementMessage(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-24 resize-y" placeholder="감사합니다. 입금 기한은 내일 정오까지입니다." />
                <p className="text-xs text-slate-500 mt-1">정산서 마지막 줄에 항상 고정으로 들어갈 안내 멘트를 적어주세요.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">신규 입찰 제한 시간 (분)</label>
                <input type="number" min="0" value={newBidLimitMinutes} onChange={e => setNewBidLimitMinutes(e.target.value ? parseInt(e.target.value, 10) : '')} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="예: 5 (5분 전 컷, 빈칸은 제한없음)" />
                <p className="text-xs text-slate-500 mt-1">예: 마감이 19:00:00이고 5분으로 설정한 경우, 18:55:59까지의 입찰은 인정되고 18:56:00부터의 신규 입찰은 무효 처리됩니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">최대 킵 기간 (일)</label>
                <input type="number" min="0" value={maxKeepDays} onChange={e => setMaxKeepDays(e.target.value ? parseInt(e.target.value, 10) : '')} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="예: 30 (빈칸은 무제한)" />
                <p className="text-xs text-slate-500 mt-1">이 기간을 초과하면 회원 관리 목록에서 "킵 기간 초과"로 표시됩니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">최초 경매시작가</label>
                <input type="text" value={initialStartingBid} onChange={e => setInitialStartingBid(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" placeholder="예: 1.5, 2 (시작 가격)" />
                <p className="text-xs text-slate-500 mt-1">이 밴드의 기본 경매 시작 가격을 설정합니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">기본 마감 시간 (HH:mm:ss)</label>
                <input type="text" value={defaultCloseTime} onChange={e => setDefaultCloseTime(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono" placeholder="예: 21:00:00" />
                <p className="text-xs text-slate-500 mt-1">새 구간 추가 시 이 시간이 자동으로 입력됩니다.</p>
              </div>

              <div className="border-t border-slate-700 pt-6 mt-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-slate-300">경매 안내 게시글 예약 (자동 등록)</label>
                  <button
                    onClick={() => {
                      setScheduledMessages([...scheduledMessages, { id: Math.random().toString(36).substring(7), timeOffsetMinutes: 5, message: '경매 마감 5분 전입니다. 앞으로 신규 입찰은 무효입니다.' }]);
                    }}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded transition-colors"
                  >
                    + 예약 추가
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-4">경매 마감 N분 전에 설정한 안내 메시지가 새로운 게시글로 자동 등록됩니다. (원하는 시간대마다 여러 메시지 등록 가능)</p>
                
                <div className="space-y-3">
                  {scheduledMessages.map((msg, idx) => (
                    <div key={msg.id} className="flex gap-2 items-start bg-slate-900/50 p-3 rounded border border-slate-700">
                      <div className="w-1/4">
                        <label className="text-xs text-slate-400 block mb-1">마감 몇 분 전?</label>
                        <input
                          type="number"
                          min="0"
                          value={msg.timeOffsetMinutes}
                          onChange={(e) => {
                            const next = [...scheduledMessages];
                            next[idx].timeOffsetMinutes = parseInt(e.target.value, 10) || 0;
                            setScheduledMessages(next);
                          }}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm focus:border-purple-500 outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 block mb-1">안내 메시지 (게시글 내용)</label>
                        <textarea
                          value={msg.message}
                          onChange={(e) => {
                            const next = [...scheduledMessages];
                            next[idx].message = e.target.value;
                            setScheduledMessages(next);
                          }}
                          className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm h-16 resize-y focus:border-purple-500 outline-none"
                        />
                      </div>
                      <button
                        onClick={() => {
                          setScheduledMessages(scheduledMessages.filter(m => m.id !== msg.id));
                        }}
                        className="text-slate-400 hover:text-red-400 mt-6 p-1 transition-colors"
                        title="삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {scheduledMessages.length === 0 && (
                    <div className="text-center text-sm text-slate-500 py-4 bg-slate-900/30 rounded border border-slate-700/50">
                      등록된 예약 메시지가 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-4 border-t border-slate-700 flex justify-end">
             <button onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded flex items-center shadow-lg transition-colors font-medium">
                <Save size={18} className="mr-2" /> 저장하기
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
