# The Current Problem: Triggers Are Not Enforced

## Summary

Triggers in Elastic Workflows are **decorative** -- they declare intent but are never enforced at runtime. Any workflow can be called from anywhere with any data, regardless of what triggers are defined. This creates dangerous scenarios in a security automation product.

### Root cause

The run API (`POST /api/workflows/{id}/run`) accepts `{ inputs: Record<string, any> }`. The runtime **does** validate inputs when a workflow defines an `inputs` section at the workflow level. But this only covers one narrow case: the caller provides `inputs`, and the workflow declares what `inputs` it expects.

The problem is that most trigger-driven workflows don't define an `inputs` section -- they rely on `event` data provided by the trigger (e.g., `event.alerts` from an alert trigger, `event.case` from a cases trigger). This event data lives outside the `inputs` contract entirely. So:

- If a workflow defines `inputs` -- the runtime validates them. This works.
- If a workflow defines only an `alert` trigger and no `inputs` section -- it can be called manually with literally anything. No validation, no error, no gating.

The execution engine never checks `workflow.definition.triggers` against the invocation source. The `triggeredBy` field is set by the caller, not derived from the workflow. The trigger's implied event shape (e.g., `event.alerts` for alert trigger) is invisible to the run API.

### Why this matters

Workflows in this product perform real-world actions: isolating hosts, blocking IPs, creating cases, calling external APIs. When called without the expected event data, workflows don't fail early -- they execute partially, performing harmful actions before eventually erroring on missing fields.

---

## Example 1: Service restart workflow triggered without a real alert

A team owns a payment API that occasionally crashes with OOM errors. They build a workflow that listens for OOM alerts on that specific service and automatically restarts it. The workflow has only an `alert` trigger -- the author designed it exclusively for alert-driven execution.

```yaml
name: Restart Payment API on OOM
enabled: true
triggers:
  - type: alert
    with:
      rule_name: "OOM in Payment API"

consts:
  service_name: payment-api
  k8s_namespace: production
  k8s_deployment: payment-api-deployment

steps:
  - name: restart_service
    type: http
    with:
      url: "https://k8s-api.internal/apis/apps/v1/namespaces/{{ consts.k8s_namespace }}/deployments/{{ consts.k8s_deployment }}"
      method: PATCH
      headers:
        Authorization: "Bearer {{ consts.k8s_token }}"
        Content-Type: application/strategic-merge-patch+json
      body:
        spec:
          template:
            metadata:
              annotations:
                restart-trigger: "{{ now }}"

  - name: log_restart
    type: elasticsearch.request
    with:
      method: POST
      path: /service-actions-log/_doc
      body:
        action: restart
        service: "{{ consts.service_name }}"
        reason: "OOM alert: {{ event.rule.name }}"
        triggered_by: "{{ execution.triggeredBy }}"
        timestamp: "{{ now }}"

  - name: notify_team
    type: slack
    connector-id: payments-team
    with:
      message: |
        :warning: *Payment API Restarted*
        Reason: OOM detected ({{ event.rule.name }})
        Namespace: {{ consts.k8s_namespace }}
        Deployment: {{ consts.k8s_deployment }}
```

The author configured the alert trigger with `rule_name: "OOM in Payment API"` -- they trust the trigger to filter invocations, so they don't add redundant conditions in steps. This is what triggers are for.

**What happens when someone calls this workflow manually (by mistake or intentionally):**
- The workflow has no `inputs` section -- the API accepts `{ inputs: {} }` with no validation
- The trigger's `rule_name` filter is not enforced -- it's decorative
- `restart_service` executes immediately: the production Payment API is restarted for no reason
- `log_restart` writes an audit entry with blank alert data
- `notify_team` posts to Slack: "OOM detected ()" -- the team sees a restart happened but has no idea why

**What happens when an Agent Builder agent calls this workflow by accident:**
An AI agent is not fully trusted -- it makes decisions based on LLM reasoning, which can be wrong. The agent sees this workflow is available as a tool (because the system exposes all workflows), misinterprets a user request like "check the payment service health," and decides to call this workflow "just in case." It sends `{ inputs: {} }`. The production Payment API restarts during peak traffic. There was no alert, no OOM, no incident -- just an LLM making a bad judgment call, and the system doing nothing to stop it.

