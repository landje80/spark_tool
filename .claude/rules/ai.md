---
paths:
  - 'src/integrations/anthropic/**'
  - 'src/modules/lead-generation/**'
---

# AI-integraties

- Modelnaam uit `ANTHROPIC_MODEL_*`, nooit hardcoded. Controleer actuele API-documentatie vóór wijzigingen.
- Output altijd strikt schema + Zod-validatie; ongeldige output = kandidaat afwijzen, niet repareren met aannames.
- Promptversie opslaan (`PromptVersion`) en koppelen aan de run; kosten/tokens/zoekaanroepen registreren en begrenzen.
- Geen feiten verzinnen: bron per bewering, onzekerheid expliciet. Nooit zelf outreach versturen.
- Tests gebruiken fixtures/mocks, nooit de echte API.
