import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

function ErrorFallback({ error, resetErrorBoundary }: any) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-red-400">
      <h1 className="text-2xl font-bold mb-4">치명적인 오류 발생!</h1>
      <pre className="bg-black/50 p-4 rounded-lg overflow-auto max-w-full text-xs text-red-300">
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button onClick={resetErrorBoundary} className="mt-6 px-4 py-2 bg-green-600 text-white rounded">다시 시도</button>
    </div>
  )
}

if ((window as any).electron && (window as any).electron.showMessageBox) {
  (window as any).alert = (msg: any) => {
    (window as any).electron.showMessageBox(String(msg));
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
