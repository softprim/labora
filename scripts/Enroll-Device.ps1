#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory=$true)][string]$ServerUrl,
  [Parameter(Mandatory=$true)][string]$EnrollmentToken
)
$ErrorActionPreference = 'Stop'
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
$result = Invoke-RestMethod -Uri ($ServerUrl.TrimEnd('/') + '/api/enroll') -Method Post -ContentType 'application/json' -Body (@{token=$EnrollmentToken}|ConvertTo-Json)
$result | Add-Member -NotePropertyName serverUrl -NotePropertyValue $ServerUrl.TrimEnd('/')
$result | ConvertTo-Json | Set-Content -Path $target -Encoding UTF8
Write-Host ('Înrolat: ' + $result.name + '. Porniți sau reporniți Labora în sesiunea utilizatorului.')
