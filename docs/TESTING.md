# Raport de testare — 8 septembrie 2026

Versiune: **0.1.0 alpha**. Acest raport diferențiază codul implementat de funcțiile
confirmate pe Windows. Nu prezintă un prototip ca produs gata pentru toate școlile.

## Executat cu succes

| Verificare | Rezultat |
|---|---|
| `npm run check` | Sintaxă validă pentru sursele JavaScript |
| `npm test` | **15 teste trecute**, 0 eșuate |
| `npm audit` | 0 vulnerabilități raportate la verificare, inclusiv dependențele de dezvoltare |
| Compilare C# cu Roslyn / referințe .NET 8 | Codul InputBridge a fost compilat în assembly; nu a fost executat pe Windows |
| Interfață în browser, date fictive | Panouri profesor/elev/IT, creare laborator, cerere de ajutor, plan și salvare |
| Indicator de control | Vizibil la elev după preluare; ascuns la oprire, prin serverul real și puntea de test |
| Imagini live de rezervă | Cadre sintetice primite și afișate în panoul profesorului prin server |
| Comandă de proiecție | Autorizare și interfață verificate; destinația nativă este înlocuită în test |
| Plan fizic după redimensionare | 12 PC-uri, 0 suprapuneri la 390 / 720 / 1024 / 1280 px |
| Plan dreptunghiular | Configurare 6 coloane × 4 rânduri, 12 PC-uri și locuri libere |
| Rotire | Vedere și reperul catedrei verificate vizual; toate cele 4 orientări testate matematic |

Testele automate acoperă: autentificare, acces per laborator/școală, tokenuri de
înrolare de unică folosință și expirare, semnalizare autorizată, control cu drept
explicit, validarea inputului, logout, revocarea dispozitivului, jurnal, persistență,
poziții unice, micșorarea grilei fără pierderea locurilor ocupate, cadre de rezervă
permise numai în ora activă și refuzul HTTP necriptat pentru bind în LAN.

Planul final păstrează pozițiile fizice la redimensionare; se adaptează scara.
Ordinea rândurilor nu este schimbată pentru a umple fereastra. Rotirea este o
preferință de vedere, separată de configurația salvată a sălii. Pozițiile se schimbă
prin mutare într-o celulă liberă sau schimb între două PC-uri, cu validare pe server.

## Limitări întâlnite în mediul de dezvoltare

- Conexiunea WebRTC directă din browserul disponibil nu a produs candidați ICE
  utilizabili: diagnosticul a arătat 0 candidați și 0 cadre decodate. **Transmisia
  directă nu este confirmată aici.** Modul JPEG de rezervă a fost adăugat și
  verificat pentru a putea afișa ecrane fără această conexiune directă.
- Cadrele folosite în browser sunt generate din canvas, cu textul „CADRE DE TEST”.
  Nu sunt capturi ale unui desktop Windows și nu sunt ecrane ale unor elevi.
- Mediul nu a permis rularea completă a toolchain-ului Windows / instalatorului.
  Compilarea C# a fost verificată separat cu compilatorul, dar **nu există în acest
  pachet un instalator Windows construit și testat**.
- Testul automat complet `npm run test:ui` este pregătit pentru CI / un mediu cu
  Chromium local. Aici verificarea browserului a fost făcută prin browserul
  disponibil, nu prin executarea completă a acestui script de la cap la coadă.
- Workflow-ul GitHub este pregătit, însă nu a rulat încă într-un repository al
  proiectului. Nu există un rezultat GitHub Actions sau un link de release confirmat.

## Matrice obligatorie pentru pilotul Windows

| Scenariu | Criteriu de acceptare | Stare |
|---|---|---|
| Instalare ca IT | Instalare per-machine și înrolare cu ACL corect | De testat |
| Elev cu cont standard | Nu poate rescrie device.json sau configurația instalării | De testat |
| Restart și login Windows | Clientul pornește după autentificarea utilizatorului | De testat |
| Captură nativă | Ecranul principal corect; indicator vizibil numai în oră | De testat |
| 2 PC-uri, apoi un laborator complet | Latență, CPU, RAM și trafic măsurate | De testat |
| WebRTC în LAN | Cadre video reale decodate, fără relay cloud | De testat |
| Rețea fără WebRTC | Cadre de rezervă actualizate; mod afișat explicit | De testat pe PC-uri |
| Input Windows | Clic stânga/dreapta și taste simple pe PC-ul selectat | De testat |
| Proiector / tabla smart | Ecran extins; se vede numai sursa selectată | De testat |
| Cablu scos, blocare sau suspendare | Partajarea/controlul se opresc; fără imagine veche prezentată ca live | De testat pe PC-uri |
| Profesor deconectat | Ora nu se reia automat fără acțiunea profesorului | Server testat; Windows de testat |
| DPI și monitoare diferite | Coordonate corecte pe monitorul principal | De testat |
| Instalator semnat | Semnare și verificare pe o mașină curată | Neimplementat în alpha |

După configurarea repository-ului GitHub, workflow-ul va putea executa testele
și genera instalatorul nesemnat. Un rezultat CI verde nu înlocuiește această
matrice pe calculatoare Windows reale.
