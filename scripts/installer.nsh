!macro customInstall
  ; Program Files is administrator-writable. Launch in EACH user's own session.
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Labora" '"$INSTDIR\Labora.exe"'

  ; Serverul laboratorului rulează pe calculatorul profesorului: fără aceste reguli
  ; calculatoarele elevilor nu îl pot găsi și nu se pot conecta.
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Labora (server laborator)" dir=in action=allow protocol=TCP localport=4310 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Labora (descoperire in retea)" dir=in action=allow protocol=UDP localport=4311 profile=any'
!macroend
!macro customUnInstall
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Labora"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Labora (server laborator)"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Labora (descoperire in retea)"'
!macroend
