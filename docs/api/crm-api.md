# CRM-API

Basispad: `/tool/api`. Alle routes vereisen een geldige sessie. Niet-GET verzoeken vereisen daarnaast header `x-csrf-token` (te lezen via `GET /me`) en een `Origin` gelijk aan `APP_BASE_URL`.

Fouten: `{ "code": "...", "message": "...", "details"?: [...], "requestId": "..." }`. `details` bevat alleen bij `VALIDATION_ERROR` (`[{ path, message }]`) en `CONFLICT` (duplicaatmatches) gegevens; nooit ingevoerde waarden.

| Methode | Pad                           | Recht             | Doel                                                                                     |
| ------- | ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| GET     | `/me`                         | (ingelogd)        | Gebruiker, CSRF-token, permissies                                                        |
| GET     | `/dashboard`                  | `prospect.read`   | KPI's, funnel, verdelingen, recente runs                                                 |
| GET     | `/users`                      | `prospect.read`   | Actieve gebruikers (id, naam) voor keuzelijsten                                          |
| GET     | `/prospects`                  | `prospect.read`   | Lijst met filters, zoeken, sortering, paginering                                         |
| GET     | `/prospects/export.csv`       | `prospect.export` | CSV (max. 5000 rijen, zelfde filters als de lijst)                                       |
| POST    | `/prospects`                  | `prospect.write`  | Aanmaken; 409 bij duplicaat (`confirmDuplicate: true` overschrijft alleen fuzzy matches) |
| GET     | `/prospects/:id`              | `prospect.read`   | Detail incl. bronnen, activiteiten, taken, toegestane statussen                          |
| PATCH   | `/prospects/:id`              | `prospect.write`  | Wijzigen (strikt schema, geen `status`)                                                  |
| POST    | `/prospects/:id/status`       | `prospect.write`  | Statuswijziging volgens de statusmachine; `CUSTOMER` niet via deze route                 |
| POST    | `/prospects/:id/activities`   | `prospect.write`  | Notitie of gesprek (`NOTE`, `CALL`)                                                      |
| POST    | `/prospects/:id/tasks`        | `prospect.write`  | Taak aanmaken                                                                            |
| POST    | `/prospects/:id/merge`        | `prospect.merge`  | Body `{ sourceId }`: bron samenvoegen in dit prospect                                    |
| POST    | `/prospects/bulk/assign`      | `prospect.write`  | `{ ids (1-200), ownerId \| null }`                                                       |
| POST    | `/prospects/bulk/next-action` | `prospect.write`  | `{ ids (1-200), nextActionAt \| null }`                                                  |
| GET     | `/tasks`                      | `prospect.read`   | `?status=OPEN\|DONE\|CANCELLED&mine=true`                                                |
| PATCH   | `/tasks/:id`                  | `prospect.write`  | Taak wijzigen of afronden; alleen eigen/niet-toegewezen taken, managers alle             |
| GET     | `/admin/health`               | `settings.manage` | Diepe healthcheck (database)                                                             |

## Lijstparameters (`GET /prospects`)

`page`, `pageSize` (≤100), `q` (naam/plaats/domein/branche), `status` (komma-gescheiden), `ownerId` (`none` = niet toegewezen), `province`, `city`, `industry`, `addedFrom/To`, `nextActionFrom/To` (YYYY-MM-DD), `due` (`today`\|`overdue`, in Europe/Amsterdam), `hasOutreach`, `minScore`, `includeArchived`, `sort` (`companyName`\|`createdAt`\|`nextActionAt`\|`fitScore`\|`status`\|`city`), `dir`. Onbekende parameters geven 400.

Elk item bevat `flags`: `dueToday`, `overdue`, `needsReview`, `draftReady`, `blocked`. "Achterstallig" telt niet voor gesloten statussen (niet geïnteresseerd, klant, gearchiveerd, ongeldig, dubbel).

## Beveiliging en gelijktijdigheid

- Samenvoegen is onomkeerbaar en vereist `prospect.merge` (MANAGER, ADMIN). Beide rijen worden in vaste id-volgorde vergrendeld; doel mag niet DUPLICATE of geanonimiseerd zijn. Unieke sleutels (domein, KvK) van de bron blijven op de bron staan als het doel er al een heeft.
- Aanmaken en wijzigen van identiteitsvelden (naam, website, telefoon, KvK, plaats) draaien onder een named lock (`GET_LOCK`): gelijktijdige identieke verzoeken leveren precies ��n prospect. Wijzigen naar een bestaand domein/KvK/telefoon geeft 409 met details.
- Statuswijzigingen schrijven alleen als de status nog gelijk is aan de gelezen status; anders 409.
- Schrijfacties hebben een eigen rate limit (120/min per IP), naast de algemene 300/min.
- Sessies verlopen na 8 uur inactiviteit en uiterlijk 12 uur na inloggen.
