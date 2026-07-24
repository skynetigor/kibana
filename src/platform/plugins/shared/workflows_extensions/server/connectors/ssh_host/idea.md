# SSH Host Connector — Concept & Differentiation

## What colleagues are building (sandbox)

A sandbox is an *isolated, disposable, controlled environment* — the host itself is the product.
You spin it up, do something, tear it down. The value is the isolation and ephemerality.
It's infrastructure-as-a-feature.

## What this connector is

A *bridge to existing infrastructure*. The host already exists and has a purpose — it's a
production VM, a CI node, a developer's laptop, a Docker container running a real service.
The connector is the integration layer. The value is reach and orchestration, not isolation.

## Use-cases

- **Remote orchestration** — trigger restarts, deploys, config changes on live hosts without
  building a dedicated API
- **Task execution without an agent** — run a one-off job on a host that doesn't have any
  Elastic agent installed, just SSH
- **Administration workflows** — rotate certs, clean up disk, patch configs, across many hosts
  in sequence or parallel
- **Monitoring/remediation** — a workflow detects something wrong, SSHes into the affected host
  and self-heals
- **Dev/CI integration** — kick off a build, run tests, collect artifacts back into the workflow
  output

## Key distinction

**Sandbox assumes you own and control the environment being connected to.**
**This connector assumes the environment already exists and has a purpose outside of Elastic.**

That's a completely different integration story.

## n8n comparison

n8n has a built-in SSH node (`n8n-nodes-base.ssh`) — so this space is validated by an
established workflow automation platform.

**What n8n supports:**
- Execute a shell command on the remote host
- Download a file from the remote host (returned as binary data in the workflow)
- Upload a file to the remote host
- Auth: password or private key (pasted into credential store)
- Any SSH-accessible host: Linux, macOS, Windows

**n8n's limitations:**
- No passphrase support for encrypted private keys (open issue since 2021)
- No async / long-running command support — each node call is a single blocking SSH exec
- No file content returned inline — files come back as binary blobs, not structured data
- No dynamic file output — caller must know exactly which file to retrieve
- No script isolation or working directory management per command
- Three hardcoded operations only; no extensible sub-action model

**Where our connector goes further:**
- Async execution with polling — long-running scripts don't block the workflow
- Dynamic file return — the connector scans the working directory and returns all output files
  automatically; no need to name them upfront
- Structured output — JS step writes JSON; connector decodes and returns it as typed workflow data
- Cancel/kill support — workflows can abort a running script cleanly
- Node.js script execution — not just bash; full JS runtime on the remote host
- ControlMaster SSH multiplexing — reuses the TCP connection across calls for speed

**Conclusion:** n8n proves the SSH-to-host pattern is a real and wanted workflow primitive.
Our implementation is meaningfully more capable for automation use-cases that involve
long-running tasks, structured output, and script-level orchestration.

## Tines comparison

Tines has **no native SSH action**. Its seven built-in action types are: Webhook, HTTP Request,
Event Transform, Trigger, Send to Story, Receive Email (IMAP), and Email.

**Workarounds they document:**
- **Ansible Tower** — Tines calls the Ansible REST API, Ansible does the SSH. This is their
  officially recommended path and even has a story template in their library.
- **Run Script action** — executes Python in AWS Lambda; you can use `paramiko` to SSH from
  there, but the Lambda network context makes reaching private/on-prem hosts difficult.
- **CoHTTP container** (paid) — a self-hosted container that can run Bash/Python scripts with
  SSH credentials; adds operational overhead.

**Limitations:**
- No credential type for SSH private keys — keys must be stored as generic secret text
- Run Script is sandboxed in AWS Lambda — unreachable from private networks without extra setup
- CoHTTP is a paid, self-hosted add-on
- No async execution, no structured output, no file return

**Conclusion:** Tines treats SSH as an afterthought, routing it through Ansible or workaround
scripts. There is no direct, first-class path to "run a command on a remote host."

---

## Datadog Workflow Automation comparison

Datadog also has **no native SSH workflow action**. Their SSH integration is monitoring-only
(checks connectivity, measures SFTP response time — cannot execute commands).

**Closest equivalent:**
- **Private Action Runner** — a Docker/Helm container you deploy in your own network, paired
  with a Script action. Scripts must be pre-approved/allowlisted by an admin; arbitrary
  user-supplied commands are not allowed.
