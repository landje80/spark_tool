# Leadgeneratie-API

Basispad `/api`; zelfde sessie-, CSRF- en foutregels als de [CRM-API](crm-api.md).

| Methode | Pad                             | Recht             | Doel                                                                                                                                             |
| ------- | ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET     | `/leads/runs`                   | `prospect.read`   | Laatste 20 runs met aantallen, tokens, zoekopdrachten en geschatte kosten                                                                        |
| POST    | `/leads/runs`                   | `lead.run`        | Plant een handmatige run in (202). 409 `not_configured` zonder API-sleutel/model, 409 `already_queued` als er al een leadrun klaarstaat of loopt |
| GET     | `/leads/candidates`             | `prospect.read`   | Openstaande fuzzy-matches: nieuw gevonden gegevens naast de bestaande prospect                                                                   |
| POST    | `/leads/candidates/:id/resolve` | `prospect.write`  | `{action: "accept" \| "attach" \| "reject"}`                                                                                                     |
| GET     | `/admin/integrations`           | `settings.manage` | Status van integraties en jobs. Alleen aanwezig/afwezig, **nooit** sleutels of tokens                                                            |
| POST    | `/admin/leadgen`                | `settings.manage` | `{enabled: boolean}` schakelt de dagelijkse leadgeneratie in/uit                                                                                 |

- `accept` maakt een nieuwe prospect (blokkeert bij een inmiddels ontstaan exact duplicaat), `attach` koppelt de nieuwe bronnen aan de bestaande prospect, `reject` sluit af. Een kandidaat kan maar één keer worden beoordeeld (409 daarna).
- Handmatige runs krijgen geen automatische herhaling (elke poging kost geld) en er staat maximaal één leadrun tegelijk in de wachtrij.
- Runs worden uitgevoerd door de jobrunner (`npm run jobs:run`), niet door het webproces; een handmatige run start dus bij de eerstvolgende taakuitvoering.
