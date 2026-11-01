# 브리즈 서버 상태 확인 (관리자 권한 불필요)
$TaskName = 'BreezeServer'
$Port = 3000

Write-Host ''
Write-Host '  브리즈 서버 상태를 확인할게요.' -ForegroundColor Cyan
Write-Host ''

$task = schtasks /query /tn $TaskName /fo LIST *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host '  자동 시작 : 등록됨 (부팅 시 자동 실행)' -ForegroundColor Green
} else {
  Write-Host '  자동 시작 : 등록 안 됨 (install-server.bat 을 관리자 권한으로 실행해 주세요)' -ForegroundColor Yellow
}

$proc = Get-Process 'breeze-server' -ErrorAction SilentlyContinue
if ($proc) {
  Write-Host "  실행 상태 : 켜짐 (PID $($proc.Id -join ', '))" -ForegroundColor Green
} else {
  Write-Host '  실행 상태 : 꺼짐 (restart-server.bat 으로 다시 켤 수 있어요)' -ForegroundColor Yellow
}

$listen = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listen) {
  Write-Host "  포트 $Port : 열림" -ForegroundColor Green
} else {
  Write-Host "  포트 $Port : 닫힘" -ForegroundColor Yellow
}

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host '  ────────────────────────────────────────'
foreach ($ip in $ips) {
  Write-Host "    교사 앱 서버 주소 : http://$ip`:$Port" -ForegroundColor White
  Write-Host "    학생 웹 주소      : http://$ip`:$Port/student/" -ForegroundColor White
}
Write-Host "    관리 페이지       : http://localhost:$Port/admin" -ForegroundColor White
Write-Host '  ────────────────────────────────────────'
Write-Host ''
Start-Process "http://localhost:$Port/admin"
Read-Host '  Enter 키를 누르면 닫혀요'
