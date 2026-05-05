## Redesign Dashboard + navigazione

Riallineamento UI a mockup fornito. Nessuna modifica a logica fiscale o backend.

### 1. Sidebar desktop (`src/components/AppSidebar.tsx`)
- Sfondo navy `#1e3a5f` (override via classi inline o token sidebar in `index.css`).
- In alto: icona goccia verde (lucide `Droplet` color `#16a34a`) + wordmark "Liquidò" bianco.
- Voci con icone già usate: Dashboard, Conti, Transazioni, Budget, Report, Importa CSV.
- Stato attivo: pill bianca semitrasparente, testo bianco.
- Footer: Impostazioni, poi avatar (iniziale utente da `useAuth`) + "Esci".
- Aggiornare token `--sidebar-*` in `src/index.css` per il navy + foreground bianco senza rompere altre pagine.

### 2. Header (`src/components/AppLayout.tsx` + Dashboard)
- Mantiene `AlertsBell`. Titolo + month selector + CTA restano nel componente Dashboard (già presenti) — solo restyling.

### 3. Dashboard (`src/pages/Dashboard.tsx`)
- Banner alert non categorizzate: già esiste, restyling arancione chiaro (`bg-orange-50 border-orange-200 text-orange-800`).
- KPI cards (3 colonne desktop):
  - Saldo Totale: icona `Wallet` su tile navy.
  - Accantonamento Fiscale: icona `Briefcase`/`Coins` tile navy.
  - Liquidità Reale: card sfondo verde `#16a34a`, testo bianco, icona `HandCoins` — evidenziata.
  - Mini sparkline a destra (mantenere SVG attuale, colori coerenti).
- Grafico Flusso di Cassa: legenda con etichette "Liquidità Reale" e "Spese" (rinominare `income`→`Liquidità Reale`? — uso "Entrate"/"Spese" per fedeltà ai dati; mockup richiede testo non hex). Forzo `formatter` legenda a etichette testuali.
- Sezione inferiore: già 2 colonne (transazioni + budget) — solo restyling header e badge.

### 4. Mobile (`< 768px`)
- Header mobile: in `AppLayout` mostrare avatar + "Ciao, {nome}" (da `profiles.full_name` via `useAuth`/query).
- `MobileNav`: già 5 voci (Dashboard, Conti, Movimenti→"Transazioni", Budget, Impostazioni). Rinomino "Movimenti" in "Transazioni" e mostro label sotto icona.
- Dashboard mobile: riordinare KPI in colonna singola con Liquidità Reale in cima, prominente.

### Tecnico
- Colori: usare classi tailwind arbitrarie (`bg-[#1e3a5f]`, `bg-[#16a34a]`) per fedeltà al mockup; non tocco design tokens globali a parte sidebar.
- Nessuna modifica DB / edge functions.
- Mantengo tutti i comportamenti esistenti (onboarding, query, FiscalBreakdown).

### File modificati
- `src/components/AppSidebar.tsx`
- `src/components/AppLayout.tsx`
- `src/components/MobileNav.tsx`
- `src/pages/Dashboard.tsx`
- `src/index.css` (token sidebar navy)
