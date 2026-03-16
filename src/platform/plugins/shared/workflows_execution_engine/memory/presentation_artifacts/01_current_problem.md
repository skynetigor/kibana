# The Current Problem: Triggers Are Decorative

## Bottom line

Trigger declarations are **ignored at runtime**. Any workflow can be called with any data via the run API. This causes production incidents, exposes dangerous actions to AI agents, and makes multi-trigger workflows unreliable.

---

## Problem 1: Triggers are decorative -- the system ignores them

Workflow authors declare triggers to express intent: "this workflow responds to OOM alerts," "this workflow runs on a schedule," "this workflow reacts to case updates." But the system treats these declarations as documentation, not contracts.

The execution engine never checks `workflow.definition.triggers` against the invocation source. The run API (`POST /api/workflows/{id}/run`) accepts `{ inputs: Record<string, any> }` -- an arbitrary bag of data. It doesn't ask which trigger is being invoked. It doesn't validate the data against any trigger's event schema. It doesn't even check whether the workflow has a trigger that permits manual invocation.

The `triggeredBy` field on execution records is set by the **caller**, not derived from the workflow definition. When the alert connector runs in summary mode via `runWorkflow`, it doesn't pass `triggeredBy: 'alert'`, so those executions are silently recorded as `triggeredBy: 'manual'`.

The runtime does validate `inputs` when a workflow defines an `inputs` section at the workflow level -- that part works. But most trigger-driven workflows don't define `inputs`. They rely on `event` data provided by the trigger (`event.alerts`, `event.case`, `event.rule`). This event data is completely outside the `inputs` contract. A workflow with only an alert trigger and no `inputs` section can be called manually with literally anything.

**Why this is a problem:** Triggers exist so that workflow authors can trust the system to provide correctly shaped data. When the system ignores triggers, that trust is broken. Authors write steps assuming `event.alerts` will be populated -- and the system lets callers bypass that assumption entirely.

---

## Problem 2: Unvalidated calls cause production incidents

Because triggers aren't enforced, workflows with real-world side effects can be invoked without the data they need. They don't fail early -- they execute partially, performing dangerous actions before eventually erroring on missing fields.

### Example: Production service restarted without an alert

A team builds a workflow to restart their Payment API when an OOM alert fires. It has only an `alert` trigger with `rule_name: "OOM in Payment API"`. The author trusts the trigger filter -- so they don't add redundant conditions in steps.

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
      url: "https://k8s-api.internal/...
            /{{ consts.k8s_deployment }}"
      method: PATCH
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
        *Payment API Restarted*
        Reason: {{ event.rule.name }}
```

Someone calls `POST /api/workflows/{id}/run` with `{ inputs: {} }`. The trigger's `rule_name` filter is decorative -- the system ignores it. `restart_service` executes immediately: the production Payment API restarts for no reason. `notify_team` posts to Slack: "Reason: " -- the team sees a restart happened but has no idea why.

**This isn't hypothetical.** The workflow does exactly what it says -- restart a production service. The only thing preventing unauthorized restarts is the trigger declaration, and the system doesn't enforce it.

**"Can't the author add an `if` condition as a guardrail?"** They can -- but they shouldn't have to. Users should not need to write defensive `if` conditions in every step to compensate for a trigger system that doesn't enforce its own declarations. The trigger declaration IS the guardrail. When the author writes `triggers: [{ type: alert, with: { rule_name: "OOM in Payment API" } }]`, they are telling the system: "only run this for OOM alerts." The system should honor that contract, not silently ignore it and shift the burden to the workflow author to re-implement validation in steps.

### Example: Firewall rule created for an empty IP

```yaml
name: Block malicious IP from alert
triggers:
  - type: alert

steps:
  - name: extract_threat_data
    type: data.set
    with:
      source_ip: "{{ event.alerts[0]._source.source.ip }}"

  - name: block_ip
    type: http
    with:
      url: "https://firewall.internal/api/v1/rules"
      method: POST
      body:
        action: block
        source: "{{ steps.extract_threat_data.output.source_ip }}"
```

Called manually with no alert data: `block_ip` sends a firewall rule for an empty IP. Depending on the firewall API, this could be a no-op or a wildcard block.

---

## Problem 3: AI agents can call any workflow with no contract

Agent Builder agents select workflows as tools. The system exposes all workflows to agents regardless of their triggers. An agent calling a workflow has no schema telling it what data to provide -- the trigger's implied event shape is invisible to the API.

The agent makes decisions based on LLM reasoning, which can be wrong. It sees this workflow is available as a tool, misinterprets a user request like "check the payment service health," and decides to call the restart workflow "just in case." It sends `{ inputs: {} }`. The production Payment API restarts during peak traffic. No alert, no OOM, no incident -- just an LLM making a bad judgment call, and the system doing nothing to stop it.

**Why this is worse than human callers:** Humans can read the workflow YAML and understand it expects alert data. Agents cannot -- they rely on the tool contract (input schema) to know what to send. Today, the tool contract is `Record<string, any>`. The agent has no way to know this workflow expects alerts, not arbitrary data.

This problem grows as more workflows become available to agents. Every alert-only, case-only, or schedule-only workflow is a potential accidental production invocation waiting to happen.

---

## Problem 4: Multi-trigger workflows have an ambiguous execution context

When a workflow has multiple triggers (e.g., alert + manual, or alert + scheduled), the `event` object in the execution context has a different shape depending on which trigger fired. Steps can't safely access trigger-specific data without runtime guessing.

The only way to know which trigger fired is checking `execution.triggeredBy` -- a string:

```yaml
- name: check_source
  type: if
  condition: 'execution.triggeredBy: "alert"'
  steps:
    - name: log_alert
      type: console
      with:
        message: "{{ event.alerts[0].host.name }}"
```

There is no typed, namespaced access to trigger data. The YAML editor can't autocomplete `event.*` properties because the shape depends on which trigger fires at runtime. Static trigger configuration (the `rule_name` from the alert trigger's `with` block, the `every` from the scheduled trigger) is not available in the execution context at all.

**Why this is a problem:** Workflow authors writing multi-trigger workflows must handle each trigger's data shape manually with conditional logic and `default` filters. The editor can't help them because the context is ambiguous. Mistakes are silent -- wrong property paths produce empty strings, not errors.

---

## The pattern

These four problems are connected. They all stem from the same root cause: **triggers are metadata, not contracts.**

```
Trigger declarations  ──>  Ignored by runtime  ──>  No validation
                                                ──>  No gating
                                                ──>  No typed context
                                                ──>  No discoverable schema
                                                         │
                                                         ▼
                                               Production incidents
                                               Agent misuse
                                               Ambiguous DX
```

| Problem | Root cause | Consequence |
|---|---|---|
| Triggers are decorative | Runtime ignores trigger definitions | Any workflow callable with any data |
| Unvalidated calls cause incidents | No validation of event data on manual calls | Service restarts, garbage cases, empty firewall rules |
| Agents call workflows with no contract | Trigger schemas not exposed to callers | LLMs invoke dangerous workflows by accident |
| Ambiguous execution context | No trigger-aware namespace in context | String-based checks, no autocomplete, silent failures |
