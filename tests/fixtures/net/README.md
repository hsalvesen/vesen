# Recorded network fixtures

Response bodies for the tests of the network commands in `src/commands/more/network` (dig, host, nslookup, ping, ip, ifconfig, whois, wget and git), served by `serveNet` in `tests/support/net.ts`, so no test touches the network. Captured on 2026-10-07 at about 21:40 Sydney time (10:40 UTC) with curl.

| File | Request | Notes |
|---|---|---|
| `doh.json` | `GET https://cloudflare-dns.com/dns-query?name=NAME&type=TYPE` with `accept: application/dns-json`, and `GET https://dns.google/resolve?name=NAME&type=TYPE` | One body per question, keyed `<host> <name> <TYPE>`. Cloudflare writes names without a trailing dot and quotes TXT strings; Google writes the dot and leaves TXT strings bare. Includes an NXDOMAIN (`nosuchname-vesen-test.com`), a SERVFAIL with Cloudflare's extended error (`dnssec-failed.org`), a CNAME (`www.github.com`), a NODATA answer (`vesen.app AAAA`), the root's name servers and what both resolvers say about `localhost` (NXDOMAIN, which is why the commands answer it themselves). `example.com ANY` was captured on 2026-10-08: Cloudflare answers NOTIMP with extended error 21 (Not Supported), Google the RFC 8482 HINFO stand-in. |
| `rdap-example.com.json` | `GET https://rdap.org/domain/example.com`, which redirects (302) to `https://rdap.verisign.com/com/v1/domain/example.com` | The registry's answer. Both hops send `access-control-allow-origin: *`. |
| `rdap-vesen.app.json` | `GET https://rdap.org/domain/vesen.app`, which redirects to `https://pubapi.registry.google/rdap/domain/vesen.app` | |
| `rdap-no-service.json` | `GET https://rdap.org/domain/example.es` | rdap.org's own 404 for a TLD with no RDAP service. A registry's 404 for a domain it does not have (`nosuchname-vesen-test.com`) has an empty body, so it has no file. |
| `cloudflare-trace.txt` | `GET https://www.cloudflare.com/cdn-cgi/trace` | Shape as captured; `ip` is replaced with a documentation address (203.0.113.7) and `uag` with an iPhone's Instagram user agent. |
| `github-commits.json` | `GET https://api.github.com/repos/hsalvesen/vesen/commits?per_page=10` with `Accept: application/vnd.github+json` | Trimmed to the fields the command reads (`sha`, the commit's author, committer and message, `html_url`, `parents`), with every e-mail address replaced by `owner@example.com`. |

Every other body is exactly as captured.
