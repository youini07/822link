const fs = require('fs');
let mainJs = fs.readFileSync('dist-electron/main.js', 'utf8');
if (!mainJs.includes('google:get-next-prod-code')) {
  mainJs = mainJs.replace('electron.ipcMain.handle("google:fetchSpreadsheetList", async (_event, spreadsheetUrl) => {', 'electron.ipcMain.handle("google:get-next-prod-code", async (_event, spreadsheetUrl) => { return await getNextProdCode(spreadsheetUrl); });\nelectron.ipcMain.handle("google:fetchSpreadsheetList", async (_event, spreadsheetUrl) => {');
  fs.writeFileSync('dist-electron/main.js', mainJs);
}

let preloadJs = fs.readFileSync('dist-electron/preload.js', 'utf8');
if (!preloadJs.includes('google:get-next-prod-code')) {
  preloadJs = preloadJs.replace('fetchSpreadsheetList: (spreadsheetUrl) => electron.ipcRenderer.invoke("google:fetchSpreadsheetList", spreadsheetUrl),', 'fetchSpreadsheetList: (spreadsheetUrl) => electron.ipcRenderer.invoke("google:fetchSpreadsheetList", spreadsheetUrl),\n    getNextProdCode: (spreadsheetUrl) => electron.ipcRenderer.invoke("google:get-next-prod-code", spreadsheetUrl),');
  preloadJs = preloadJs.replace('uploadProduct: (payload) => electron.ipcRenderer.invoke("google:upload-product", payload),', 'uploadProduct: (payload) => electron.ipcRenderer.invoke("google:upload-product", payload),');
  fs.writeFileSync('dist-electron/preload.js', preloadJs);
}
