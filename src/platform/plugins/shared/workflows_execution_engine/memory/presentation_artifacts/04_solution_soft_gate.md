# Solution B: Soft-Gated Triggers (Datadog model)

## Principle

**You don't call a workflow -- you call a trigger of a workflow.**

Every trigger defines its event contract. Manual invocation means selecting which trigger to invoke and providing data matching that trigger's schema. The system validates the data and injects it into `event`. Workflow steps work unchanged regardless of whether the trigger fired automatically or was invoked manually.

No separate `manual` trigger is needed to invoke existing triggers manually -- any trigger can be invoked manually by providing data matching its schema. The `manual` trigger serves a different purpose: it lets the user **define their own event shape** for callers (humans, agents, API consumers) that doesn't correspond to any system-defined trigger type.

This is how Datadog Workflows work: any workflow can be run from its page by filling in trigger variables.

---

## How it changes the workflow model

### Current behavior

```
Call workflow  ──>  { inputs: Record<string, any> }  ──>  No validation, trigger ignored
```

### Proposed behavior

```
Call trigger of workflow  ──>  Data validated against trigger's event schema  ──>  Injected into event
```

Specifically:

```
Invoke alert trigger manually    ──>  Provide alert-shaped data    ──>  Validated, lands in event.alerts
Invoke scheduled trigger manually  ──>  Provide schedule context    ──>  Validated, lands in event
Invoke custom trigger manually   ──>  Provide trigger's event data ──>  Validated, lands in event
Invoke manual trigger            ──>  Provide custom-shaped data   ──>  Validated, lands in event
Alert connector fires            ──>  System provides alert data   ──>  Lands in event.alerts (same path)
Task Manager fires               ──>  System provides schedule data ──>  Lands in event (same path)
```

---

## The two layers

### Layer 1: Invoke any trigger manually (always available from workflow page)

When a user clicks "Run" on any workflow page, the system:

1. Shows the list of defined triggers
2. User selects which trigger to invoke
3. System renders input fields derived from that trigger's event contract
4. System validates the provided data against the trigger's schema
5. Data is injected into `event`
6. Execution starts -- steps work unchanged

This is NOT "calling a workflow with arbitrary data." This is "invoking a specific trigger with properly shaped data."

### Layer 2: Contextual visibility gating

Triggers determine where a workflow appears as an option throughout the product:

| Context in product | Required trigger | Effect |
|---|---|---|
| Rule actions dropdown | `alert` | Only workflows with alert trigger appear |
| Case automation settings | `cases.updated` / `cases.created` | Only matching workflows appear |
| Agent Builder tool list | `manual` (with event schema) | Only workflows with manual trigger appear |
| API invocation | Any trigger (caller specifies which) | Validates against selected trigger's schema |
| Scheduled execution | `scheduled` | Task Manager only registers for these |
| Security panel "Run Workflow" | `alert` or `manual` | Only relevant workflows appear |

---

## Key design principle: all triggers produce events

Every trigger -- alert, scheduled, custom, manual -- produces an `event` in the execution context. The difference is only **who provides the data**:

- **Alert trigger (automatic):** System constructs `event` from the alert connector
- **Alert trigger (manual invocation):** Caller provides alert-shaped data, system validates and injects into `event`
- **Scheduled trigger (automatic):** System constructs `event` from task manager
- **Custom trigger (automatic):** System constructs `event` from the emitted payload
- **Manual trigger:** Caller provides custom-shaped data, system validates and injects into `event`

The execution context looks identical regardless of how the trigger was invoked. `execution.triggeredBy` distinguishes automatic vs manual invocation.

---

## Example: Alert-only workflow

```yaml
name: Restart Payment API on OOM
enabled: true
triggers:
  - type: alert
    with:
      rule_name: "OOM in Payment API"

consts:
  k8s_namespace: production
  k8s_deployment: payment-api-deployment

steps:
  - name: restart_service
    type: http
    with:
      url: "https://k8s-api.internal/apis/apps/v1/namespaces/{{ consts.k8s_namespace }}/deployments/{{ consts.k8s_deployment }}"
      method: PATCH
      headers:
        Content-Type: application/strategic-merge-patch+json
      body:
        spec:
          template:
            metadata:
              annotations:
                restart-trigger: "{{ now }}"

  - name: notify_team
    type: slack
    connector-id: payments-team
    with:
      message: |
        :warning: *Payment API Restarted*
        Reason: {{ event.rule.name }}
        Triggered by: {{ execution.triggeredBy }}
```

**Behavior in the product:**
- Appears in Rule actions dropdown (has alert trigger)
- Does NOT appear in Agent Builder tool list (no manual trigger)
- CAN be run from workflow page: user selects "alert" trigger, system presents alert-shaped input form, data lands in `event`
- Steps reference `event.rule.name` -- works whether alert fired automatically or was invoked manually

---

## Example: Workflow page "Run" experience

When a user opens the workflow page for "Restart Payment API on OOM" and clicks "Run":

