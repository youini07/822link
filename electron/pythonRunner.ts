import { spawn } from 'child_process'
import path from 'path'
import { app } from 'electron'

export async function runPythonProcessor(
  imagePaths: string[],
  outputDir: string,
  brand: string,
  title: string,
  prodCode: string,
  copyright?: string,
  skipNukki?: boolean
): Promise<{ success: boolean; nukkiPath?: string; synthesisPath?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      // 루트 폴더 기준 python/processor.py 경로 추정 (빌드된 dist-electron 기준 상위)
      const pythonScript = app.isPackaged
        ? path.join(process.resourcesPath, 'python', 'processor.py')
        : path.join(app.getAppPath(), 'python', 'processor.py')

      console.log(`[Python Runner] 스크립트 실행: ${pythonScript}`)
      console.log(`[Python Runner] 출력 폴더: ${outputDir}`)
      console.log(`[Python Runner] 대상 이미지: ${imagePaths.length}장`)

      const args = [
        pythonScript,
        outputDir,
        brand || 'Unknown',
        title || 'Vintage Item',
        prodCode || '0',
        copyright || '© 822 Vintage. All rights reserved.',
        skipNukki ? 'true' : 'false',
        ...imagePaths
      ]

      // 파이썬 실행
      const pythonExecutable = process.platform === 'win32' ? 'py' : 'python'
      const pyProcess = spawn(pythonExecutable, args)

      let outputData = ''
      let errorData = ''

      pyProcess.stdout.on('data', (data) => {
        outputData += data.toString()
      })

      pyProcess.stderr.on('data', (data) => {
        errorData += data.toString()
        console.error(`[Python stderr] ${data.toString()}`)
      })

      pyProcess.on('close', (code) => {
        console.log(`[Python Runner] 종료 코드: ${code}`)
        
        try {
          // 파이썬 스크립트가 뱉어낸 마지막 JSON 파싱
          // stdout에 불필요한 로그가 섞일 수 있으므로 중괄호로 시작하는 마지막 문자열을 찾음
          const lines = outputData.trim().split('\n')
          const jsonLine = lines.find(line => line.trim().startsWith('{'))
          
          if (jsonLine) {
            const result = JSON.parse(jsonLine)
            resolve(result)
          } else {
            resolve({ success: false, error: 'JSON 응답을 찾을 수 없습니다. (Python 출력: ' + outputData + ')' })
          }
        } catch (e: any) {
          resolve({ success: false, error: 'JSON 파싱 에러: ' + e.message })
        }
      })

      pyProcess.on('error', (err) => {
        resolve({ success: false, error: '프로세스 실행 실패: ' + err.message })
      })

    } catch (err: any) {
      resolve({ success: false, error: '실행 준비 중 에러: ' + err.message })
    }
  })
}
