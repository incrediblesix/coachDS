# DS Allenamento: guida di installazione

Sito statico (solo HTML e JavaScript) con dati su Supabase.
Si apre da browser e si aggiunge alla schermata Home come un'app.

## File del progetto

Tutti nella stessa cartella, senza sottocartelle:

- `index.html`, `app.js`, `config.js`: il sito
- `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: servono per l'app da Home
- `schema.sql`: il database (si usa una volta sola, su Supabase)

## 1. Supabase: database

1. Apri il tuo progetto su supabase.com.
2. Menu **SQL Editor** > **New query**.
3. Incolla tutto il contenuto di `schema.sql` e premi **Run**. Deve comparire un messaggio di successo.
4. Menu **Authentication** > impostazioni dell'email (Providers > Email): **disattiva "Confirm email"**.
   Cosi' i clienti possono creare l'account senza ricevere email (sul piano gratuito l'invio di email e' molto limitato).
5. Menu **Project Settings** > **API**: copia
   - **Project URL** (tipo `https://abcd1234.supabase.co`)
   - la chiave **anon** (o **publishable**)

   Non usare mai la chiave `service_role` o `secret`.
6. Apri `config.js` e incolla i due valori al posto di `INSERISCI_...`.

## 2. GitHub: pubblicare il sito

1. Crea un repository su github.com (nome a piacere, per esempio `palestra`). Per GitHub Pages gratuito deve essere pubblico.
2. **Add file** > **Upload files**: carica tutti i file del progetto (tranne, se vuoi, `schema.sql`) e fai **Commit**.
3. **Settings** > **Pages** > Source: **Deploy from a branch**, branch `main`, cartella `/ (root)` > **Save**.
4. Dopo uno o due minuti il sito e' online su `https://TUONOME.github.io/palestra/`.

Nel repository pubblico ci sara' l'indirizzo Supabase e la chiave anon: va bene, sono pensati per essere pubblici.
La protezione dei dati e' nelle regole del database, create da `schema.sql`.

Nota: i termini di GitHub Pages sconsigliano l'uso come servizio commerciale. Se preferisci stare tranquillo,
Cloudflare Pages o Netlify (gratuiti) leggono lo stesso repository senza modifiche ai file.

## 3. Il tuo account da allenatore

1. Apri il sito > **Nuovo account** > crea l'account con la tua email e una password.
2. In Supabase > **SQL Editor** esegui questa riga, con la tua email al posto di `TUA@EMAIL.IT`:

```sql
insert into public.trainers (user_id)
select id from auth.users where email = 'TUA@EMAIL.IT';
```

3. Ricarica il sito: vedrai il pannello allenatore.

Solo chi e' nella tabella `trainers` puo' creare clienti e schede. Nessuno si puo' promuovere da solo.

## 4. Aggiungere un cliente

1. Nel pannello scrivi nome e cognome e premi **Aggiungi**. Compare un **codice** di 6 caratteri.
2. Mandi al cliente il link del sito e il codice.
3. Il cliente: **Nuovo account** > email e password > inserisce il codice. Da quel momento vede solo la sua scheda.
4. Dalle volte successive entra solo con email e password.

## 5. Aggiungere alla schermata Home

- **iPhone (Safari):** tasto Condividi > **Aggiungi alla schermata Home**.
- **Android (Chrome):** menu a tre puntini > **Installa app** o **Aggiungi a schermata Home**.

## Da sapere

- **Password dimenticata:** senza un servizio email dedicato non c'e' il recupero automatico.
  Da Supabase > Authentication > Users puoi reimpostare la password di un cliente.
- **Progetto in pausa:** sul piano gratuito Supabase mette in pausa i progetti inattivi per circa una settimana.
  Con clienti attivi non succede. Se succede, si riattiva con un clic dalla dashboard.
- **Backup:** sul piano gratuito non ci sono backup scaricabili automatici. Ogni tanto esporta le tabelle
  (Table Editor > Export to CSV), in particolare `logs`, `plans` e `clients`.
- **Privacy:** hai dati personali dei tuoi clienti. Scegli la regione UE per il progetto Supabase
  e prepara una breve informativa privacy da mostrare ai clienti.
- **Offline:** l'app si apre anche con rete debole, ma carichi e ripetizioni si salvano solo con connessione.
