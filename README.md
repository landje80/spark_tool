# Spark Tool

CRM, dagelijkse leadgeneratie, outreach en content intake voor Spark. Live: https://spark.nicenext.nl/tool

**Status:** fase 1 in uitvoering. Fundament, databaseschema, Microsoft SSO (single-tenant), RBAC-basis en responsive shell zijn gebouwd en getest. CRM-schermen, leadgeneratie, outreach en content intake zijn nog niet gebouwd. Zie `docs/architecture/system-design.md` (Status).

## Snel starten

```bash
npm install
cp .env.example .env   # vul lokale waarden in
npm run db:generate
npm run dev            # API :3000, web :5173 (onder /tool)
npm run verify         # format, lint, typecheck, prisma validate, test, build, audit
```

Vereist Node.js >= 22.12 en MySQL 8.

## Documentatie

`docs/product-requirements.md` · `docs/architecture/` · `docs/security/security-design.md` · `docs/deployment/plesk-deployment.md` · `docs/operations/runbook.md`

## Werkwijze

Conventional Commits, `main` is productieklaar, releases via Git-tags, geen staging. Zie `CLAUDE.md` en `.claude/`.
