!macro customInstall
  ; Program Files is administrator-writable. Launch in EACH user's own session.
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Labora" '$"$INSTDIR\Labora.exe$"'
!macroend
!macro customUnInstall
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Labora"
!macroend
