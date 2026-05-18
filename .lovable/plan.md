# Visuell uppfräschning – Nordisk minimalism

Ett helhetsgrepp om designen så att ZenOS Lab känns lugnare, mer pålitlig och lättare att förstå för en förstagångsbesökare. Inspiration: Swiss/nordisk minimalism – mycket whitespace, papper & bläck, en tydlig accent (Zenion-grön), strikt typografi.

## Mål

- Förstagångsbesökaren förstår direkt vad appen gör.
- Mindre visuellt brus: färre färger, lugnare ytor, tydligare hierarki.
- Konsekvent designsystem i hela appen (inga ad-hoc-färger i komponenter).

## Designspråk

**Palett (nordisk minimalism + Zenion-accent)**

```text
Bakgrund        #F5F3EE   varm off-white (papper)
Yta / kort      #FFFFFF
Mjuk yta        #E8E4DD   sektionsavdelare, muted
Text primär     #2D2D2D   bläck
Text muted      #6B6B6B
Accent          #1D9A85   Zenion-grön (sparsamt, bara CTA/status)
Linje           #E2DED5
```

**Typografi**

- Behåll Poppins som body.
- Lägg till ett serif-display för rubriker (Instrument Serif eller Fraunces) – ger redaktionell, nordisk känsla utan att bli stelt.
- Tydligare skalor: h1 36–44px, h2 24–28px, body 14–15px, micro 11–12px uppercase tracking.

**Yta & rytm**

- Större luft mellan sektioner (py-12 mellan block, py-6 inom).
- Tunnare linjer (1px `border-border/60`) istället för skuggor på de flesta ytor.
- Border-radius nedjusterat: kort 12px, knappar pill behålls för CTA, övriga 8px.
- Skuggor: nästan inga – bara `shadow-soft` på CTA och elevated cards.

## Vad som ändras konkret

### 1. Designsystem (`src/index.css`, `tailwind.config.ts`)

- Uppdatera CSS-variablerna till paletten ovan (HSL).
- Lägg till `--font-display` för serif-rubriker, ladda via `index.html`.
- Lägg till hjälpklasser: `.section-label` (uppercase 11px tracking-wider muted), `.display` (serif rubriker).

### 2. Sidebar (`AppShell.tsx`)

- Tunnare sidebar (w-60), mer luft i toppen runt loggan.
- Navigationsknappar: byt pill-fyllning till en diskret vänsterkant-accent + lätt bakgrund för aktiv vy. Mindre färgglatt.
- "Sign out" och e-post grupperas i en stilrenare footer.

### 3. Login (`Login.tsx`)

- Tvådelad layout på desktop: vänster sida med stort serif-citat / tagline ("Simulera energiframtiden."), höger sida med formuläret på papper-yta.
- Mindre kort, mer luft.

### 4. Översikt (`Overview.tsx`)

- Lägg till en **välkomst-header** överst: serif-rubrik + en menings-sammanfattning av vad appen visar, plus 3 snabblänkar (Importera data → Skapa hushåll → Kör simulering).
- KPI-korten görs platta: vit yta, tunn linje, stor siffra i serif, label i uppercase. Inga färgade ikon-badges – ikonen är monokrom muted.
- Grafer: reducera paletten till grön + neutralgrå + en varm accent (terrakotta) för varningar. Ta bort lila/blå/orange-mixen.
- Sektioner separeras med tunna linjer + section-labels ("01 — Aktivitet", "02 — Utmaningar") istället för många kort som tävlar om uppmärksamhet.

### 5. Tomma tillstånd

- När det inte finns hushåll/simuleringar: visa en lugn, centrerad illustration + en mening + en CTA. Idag möts nya användare av tomma tabeller.

### 6. Övriga sidor (Hushåll, Simulering, Resultat)

- Samma uppdaterade tokens slår igenom automatiskt.
- Sidrubriker görs konsekventa: serif h1 + muted underrubrik + tunn linje under.
- Tabs och pill-knappar dämpas (muted bg, accent bara för aktivt val).

## Teknisk sammanfattning

Filer som rörs:

- `src/index.css` – nya HSL-tokens, font-imports, hjälpklasser.
- `tailwind.config.ts` – `fontFamily.display`, ev. extra spacing.
- `index.html` – Google Fonts-länk för Instrument Serif (eller Fraunces).
- `src/components/AppShell.tsx` – sidebar-layout & nav-styling.
- `src/pages/Login.tsx` – split layout.
- `src/pages/Overview.tsx` – välkomst-header, plattare KPI-kort, dämpad grafpalett, section-labels.
- Mindre justeringar: `Hushall.tsx`, `Simulering.tsx`, `ResultatLoggar.tsx` – sidrubriker + ev. empty states.

Inga ändringar i affärslogik, databas eller edge functions. Inga nya beroenden utöver Google Font.

## Utanför scope (kan tas separat)

- Guidad tour / tooltips för onboarding.
- Mörkt läge.
- Animationer/motion utöver befintliga.
