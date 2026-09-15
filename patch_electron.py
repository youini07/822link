import os
import re

preload_822_path = r'c:\Users\youin\OneDrive\바탕 화면\822링크\electron\preload_822.ts'
preload_cts_path = r'c:\Users\youin\OneDrive\바탕 화면\822링크\electron\preload.cts'
main_822_path = r'c:\Users\youin\OneDrive\바탕 화면\822링크\electron_822link_backup\main.ts'
main_ts_path = r'c:\Users\youin\OneDrive\바탕 화면\822링크\electron\main.ts'

# 1. Merge preload
with open(preload_822_path, 'r', encoding='utf-8') as f:
    preload_822_content = f.read()

# Extract electronAPI block
match = re.search(r'contextBridge\.exposeInMainWorld\(\'electronAPI\', (\{.*?\})\)', preload_822_content, re.DOTALL)
if match:
    electron_api_block = match.group(1)
    with open(preload_cts_path, 'a', encoding='utf-8') as f:
        f.write('\n\n// --- 822link API ---\n')
        f.write('contextBridge.exposeInMainWorld(\'electronAPI\', ')
        f.write(electron_api_block)
        f.write(');\n')

# 2. Merge main.ts IPC handlers
with open(main_822_path, 'r', encoding='utf-8') as f:
    main_822_content = f.read()

# Copy imports (only the ones not in main.ts)
imports_to_add = []
for line in main_822_content.splitlines():
    if line.startswith('import ') and 'electron' not in line and 'path' not in line and 'fs' not in line:
        imports_to_add.append(line)

# Extract handlers block (everything after the first ipcMain.handle)
handlers_start = main_822_content.find('ipcMain.handle(')
if handlers_start != -1:
    handlers_block = main_822_content[handlers_start:]
    with open(main_ts_path, 'a', encoding='utf-8') as f:
        f.write('\n\n// --- 822link Handlers ---\n')
        # We need to make sure we don't redefine imports, so we just write the block
        # Wait, the imports might be needed for the handlers to work!
        # Let's write the imports first.
        f.write('\n'.join(imports_to_add) + '\n\n')
        f.write(handlers_block)

print("Patching complete.")
