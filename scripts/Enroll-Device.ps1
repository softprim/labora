#Requires -RunAsAdministrator
<#
  Înrolează acest calculator în laborator.

  Fără -ServerUrl caută automat serverul profesorului în rețeaua locală, deci în ziua de
  configurare nu se tastează adrese pe fiecare calculator. Certificatul serverului este
  instalat ca de încredere, altfel aplicația refuză conexiunea.
#>
param(
  [string]$ServerUrl,
  [Parameter(Mandatory=$true)][string]$EnrollmentToken,
  [int]$DiscoveryTimeoutSeconds = 5
)
$ErrorActionPreference = 'Stop'

function Find-LaboraServer([int]$TimeoutSeconds) {
  $client = New-Object System.Net.Sockets.UdpClient
  try {
    $client.EnableBroadcast = $true
    $client.Client.ReceiveTimeout = $TimeoutSeconds * 1000
    $query = [Text.Encoding]::UTF8.GetBytes('{"magic":"labora-discovery-1","type":"query"}')
    [void]$client.Send($query, $query.Length, (New-Object Net.IPEndPoint([Net.IPAddress]::Broadcast, 4311)))
    $remote = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
    $data = $client.Receive([ref]$remote)
    $message = [Text.Encoding]::UTF8.GetString($data) | ConvertFrom-Json
    if ($message.magic -ne 'labora-discovery-1' -or $message.type -ne 'server') { return $null }
    return $message
  } catch { return $null } finally { $client.Close() }
}

if (-not $ServerUrl) {
  Write-Host 'Caut serverul laboratorului în rețea...'
  $found = Find-LaboraServer -TimeoutSeconds $DiscoveryTimeoutSeconds
  if (-not $found) { throw 'Nu am găsit niciun server Labora în rețea. Porniți aplicația pe calculatorul profesorului sau indicați -ServerUrl.' }
  $ServerUrl = $found.url
  Write-Host ('Găsit: ' + $ServerUrl + ' (' + $found.name + ')')
}

$serverUri = [Uri]$ServerUrl
if ($serverUri.Scheme -ne 'https' -and -not ($serverUri.Scheme -eq 'http' -and $serverUri.IsLoopback)) { throw 'HTTPS este obligatoriu în rețeaua școlii.' }
if ($serverUri.UserInfo -or $serverUri.Query -or $serverUri.Fragment -or $serverUri.AbsolutePath -ne '/') { throw 'Adresa serverului nu poate conține cale, credențiale sau parametri.' }

$folder = Join-Path $env:ProgramData 'Labora'
$target = Join-Path $folder 'device.json'
if (Test-Path $target) { throw 'Calculator deja înrolat. Revocați înrolarea din administrare și eliminați configurația ca administrator înainte de reînrolare.' }
New-Item -Path $folder -ItemType Directory -Force | Out-Null
# Stable SIDs work on Romanian and English Windows. Students get read/execute only.
& icacls.exe $folder /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nu s-au putut proteja setările.' }

# Certificatul serverului este auto-semnat: îl instalăm ca de încredere pe acest calculator,
# altfel aplicația refuză conexiunea. Amprenta este afișată pentru verificare de către IT.
if ($serverUri.Scheme -eq 'https' -and -not $serverUri.IsLoopback) {
  $tcp = New-Object Net.Sockets.TcpClient($serverUri.Host, $serverUri.Port)
  try {
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, { $true })
    $ssl.AuthenticateAsClient($serverUri.Host)
    $serverCert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    Write-Host ('Amprenta certificatului serverului: ' + $serverCert.Thumbprint)
    $store = New-Object Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
    $store.Open('ReadWrite')
    if (-not $store.Certificates.Find('FindByThumbprint', $serverCert.Thumbprint, $false).Count) {
      $store.Add($serverCert); Write-Host 'Certificatul a fost instalat ca de încredere.'
    } else { Write-Host 'Certificatul era deja de încredere.' }
    $store.Close()
  } finally { $tcp.Close() }
}

$result = Invoke-RestMethod -Uri ($ServerUrl.TrimEnd('/') + '/api/enroll') -Method Post -ContentType 'application/json' -Body (@{token=$EnrollmentToken}|ConvertTo-Json)
$result | Add-Member -NotePropertyName serverUrl -NotePropertyValue $ServerUrl.TrimEnd('/')
$result | ConvertTo-Json | Set-Content -Path $target -Encoding UTF8
Write-Host ('Înrolat: ' + $result.name + ' (' + $result.role + '). Porniți sau reporniți Labora în sesiunea utilizatorului.')
