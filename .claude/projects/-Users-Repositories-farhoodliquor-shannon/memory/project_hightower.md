---
name: Hightower project context
description: Hightower is a custom deployment of Shannon (upstream pentest agent) with K8s API server, Flux GitOps, and MiniMax LLM provider
type: project
---

Hightower is farhoodliquor's custom deployment of Shannon (upstream KeygraphHQ/shannon). The GitHub repo is `farhoodliquor/hightower`.

**Why:** The upstream Shannon CLI is Docker-based. Hightower adds a K8s-native REST API server, Flux GitOps deployment, and targets MiniMax as the LLM provider instead of Anthropic.

**How to apply:**
- The worker image (`ghcr.io/farhoodliquor/shannon`) is intentionally kept as a clean fork of upstream for easy backporting. Don't modify the worker package unless necessary.
- Custom components use the `hightower-*` prefix (API server, credentials, workspaces PVC, Temporal, worker jobs).
- Upstream Shannon names are preserved where they refer to the upstream codebase: `@shannon/worker` package, `.shannon/` directories, the worker Docker image.
- Namespace is `hightower`, managed by the cluster repo (`cpfarhood/kubernetes`), not this repo.
- LLM provider is MiniMax via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (custom base URL mode).
