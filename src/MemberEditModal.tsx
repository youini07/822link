import { useState, useEffect } from 'react';
import { User, Check, X } from 'lucide-react';
import type { Member } from './types';

interface Props {
  isOpen: boolean;
  isCreating: boolean;
  initialData: Partial<Member>;
  onClose: () => void;
  onSave: (member: Partial<Member>) => void;
}

export function MemberEditModal({ isOpen, isCreating, initialData, onClose, onSave }: Props) {
  const [editForm, setEditForm] = useState<Partial<Member>>(initialData);

  useEffect(() => {
    setEditForm(initialData);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl border border-slate-700 flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white flex items-center">
            <User className="mr-2 text-green-400" /> 
            {isCreating ? '새 회원 등록' : '회원 정보 수정'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            {isCreating && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1">아이디 (닉네임) *필수</label>
                <input type="text" value={editForm.nickname || ''} onChange={e => setEditForm({...editForm, nickname: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">실명 (이름)</label>
              <input type="text" value={editForm.realName || ''} onChange={e => setEditForm({...editForm, realName: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">연락처</label>
              <input type="text" value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" placeholder="010-0000-0000" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-1">배송받을 주소</label>
              <input type="text" value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-1">특이사항 (메모)</label>
              <textarea value={editForm.memo || ''} onChange={e => setEditForm({...editForm, memo: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" rows={3} />
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-700 bg-slate-900/30 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
            취소
          </button>
          <button onClick={() => onSave(editForm)} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg flex items-center text-sm font-medium transition-colors shadow-lg shadow-green-900/20">
            <Check size={18} className="mr-2" /> 저장하기
          </button>
        </div>
      </div>
    </div>
  );
}
