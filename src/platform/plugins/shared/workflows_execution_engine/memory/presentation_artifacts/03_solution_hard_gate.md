# Solution A: Hard-Gated Triggers (GitHub Actions / n8n model)

## Principle

**You don't call a workflow -- you call a trigger of a workflow. No trigger declaration = no invocation of that type.**

Each trigger is an enforced contract that defines an invocation channel and an event shape. The caller always specifies which trigger to invoke and provides data matching that trigger's schema. If a workflow does not declare a trigger for a given invocation channel, that channel is closed. Test runs (flagged with `isTestRun: true`) are the only exception.

The difference from the soft-gate model: in the hard-gate model, a `manual` trigger is required to enable manual invocation. Without it, the workflow can only be invoked by its declared triggers (alert connector, task manager, event bus). You cannot manually invoke an alert trigger -- you need an explicit `manual` trigger to opt in.

This is how GitHub Actions (`workflow_dispatch`) and n8n (Manual Trigger node) work.

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
Invoke manual trigger          ──>  Provide data matching manual trigger's schema  ──>  Validated, lands in event
Alert connector fires          ──>  System provides alert data                     ──>  Lands in event.alerts
Task Manager fires             ──>  System provides schedule data                  ──>  Lands in event
Event bus fires custom trigger ──>  System provides event payload                  ──>  Lands in event
No manual trigger declared     ──>  POST /api/workflows/{id}/run                  ──>  REJECTED (403 or 400)
Any workflow                   ──>  POST /api/workflows/{id}/test                 ──>  Test run (isTestRun: true), always allowed
```

---

## Example: Alert-only workflow (safe by default)

```yaml
name: Auto-isolate compromised host
enabled: true
triggers:
  - type: alert
    with:
      rule_name: "Malware Detection - Critical"

# No manual trigger -- cannot be called via API or UI (except test runs)

steps:
  - name: isolate_host
    type: kibana.request
    with:
      request:
        method: POST
        path: /api/endpoint/action/isolate
        body:
          endpoint_ids:
            - "{{ event.alerts[0].agent.id }}"
          comment: "Auto-isolated due to {{ event.rule.name }}"

  - name: notify_soc
    type: slack
    connector-id: soc-alerts
    with:
      message: |
        :rotating_light: *Host Isolated*
        Host: {{ event.alerts[0].host.name }}
        Rule: {{ event.rule.name }}
```

**Result:** `POST /api/workflows/{id}/run` returns an error: "This workflow does not have a manual trigger. Add a manual trigger to enable manual invocation."

---

## Key design principle: all triggers produce events

Every trigger -- alert, scheduled, custom, manual -- produces an `event` in the execution context. The difference is only **who provides the event data**:

- **Alert trigger:** The system constructs `event` from the alert connector (alerts, rule, params)
- **Scheduled trigger:** The system constructs `event` from task manager (timestamp, schedule info)
- **Custom trigger:** The system constructs `event` from the emitted payload
- **Manual trigger:** The **caller** provides `event` data, validated against the trigger's schema

This means workflow steps work unchanged regardless of how the workflow was triggered. `event.alerts[0].host.name` resolves the same way whether the event came from a real alert or a manual caller who provided alert-shaped data. `execution.triggeredBy` distinguishes the source when needed.

**No normalization boilerplate.** The workflow author never needs to write `{% if event.alerts %}...{% else %}{{ inputs.source_ip }}{% endif %}`. The manual trigger produces the same `event` shape as the trigger it mirrors.

---

## Manual trigger with predefined shapes

Defining a full event schema for the manual trigger can be tedious -- especially when the workflow already works with well-known entities like alerts or cases. The system should provide **predefined event shapes** that the user can reference by name. The caller's data is validated against the shape and injected into `event`.

### Using a predefined shape

```yaml
triggers:
  - type: alert
  - type: manual
    event:
      shape: alert    # caller must provide alert-shaped data -> lands in event.alerts, event.rule, etc.
