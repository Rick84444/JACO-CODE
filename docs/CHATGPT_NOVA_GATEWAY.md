# JACO ChatGPT/Nova Gateway v1

## Purpose

Expose a narrow authenticated HTTPS API that ChatGPT Actions, Plugins, MCP adapters, or other agents can call while keeping `agents/nova-bridge.mjs` loopback-only.

```text
ChatGPT / Plugin / agent
        |
        | HTTPS + Bearer token
        v
JACO Gateway :4250
        |
        | loopback HTTP
        v
Nova Bridge :4243
        |
        v
Chrome CDP :9222
```

## Security boundary

Do **not** publish Nova Bridge (`:4243`) directly to the Internet. Publish only the gateway.

The gateway defaults to:

- bearer authentication required for all `/v1/*` routes
- mutations disabled
- navigation denied unless a hostname allow-list is configured
- request body limit
- upstream timeout
- per-request receipt ID

## Environment

```bash
export JACO_GATEWAY_TOKEN='replace-with-a-long-random-secret'
export JACO_GATEWAY_HOST='127.0.0.1'
export JACO_GATEWAY_PORT='4250'
export JACO_NOVA_URL='http://127.0.0.1:4243'

# Explicit opt-in for navigate/click/type
export JACO_GATEWAY_ALLOW_MUTATIONS='1'

# Comma-separated exact hostnames. Use * only for a deliberately unrestricted local operator setup.
export JACO_GATEWAY_ALLOWED_HOSTS='example.com,docs.example.com'
```

Start:

```bash
node gateway/src/chatgpt-nova-gateway.mjs
```

## Public HTTPS

Place Cloudflare Tunnel, another authenticated reverse proxy, or an equivalent HTTPS ingress in front of `127.0.0.1:4250`.

The desired topology is:

```text
public HTTPS hostname
        |
        v
Cloudflare / reverse proxy
        |
        v
127.0.0.1:4250 Gateway
        |
        v
127.0.0.1:4243 Nova
```

Do not point the tunnel at `4243` or Chrome `9222`.

## OpenAPI

`gateway/openapi/jaco-nova-action.yaml` contains the Action/API contract. Replace:

```text
https://YOUR_PUBLIC_JACO_DOMAIN
```

with the actual HTTPS hostname before importing the schema.

Authentication is Bearer token. Configure the same secret as `JACO_GATEWAY_TOKEN`.

## Routes

Read-only:

- `GET /health`
- `GET /v1/nova/observe`
- `GET /v1/nova/targets`
- `POST /v1/nova/survey`

Consequential/mutating and disabled by default:

- `POST /v1/nova/navigate`
- `POST /v1/nova/click`
- `POST /v1/nova/type`

## Truth boundary

This branch implements the HTTP ingress contract and policy layer. It does **not** prove Internet reachability, ChatGPT-to-gateway execution, Cloudflare configuration, or end-to-end CDP execution on a physical machine. Those require runtime verification on the target host.

## Next integration

The gateway should become one ingress adapter into the future authoritative JACO Gateway rather than a second mission owner:

```text
ChatGPT / Plugin / MCP / A2A
          |
          v
      JACO Gateway
          |
          v
      mission auth
          |
          v
      NEO / Nova
          |
          v
     CDP / UIA / Android
          |
          v
        Verifier
```
