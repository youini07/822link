import React, { useState } from 'react';
import { X, Lock, Key, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
}

export function ChangePasswordModal({ isOpen, onClose, token }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  if (!isOpen) return null;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ type: 'error', text: '모든 필드를 입력해주세요.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch('https://bandadmin-auth-server-production.up.railway.app/api/change-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '비밀번호 변경에 실패했습니다.');
      }

      setMessage({ type: 'success', text: '비밀번호가 성공적으로 변경되었습니다!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      
      // 2초 뒤 창 닫기
      setTimeout(() => {
        onClose();
        setMessage(null);
      }, 2000);

    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '서버 통신 오류' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
          <h2 className="text-lg font-bold text-white flex items-center">
            <Lock className="mr-2 text-green-400" size={20} /> 비밀번호 변경
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          {message && (
            <div className={`mb-6 p-3 rounded-lg flex items-center text-sm ${message.type === 'success' ? 'bg-emerald-900/30 border border-emerald-800/50 text-emerald-300' : 'bg-red-900/30 border border-red-800/50 text-red-300'}`}>
              {message.type === 'success' ? <CheckCircle2 className="mr-2 shrink-0" size={16}/> : <AlertCircle className="mr-2 shrink-0" size={16}/>}
              <span>{message.text}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">현재 임시/기존 비밀번호</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Key size={14} className="text-slate-500" />
                </div>
                <input 
                  type="password" 
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">새로운 비밀번호</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={14} className="text-slate-500" />
                </div>
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">새로운 비밀번호 확인</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <CheckCircle2 size={14} className="text-slate-500" />
                </div>
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-green-500 transition-colors text-sm"
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className={`w-full py-3 mt-4 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center text-sm ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? <><Loader2 size={16} className="animate-spin mr-2" /> 변경 중...</> : '비밀번호 변경하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
