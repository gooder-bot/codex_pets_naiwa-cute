[CmdletBinding()]
param([string]$NodePath, [switch]$NoShortcut)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw '请先安装 Windows 版 Codex。' }
if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }
$sourceApp = Join-Path $package.InstallLocation 'app'
$installRoot = Join-Path $env:LOCALAPPDATA "CodexPetLab\$($package.Version)-natural"
$destinationApp = Join-Path $installRoot 'app'
$sourceAsar = Join-Path $sourceApp 'resources\app.asar'
$preparedAsar = Join-Path $installRoot 'natural.asar'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

# Build first: an incompatible client leaves the existing installation usable.
$patchReport = & $NodePath (Join-Path $PSScriptRoot 'integrate_current_runtime.cjs') --source $sourceAsar --output $preparedAsar
if ($LASTEXITCODE -ne 0) { throw '当前客户端的宠物模块与此版本不匹配；请查看上面的具体错误。' }

& robocopy $sourceApp $destinationApp /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw '复制 Codex 运行文件失败。' }
$destinationAsar = Join-Path $destinationApp 'resources\app.asar'
Move-Item -LiteralPath $preparedAsar -Destination $destinationAsar -Force

$petHome = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'pets\xiaohuangtuan' } else { Join-Path $env:USERPROFILE '.codex\pets\xiaohuangtuan' }
New-Item -ItemType Directory -Force -Path $petHome | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'pet.json'), (Join-Path $repoRoot 'spritesheet.webp') -Destination $petHome -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-Naiwa-Natural.ps1') -Destination $installRoot -Force
[IO.File]::WriteAllText((Join-Path $installRoot 'patch-report.json'), ($patchReport -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

if (-not $NoShortcut) {
  $desktopPath = [Environment]::GetFolderPath('Desktop')
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktopPath 'Codex - 可爱奶蛙（自然动作）.lnk'))
  $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'Launch-Naiwa-Natural.ps1') + '"'
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.IconLocation = (Join-Path $destinationApp 'ChatGPT.exe') + ',0'
  $shortcut.Description = 'Naiwa：安静陪伴、单次回应和柔软收尾'
  $shortcut.Save()
}

Write-Host "已安装 Naiwa 自然动作版：$installRoot"
Write-Host '退出当前 Codex 后，从桌面的「Codex - 可爱奶蛙（自然动作）」启动，并选择「可爱奶蛙」。'
Write-Host '普通 Codex 入口仍使用客户端原有动作；本安装不会自动重启正在进行的任务。'
