import { ipcMain } from 'electron'
import { runFruitsUploader, runFruitsDeleter, cancelActiveFruitsProcess } from '../mobileRunner'
import { getSpreadsheetDataByProdCode, updateSpreadsheetPID } from '../googleUploader'

let isFruitsCancelled = false

export function registerFruitsHandlers() {
  ipcMain.handle('fruits:cancelUpload', async () => {
    console.log('[Fruits] 작업 강제 중단 요청 수신')
    isFruitsCancelled = true
    cancelActiveFruitsProcess()
  })

  ipcMain.handle('fruits:uploadMulti', async (event, payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) => {
    const { prodCodes, spreadsheetUrl, uploadTarget } = payload
    isFruitsCancelled = false
    let successCount = 0
    let failCount = 0

    for (const prodCode of prodCodes) {
      if (isFruitsCancelled) {
        console.log(`[Fruits Upload] 작업 중단됨. 남은 대기열 취소.`)
        break
      }
      event.sender.send('bunjang:progress', { prodCode, status: 'uploading' })
      
      try {
        const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
        if (!sheetRes.success || !sheetRes.data) {
          throw new Error(sheetRes.error || '데이터 읽기 실패')
        }

        const { data } = sheetRes
        const priceStr = String(data.price).replace(/[^0-9]/g, '')
        let price = parseInt(priceStr, 10) || 0
        if (price > 0 && price < 100000) {
          price += 4000
        }

        // 이미지 경로 수집
        const fs = require('fs')
        const path = require('path')
        const staticBaseDir = uploadTarget === 'dreamstudio'
          ? 'c:\\Users\\youin\\OneDrive\\바탕 화면\\dreamstudiovtg\\static'
          : 'c:\\Users\\youin\\OneDrive\\바탕 화면\\catalog_app\\static'
        const outputDir = path.join(staticBaseDir, 'images', prodCode)
        if (!fs.existsSync(outputDir)) {
          throw new Error(`이미지 폴더를 찾을 수 없습니다: ${outputDir}`)
        }

        const imagePaths: string[] = []
        // 메인 이미지 경로
        const possibleMains = [
          path.join(outputDir, `main${prodCode}.jpg`),
          path.join(outputDir, `main${prodCode}.png`),
          path.join(outputDir, `main.jpg`),
          path.join(outputDir, `main.png`),
          path.join(staticBaseDir, 'images', 'Composites', `${prodCode}.jpg`),
          path.join(staticBaseDir, 'images', `${prodCode}.jpg`),
          path.join(staticBaseDir, 'images', `${prodCode}.png`)
        ]
        for (const p of possibleMains) {
          if (fs.existsSync(p)) {
            imagePaths.push(p)
            break
          }
        }

        const allFiles = fs.readdirSync(outputDir)
        allFiles.sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        
        for (const f of allFiles) {
          if (imagePaths.length >= 7) break // FruitsFamily는 7장(main 1 + sub 6)으로 제한
          const lowerF = f.toLowerCase()
          if (!lowerF.endsWith('.jpg') && !lowerF.endsWith('.jpeg') && !lowerF.endsWith('.png')) continue
          if (lowerF.startsWith('c' + prodCode.toLowerCase()) || lowerF.startsWith('main')) continue
          
          const fullPath = path.join(outputDir, f)
          if (!imagePaths.includes(fullPath)) {
            imagePaths.push(fullPath)
          }
        }

        if (imagePaths.length === 0) {
          throw new Error('업로드할 이미지 파일을 찾을 수 없습니다.')
        }

        // 파이썬 로봇에 넘길 데이터 구성
        const productData = {
          prodCode,
          title: `${data.title || ''} (No-${prodCode})`,
          price: price,
          description: data.description || '',
          category: data.category || '',
          gender: data.gender || '',
          size: data.size || '',
          condition: data.condition || '',
          imagePaths // 수집된 이미지 경로 전달
        }

        const res = await runFruitsUploader(productData)
        if (res.success && res.pid) {
          // 업로드 성공 시 스프레드시트에 PID 기록 (AF열)
          await updateSpreadsheetPID(spreadsheetUrl, prodCode, 'AF', res.pid)
          
          event.sender.send('bunjang:progress', { prodCode, status: 'success' })
          successCount++
        } else {
          throw new Error(res.error || '알 수 없는 파이썬 에러')
        }
      } catch (err: any) {
        console.error(`[Fruits Upload] ${prodCode} 실패:`, err)
        event.sender.send('bunjang:progress', { prodCode, status: 'failed', error: err.message })
        failCount++
      }
    }

    return { success: true, summary: { success: successCount, failed: failCount } }
  })

  ipcMain.handle('fruits:deleteMulti', async (event, payload: { prodCodes: string[]; spreadsheetUrl: string }) => {
    const { prodCodes, spreadsheetUrl } = payload
    console.log(`[Fruits Delete] 요청 수신: ${prodCodes.length}개 상품, 시트: ${spreadsheetUrl}`)
    
    isFruitsCancelled = false
    let successCount = 0
    let failCount = 0

    for (const prodCode of prodCodes) {
      if (isFruitsCancelled) {
        console.log(`[Fruits Delete] 작업 중단됨. 남은 대기열 취소.`)
        break
      }
      console.log(`[Fruits Delete] 처리 시작: ${prodCode}`)
      event.sender.send('bunjang:progress', { prodCode, status: 'deleting' })
      
      try {
        console.log(`[Fruits Delete] 시트 데이터 가져오는 중...`)
        const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
        console.log(`[Fruits Delete] 시트 응답:`, sheetRes)
        if (!sheetRes.success || !sheetRes.data) throw new Error(sheetRes.error || '데이터 읽기 실패')

        const fruitsPid = sheetRes.data.fruitsPid
        console.log(`[Fruits Delete] 추출된 fruitsPid: ${fruitsPid}`)
        if (!fruitsPid || fruitsPid.trim() === '') throw new Error('후르츠패밀리 PID가 존재하지 않습니다.')

        if (fruitsPid.startsWith('d')) {
          console.log(`[Fruits Delete] 이미 삭제된(d_ 접두어) 항목입니다. 건너뜀.`)
          event.sender.send('bunjang:progress', { prodCode, status: 'delete_success' })
          successCount++
          continue
        }

        console.log(`[Fruits Delete] 파이썬 로봇(deleter) 실행: ${fruitsPid}`)
        const res = await runFruitsDeleter(fruitsPid)
        console.log(`[Fruits Delete] 파이썬 로봇 응답:`, res)
        
        if (res.success && res.pid) {
          console.log(`[Fruits Delete] 삭제 성공, 시트 업데이트 중...`)
          await updateSpreadsheetPID(spreadsheetUrl, prodCode, 'AF', 'd_' + res.pid.replace('f_', ''))
          console.log(`[Fruits Delete] 시트 업데이트 완료`)
          event.sender.send('bunjang:progress', { prodCode, status: 'delete_success' })
          successCount++
        } else {
          throw new Error(res.error || '알 수 없는 파이썬 에러')
        }
      } catch (err: any) {
        console.error(`[Fruits Delete] ${prodCode} 실패:`, err)
        event.sender.send('bunjang:progress', { prodCode, status: 'delete_failed', error: err.message })
        failCount++
      }
    }

    console.log(`[Fruits Delete] 전체 처리 완료. 성공: ${successCount}, 실패: ${failCount}`)
    return { success: true, summary: { success: successCount, failed: failCount } }
  })
}
