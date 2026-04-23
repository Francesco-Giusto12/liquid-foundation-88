💧 Liquidò — Liquidità Reale per Freelancer con Partita IVA
Sai quanto puoi davvero spendere dopo aver ricevuto un pagamento? Liquidò calcola automaticamente la tua liquidità reale, sottraendo l'accantonamento fiscale dal saldo lordo. Niente più sorprese alla dichiarazione dei redditi.

🧮 La Formula
Liquidità Reale = Saldo Lordo − Accantonamento Fiscale 
Quando ricevi un pagamento da un cliente, Liquidò mostra immediatamente quanto di quel denaro puoi effettivamente usare, tenendo conto delle imposte da versare (IRPEF, contributi INPS, ecc.).

✨ Funzionalità principali
Dashboard in tempo reale — visualizza saldo lordo, accantonamento fiscale e liquidità reale disponibile
Calcolo automatico — inserisci il regime fiscale (forfettario, ordinario) e la percentuale viene applicata automaticamente
Storico pagamenti — tieni traccia di ogni incasso e della relativa quota fiscale accantonata
Design responsive — pensato per essere usato da mobile, quando ricevi un pagamento sul campo
Interfaccia minimalista — niente complessità inutile, solo i numeri che contano

🛠️ Stack Tecnico



🚀 Getting Started
Prerequisiti
Node.js >= 18
npm o yarn
Account Supabase (gratuito)
Installazione
# Clona la repository git clone https://github.com/Francesco-Giusto12/liquid-foundation-88.git cd liquid-foundation-88  # Installa le dipendenze npm install  # Configura le variabili d'ambiente cp .env.example .env 
Variabili d'ambiente
Crea un file .env nella root del progetto con le seguenti chiavi:
VITE_SUPABASE_URL=your_supabase_project_url VITE_SUPABASE_ANON_KEY=your_supabase_anon_key 
Trovi questi valori nel pannello del tuo progetto Supabase → Settings → API.
Avvio in locale
npm run dev 
L'app sarà disponibile su http://localhost:5173
Build per produzione
npm run build 

📁 Struttura del Progetto
liquid-foundation-88/ ├── src/ │   ├── components/       # Componenti React riutilizzabili │   ├── pages/            # Pagine principali dell'app │   ├── hooks/            # Custom React hooks │   ├── lib/              # Configurazione Supabase e utilities │   ├── types/            # TypeScript type definitions │   └── main.tsx          # Entry point ├── public/               # Asset statici ├── index.html ├── vite.config.ts ├── tailwind.config.ts └── tsconfig.json 

🎯 A chi è rivolto
Liquidò è pensato per:
Freelancer con Partita IVA forfettaria o ordinaria
Consulenti e professionisti autonomi italiani
Chiunque voglia avere chiarezza immediata sulla propria situazione di cassa al netto delle tasse

🌐 Link
App: liquid-foundation-88.vercel.app
Landing Page: getliquido.netlify.app

📸 Screenshot
(Aggiungi qui uno screenshot della dashboard)

🗺️ Roadmap
[ ] Supporto multi-regime fiscale (forfettario / ordinario / minimi)
[ ] Notifiche push per avvisi di scadenza fiscale
[ ] Esportazione dati in CSV/PDF
[ ] Integrazione con fatturazione elettronica
[ ] Calcolo contributi INPS Gestione Separata

👤 Autore
Francesco Giusto
GitHub: @Francesco-Giusto12
Email: francescogiusto596@gmail.com

📄 Licenza
Questo progetto è distribuito sotto licenza MIT. Vedi il file LICENSE per i dettagli.

"Non è quanto guadagni. È quanto puoi spendere."<img width="1631" height="1118" alt="Screenshot 2026-03-12 alle 15 45 36" src="https://github.com/user-attachments/assets/f3c234c1-84ec-4f29-a338-c14c12f6d879" />
<img width="1631" height="1118" alt="Screenshot 2026-03-12 alle 15 45 36" src="https://github.com/user-attachments/assets/f90b82d7-2f1d-45e7-8287-15c75a88f21c" />
