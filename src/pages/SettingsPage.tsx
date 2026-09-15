import { useState, useEffect } from 'react';
import { Save, FolderOpen, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const [telegramToken, setTelegramToken] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [processedFolder, setProcessedFolder] = useState('');
  const [thumbnailFolder, setThumbnailFolder] = useState('');
  const [watchFolder, setWatchFolder] = useState('');
  const [purchasedFolder, setPurchasedFolder] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI?.settings) {
          const tToken = await window.electronAPI.settings.get('telegramBotToken');
          const gKey = await window.electronAPI.settings.get('geminiApiKey');
          const sUrl = await window.electronAPI.settings.get('googleSpreadsheetUrl');
          const dUrl = await window.electronAPI.settings.get('googleDriveUrl');
          const pFolder = await window.electronAPI.settings.get('localImageSavePath');
          const thFolder = await window.electronAPI.settings.get('localThumbnailSavePath');
          const wFolder = await window.electronAPI.settings.get('localImageWatchPath');
          const purFolder = await window.electronAPI.settings.get('purchasedItemImageFolder');
          
          if (tToken) setTelegramToken(tToken);
          if (gKey) setGeminiKey(gKey);
          if (sUrl) setSheetUrl(sUrl);
          if (dUrl) setDriveUrl(dUrl);
          if (pFolder) setProcessedFolder(pFolder);
          if (thFolder) setThumbnailFolder(thFolder);
          if (wFolder) setWatchFolder(wFolder);
          if (purFolder) setPurchasedFolder(purFolder);
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Save general app settings
      if (window.electronAPI?.settings) {
        await window.electronAPI.settings.set('telegramBotToken', telegramToken);
        await window.electronAPI.settings.set('geminiApiKey', geminiKey);
        await window.electronAPI.settings.set('googleSpreadsheetUrl', sheetUrl);
        await window.electronAPI.settings.set('googleDriveUrl', driveUrl);
        await window.electronAPI.settings.set('localImageSavePath', processedFolder);
        await window.electronAPI.settings.set('localThumbnailSavePath', thumbnailFolder);
        await window.electronAPI.settings.set('localImageWatchPath', watchFolder);
        await window.electronAPI.settings.set('purchasedItemImageFolder', purchasedFolder);
      }
      
      // 2. Save to catalog settings to restart Telegram bot
      if ((window as any).electron?.getCatalogSettings && (window as any).electron?.saveCatalogSettings) {
        const currentCatalogSettings = await (window as any).electron.getCatalogSettings();
        const updatedCatalogSettings = { 
          ...currentCatalogSettings, 
          telegramToken: telegramToken, 
          geminiKey: geminiKey,
          googleSpreadsheetUrl: sheetUrl,
          googleDriveUrl: driveUrl,
          localWatchPath: watchFolder,
          localSavePath: processedFolder,
          localThumbnailSavePath: thumbnailFolder,
          purchasedItemImageFolder: purchasedFolder
        };
        await (window as any).electron.saveCatalogSettings(updatedCatalogSettings);
      }
      
      alert('설정이 성공적으로 저장되었습니다.');
    } catch (err) {
      console.error('Failed to save settings', err);
      alert('설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectFolder = async (setter: React.Dispatch<React.SetStateAction<string>>) => {
    if (window.electronAPI?.settings?.selectFolder) {
      const folderPath = await window.electronAPI.settings.selectFolder();
      if (folderPath) {
        setter(folderPath);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-900">
        <Loader2 size={24} className="animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-8 bg-slate-900 overflow-auto">
      <div className="max-w-3xl w-full mx-auto space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-200">환경설정</h2>
          <p className="text-sm text-slate-400 mt-1">
            API 연동 및 로컬 폴더 경로 등 시스템 전반의 필수 설정을 관리합니다.
          </p>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg shadow-black/20 space-y-6">
          
          {/* API 설정 섹션 */}
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-slate-200 border-b pb-2">API 연결 설정</h3>
            
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-semibold text-slate-300">텔레그램 Bot API 토큰</span>
                <input 
                  type="text" 
                  className="mt-1 w-full p-2.5 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                  placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">BotFather를 통해 발급받은 봇 토큰을 입력하세요.</p>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-300">Gemini API 키</span>
                <input 
                  type="password" 
                  className="mt-1 w-full p-2.5 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                  placeholder="AI_xxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">AI 분석 기능을 사용하기 위한 Google Gemini API 키입니다.</p>
              </label>
            </div>
          </section>

          {/* 데이터베이스 연동 섹션 */}
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-slate-200 border-b pb-2">데이터베이스 연동</h3>
            
            <label className="block">
              <span className="text-sm font-semibold text-slate-300">구글 스프레드시트 주소 (URL)</span>
              <input 
                type="text" 
                className="mt-1 w-full p-2.5 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">상품 관리에 사용할 스프레드시트 링크를 입력하세요.</p>
            </label>

            <label className="block mt-4">
              <span className="text-sm font-semibold text-slate-300">구글 드라이브 주소 (URL)</span>
              <input 
                type="text" 
                className="mt-1 w-full p-2.5 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                placeholder="https://drive.google.com/drive/folders/..."
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">이미지를 업로드할 구글 드라이브 폴더 링크를 입력하세요.</p>
            </label>
          </section>

          {/* 로컬 폴더 설정 섹션 */}
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-slate-200 border-b pb-2">로컬 파일 경로</h3>
            
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-semibold text-slate-300 mb-1">원본 이미지(누끼 포함) 저장 폴더</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly
                    className="flex-1 p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400 outline-none"
                    placeholder="폴더를 선택해주세요..."
                    value={processedFolder}
                  />
                  <button 
                    onClick={() => handleSelectFolder(setProcessedFolder)}
                    className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    <FolderOpen size={16} /> 찾아보기
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">텔레그램 전송 후 원본 1~6.jpg 파일 및 누끼 메인 이미지가 폴더(제품번호)별로 저장될 경로입니다.</p>
              </div>

              <div>
                <span className="block text-sm font-semibold text-slate-300 mb-1">썸네일 저장 폴더</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly
                    className="flex-1 p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400 outline-none"
                    placeholder="폴더를 선택해주세요..."
                    value={thumbnailFolder}
                  />
                  <button 
                    onClick={() => handleSelectFolder(setThumbnailFolder)}
                    className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    <FolderOpen size={16} /> 찾아보기
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">리사이징된 썸네일 이미지가 저장될 경로입니다.</p>
              </div>

            <div className="pt-2">
              <span className="text-sm font-semibold text-slate-300 block mb-1">사입품목 이미지 저장폴더</span>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly
                  className="w-full p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400 outline-none"
                  placeholder="폴더를 선택해주세요"
                  value={purchasedFolder}
                />
                <button 
                  onClick={async () => {
                    if (window.electronAPI?.settings) {
                      const folderPath = await window.electronAPI.settings.selectFolder();
                      if (folderPath) setPurchasedFolder(folderPath);
                    }
                  }}
                  className="shrink-0 px-4 py-2 bg-slate-800 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-900 transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <FolderOpen size={16} />
                  폴더 변경
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">오토시트 실행 시, 정리 안 된 이미지를 날짜별 폴더로 정리하여 업로드하는 폴더입니다.</p>
            </div>

              <div>
                <span className="block text-sm font-semibold text-slate-300 mb-1">이미지 감시(업로드) 폴더</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly
                    className="flex-1 p-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400 outline-none"
                    placeholder="폴더를 선택해주세요..."
                    value={watchFolder}
                  />
                  <button 
                    onClick={() => handleSelectFolder(setWatchFolder)}
                    className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    <FolderOpen size={16} /> 찾아보기
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">여기에 이미지를 넣으면 로컬 업로드 기능이 자동으로 감지하여 작동합니다.</p>
              </div>
            </div>
          </section>

          {/* 저장 버튼 */}
          <div className="pt-6 flex justify-end">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-bold flex items-center gap-2 transition-colors shadow-lg shadow-black/20"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              <span>{isSaving ? '저장 중...' : '설정 저장'}</span>
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}
