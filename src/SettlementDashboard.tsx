import { useState, useEffect, useMemo } from 'react';
import { BarChart3, TrendingUp, Calendar as CalendarIcon, DollarSign, Package } from 'lucide-react';
import type { Member } from './types';

export function SettlementDashboard({ isActive }: { isActive?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'all'>('weekly');
  const [currentDate, setCurrentDate] = useState(new Date());

  const loadMembers = async () => {
    if (window.electron) {
      const data = await window.electron.getMembers(localStorage.getItem('bandadmin_username') || 'default');
      setMembers(data);
    }
  };

  useEffect(() => {
    if (isActive !== false) {
      loadMembers();
    }
  }, [isActive]);

  const stats = useMemo(() => {
    let totalBids = 0;
    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;

    const targetYear = currentDate.getFullYear();
    const targetMonth = currentDate.getMonth();

    // Helper to check if a date falls in the selected period
    const isInPeriod = (dateMs: number) => {
      const d = new Date(dateMs);
      if (period === 'all') return true;
      if (period === 'monthly') {
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      }
      if (period === 'weekly') {
        // Calculate start and end of the week (Sunday to Saturday)
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return d >= startOfWeek && d <= endOfWeek;
      }
      return false;
    };

    members.forEach(member => {
      (member.items || []).forEach(item => {
        if (isInPeriod(item.dateAdded)) {
          totalBids++;
          totalAmount += item.winningBid * 1000;
          paidAmount += item.winningBid * 1000; // All saved items are considered paid now
        }
      });
    });

    return { totalBids, totalAmount, paidAmount, unpaidAmount };
  }, [members, period, currentDate]);

  const navigateDate = (dir: 'prev' | 'next') => {
    const nextDate = new Date(currentDate);
    if (period === 'monthly') {
      nextDate.setMonth(nextDate.getMonth() + (dir === 'next' ? 1 : -1));
    } else if (period === 'weekly') {
      nextDate.setDate(nextDate.getDate() + (dir === 'next' ? 7 : -7));
    }
    setCurrentDate(nextDate);
  };

  const periodLabel = useMemo(() => {
    if (period === 'all') return '전체 누적 통계';
    if (period === 'monthly') {
      return `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월`;
    }
    // Weekly
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()} ~ ${endOfWeek.getMonth() + 1}/${endOfWeek.getDate()}`;
  }, [period, currentDate]);

  return (
    <div className="flex-1 bg-slate-900 p-6 overflow-auto text-slate-200">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="text-purple-400" /> 정산 통계 대시보드
        </h2>
        
        <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={() => setPeriod('weekly')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${period === 'weekly' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            주간
          </button>
          <button
            onClick={() => setPeriod('monthly')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${period === 'monthly' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            월간
          </button>
          <button
            onClick={() => setPeriod('all')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${period === 'all' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
          >
            전체
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl mb-8">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-700">
          {period !== 'all' ? (
            <div className="flex items-center gap-4">
              <button onClick={() => navigateDate('prev')} className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white">
                ◀
              </button>
              <h3 className="text-xl font-bold text-white flex items-center gap-2 min-w-[150px] justify-center">
                <CalendarIcon size={20} className="text-purple-400" />
                {periodLabel}
              </h3>
              <button onClick={() => navigateDate('next')} className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white">
                ▶
              </button>
              <button onClick={() => setCurrentDate(new Date())} className="ml-4 px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">
                오늘/이번주
              </button>
            </div>
          ) : (
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <CalendarIcon size={20} className="text-purple-400" />
              전체 누적 통계
            </h3>
          )}
          <button onClick={loadMembers} className="text-sm bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded shadow transition-colors">
            데이터 새로고침
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl flex flex-col items-center justify-center text-center">
            <Package size={32} className="text-slate-500 mb-2" />
            <div className="text-slate-400 text-sm font-medium mb-1">총 낙찰건수</div>
            <div className="text-3xl font-bold text-white">{stats.totalBids.toLocaleString()}건</div>
          </div>
          
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl flex flex-col items-center justify-center text-center">
            <TrendingUp size={32} className="text-emerald-500 mb-2" />
            <div className="text-slate-400 text-sm font-medium mb-1">총 낙찰액</div>
            <div className="text-3xl font-bold text-emerald-400">{stats.totalAmount.toLocaleString()}원</div>
          </div>

          <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute -right-4 -top-4 opacity-5">
              <DollarSign size={100} />
            </div>
            <DollarSign size={32} className="text-blue-500 mb-2" />
            <div className="text-slate-400 text-sm font-medium mb-1">입금 완료액</div>
            <div className="text-3xl font-bold text-blue-400">{stats.paidAmount.toLocaleString()}원</div>
            <div className="mt-2 text-xs text-slate-500 font-bold bg-slate-800 px-2 py-1 rounded">
              비중: {stats.totalAmount > 0 ? Math.round((stats.paidAmount / stats.totalAmount) * 100) : 0}%
            </div>
          </div>

          <div className="bg-slate-900 border border-red-900/50 p-6 rounded-xl flex flex-col items-center justify-center text-center">
            <div className="w-8 h-8 rounded-full bg-red-900/50 flex items-center justify-center text-red-500 font-bold mb-2">!</div>
            <div className="text-slate-400 text-sm font-medium mb-1">미입금액 (수금 필요)</div>
            <div className="text-3xl font-bold text-red-400">{stats.unpaidAmount.toLocaleString()}원</div>
          </div>
        </div>
      </div>
    </div>
  );
}
