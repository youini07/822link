import React, { useState, useEffect } from 'react';
import { UserPlus, Copy, Key, Calendar, AlertCircle, CheckCircle2, Trash2, Edit2, ShieldAlert } from 'lucide-react';

interface AccountManagementProps {
  token: string;
}

interface User {
  id: number;
  username: string;
  expires_at: string;
  created_at: string;
  ai_analysis_enabled: boolean;
  upload_bot_enabled: boolean;
  auto_settlement_enabled: boolean;
  band_features_enabled: boolean;
  ai_usage_count?: number;
}

export function AccountManagement({ token }: AccountManagementProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [daysValid, setDaysValid] = useState('30');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // User List State
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Modals
  const [planModal, setPlanModal] = useState<{isOpen: boolean, user: User | null, planName: 'PRO' | 'MAX' | null}>({isOpen: false, user: null, planName: null});
  const [planDays, setPlanDays] = useState('30');

  const [expiryModal, setExpiryModal] = useState<{isOpen: boolean, userId: number | null, currentExpiry: string | null}>({isOpen: false, userId: null, currentExpiry: null});
  const [expiryDays, setExpiryDays] = useState('30');

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const response = await fetch('https://bandadmin-auth-server-production.up.railway.app/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('사용자 목록을 불러오지 못했습니다.');
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [token]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !daysValid) {
      setMessage({ type: 'error', text: '모든 필드를 입력해주세요.' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch('https://bandadmin-auth-server-production.up.railway.app/api/register', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          username, 
          password, 
          daysValid: parseInt(daysValid, 10) 
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '계정 생성에 실패했습니다.');
      }

      setMessage({ type: 'success', text: `[${data.user.username}] 사장님 계정이 발급되었습니다!` });
      setUsername('');
      setPassword('');
      setDaysValid('30');
      
      // 목록 새로고침
      fetchUsers();
      
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '서버 통신 오류' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUser = async (userId: number, userName: string) => {
    if (!window.confirm(`정말 [${userName}] 계정을 삭제하시겠습니까?\n이 작업은 절대 되돌릴 수 없습니다.`)) return;

    try {
      const response = await fetch(`https://bandadmin-auth-server-production.up.railway.app/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('계정 삭제 실패');
      alert('계정이 삭제되었습니다.');
      fetchUsers();
    } catch (err: any) {
      alert(`삭제 중 오류가 발생했습니다: ${err.message}`);
    }
  };

  const handleUpdatePlan = async (user: User, planName: 'PRO' | 'MAX' | 'FREE' | 'MARKET') => {
    if (!window.confirm(`[${user.username}] 계정에 ${planName} 권한을 설정하시겠습니까?`)) return;

    try {
      const updates: any = {};
      
      if (planName === 'PRO') {
        updates.ai_analysis_enabled = false;
        updates.upload_bot_enabled = false;
        updates.auto_settlement_enabled = true;
        updates.band_features_enabled = true;
      } else if (planName === 'MAX') {
        updates.ai_analysis_enabled = true;
        updates.upload_bot_enabled = true;
        updates.auto_settlement_enabled = true;
        updates.band_features_enabled = true;
      } else if (planName === 'MARKET') {
        updates.ai_analysis_enabled = true;
        updates.upload_bot_enabled = true;
        updates.auto_settlement_enabled = false;
        updates.band_features_enabled = false;
      } else if (planName === 'FREE') {
        updates.ai_analysis_enabled = false;
        updates.upload_bot_enabled = false;
        updates.auto_settlement_enabled = false;
        updates.band_features_enabled = true;
      }

      const response = await fetch(`https://bandadmin-auth-server-production.up.railway.app/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('권한 수정 실패');
      
      alert(`[${user.username}] 계정이 ${planName} 등급으로 설정되었습니다.`);
      fetchUsers();
    } catch (err: any) {
      alert(err.message || '오류가 발생했습니다.');
    }
  };

  const confirmPlanUpdate = async () => {
    if (!planModal.user || !planModal.planName) return;
    const addDays = parseInt(planDays, 10);
    if (isNaN(addDays)) {
      alert('숫자만 입력해주세요.');
      return;
    }

    let newPlanFields: any = {};
    if (planModal.planName === 'PRO') {
      newPlanFields = { ai_analysis_enabled: false, upload_bot_enabled: false, auto_settlement_enabled: true };
    } else if (planModal.planName === 'MAX') {
      newPlanFields = { ai_analysis_enabled: true, upload_bot_enabled: true, auto_settlement_enabled: true };
    }

    if (addDays !== 0) {
      const newDate = new Date(planModal.user.expires_at);
      newDate.setDate(newDate.getDate() + addDays);
      newPlanFields.expires_at = newDate.toISOString();
    }

    try {
      const response = await fetch(`https://bandadmin-auth-server-production.up.railway.app/api/users/${planModal.user.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(newPlanFields)
      });
      
      if (!response.ok) throw new Error('권한 수정 실패');
      setPlanModal({isOpen: false, user: null, planName: null});
      fetchUsers();
    } catch (err: any) {
      alert(`수정 중 오류가 발생했습니다: ${err.message}`);
    }
  };

  const handleUpdateExpiry = async (userId: number, currentExpiry: string) => {
    setExpiryDays('30');
    setExpiryModal({isOpen: true, userId, currentExpiry});
  };

  const confirmExpiryUpdate = async () => {
    if (!expiryModal.userId || !expiryModal.currentExpiry) return;
    const addDays = parseInt(expiryDays, 10);
    if (isNaN(addDays)) {
      alert('숫자만 입력해주세요.');
      return;
    }

    const newDate = new Date(expiryModal.currentExpiry);
    newDate.setDate(newDate.getDate() + addDays);

    if (!window.confirm(`만료일을 [${newDate.toLocaleDateString('ko-KR')}]로 변경하시겠습니까?`)) return;

    try {
      const response = await fetch(`https://bandadmin-auth-server-production.up.railway.app/api/users/${expiryModal.userId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ expires_at: newDate.toISOString() })
      });
      
      if (!response.ok) throw new Error('만료일 수정 실패');
      alert('만료일이 성공적으로 변경되었습니다.');
      setExpiryModal({isOpen: false, userId: null, currentExpiry: null});
      fetchUsers();
    } catch (err: any) {
      alert(`수정 중 오류가 발생했습니다: ${err.message}`);
    }
  };

  const copyToClipboard = () => {
    const text = `[경매 라이선스 발급 안내]\n아이디: ${username}\n임시 비밀번호: ${password}\n접속 후 우측 상단의 '비밀번호 변경'을 통해 원하시는 비밀번호로 변경해주세요!`;
    if(navigator.clipboard) {
       navigator.clipboard.writeText(text);
       alert('복사되었습니다! 사장님께 전달해주세요.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 p-8 text-slate-300">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* 새 계정 발급 영역 */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-green-900/50 rounded-lg flex items-center justify-center mr-3 border border-green-700/50">
              <UserPlus className="text-green-400" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">새 라이선스 발급</h2>
              <p className="text-slate-400 text-sm">사장님들에게 지급할 새로운 계정(라이선스)을 발급합니다.</p>
            </div>
          </div>

          {message && (
            <div className={`mb-6 p-4 rounded-lg flex items-center ${message.type === 'success' ? 'bg-emerald-900/30 border border-emerald-800/50 text-emerald-300' : 'bg-red-900/30 border border-red-800/50 text-red-300'}`}>
              {message.type === 'success' ? <CheckCircle2 className="mr-2 shrink-0" size={20}/> : <AlertCircle className="mr-2 shrink-0" size={20}/>}
              <span>{message.text}</span>
            </div>
          )}

          <form onSubmit={handleCreateAccount} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">새 아이디</label>
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="예: boss_01"
                  className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 flex justify-between">
                  <span>임시 비밀번호</span>
                  {password && <button type="button" onClick={copyToClipboard} className="text-xs text-green-400 hover:text-green-300 flex items-center"><Copy size={12} className="mr-1"/> 복사</button>}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key size={16} className="text-slate-500" />
                  </div>
                  <input 
                    type="text" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="사장님께 전달할 임시 비밀번호"
                    className="w-full pl-9 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors"
                  />
                </div>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-slate-300">라이선스 만료일 설정 (일)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar size={16} className="text-slate-500" />
                  </div>
                  <input 
                    type="number" 
                    value={daysValid}
                    onChange={(e) => setDaysValid(e.target.value)}
                    min="1"
                    className="w-full pl-9 pr-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">입력한 일수만큼 해당 계정이 활성화됩니다. 기본적으로 모든 유료 권한이 부여됩니다.</p>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className={`w-full py-3.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center shadow-lg shadow-green-900/20 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? '발급 중...' : '새 라이선스 계정 발급하기'}
            </button>
          </form>
        </div>

        {/* 발급된 계정 목록 영역 */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-blue-900/50 rounded-lg flex items-center justify-center mr-3 border border-blue-700/50">
                <ShieldAlert className="text-blue-400" size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">발급된 계정 관리</h2>
                <p className="text-slate-400 text-sm">계정의 만료일과 기능 권한을 제어합니다.</p>
              </div>
            </div>
            <button 
              onClick={fetchUsers}
              disabled={isLoadingUsers}
              className="text-sm bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {isLoadingUsers ? '불러오는 중...' : '새로고침'}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900/50">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="p-4 font-medium">아이디</th>
                  <th className="p-4 font-medium text-center">만료일 (D-Day)</th>
                  <th className="p-4 font-medium text-center">현재 플랜</th>
                  <th className="p-4 font-semibold text-sm text-slate-300 w-[420px] uppercase tracking-wider text-center border-l border-slate-700">권한 관리</th>
                  <th className="p-4 font-semibold text-sm text-slate-300 w-24 uppercase tracking-wider text-center border-l border-slate-700">AI 분석량</th>
                  <th className="p-4 font-medium text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      발급된 일반 사장님 계정이 없습니다.
                    </td>
                  </tr>
                ) : (
                  users.map(user => {
                    const expiry = new Date(user.expires_at);
                    const now = new Date();
                    const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const isExpired = diffDays <= 0;

                    return (
                      <tr key={user.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-200">{user.username}</div>
                          <div className="text-xs text-slate-500">생성일: {new Date(user.created_at).toLocaleDateString('ko-KR')}</div>
                        </td>
                        <td className="p-4 text-center">
                          <div className={`font-mono font-bold ${isExpired ? 'text-red-400' : diffDays <= 7 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {isExpired ? '만료됨' : `D-${diffDays}`}
                          </div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1">
                            {expiry.toLocaleDateString('ko-KR')}
                            <button onClick={() => handleUpdateExpiry(user.id, user.expires_at)} className="p-1 hover:bg-slate-700 rounded text-blue-400" title="만료일 연장/단축">
                              <Edit2 size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          {user.band_features_enabled === false ? (
                            <span className="inline-block bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold px-3 py-1.5 rounded-full text-xs">오픈마켓</span>
                          ) : user.ai_analysis_enabled || user.upload_bot_enabled ? (
                            <span className="inline-block bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 rounded-full text-xs">MAX 플랜</span>
                          ) : user.auto_settlement_enabled ? (
                            <span className="inline-block bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold px-3 py-1.5 rounded-full text-xs">PRO 플랜</span>
                          ) : (
                            <span className="inline-block bg-slate-700/50 text-slate-400 border border-slate-600 font-bold px-3 py-1.5 rounded-full text-xs">FREE</span>
                          )}
                        </td>
                        <td className="p-4 text-center border-l border-slate-700 bg-slate-800/30">
                          <div className="flex flex-wrap justify-center gap-2">
                            <button onClick={() => handleUpdatePlan(user, 'PRO')} className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors">PRO 부여</button>
                            <button onClick={() => handleUpdatePlan(user, 'MAX')} className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors">MAX 부여</button>
                            <button onClick={() => handleUpdatePlan(user, 'MARKET')} className="bg-orange-600 hover:bg-orange-500 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors">오픈마켓 부여</button>
                            {(user.ai_analysis_enabled || user.upload_bot_enabled || user.auto_settlement_enabled || !user.band_features_enabled) && (
                              <button onClick={() => handleUpdatePlan(user, 'FREE')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 transition-colors">권한 삭제</button>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-center bg-emerald-900/5 font-mono">
                          {user.ai_usage_count ? user.ai_usage_count.toLocaleString() : 0}건
                        </td>
                        <td className="p-4 text-center">
                          <button 
                            onClick={() => handleDeleteUser(user.id, user.username)}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors border border-transparent hover:border-red-900/50"
                            title="계정 강제 삭제"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {planModal.isOpen && planModal.user && planModal.planName && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-sm border border-slate-700 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">
              [{planModal.user.username}] 계정에 {planModal.planName} 권한 부여
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">권한을 부여할 '일수'를 입력해주세요.</label>
                <input 
                  type="number" 
                  value={planDays}
                  onChange={e => setPlanDays(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white focus:border-green-500 focus:outline-none" 
                  placeholder="30"
                />
                <p className="text-xs text-slate-500 mt-2">
                  (예: 30 입력 시 현재 만료일에서 30일 연장)<br/>
                  ※ 기간 연장이 필요 없다면 0을 입력하세요.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button 
                onClick={() => setPlanModal({isOpen: false, user: null, planName: null})} 
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                취소
              </button>
              <button 
                onClick={confirmPlanUpdate} 
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-sm font-bold transition-colors shadow-lg"
              >
                부여하기
              </button>
            </div>
          </div>
        </div>
      )}

      {expiryModal.isOpen && expiryModal.userId && expiryModal.currentExpiry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-sm border border-slate-700 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">만료일 연장/단축</h3>
            <div className="space-y-4">
              <div className="text-sm text-slate-400 mb-2">
                현재 만료일: {new Date(expiryModal.currentExpiry).toLocaleDateString('ko-KR')}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">연장(또는 단축)할 '일수'를 입력해주세요.</label>
                <input 
                  type="number" 
                  value={expiryDays}
                  onChange={e => setExpiryDays(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white focus:border-blue-500 focus:outline-none" 
                  placeholder="30"
                />
                <p className="text-xs text-slate-500 mt-2">
                  (예: 30 입력 시 30일 연장, -10 입력 시 10일 단축)
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button 
                onClick={() => setExpiryModal({isOpen: false, userId: null, currentExpiry: null})} 
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                취소
              </button>
              <button 
                onClick={confirmExpiryUpdate} 
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold transition-colors shadow-lg"
              >
                변경하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
