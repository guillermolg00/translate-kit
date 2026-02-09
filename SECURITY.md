# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub's private vulnerability reporting](https://github.com/guillermolg00/translate-kit/security/advisories/new) to submit your report. You will receive a response within 48 hours.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Scope

translate-kit is a build-time CLI tool. It interacts with:

- Local filesystem (reading/writing JSON and source files)
- AI provider APIs (via Vercel AI SDK, using your own API keys)

Security concerns most relevant to this project:

- API key exposure (keys are read from environment variables, never logged or transmitted elsewhere)
- File system access (limited to configured directories)
- Supply chain (dependencies are kept minimal and audited)
