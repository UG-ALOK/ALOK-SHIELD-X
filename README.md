# UG ALOK — Kit

**Developer: UG ALOK** · Version 1.0.0

A compact, defensive, terminal-based security toolkit written in pure JavaScript for Node.js.
No third-party packages, no web server, no `package.json`. Designed for Android **Termux** and desktop systems.

## Features

| # | Tool | What it does |
|---|------|--------------|
| 1 | **IP Show** | Local interfaces/addresses and (optionally) your public IPv4/IPv6 via ipify.org |
| 2 | **IP Info** | Validates an IPv4/IPv6 address, classifies it (private, public, loopback, link-local, multicast, reserved), reverse DNS |
| 3 | **LinkShield** | URL security analyzer: hostname tricks, punycode, IP hosts, ports, encoding, redirects, HTTPS |
| 4 | **HeaderGuard** | Checks CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options |
| 5 | **PassCheck** | Offline password strength estimate (hidden input, never stored or sent) |
| 6 | **FileSentinel** | SHA-256 of a local file with optional expected-hash comparison (read-only) |
| 7 | **DNSLens / NetWatch** | A / AAAA / CNAME lookups with timing, plus read-only local network info |
| 8 | **Fake Website Checker** | Lookalike/phishing indicators with verdict: LIKELY LEGITIMATE, SUSPICIOUS, HIGH RISK, INSUFFICIENT EVIDENCE |
| 9 | **Local Request Tester** | Rate-limited GET tester for **loopback servers only** |

## Requirements

- Node.js **18 or newer** (uses built-in `fetch`).
- Nothing else. No npm install.

## Termux installation

```sh
pkg update && pkg install nodejs 
git clone https://github.com/UG-ALOK/ALOK-SHIELD-X.git
cd ALOK-SHIELD-X
sh install.sh
node main.js
```

Desktop (Linux/macOS/WSL): install Node.js 18+, extract the ZIP, run `sh install.sh`, then `node main.js`.

`install.sh` only checks your environment (Node present and ≥ 18, `main.js` exists, syntax OK) and sets the executable bit. It does not install packages, change system settings, or need root.

## Usage

Run `node main.js`, type a number, press Enter. After each tool you return to the menu. **Ctrl+C** cancels the running tool (and exits when at the menu). Pressing Enter on an empty prompt goes back.

### Examples

- **IP Info:** `2` → `192.168.1.5` → PRIVATE, RFC 1918. Try `2001:db8::1` or `8.8.8.8`.
- **LinkShield:** `3` → `https://paypa1-secure.example.xyz/login` → lists each indicator and a heuristic risk.
- **HeaderGuard:** `4` → `https://yoursite.example` → confirm you own/are authorized → header report.
- **FileSentinel:** `6` → `~/storage/downloads/app.zip` → paste the publisher's SHA-256 to compare. (Run `termux-setup-storage` once for shared storage access.)
- **Local Request Tester:** start your dev server, then `9` → `http://127.0.0.1:3000/` → count (default 2000) → rate → timeout → type `YES`.

### Local Request Tester limits

- Targets: `http://` and loopback only (`localhost`, `127.0.0.0/8`, `::1`). Hostnames must resolve **only** to loopback; the connection is pinned to the resolved loopback IP, so DNS changes cannot redirect it. Redirects are **never followed**.
- Count: default 2000, hard maximum 100,000 per run. Concurrency: fixed at 1.
- Rate: default 20 req/s, maximum 50 req/s. Timeout: default 5 s, range 1–30 s.
- Explicit `YES` confirmation required; Ctrl+C stops immediately; stops early after 25 consecutive failures.
- Because the connection uses the IP literal, the `Host` header will be the IP (e.g. `127.0.0.1:3000`), not `localhost`.

### Optional reputation check (Fake Website Checker)

Off by default. To enable, export a Google Safe Browsing API key in your shell (never put keys in source code):

```sh
export UGALOK_GSB_KEY="your-key"
```

You are asked each time before the full URL is sent to Google. This path requires a real API key and Internet access, and was not exercised in the packaged test run.

## Privacy

- Passwords never leave the process, are not printed, logged or saved.
- Network features say what they contact (ipify.org, the site you enter, your DNS resolver, optionally Safe Browsing) and ask first where your IP or URL is shared.
- No telemetry, no files written, no stored data.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Node.js 18 or newer` error | Termux: `pkg upgrade nodejs`; elsewhere install from nodejs.org |
| Interface list unavailable | Some Android versions restrict `os.networkInterfaces()`; the tool reports this and continues |
| DNS "direct queries failed" but system lookup works | Node's built-in resolver can't find DNS servers on some Termux setups; system lookup is shown separately |
| Public IP unavailable | No Internet, a firewall blocks ipify.org, or no IPv6 (normal) |
| `Connection refused` in Request Tester | Nothing is listening on that port; start your server first |
| Box characters look odd | Use a UTF-8 terminal font; set `NO_COLOR=1` to disable colors |

## Known limitations

- All risk results are **heuristics**. A clean result never guarantees a site is safe; a flagged result is not proof of fraud. HTTPS does not prove legitimacy.
- Registered-domain detection is approximate (no full Public Suffix List). The brand list is small.
- HeaderGuard reviews headers only. A missing header is a hardening gap, not proof of a vulnerability.
- PassCheck gives an estimate with a small built-in pattern list; it cannot know breach data.
- IP Info cannot determine location, owner or identity. IPv6 "public" means a globally routable range, nothing more.
- Request Tester measures a local server; it is not a load-generation or stress tool.
- Not an exploit, scanner, or network-discovery tool. No network-wide scanning is performed.

## Responsible use
🙏 **Disclaimer**
**Use these tools only on devices, networks, files and websites that you own or are explicitly authorized to test. The developer provides no warranty and is not responsible for misuse. Results are informational and do not replace professional security review**

**Developer: UG ALOK**
