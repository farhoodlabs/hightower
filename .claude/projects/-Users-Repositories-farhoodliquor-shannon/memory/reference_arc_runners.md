---
name: ARC self-hosted runners
description: farhoodliquor org has ARC runner scale set named "runners-farhoodliquor" in their K8s cluster for GitHub Actions CI/CD
type: reference
---

The farhoodliquor GitHub org has Actions Runner Controller (ARC) deployed in their K8s cluster with a runner scale set named `runners-farhoodliquor`. The ARC configuration lives in a separate repo (not in shannon). Shannon CI workflows should target these self-hosted runners instead of GitHub-hosted runners to avoid free-tier runner minute limits.

**How to apply:** When modifying `.github/workflows/` files, use `runs-on: runners-farhoodliquor` instead of `runs-on: ubuntu-latest`.
