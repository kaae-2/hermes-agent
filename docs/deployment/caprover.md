# Deploying Hermes Agent on CapRover

This guide describes a secure baseline for running Hermes Agent on a VPS with
CapRover. The recommended operating mode for this deployment is: briefly expose
the authenticated dashboard for setup, then disable it and administer Hermes over
SSH with `docker exec`.

Hermes Agent is a terminal-capable personal agent. Treat dashboard or API access
as admin-equivalent access to the container's `/opt/data` volume and to any
tools, credentials, skills, plugins, or messaging platforms configured there.

## Files in this repo

- `captain-definition` builds this repository's `Dockerfile` and exposes port
  `9119`.
- `.env.caprover.example` lists the CapRover environment variables to set in the
  app UI.
- This document captures the operational tradeoffs and hardening checklist.

## CapRover app settings

Use these settings in CapRover:

- Container HTTP Port: `9119`
- Persistent app: enabled
- Instance count: `1`
- Persistent directory: mount a persistent volume at `/opt/data`
- HTTPS: enabled through CapRover
- Do not enable privileged mode
- Do not mount `/var/run/docker.sock`
- Do not publish an extra `8642` port unless the API server is intentionally enabled

Because the base Dockerfile keeps the generic image default (`hermes`) for
normal Docker users, set this CapRover **Service Update Override** so the app
runs the gateway process:

```yaml
TaskTemplate:
  ContainerSpec:
    Args:
      - gateway
      - run
```

If this override is missing, the container starts the default interactive Hermes
CLI instead of the long-running gateway and the app may exit or never serve the
dashboard.

The `/opt/data` volume holds `config.yaml`, `.env`, auth state, sessions,
memories, skills, plugins, logs, and dashboard uploads. Losing it means losing
the agent's configuration and state.

## Chosen operating mode

Use the dashboard as a temporary setup surface, then close it:

1. Deploy with `HERMES_DASHBOARD=1` and a real dashboard auth provider.
2. Finish setup through the dashboard or with SSH commands.
3. Set `HERMES_DASHBOARD=0` in CapRover and redeploy/restart.
4. Use `docker exec -it <container> hermes ...` for future changes.

When closed, the gateway can keep running and all configuration remains in
`/opt/data`. The CapRover HTTP route may show 502 while the dashboard is off;
that is expected because nothing is listening on port `9119`.

## Required dashboard authentication

CapRover exposes the app over the network, so the dashboard must have an auth
provider. Current Hermes code fails closed on non-loopback dashboard binds when
no provider is registered. `HERMES_DASHBOARD_INSECURE` and `--insecure` no
longer bypass the auth gate.

Preferred public options:

- Nous Portal OAuth: set `HERMES_DASHBOARD_OAUTH_CLIENT_ID` and
  `HERMES_DASHBOARD_PUBLIC_URL`.
- Self-hosted OIDC: set the OIDC issuer/client env vars documented by the web
  dashboard auth docs.

Basic auth is technically supported, but should be used only behind VPN,
Tailscale, or a trusted LAN. If using it, prefer
`HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH` over plaintext password and set a
stable `HERMES_DASHBOARD_BASIC_AUTH_SECRET` so sessions survive restarts.

## Setup options and tradeoffs

### Option A: Public dashboard for setup, then leave it on

Use this when you want the web UI, remote Desktop connection, profile switching,
and browser-based setup after the first deploy.

Pros:

- Easiest initial setup.
- Works well with CapRover HTTPS and OAuth/OIDC.
- Gives ongoing access to dashboard tools, config, sessions, and profile UI.

Cons:

- Largest public attack surface.
- Requires continuous auth provider maintenance.
- Anyone who authenticates can drive powerful agent/admin functionality.

Baseline env:

```sh
HERMES_DASHBOARD=1
HERMES_DASHBOARD_HOST=0.0.0.0
HERMES_DASHBOARD_PORT=9119
HERMES_DASHBOARD_PUBLIC_URL=https://hermes.example.com
HERMES_DASHBOARD_OAUTH_CLIENT_ID=agent:REPLACE_ME
```

### Option B: Public dashboard only for setup, then disable it

Use this when you want the dashboard for first-time configuration but do not
need a permanent browser UI.

This is the recommended mode for the baseline VPS deployment.

Pros:

- Smaller long-term public surface.
- Configuration persists in `/opt/data` after the dashboard is disabled.
- Gateway integrations can keep running without a dashboard listener.

Cons:

- The CapRover public route will return 502/connection-refused while the
  dashboard is disabled.
- Further config changes require SSH/docker exec or temporarily re-enabling the
  dashboard.
- Remote Desktop/web-dashboard features are unavailable while disabled.

To disable after setup, set this in CapRover and redeploy/restart:

```sh
HERMES_DASHBOARD=0
```

