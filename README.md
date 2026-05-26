# TeamClaw Workspace

This repository root is now a thin workspace shell.

The full JueYing mainline program lives under:

```text
jueying-mainline/
```

Use that directory as the working root for development, validation, local app startup, docs, graphs, fixtures, tests, schemas, reports, and the historical JueYing v1 runtime compatibility layer.

```bash
cd jueying-mainline
npm run verify
npm run app:start
```

The root keeps only repository-level items:

- `.git/`
- `.gitignore`
- `.vscode/`
- `README.md`
- `jueying-mainline/`

JueYing is the mainline product: an enterprise-grade Agent Harness for centralized management in small and mid-sized teams. The AI-native operating console is built into JueYing mainline, not maintained as a separate application.
