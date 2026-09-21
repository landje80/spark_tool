---
name: anthropic-prompt-change
description: Wijzig een Anthropic-prompt of outputschema traceerbaar en veilig.
---

1. Raadpleeg de actuele Anthropic API-docs (structured output, web search, modelnamen).
2. Maak een nieuwe PromptVersion (nooit bestaande overschrijven); schema en Zod-validator synchroon houden.
3. Update fixtures en tests (ongeldige output, ontbrekende bronnen, dedupe).
4. Controleer kostenlimieten (ANTHROPIC_MAX_DAILY_COST, WEB_SEARCH_MAX_USES). Geen echte API-calls in tests.