```

The system knows the alert shape (it's already defined in `AlertEventPropsSchema`). When the user selects `shape: alert`, the manual trigger uses the full alert event contract. The UI renders alert-specific fields, the API validates against the alert schema, and the caller's data is injected into `event` -- identical to a real alert trigger.

### Available predefined shapes

| Shape | What it provides in `event` | Derived from |
|---|---|---|
| `alert` | `event.alerts`, `event.rule`, `event.params` | `AlertEventPropsSchema` |
| `case` | `event.case`, `event.user` | Case event schema from `cases.*` triggers |
| Custom trigger ID (e.g., `cases.updated`) | The trigger's registered `eventSchema` | Trigger registry |

### Using a custom shape

If the predefined shapes don't fit, the user defines a custom event schema:

```yaml
triggers:
  - type: manual
    event:
      properties:
        source_ip:
          type: string
          format: ipv4
        host_name:
          type: string
      required:
        - source_ip
        - host_name
```

The caller provides `{ event: { source_ip: "1.2.3.4", host_name: "web-01" } }`. The system validates against the schema and injects into `event`.

### Combining predefined shape with extra fields

```yaml
triggers:
  - type: manual
    event:
      shape: alert
      properties:          # additional fields on top of the alert event shape
        priority:
          type: string
          enum: [low, medium, high, critical]
      required:
        - priority
```

The caller provides alert-shaped data plus a `priority` field. Both are validated and injected into `event`.

---

## Example: Workflow with manual trigger using alert shape

```yaml
name: Block malicious IP
enabled: true
triggers:
  - type: alert
  - type: manual
    event:
      shape: alert    # manual callers provide alert-shaped data -> lands in event

steps:
  # No normalization needed -- event.alerts works for both alert and manual triggers
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
        Host: {{ event.alerts[0]._source.host.name }}
        Rule: {{ event.rule.name }}
        Triggered by: {{ execution.triggeredBy }}
```

**What the system does on manual call:**
1. Checks that the workflow has a `manual` trigger -- it does
2. Validates the caller's data against the alert event schema (alerts array, rule object, etc.)
3. If required alert fields are missing, rejects with a validation error BEFORE execution
4. If valid, injects the data into `event` -- steps reference `event.alerts` as usual
5. `execution.triggeredBy` is `manual`, so the workflow can distinguish if needed

---

## Example: Agent Builder agent calling a workflow

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

  - name: enrich_with_threat_intel
    type: elasticsearch.request
    with:
      method: GET
      path: /threat-intel-*/_search
      body:
        query:
          match:
            indicator.ip: "{{ steps.fetch_alert.output._source.source.ip }}"

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

**What the agent sees:** The manual trigger's event schema is exposed as the tool's input contract. The agent knows it must provide `alert_id` (string) and `priority` (one of low/medium/high/critical). The data lands in `event`, consistent with every other trigger type. No guessing.

---

## Test runs: the escape hatch

For testing alert-only workflows without adding a manual trigger:

```
POST /api/workflows/{id}/test
Body: { trigger: "alert", event: { alerts: [...], rule: {...} } }
```

- Always available for any workflow (bypasses trigger gating)
- Execution flagged with `isTestRun: true` (already exists in `WorkflowExecutionContextSchema`)
- UI presents trigger-specific mock inputs (e.g., sample alert payload for alert trigger)
- Does not count as production execution

---

## What changes in the system

| Component | Change |
|---|---|
| `ManualTriggerSchema` | Add `event` field (JSON Schema or predefined shape reference) |
| `POST /api/workflows/{id}/run` | Check for manual trigger; validate caller data against event schema; inject into `event` |
| Alert connector | Check for alert trigger before invoking |
| Execution engine | Validate trigger match before `createAndPersistWorkflowExecution` |
| UI - "Run" button | Only show if workflow has manual trigger; render event form from schema |
| UI - "Test" button | Always available; present trigger-specific mock data form |
| Agent Builder integration | Expose manual trigger event schema as tool input contract |
