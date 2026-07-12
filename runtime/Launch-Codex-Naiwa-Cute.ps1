$ErrorActionPreference = "Stop"

$portableRoot = Join-Path $env:LOCALAPPDATA "CodexPetLab\26.707.3748.0\app"
$appPath = Join-Path $portableRoot "ChatGPT.exe"
$asarPath = Join-Path $portableRoot "resources\app.asar"
$expectedAsarSha256 = "D0868BF4C3F72C0AC3A4F380826CB1EC566548A8E037C7D9C0486B3E78AC6908"

function Show-LauncherMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Message,

        [string] $Title = "Codex 可爱奶蛙"
    )

    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

try {
    if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
        throw "找不到可爱奶蛙运行副本：$appPath"
    }

    if (-not (Test-Path -LiteralPath $asarPath -PathType Leaf)) {
        throw "找不到动画补丁：$asarPath"
    }

    $actualAsarSha256 = (Get-FileHash -LiteralPath $asarPath -Algorithm SHA256).Hash
    if ($actualAsarSha256 -ne $expectedAsarSha256) {
        throw "动画补丁校验失败。为避免启动不完整版本，本次已停止。"
    }

    $portablePrefix = [System.IO.Path]::GetFullPath($portableRoot).TrimEnd("\") + "\"
    $conflictingProcesses = Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            -not $_.ExecutablePath.StartsWith(
                $portablePrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )
        }

    if ($conflictingProcesses) {
        Show-LauncherMessage -Message "请先完全退出当前官方 Codex，再双击此快捷方式。这样可以避免两个实例争用同一份配置与桌面宠物。"
        exit 2
    }

    Start-Process -FilePath $appPath -WorkingDirectory $portableRoot
}
catch {
    Show-LauncherMessage -Message $_.Exception.Message -Title "Codex 可爱奶蛙 - 启动失败"
    exit 1
}
