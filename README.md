<div align="center">

# Hightower — AI Pentester

Hightower is a fork of [Shannon](https://github.com/KeygraphHQ/shannon) by Keygraph, wrapped with a REST API and Kubernetes tooling for cluster-based deployments.

</div>

## What is Hightower?

Hightower is an API-driven AI pentester built on top of Shannon's autonomous penetration testing engine. It performs white-box security testing of web applications and APIs by combining source code analysis with live exploitation.

Unlike the upstream Shannon CLI, Hightower is designed to run as a service on Kubernetes — scans are triggered via REST API, orchestrated by Temporal, and executed in ephemeral worker pods.

> [!IMPORTANT]
> **White-box only.** Hightower expects access to your application's source code and repository layout.

## Features

- **Fully Autonomous Operation**: A single API call launches the full pentest. Handles 2FA/TOTP logins (including SSO), browser navigation, exploitation, and report generation without manual intervention.
- **Reproducible Proof-of-Concept Exploits**: The final report contains only proven, exploitable findings with copy-and-paste PoCs. Vulnerabilities that cannot be exploited are not reported.
- **OWASP Vulnerability Coverage**: Identifies and validates Injection, XSS, SSRF, and Broken Authentication/Authorization.
- **Code-Aware Dynamic Testing**: Analyzes source code to guide attack strategy, then validates findings with live browser and CLI-based exploits against the running application.
- **Integrated Security Tooling**: Leverages Nmap, Subfinder, WhatWeb, and Schemathesis during reconnaissance and discovery phases.
- **Parallel Processing**: Vulnerability analysis and exploitation phases run concurrently across all attack categories.

## Architecture

Hightower uses a multi-agent architecture that combines white-box source code analysis with dynamic exploitation across five phases:

```
        +----------------------+
        |   Pre-Reconnaissance |
        |  (nmap, subfinder,   |
        |  whatweb, code scan) |
        +----------+-----------+
                   |
                   v
        +----------------------+
        |   Reconnaissance     |
        |  (attack surface     |
        |   mapping)           |
        +----------+-----------+
                   |
                   v
        +----------+----------+
        |          |          |
        v          v          v
  +-----------+ +---------+ +---------+
  | Vuln      | | Vuln    | |   ...   |
  |(Injection)| |  (XSS)  | |         |
  +-----+-----+ +----+----+ +----+----+
        |             |           |
        v             v           v
  +-----------+ +---------+ +---------+
  | Exploit   | | Exploit | |   ...   |
  |(Injection)| |  (XSS)  | |         |
  +-----+-----+ +----+----+ +----+----+
        |             |           |
        +------+------+-----------+
               |
               v
        +----------------------+
        |      Reporting       |
        +----------------------+
```

Each scan runs as an ephemeral Kubernetes Job with a per-invocation Temporal task queue, enabling concurrent scans with different target repositories.

## Deployment

Kubernetes manifests live in a separate repository: [farhoodlabs/hightower-infra](https://github.com/farhoodlabs/hightower-infra).

## Sample Reports

Sample penetration test reports from industry-standard vulnerable applications:

- **OWASP Juice Shop** — 20+ vulnerabilities including auth bypass and database exfiltration. [View Report](sample-reports/shannon-report-juice-shop.md)
- **c{api}tal API** — ~15 critical/high vulnerabilities including command injection and auth bypass. [View Report](sample-reports/shannon-report-capital-api.md)
- **OWASP crAPI** — 15+ critical/high vulnerabilities including JWT attacks and database compromise. [View Report](sample-reports/shannon-report-crapi.md)

## Benchmark

Shannon Lite scored **96.15% (100/104 exploits)** on a hint-free, source-aware variant of the XBOW security benchmark.

[Full results with detailed agent logs and per-challenge pentest reports](https://github.com/KeygraphHQ/xbow-validation-benchmarks/blob/main/xben-benchmark-results/)

## Disclaimers

> [!WARNING]
> **DO NOT run Hightower on production environments.**
> It actively executes attacks to confirm vulnerabilities. Use only on sandboxed, staging, or local development environments.

> [!CAUTION]
> **You must have explicit, written authorization** from the owner of the target system before running Hightower. Unauthorized scanning is illegal.

- **Verification is Required**: Human oversight is essential to validate all reported findings. LLMs can still generate hallucinated content.
- **Targeted Vulnerabilities**: Broken Authentication & Authorization, Injection, XSS, SSRF.
- **Cost**: A full test run typically takes 1-1.5 hours and may cost ~$50 USD using Claude Sonnet.

## License

Released under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

## Support

- **Report bugs**: [GitHub Issues](https://github.com/farhoodlabs/hightower/issues)
- **Discussions**: [GitHub Discussions](https://github.com/farhoodlabs/hightower/discussions)

---

<p align="center">
  Based on <a href="https://github.com/KeygraphHQ/shannon">Shannon</a> by <a href="https://keygraph.io">Keygraph</a>
</p>
