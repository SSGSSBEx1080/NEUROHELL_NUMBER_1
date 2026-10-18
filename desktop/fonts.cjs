'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
let pending;
/** Fixed, argument-free query. No renderer-supplied command, filesystem path or font bytes cross IPC. */
function listSystemFonts() {
  if (process.platform !== 'win32') return Promise.reject(new Error('Автоматический перечень в настольной версии доступен только на Windows. Загрузи TTF/OTF вручную.'));
  if (!pending) pending = new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; @($fonts.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) | ConvertTo-Json -Compress; $fonts.Dispose()"], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, output) => {
      if (error) { pending = undefined; reject(new Error('Windows не предоставила перечень шрифтов. Можно загрузить TTF/OTF вручную.')); return; }
      try { const value = JSON.parse(output.replace(/^\uFEFF/, '').trim()); resolve((Array.isArray(value) ? value : [value]).filter(n => typeof n === 'string' && n.length > 0 && n.length <= 160).slice(0, 10000)); } catch { pending = undefined; reject(new Error('Не удалось прочитать перечень шрифтов Windows')); }
    });
  });
  return pending;
}
function trustedFontRequest(event, window) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { const u = new URL(event.senderFrame.url); return u.protocol === 'fsh777:' && u.host === 'studio' && !u.username && !u.password; } catch { return false; }
}
module.exports = { listSystemFonts, trustedFontRequest };