```
┌──────────────────────────────────────────────────┐
│  Run Workflow: Restart Payment API on OOM         │
│                                                   │
│  Select trigger to invoke:                        │
│  ┌──────────────────────────────────────────┐     │
│  │ ● Alert trigger                          │     │
│  │   (rule: OOM in Payment API)             │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
│  Provide alert event data:                        │
│                                                   │
│  Rule name:    [ OOM in Payment API       ]       │
│  Alert host:   [ payment-api-prod-01      ]       │
│  Agent ID:     [ abc-123-def-456          ]       │
│  Timestamp:    [ 2025-03-13T10:00:00Z     ]       │
│                                                   │
│              [ Cancel ]  [ Run ]                  │
└──────────────────────────────────────────────────┘
```

The system derives the form from the alert trigger's event schema. The caller provides alert-shaped data, the system validates it and injects it into `event`. The workflow runs with a properly shaped event -- identical to when a real alert fires.

---

## When do you need a `manual` trigger?

The `manual` trigger is for workflows that need a **custom event shape** not covered by any other trigger:

```yaml
name: Enrich and escalate alert
enabled: true
triggers:
  - type: manual
    event:
      properties:
        alert_id:
          type: string
          description: "The alert ID to investigate"
        priority:
          type: string
          description: "Escalation priority"
          enum: [low, medium, high, critical]
      required:
        - alert_id
        - priority

steps:
  - name: fetch_alert
    type: elasticsearch.request
    with:
      method: GET
      path: /.alerts-security.alerts-default/_doc/{{ event.alert_id }}

  - name: create_case
    type: kibana.request
    with:
      request:
        method: POST
        path: /api/cases
        body:
          title: "[{{ event.priority | upcase }}] Escalated: {{ steps.fetch_alert.output._source.kibana.alert.rule.name }}"
          severity: "{{ event.priority }}"
```

This workflow doesn't react to alerts or cases -- it has its own custom input shape. The `manual` trigger defines that shape. It appears in the Agent Builder tool list, and the agent sees a clear contract: provide `alert_id` and `priority`.

### Predefined shapes for manual triggers

When a manual trigger needs an event shape that matches an existing trigger type, use a predefined shape instead of writing JSON Schema:

```yaml
triggers:
  - type: manual
    event:
      shape: alert    # caller provides alert-shaped data -> lands in event.alerts, event.rule, etc.
```

```yaml
triggers:
  - type: manual
    event:
      shape: case     # caller provides case-shaped data -> lands in event.case, event.user, etc.
```

---

## Example: Workflow with alert trigger + manual trigger (different shapes)

```yaml
name: Block malicious IP
enabled: true
triggers:
  - type: alert
  - type: manual
    event:
      shape: alert    # manual callers provide alert-shaped data -> same event as alert trigger

steps:
  - name: block_ip
    type: http
    with:
      url: "https://firewall.internal/api/v1/rules"
      method: POST
      body:
        action: block
        source: "{{ event.alerts[0]._source.source.ip }}"
        comment: "Blocked due to {{ event.rule.name }}"
        ttl: 86400

  - name: notify_soc
    type: slack
    connector-id: soc-alerts
    with:
      message: |
        :no_entry: *IP Blocked*
        IP: {{ event.alerts[0]._source.source.ip }}
        Rule: {{ event.rule.name }}
        Triggered by: {{ execution.triggeredBy }}
```

**Behavior:**
- Alert connector fires -> system provides event -> steps run
- Agent calls manual trigger -> provides alert-shaped data -> validated -> injected into event -> same steps run
- From workflow page -> user selects either "alert" or "manual" trigger -> provides data -> steps run
- No normalization boilerplate needed

---

## Comparison: Hard gate vs Soft gate

| Aspect | Hard gate (Solution A) | Soft gate (Solution B) |
|---|---|---|
| Mental model | "Call a trigger of a workflow" (manual trigger required for manual invocation) | "Call a trigger of a workflow" (any trigger can be invoked manually) |
| Manual run from workflow page | Blocked without manual trigger | Always available -- invoke any trigger |
| API invocation | Blocked without manual trigger | Specify which trigger to invoke; validated |
| Agent Builder access | Needs manual trigger | Needs manual trigger (for custom shapes) |
| Rule actions visibility | Needs alert trigger | Needs alert trigger |
| Test runs | Always available (separate endpoint) | Not needed -- invoke any trigger manually |
| User friction | Higher -- must add manual trigger | Lower -- any trigger is manually invocable |
| Safety | Highest -- nothing runs without explicit opt-in | High -- all invocations validated against trigger schema |
| Industry precedent | GitHub Actions, n8n | Datadog |

---

## What changes in the system

| Component | Change |
|---|---|
| `ManualTriggerSchema` | Add `event` field (JSON Schema or predefined shape reference) |
| All trigger schemas | Define implied event shape (alert trigger implies alerts, rule, etc.) |
| `POST /api/workflows/{id}/run` | Accept `{ trigger: "alert", event: {...} }` -- validate against selected trigger's schema; inject into `event` |
| UI - workflow page "Run" | Show trigger selector; render trigger-specific event form; inject into `event` |
| UI - Rule actions dropdown | Filter to workflows with alert trigger |
| UI - Case automation | Filter to workflows with case triggers |
| Agent Builder integration | Only list workflows with manual trigger; expose event schema as tool contract |
| Execution engine | Validate trigger type + event data shape before execution |
