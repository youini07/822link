const fs = require('fs');
let js = fs.readFileSync('dist/assets/index-i6EDVfGe.js', 'utf8');
js = js.replace('brand:M.brand,title:M.category,prodCode:E.replace("PROD-","")', 'brand:M.brand,title:M.nameEN||M.title,prodCode:E.replace("PROD-","")');
fs.writeFileSync('dist/assets/index-i6EDVfGe.js', js);
