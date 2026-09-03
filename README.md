# Reddit Poster

Eine kleine Cloudflare-Worker-App, mit der du Reddit-Beiträge vorbereiten, prüfen und nach ausdrücklicher Bestätigung veröffentlichen kannst.

## Enthalten

- Reddit-Anmeldung über OAuth – kein Reddit-Passwort in der App
- Text- und Link-Beiträge
- Live-Vorschau
- NSFW- und Spoiler-Markierung
- lokal gespeicherter Entwurf
- Bestätigungsdialog vor jedem öffentlichen Beitrag
- verschlüsselte Sitzung in einem HttpOnly-Cookie
- Smartphone- und Desktop-Ansicht

## 1. Reddit-App anlegen

Lege bei Reddit eine OAuth-Anwendung vom Typ **web app** an. Als Redirect-Adresse trägst du exakt diese Adresse ein:

```text
https://DEINE-WORKER-ADRESSE/auth/reddit/callback
```

Für die lokale Entwicklung lautet sie:

```text
http://localhost:8787/auth/reddit/callback
```

Die App fordert nur die Berechtigungen `identity` und `submit` an.

## 2. Cloudflare-Variablen eintragen

In Cloudflare unter **Workers & Pages → dein Worker → Settings → Variables and Secrets**:

| Name | Einstellung | Inhalt |
| --- | --- | --- |
| `REDDIT_CLIENT_ID` | Secret | Client-ID der Reddit-App |
| `REDDIT_CLIENT_SECRET` | Secret | Client-Secret der Reddit-App |
| `REDDIT_REDIRECT_URI` | Variable | Exakte Callback-Adresse von oben |
| `SESSION_SECRET` | Secret | Lange zufällige Zeichenfolge, mindestens 32 Zeichen |
| `APP_USER_AGENT` | Variable | `web:reddit-poster:v1.0.0 (by /u/DEINNAME)` |

## 3. Bereitstellen

```bash
npm install
npm run deploy
```

Bei einer GitHub-Verknüpfung mit Cloudflare lautet der Deploy-Befehl:

```text
npx wrangler deploy
```

Ein Build-Befehl ist nicht notwendig.

## Lokal testen

Kopiere `.dev.vars.example` nach `.dev.vars`, setze die Werte und starte:

```bash
npm install
npm run dev
```

`.dev.vars` wird nicht in Git gespeichert.

## Sicherheit

Refresh-Tokens werden mit AES-GCM verschlüsselt und nur in einem `HttpOnly`, `SameSite=Lax` Cookie gespeichert. Zugangsdaten gehören ausschließlich in Cloudflare Secrets und niemals in dieses Repository.

Das Veröffentlichen kann trotzdem an Reddit-Regeln, subreddit-spezifischen Vorgaben, fehlendem Karma, Kontobeschränkungen oder API-Zugangsbedingungen scheitern. Die App zeigt die von Reddit gelieferte Fehlermeldung an.
