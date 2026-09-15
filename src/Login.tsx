import React, { useState } from 'react';
import { AlertCircle, User, KeyRound, Loader2 } from 'lucide-react';
import { BandLogo } from './BandLogo';

interface LoginProps {
  onLoginSuccess: (token: string, expiresAt: string, role: string, username: string, aiEnabled: boolean, uploadEnabled: boolean, autoSettlementEnabled: boolean, bandFeaturesEnabled: boolean, geminiApiKey?: string) => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState(() => localStorage.getItem('bandadmin_saved_username') || '');
  const [password, setPassword] = useState(() => localStorage.getItem('bandadmin_saved_password') || '');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('bandadmin_remember_me') === 'true');
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setErrorMsg('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('https://bandadmin-auth-server-production.up.railway.app/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '로그인에 실패했습니다.');
      }

      // Save credentials for next time if checked
      if (rememberMe) {
        localStorage.setItem('bandadmin_saved_username', username);
        localStorage.setItem('bandadmin_saved_password', password);
        localStorage.setItem('bandadmin_remember_me', 'true');
      } else {
        localStorage.removeItem('bandadmin_saved_username');
        localStorage.removeItem('bandadmin_saved_password');
        localStorage.setItem('bandadmin_remember_me', 'false');
      }

      // 로그인 성공
      const u = data.user || data;
      onLoginSuccess(
        data.token, 
        u.expires_at || u.expiresAt, 
        u.role || 'user', 
        username, 
        u.ai_analysis_enabled ?? true, 
        u.upload_bot_enabled ?? true, 
        u.auto_settlement_enabled ?? false, 
        u.band_features_enabled ?? true, 
        u.gemini_api_key
      );
      
    } catch (err: any) {
      setErrorMsg(err.message || '서버와 통신할 수 없습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center relative overflow-hidden font-sans">
      
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-green-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-600/20 blur-[120px] pointer-events-none" />

      {/* Login Card (Glassmorphism) */}
      <div className="w-full max-w-md p-8 bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl relative z-10 transition-all duration-300 transform">
        
        {/* Header Section */}
        <div className="flex flex-col items-center mb-8">
          <BandLogo size={64} className="mb-4 drop-shadow-lg" />
          <h1 className="text-2xl font-bold text-white tracking-tight">Band Admin Bot</h1>
        </div>

        {/* Error Message Alert */}
        {errorMsg && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-800/50 rounded-lg flex items-start animate-fade-in">
            <AlertCircle size={18} className="text-red-400 mr-2 mt-0.5 shrink-0" />
            <span className="text-red-300 text-sm leading-relaxed">{errorMsg}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          {/* Username Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 tracking-wide uppercase">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User size={18} className="text-slate-500" />
              </div>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디를 입력하세요"
                className="w-full pl-10 pr-4 py-3 bg-slate-950/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all text-sm shadow-inner"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 tracking-wide uppercase">Password / License</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <KeyRound size={18} className="text-slate-500" />
              </div>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호(라이선스 키)를 입력하세요"
                className="w-full pl-10 pr-4 py-3 bg-slate-950/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all text-sm shadow-inner"
              />
            </div>
          </div>

          {/* Remember Me Checkbox */}
          <div className="flex items-center mt-2">
            <input
              type="checkbox"
              id="remember-me"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 text-green-600 bg-slate-900 border-slate-700 rounded focus:ring-green-500 focus:ring-2 cursor-pointer accent-green-500"
            />
            <label htmlFor="remember-me" className="ml-2 text-sm text-slate-400 cursor-pointer select-none">
              아이디/비밀번호 저장
            </label>
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={isLoading}
            className={`w-full py-3 mt-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-green-900/50 transition-all flex items-center justify-center group ${isLoading ? 'opacity-70 cursor-not-allowed' : 'active:scale-[0.98]'}`}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin mr-2" />
                인증 중...
              </>
            ) : (
              '시스템 접속 (Login)'
            )}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-700/50 pt-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            라이선스 발급 및 연장은 관리자에게 문의하세요.<br/>
            (카카오톡 아이디: <strong className="text-slate-300">jayda</strong>)<br/>
            &copy; 2026 822 Shop Auction. All rights reserved.
          </p>
        </div>

      </div>
    </div>
  );
}
