param([string]$PythonExe = 'python')
$ErrorActionPreference = 'Stop'
$agentRoot = $PSScriptRoot
$agentExe = Join-Path $agentRoot 'dist-next\SouodElShafiePrintAgent.exe'
$hashDir = Join-Path $agentRoot 'build\updater-input'
$specDir = Join-Path $agentRoot 'build\updater-spec'
$workDir = Join-Path $agentRoot 'build\updater-package'
$distDir = Join-Path $agentRoot 'dist-updater'
if (-not (Test-Path -LiteralPath $agentExe -PathType Leaf)) { throw 'Build the print agent in dist-next before building the updater.' }
New-Item -ItemType Directory -Force -Path $hashDir, $specDir, $distDir | Out-Null
$hashFile = Join-Path $hashDir 'sha256.txt'
(Get-FileHash -LiteralPath $agentExe -Algorithm SHA256).Hash.ToLowerInvariant() | Set-Content -Encoding ascii -LiteralPath $hashFile
& $PythonExe -m PyInstaller --noconfirm --onefile --windowed --name SouodElShafiePrintAgentUpdate `
  --icon (Join-Path $agentRoot 'print_agent\assets\icon.ico') `
  --add-data "${agentExe};payload" --add-data "${hashFile};payload" `
  --distpath $distDir --workpath $workDir --specpath $specDir (Join-Path $agentRoot 'updater\main.py')
if ($LASTEXITCODE -ne 0) { throw "Updater build failed with exit code $LASTEXITCODE" }
Write-Host "Updater built: $(Join-Path $distDir 'SouodElShafiePrintAgentUpdate.exe')"
