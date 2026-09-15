import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as path from 'path'

let activeProcess: ChildProcessWithoutNullStreams | null = null

export function cancelActiveFruitsProcess() {
  if (activeProcess) {
    console.log('[mobileRunner] 파이썬 프로세스 강제 종료 시도...')
    try {
      // Windows의 경우 taskkill을 사용하는 것이 더 확실할 수 있지만 기본 kill()부터 시도
      activeProcess.kill()
    } catch (e) {
      console.error('프로세스 종료 중 에러:', e)
    }
    activeProcess = null
  }
}

export async function runFruitsUploader(productData: any): Promise<{ success: boolean; pid?: string; error?: string }> {
  return new Promise((resolve) => {
    // pythonRunner.ts와 유사하게 시스템 파이썬 또는 가상환경 파이썬 사용
    const pythonExecutable = process.platform === 'win32' ? 'py' : 'python' // 환경에 맞게 조정 필요시 수정
    const scriptPath = path.join(__dirname, '..', 'python', 'fruits_uploader.py')

    const process = spawn(pythonExecutable, [scriptPath])
    activeProcess = process

    let outputData = ''

    process.stdout.on('data', (data) => {
      const text = data.toString()
      console.log(text)
      outputData += text
    })

    process.stderr.on('data', (data) => {
      console.error(`[Python U2 Error] ${data}`)
    })

    process.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, error: `Python 프로세스가 코드 ${code}로 종료되었습니다.` })
      }

      // RESULT_JSON: 찾기
      const match = outputData.match(/RESULT_JSON:(.*)/)
      if (match && match[1]) {
        try {
          const result = JSON.parse(match[1])
          resolve(result)
        } catch (e) {
          resolve({ success: false, error: 'Python 결과 파싱 실패' })
        }
      } else {
        resolve({ success: false, error: 'Python 스크립트에서 RESULT_JSON을 찾을 수 없습니다.' })
      }
    })

    // 프로세스 JSON 문자열 넘겨주기 (stdin)
    process.stdin.write(JSON.stringify(productData))
    process.stdin.end()
  })
}

export async function runFruitsDeleter(pid: string): Promise<{ success: boolean; pid?: string; error?: string }> {
  return new Promise((resolve) => {
    const pythonExecutable = process.platform === 'win32' ? 'py' : 'python'
    const scriptPath = path.join(__dirname, '..', 'python', 'fruits_deleter.py')

    const process = spawn(pythonExecutable, [scriptPath, pid])
    activeProcess = process

    let outputData = ''

    process.stdout.on('data', (data) => {
      const text = data.toString()
      console.log(text)
      outputData += text
    })

    process.stderr.on('data', (data) => {
      console.error(`[Python Deleter Error] ${data}`)
    })

    process.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, error: `Python 프로세스가 코드 ${code}로 종료되었습니다.` })
      }

      // 결과 추출
      const match = outputData.match(/###RESULT_START###\s*(\{.*\})\s*###RESULT_END###/)
      if (match && match[1]) {
        try {
          const result = JSON.parse(match[1])
          resolve(result)
        } catch (e) {
          resolve({ success: false, error: 'Python 결과 파싱 실패' })
        }
      } else {
        resolve({ success: false, error: 'Python 스크립트에서 결과를 찾을 수 없습니다.' })
      }
    })
  })
}
