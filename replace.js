const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\youin\\OneDrive\\바탕 화면\\822링크\\electron\\telegramBot.ts', 'utf8');

const startIndex = content.indexOf('    // 5. 로컬 원본 이미지 파일들');
const endStr = '          let topHalfImg = img\n          if (fullSize.width === 1080 && fullSize.height === 1920) {\n             topHalfImg = img.crop({ x: 0, y: 0, width: 1080, height: 960 })\n          }';
const endIndex = content.indexOf(endStr) + endStr.length;

if (startIndex !== -1 && endIndex !== -1) {
  const replacement = `    // 5. 로컬 원본 이미지 파일들 설정된 폴더로 최종 아카이빙(정리이동)
    const finalProdCode = uploadRes.prodCode || prodCodeSeed
    
    const baseSavePath = settings.localSavePath || path.join(app.getPath('desktop'), '822_images')
    const baseThumbPath = settings.localThumbnailSavePath || path.join(app.getPath('desktop'), '822_thumbnails')
    
    const outputDir = path.join(baseSavePath, finalProdCode)
    const thumbnailDir = baseThumbPath

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
      if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true })
      }

      let thumbSourcePath = ''
      sessionData.files.forEach((filePath, index) => {
        if (fs.existsSync(filePath)) {
          const originalName = path.basename(filePath)
          const fileExt = path.extname(filePath) || '.jpg'
          const destName = \`\${index + 1}\${fileExt}\`
          const destPath = path.join(outputDir, destName)
          try {
            fs.copyFileSync(filePath, destPath)
            fs.unlinkSync(filePath)
            if (index === 0) thumbSourcePath = destPath
          } catch (copyErr) {
            console.error(\`[Archive Error] 원본 복사 실패 (\${originalName}):\`, copyErr)
          }
        }
      })

      // 메인 이미지 지정 (합성 기능을 사용하지 않으므로 1번 이미지를 썸네일 소스로 사용)
      let mainImagePath = thumbSourcePath

      // 누끼 이미지 복사
      if (nukkiPath && fs.existsSync(nukkiPath)) {
        const destNukki = path.join(outputDir, \`main\${finalProdCode}\${path.extname(nukkiPath)}\`)
        try {
          fs.copyFileSync(nukkiPath, destNukki)
          fs.unlinkSync(nukkiPath)
        } catch (copyErr) {
          console.error('[Archive Error] 누끼 복사 실패:', copyErr)
        }
      }

      // Electron nativeImage를 사용한 800x674 썸네일 생성 및 저장
      if (mainImagePath && fs.existsSync(mainImagePath)) {
        try {
          const img = nativeImage.createFromPath(mainImagePath)
          const fullSize = img.getSize()
          
          let topHalfImg = img
          if (fullSize.width === 1080 && fullSize.height === 1920) {
             topHalfImg = img.crop({ x: 0, y: 0, width: 1080, height: 960 })
          }`;

  const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
  fs.writeFileSync('C:\\Users\\youin\\OneDrive\\바탕 화면\\822링크\\electron\\telegramBot.ts', newContent, 'utf8');
  console.log('Success');
} else {
  console.log('Failed to find indices');
}
