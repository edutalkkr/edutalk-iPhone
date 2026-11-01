# 브리즈 서버 자동 시작 등록 + 방화벽 허용 (관리자 권한 필요)
# 실행은 install-server.bat 으로 해 주세요.
$ErrorActionPreference = 'Stop'
$TaskName = 'BreezeServer'
$Port = 3000
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe = Join-Path $Root 'breeze-server.exe'

function Fail($msg) {
  Write-Host ''
  Write-Host "  ✕ $msg" -ForegroundColor Red
  Write-Host ''
  Read-Host '  Enter 키를 누르면 닫혀요'
  exit 1
}

Write-Host ''
Write-Host '  브리즈 서버 설치를 시작할게요.' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $Exe)) { Fail 'breeze-server.exe 파일을 찾지 못했어요. 압축을 풀어 같은 폴더에 두고 실행해 주세요.' }

# 이미 실행 중인 브리즈 서버가 있으면 잠시 멈춘다
Get-Process 'breeze-server' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600

# 3000 포트를 다른 프로그램이 쓰고 있으면 안내하고 멈춘다
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Fail "포트 $Port 를 다른 프로그램이 쓰고 있어요. 그 프로그램을 끄거나 서버 포트를 바꾼 뒤 다시 실행해 주세요." }

# 기존 예약 작업 정리
schtasks /query /tn $TaskName *> $null
if ($LASTEXITCODE -eq 0) { schtasks /delete /tn $TaskName /f *> $null }

# 부팅 시 SYSTEM 계정으로 자동 실행 (로그인 없이, 검은 창 없이)
$action = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
try { $settings.RestartCount = 999; $settings.RestartInterval = (New-TimeSpan -Minutes 1) } catch {}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '브리즈 학교 내부망 메신저 서버 (부팅 시 자동 실행)' -Force | Out-Null
Write-Host '  ✓ 부팅 시 자동 시작 등록 완료' -ForegroundColor Green

# 방화벽 인바운드 허용 (프로그램 + TCP 포트)
Get-NetFirewallRule -DisplayName 'Breeze Server*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Breeze Server (프로그램)' -Direction Inbound -Action Allow -Program $Exe -Profile Any -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "Breeze Server (TCP $Port)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any -ErrorAction SilentlyContinue | Out-Null
Write-Host "  ✓ 방화벽 인바운드 허용 완료 (TCP $Port)" -ForegroundColor Green

# 지금 바로 시작
Start-ScheduledTask -TaskName $TaskName
Write-Host '  … 서버를 켜는 중이에요.'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
}
if ($ok) {
  Write-Host '  ✓ 서버가 켜졌어요' -ForegroundColor Green
} else {
  Write-Host '  ! 서버가 아직 포트를 열지 못했어요. 잠시 뒤 check-server.bat 으로 상태를 확인해 주세요.' -ForegroundColor Yellow
}

# 교내 접속 주소 안내
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host '  ────────────────────────────────────────'
Write-Host '  학교에서 접속하는 주소' -ForegroundColor Cyan
foreach ($ip in $ips) {
  Write-Host "    교사 앱 서버 주소 : http://$ip`:$Port" -ForegroundColor White
  Write-Host "    학생 웹 주소      : http://$ip`:$Port/student/" -ForegroundColor White
}
Write-Host "    이 PC 관리 페이지 : http://localhost:$Port/admin" -ForegroundColor White
Write-Host '  ────────────────────────────────────────'
Write-Host ''
Write-Host '  다음: 열린 관리 페이지에서 1·2단계 초기 설정을 마쳐 주세요.' -ForegroundColor Yellow
Write-Host ''
Start-Process "http://localhost:$Port/admin"
Read-Host '  Enter 키를 누르면 닫혀요'