To re-open for maintenance, set `HERMES_DASHBOARD=1` again and redeploy. Keep
the auth provider configured even for temporary exposure.

### Option C: Keep dashboard closed and configure over SSH

Use this when the VPS is administered only by SSH and no browser UI is needed.

Pros:

- Smallest public HTTP surface. You can keep the CapRover route disabled or
  unreachable.
- Avoids exposing dashboard admin functions to the internet.
- Works well for single-operator servers.

Cons:

- Setup is less convenient.
- Requires SSH access and TTY-capable commands.
- OAuth/device flows may require copying URLs/codes between terminal and browser.

Typical commands:

```sh
ssh user@server
docker exec -it <container> hermes setup
docker exec -it <container> hermes setup --portal
docker exec -it <container> hermes auth add nous --no-browser
```

For dashboard OAuth registration without using the dashboard UI:

```sh
docker exec -it <container> hermes dashboard register \
  --redirect-uri https://hermes.example.com/auth/callback
```

## Model setup

Set provider credentials as CapRover environment variables. For OpenRouter:

```sh
OPENROUTER_API_KEY=sk-or-...
```

The selected main model is stored in `/opt/data/config.yaml`, because the image
sets `HERMES_HOME=/opt/data`. Do not use `LLM_MODEL`; Hermes no longer reads it.

To set the main model from Discord, message the bot:

```text
/model anthropic/claude-sonnet-4.6 --provider openrouter --global
/new
```

To set the main model over SSH without keeping the dashboard open:

```sh
docker exec -it <container> hermes config set model.provider openrouter
docker exec -it <container> hermes config set model.default anthropic/claude-sonnet-4.6
docker exec -it <container> hermes config set model.base_url ""
docker exec -it <container> hermes config set model.api_mode chat_completions
```

Equivalent direct config:

```yaml
model:
  provider: openrouter
  default: anthropic/claude-sonnet-4.6
  base_url: ''
  api_mode: chat_completions
```

Model changes apply to new sessions. Existing gateway conversations keep the
model they started with unless you switch them in-session with `/model`.

## Discord gateway

For a Discord-only deployment, keep global access closed and set explicit
Discord allowlists in CapRover:

```sh
GATEWAY_ALLOW_ALL_USERS=false
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=123456789012345678
```

`DISCORD_ALLOWED_ROLES` can be used alongside `DISCORD_ALLOWED_USERS`; access is
allowed if either allowlist matches. Without `DISCORD_ALLOWED_USERS` or
`DISCORD_ALLOWED_ROLES`, Discord users are denied by default.

## API server posture

Keep the OpenAI-compatible API server off unless needed:

```sh
API_SERVER_ENABLED=false
```

If enabled, it can dispatch terminal-capable agent work. That is an
authenticated remote-code-execution surface by design. Use a strong key and
network restrictions:

```sh
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=<openssl rand -hex 32>
API_SERVER_CORS_ORIGINS=https://exact-client.example.com
```

Do not use `API_SERVER_CORS_ORIGINS=*` for production.

## Recommended production config

After setup, put these in `/opt/data/config.yaml` using the dashboard or
`docker exec -it <container> hermes config edit`:

```yaml
security:
  allow_lazy_installs: false
  allow_private_urls: false
  redact_secrets: true

browser:
  allow_private_urls: false

approvals:
  mode: manual
  cron_mode: deny

memory:
  write_approval: true

skills:
  write_approval: true

delegation:
  subagent_auto_approve: false

gateway:
  api_server:
    max_concurrent_runs: 2

tool_loop_guardrails:
  hard_stop_enabled: true
  hard_stop_after:
    exact_failure: 5
    idempotent_no_progress: 5
```

## Network and container hardening

- Keep CapRover instance count at `1`; Hermes state is single-tenant and stored
  on one `/opt/data` volume.
- Do not run privileged.
- Do not mount the host Docker socket. The image includes `docker-cli`, and a
  mounted Docker socket is host-root-equivalent.
- Keep only `/opt/data` mounted persistently.
- Use CapRover resource limits appropriate to the VPS. Start with 2 CPUs and
  2-4 GB RAM if browser automation may be used.
- Prefer exact image tags or digests over `latest` for controlled production
  upgrades.
- Consider VPS firewall or VPN restrictions in front of CapRover for dashboard
  access, especially if using basic auth.

## Validation

After deploying with the dashboard enabled and auth configured:

```sh
curl -s https://hermes.example.com/api/status
```

Expected signals:

- `auth_required` is `true` for public/non-loopback deployments.
- `auth_providers` lists the configured provider.
- Protected routes redirect to login or return unauthorized before login.

If `HERMES_DASHBOARD=0`, the dashboard port will not listen and the CapRover
route may show a 502. That is expected for the closed-dashboard operating mode.