**The real issue isn't that manual invocation should be forbidden.** It's fine to trigger this workflow manually -- but the API should require the caller to provide data matching the alert trigger shape (alert name, rule, host, etc.). Today the API accepts anything because it doesn't know about the trigger contract. The trigger declaration says "only OOM alerts," but the system ignores it.

In Datadog, the "Run" button on this workflow's page would present fields derived from the alert trigger: alert name, rule name, host, etc. The caller provides real or mock alert data, and the workflow runs with correctly shaped input. In our system, the caller sends `{ inputs: {} }` and the production service gets restarted.

---

## Example 2: Manual run is trigger-unaware

This workflow blocks malicious IPs from alert data. An Agent Builder agent calls it as a tool, but the agent has no contract to follow -- the API doesn't expose the trigger's implied event shape.

```yaml
name: Block malicious IP from alert
enabled: true
triggers:
  - type: alert

steps:
  - name: extract_threat_data
    type: data.set
    with:
      source_ip: "{{ event.alerts[0]._source.source.ip }}" # event.alerts is empty for manual call via agent
      host_name: "{{ event.alerts[0]._source.host.name }}"
      rule_name: "{{ event.rule.name }}"

  - name: create_case
    type: kibana.request
    with:
      request:
        method: POST
        path: /api/cases
        body:
          title: "Network threat: {{ steps.extract_threat_data.output.rule_name }} on {{ steps.extract_threat_data.output.host_name }}"

  # DANGEROUS: sends firewall rule for empty IP
  - name: block_ip
    type: http
    with:
      url: "https://firewall.internal/api/v1/rules"
      method: POST
      body:
        action: block
        source: "{{ steps.extract_threat_data.output.source_ip }}"
        ttl: 86400
```

**The core issue:** The manual run API is completely disconnected from triggers. It accepts `{ inputs: Record<string, any> }`. The caller (human, agent, API consumer) has no way to discover what data this workflow needs. The alert trigger implies `event.alerts`, but neither the agent nor the API knows that.

---

## Example 3: Custom trigger workflow callable from anywhere

This workflow reacts to case status changes by syncing to Jira. It uses a `cases.updated` custom trigger. But nothing prevents manual invocation via API.

```yaml
name: Sync case status to Jira
enabled: true
triggers:
  - type: cases.updated
    on:
      condition: 'event.case.status: "in-progress" or event.case.status: "closed"'

steps:
  - name: find_jira_ticket
    type: elasticsearch.request
    with:
      method: GET
      path: /case-jira-mapping/_search
      body:
        query:
          term:
            case_id: "{{ event.case.id }}"

  - name: update_jira
    type: http
    if: 'steps.find_jira_ticket.output.hits.total.value > 0'
    with:
      url: "https://elastic.atlassian.net/rest/api/3/issue/{{ steps.find_jira_ticket.output.hits.hits[0]._source.jira_key }}/transitions"
      method: POST
      body:
        transition:
          id: "{% if event.case.status == 'in-progress' %}21{% elsif event.case.status == 'closed' %}31{% endif %}"

  - name: notify_channel
    type: slack
    connector-id: soc-alerts
    with:
      message: |
        :jira: *Case to Jira Sync*
        Case: {{ event.case.title }} ({{ event.case.status }})
        Jira: {{ steps.find_jira_ticket.output.hits.hits[0]._source.jira_key }}
```

**What happens when called manually:** The Jira ticket gets created with empty fields, the ES update targets a nonexistent case, and the Slack message posts garbage to the SOC channel.

---

## The pattern across all examples

| Problem | What happens |
|---|---|
| Triggers are not enforced at runtime | Any workflow callable from anywhere regardless of defined triggers |
| Manual run is trigger-unaware | API accepts arbitrary data; trigger-implied event shapes are invisible to callers |
| `inputs` validation exists but doesn't cover triggers | Runtime validates `inputs` if defined, but trigger-driven workflows rely on `event` data which is never validated on manual calls |
| Side effects before failure | Dangerous actions (isolate host, block IP, create case) happen before error |
| No discoverable contract for callers | Agents, API consumers have no schema to follow when workflow uses triggers instead of `inputs` |
