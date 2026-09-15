import { ipcMain } from 'electron'
import { chromium } from 'playwright-extra'
import { uploadToBunjang, cancelActiveBunjangUpload } from '../automation/bunjangUploader'
import { deleteFromBunjang } from '../automation/bunjangDeleter'
import { updateBunjangPrice } from '../automation/bunjangPriceUpdater'
import { runAutoUp } from '../automation/bunjangAutoUp'
import { getSpreadsheetDataByProdCode, updateSpreadsheetPID, updateSpreadsheetPrice } from '../googleUploader'
import path from 'path'
import os from 'os'

let isBunjangCancelled = false

export function registerBunjangHandlers() {
  ipcMain.handle('bunjang:cancelUpload', async () => {
    console.log('[Bunjang] 작업 강제 중단 요청 수신')
    isBunjangCancelled = true
    cancelActiveBunjangUpload()
  })

  ipcMain.handle('bunjang:uploadMulti', async (event, payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) => {
    const { prodCodes, spreadsheetUrl, uploadTarget } = payload
    let successCount = 0
    let failCount = 0

    isBunjangCancelled = false
    let browser: any = null
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222')
    } catch (err) {
      console.error('[MultiUpload] 공용 브라우저 연결 실패:', err)
    }

    for (const prodCode of prodCodes) {
      if (isBunjangCancelled) {
        console.log(`[Bunjang Upload] 작업 중단됨. 남은 대기열 취소.`)
        break
      }
      event.sender.send('bunjang:progress', { prodCode, status: 'uploading' })
      
      try {
        const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
        if (!sheetRes.success || !sheetRes.data) {
          throw new Error(sheetRes.error || '데이터 읽기 실패')
        }

        const { data } = sheetRes
        const cats = (data.category || '').split('>').map((c: string) => c.trim()).filter(Boolean)
        const priceStr = String(data.price).replace(/[^0-9]/g, '')
        let price = parseInt(priceStr, 10) || 0
        if (price > 0 && price < 100000) {
          price += 4000
        }

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
        // 메인 이미지 경로 (우선순위: 폴더 내 main 이미지 -> Composites -> 폴더 밖)
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
          if (imagePaths.length >= 12) break
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

        const pid = await uploadToBunjang({
          imagePaths,
          title: `${data.title || ''} (No-${prodCode})`,
          categories: cats,
          price: price,
          description: data.description || '',
          condition: data.condition || '사용감 적음',
          isExchangeable: false,
          size: data.size || '',
          hashtags: data.hashtags
        }, browser)

        if (pid) {
          await updateSpreadsheetPID(spreadsheetUrl, prodCode, 'AD', pid)
        }

        event.sender.send('bunjang:progress', { prodCode, status: 'success' })
        successCount++
        await new Promise(resolve => setTimeout(resolve, 3000))
      } catch (err: any) {
        console.error(`[MultiUpload] ${prodCode} 실패:`, err)
        event.sender.send('bunjang:progress', { prodCode, status: 'failed', error: err.message })
        failCount++
      }
    }

    // if (browser) await browser.close().catch(() => {}) // 브라우저 창이 닫히는 문제 방지
    return { success: true, summary: { success: successCount, failed: failCount } }
  })

  ipcMain.handle('bunjang:deleteMulti', async (event, payload: { prodCodes: string[]; spreadsheetUrl: string; uploadTarget?: string }) => {
    const { prodCodes, spreadsheetUrl, uploadTarget } = payload
    let successCount = 0
    let failCount = 0

    let browser: any = null
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222')
    } catch (err) {
      console.error('[MultiDelete] 공용 브라우저 연결 실패:', err)
    }

    isBunjangCancelled = false

    for (const prodCode of prodCodes) {
      if (isBunjangCancelled) {
        console.log(`[Bunjang Delete] 작업 중단됨. 남은 대기열 취소.`)
        break
      }
      event.sender.send('bunjang:progress', { prodCode, status: 'deleting' })
      
      try {
        const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
        if (!sheetRes.success || !sheetRes.data) throw new Error(sheetRes.error || '데이터 읽기 실패')

        const bunjangPid = sheetRes.data.bunjangPid
        if (!bunjangPid || bunjangPid.trim() === '') throw new Error('번개장터 PID가 존재하지 않습니다.')

        if (bunjangPid.startsWith('d')) {
          event.sender.send('bunjang:progress', { prodCode, status: 'delete_success' })
          successCount++
          continue
        }

        const deletedPid = await deleteFromBunjang(bunjangPid, browser)
        if (deletedPid) {
          await updateSpreadsheetPID(spreadsheetUrl, prodCode, 'AD', 'd' + deletedPid)
        }

        event.sender.send('bunjang:progress', { prodCode, status: 'delete_success' })
        successCount++
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (err: any) {
        console.error(`[MultiDelete] ${prodCode} 실패:`, err)
        event.sender.send('bunjang:progress', { prodCode, status: 'delete_failed', error: err.message })
        failCount++
      }
    }

    // if (browser) await browser.close().catch(() => {}) // 브라우저 창이 닫히는 문제 방지
    return { success: true, summary: { success: successCount, failed: failCount } }
  })

  // === 다중 가격 업데이트 ===
  ipcMain.handle('bunjang:updatePriceMulti', async (event, payload: { prodCodes: string[]; newPrices: Record<string, string>; spreadsheetUrl: string; uploadTarget?: string }) => {
    const { prodCodes, newPrices, spreadsheetUrl } = payload
    let browser: any = null

    try {
      browser = await chromium.connectOverCDP('http://localhost:9222')
    } catch (e: any) {
      console.warn('Browser launch fallback:', e)
    }

    isBunjangCancelled = false
    let successCount = 0
    let failCount = 0

    for (const prodCode of prodCodes) {
      if (isBunjangCancelled) {
        console.log(`[Bunjang UpdatePrice] 작업 중단됨. 남은 대기열 취소.`)
        break
      }
      try {
        event.sender.send('bunjang:progress', { prodCode, status: 'uploading' }) // 수정 중

        const newPrice = newPrices[prodCode]
        if (!newPrice) throw new Error('수정할 가격 데이터가 없습니다.')

        // 시트 데이터 가져오기 (PID 추출용)
        const sheetRes = await getSpreadsheetDataByProdCode(spreadsheetUrl, prodCode)
        if (!sheetRes.success || !sheetRes.data) {
          throw new Error('시트에서 데이터를 읽지 못했습니다.')
        }

        const bunjangPid = sheetRes.data.bunjangPid
        if (!bunjangPid || bunjangPid.trim() === '') {
          throw new Error('번개장터 PID가 존재하지 않습니다. (미등록 상태)')
        }

        // 1. 구글 시트 I열 업데이트 (원본 동기화)
        const sheetUpdateRes = await updateSpreadsheetPrice(spreadsheetUrl, prodCode, newPrice)
        if (!sheetUpdateRes.success) {
          console.warn(`[MultiPriceUpdate] ${prodCode} 구글 시트 I열 업데이트 실패`)
        }

        // 2. 번개장터 자동화 봇 실행
        await updateBunjangPrice(bunjangPid, newPrice, browser!)

        event.sender.send('bunjang:progress', { prodCode, status: 'success' })
        successCount++
      } catch (err: any) {
        console.error(`[MultiPriceUpdate] ${prodCode} 실패:`, err)
        event.sender.send('bunjang:progress', { prodCode, status: 'failed', error: err.message })
        failCount++
      }
    }

    // if (browser) await browser.close().catch(() => {})
    return { success: true, summary: { success: successCount, failed: failCount } }
  })

  // === 자동 UP 실행 ===
  ipcMain.handle('bunjang:autoUp', async (event) => {
    let browser: any = null

    try {
      browser = await chromium.connectOverCDP('http://localhost:9222')
    } catch (e: any) {
      console.warn('Browser launch fallback:', e)
      return { success: false, error: '열려있는 로봇 전용 크롬 창을 찾을 수 없습니다.' }
    }

    try {
      const result = await runAutoUp(browser)
      return { success: true, summary: result }
    } catch (error: any) {
      console.error('[AutoUp Error]', error)
      return { success: false, error: error.message }
    }
  })
}