- **AWS SSM / Azure Run Command** — first-class actions in their catalog for cloud VMs, but
  these are vendor-specific and require SSM/Azure agent on the target.
- **Kubernetes exec** — available natively, but scoped to K8s pods only.

**Limitations:**
- No SSH-native action at all — SSH must be scripted inside the runner
- Scripts must be pre-defined and admin-allowlisted (no dynamic scripts)
- Containerized runners cannot run privileged commands; only agent-based runners can
- SSH client binary requires the `-large` runner image (not the default)
- Runner must be deployed and maintained in your own infrastructure

**Conclusion:** Datadog's path to remote execution requires deploying and operating their Private
Action Runner inside your network — significant infrastructure overhead compared to a credential
and an IP address.

---

## GitHub Actions comparison

GitHub Actions has **no first-party SSH action**. All SSH functionality comes from community
Marketplace actions.

**Dominant community action: `appleboy/ssh-action`** (~4,500+ stars, used by tens of thousands
of repos). It runs shell commands on remote hosts via SSH, with multi-host fan-out support.
A companion `appleboy/scp-action` handles file uploads (remote → runner download is not
supported natively and requires raw `scp` in a `run:` step).

**Authentication:** SSH private key or password stored in GitHub Secrets; passphrase support;
host fingerprint verification.

**Limitations:**
- **Blocking only** — every command waits for the remote shell to exit before the step
  completes; background commands with `&` cause the step to hang and time out
- **No async execution** — long-running remote tasks are a well-documented open issue (#40, #93)
- **No structured output** — stdout capture returns raw text only; no JSON, no stderr as a
  separate variable
- **stdout + exit code bug** — if a command exits non-zero with `capture_stdout: true`, the
  output variable is not populated (#375)
- **No file download** — no native action for pulling files from the remote back to the runner
- **Fresh session per step** — no persistent or reused SSH connection across steps

**Conclusion:** GitHub Actions has the most polished community SSH story of the group, but it
is still fundamentally limited to blocking, fire-and-forget command execution with no structured
return values and no async support.

---

## Overall market conclusion

| Platform        | Native SSH action | Async execution | Structured output | File return | Dynamic scripts |
|-----------------|:-----------------:|:---------------:|:-----------------:|:-----------:|:---------------:|
| **n8n**         | Yes (built-in)    | No              | No                | Binary blob | No              |
| **Tines**       | No (Ansible proxy)| No              | No                | No          | No (admin-gated)|
| **Datadog**     | No (runner+script)| No              | No                | No          | No (admin-gated)|
| **GitHub Actions** | No (community) | No              | No (raw text)     | No          | Yes             |
| **Our connector** | Yes (built-in) | **Yes**         | **Yes (JSON)**    | **Yes (auto)**| **Yes**       |

Every major platform either lacks SSH entirely or has a minimal blocking implementation.
Our connector is the only one with async execution, automatic file collection, and typed
structured output — making it genuinely useful for long-running automation, not just
one-liners.

## Step design

Steps are split into two namespaces by intent:

- `code.*` — sandboxed, no connector required, safe, limited runtime
- `remoteHost.*` — runs on a real host via SSH Host connector, full power, explicit dependency

This separation eliminates the current ambiguity where `code.bash` silently does two different
things depending on whether `connectorId` is set.

### Proposed `remoteHost` steps

| Step ID | Description |
|---|---|
| `remoteHost.runCommand` | Execute a raw shell command on the remote host (host's default shell) |
| `remoteHost.runJavascript` | Execute a Node.js script — requires Node.js pre-installed on the host |
| `remoteHost.runPython` | Execute a Python script — requires Python pre-installed on the host |
| `remoteHost.uploadFile` | Upload a file from the workflow to the remote host |
| `remoteHost.downloadFile` | Download a file from the remote host into the workflow |

`runJavascript` and `runPython` get language-specific syntax highlighting and validation in the
editor. Runtime pre-installation requirements are documented in each step's description.

### Note on `runCommand` and shell ambiguity

Currently `runCommand` targets Linux/macOS (bash). If Windows support is added later,
`runCommand` becomes ambiguous — the right path at that point is explicit steps:
`runBash`, `runPowerShell`, etc. For now `runCommand` is sufficient.
