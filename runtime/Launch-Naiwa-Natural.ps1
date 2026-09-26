$ErrorActionPreference = 'Stop'
$application = Join-Path $PSScriptRoot 'app\ChatGPT.exe'
try {
  if (-not (Test-Path -LiteralPath $application)) { throw '找不到运行文件，请重新执行 Install-Naiwa-Natural.ps1。' }
  $running = Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ne $application }
  if ($running) { throw '请先完全退出当前 Codex，再打开此快捷方式，新的自然动作会在启动后生效。' }
  Start-Process -FilePath $application -WorkingDirectory (Split-Path -Parent $application)
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '可爱奶蛙 · 自然动作') | Out-Null
}
