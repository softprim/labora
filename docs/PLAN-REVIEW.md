# Planul laboratorului — modificări pentru verificare

Bază: softprim/labora, main, b01d9f3754dfa525abef2e8354e11f95cf72021d.

## Comportament

- Planul folosește o grilă fizică stabilă, scalată uniform în ambele axe. Redimensionarea ferestrei nu schimbă locurile calculatoarelor sau culoarele.
- Administratorul poate trage un PC pe un loc liber sau ocupat. Pe un loc ocupat, cele două PC-uri schimbă locurile.
- Butonul „Mută calculatoare” permite selectarea PC-ului, apoi selectarea destinației cu mouse-ul sau prin atingere. Enter/Space activează o poziție; Escape anulează selecția. Alt + săgeți mută în direcția vizuală și păstrează focusul.
- Rotirea cu 90° mută și catedra în poziția corespunzătoare; la 180° este perspectiva profesorului. Orientarea se păstrează separat pentru utilizator și laborator.
- „Potrivește” afișează întregul plan. Zoom-ul permite examinarea detaliilor, cu derulare în interiorul planului.
- Salvarea păstrează mutările făcute în timpul unei cereri aflate în curs ca modificări nesalvate; salvările simultane sunt blocate.
- Laboratoarele multiple, accesul pe școală și proiecția pe ecranul secundar Windows rămân în implementarea existentă.

## Verificare

- `npm run check`: verificarea sintaxei.
- `npm test`: 15 teste pentru geometrie, persistență, autorizare și fluxurile serverului.
- `npm run test:ui`: integrare în Chromium, grile la 320/390/720/1024/1440 px, lipsa suprapunerilor, mutare în toate cele patru orientări, persistență după reîncărcare, focus la mutări consecutive și potrivirea grilei maxime 12 × 16.
- Testele existente verifică și crearea laboratoarelor, ecrane sintetice, ajutor, semnalizarea controlului și transmiterea cadrelor de proiecție.

Mediul de verificare este Linux. Captura reală, controlul nativ, instalatorul Windows și afișarea pe proiector/tablă smart fizică necesită validare pe Windows. Nu se afirmă certificarea întregii aplicații pentru producție.

## Aplicare

Patch-ul este destinat versiunii de bază de mai sus. Din copia repository-ului:

```sh
git apply --check labora-responsive.patch
git apply labora-responsive.patch
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:ui
```

Publicarea acestor modificări în repository a fost aprobată de proprietar.
