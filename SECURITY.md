# Security Policy

## Reporting a Vulnerability

The H3 project takes security seriously. If you discover a security vulnerability, please do NOT open a public issue.

Email: wojonstech@gmail.com

Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Any potential mitigations

We aim to respond within 72 hours and release a fix within 7 days of confirmation.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ Active development |

## Security Model

H3 Protocol is the OpenAPI 3.1 specification for the Hermes Harness Hooks protocol. Key security boundaries:

- **Schema validation**: All protocol messages are validated against the H3 OpenAPI 3.1 schema.
- **Transport**: HTTPS between Hermes and harnesses.
- **Auth**: API key authentication via `Authorization` header.

## Disclosure Policy

We follow responsible disclosure:
1. Reporter submits vulnerability privately
2. We acknowledge within 72 hours
3. We develop and test a fix
4. We release the fix and publish an advisory
