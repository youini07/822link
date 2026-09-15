const fs = require('fs');
let js = fs.readFileSync('dist/assets/index-i6EDVfGe.js', 'utf8');
js = js.replace('const E=PROD-\;', 'let reNum=String(x.index).padStart(3,"0");try{if(m&&window.electronAPI.google?.getNextProdCode){const nC=await window.electronAPI.google.getNextProdCode(d);if(nC)reNum=nC}}catch(e){}const E=PROD-\;');
js = js.replace('uploadProduct({aiTitle:M.title,', 'uploadProduct({predefinedProdCode:reNum,aiTitle:M.title,');
fs.writeFileSync('dist/assets/index-i6EDVfGe.js', js);
