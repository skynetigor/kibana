# How Competitors Handle Triggers

All documentation verified as of March 2025.

---

## GitHub Actions -- Hard gate with typed inputs

**Source:** [GitHub Actions docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_dispatch)

### Key principle

> *"To enable a workflow to be triggered manually, you need to configure the `workflow_dispatch` event."*

Without `workflow_dispatch`, the "Run workflow" button does not appear in the UI, and the workflow cannot be triggered via API or CLI. The trigger defines typed inputs with descriptions, defaults, required flags, and type constraints.

### Example

```yaml
on:
  workflow_dispatch:
    inputs:
      logLevel:
        description: 'Log level'
        required: true
        default: 'warning'
        type: choice
        options: [info, warning, debug]
      environment:
        description: 'Environment to run tests against'
        type: environment
        required: true
```

- Inputs are accessed via `inputs.logLevel`, `inputs.environment`
- UI renders a form with dropdowns, text fields, and required markers
- API validates inputs against the schema before execution

### Model: No trigger = no invocation, period.

---

## n8n -- Trigger node required as entry point

**Source:** [n8n docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/)

### Key principle

> *"Workflows always need a trigger, or start point."*
> *"The Manual Trigger node serves as the workflow trigger for workflows that don't have an automatic trigger."*

### How it works

- Every workflow starts with a trigger node (Manual Trigger, Schedule Trigger, Webhook Trigger, etc.)
- Only one Manual Trigger node is allowed per workflow
- n8n also has a **Form Trigger** -- a manual trigger with structured input schema (typed form fields with validation)
- Production executions (automatic triggers) and manual executions are tracked separately
- Manual executions don't count toward billing quotas

### Model: Trigger node is the entry point. No trigger node = no execution.

---

## Datadog -- Hybrid model: trigger-aware manual runs + contextual visibility gating

**Source:** [Datadog docs](https://docs.datadoghq.com/actions/workflows/trigger/)

### Key principle

Datadog has two layers of trigger enforcement:

**Layer 1 -- Trigger-aware manual run (always available from workflow page):**

> *"To trigger a workflow manually: 1. From the workflow page, click Run. 2. Enter the values for existing trigger variables. 3. When you're ready to run the workflow, click Save & Run."*

The user sees the workflow's triggers and their variables, and provides data matching the trigger shape. The manual run is **trigger-aware**: the system knows what data the workflow expects.

**Layer 2 -- Triggers gate contextual visibility across the product:**

> *"Only workflows with monitor triggers appear in the list."*
> *"Only workflows with security triggers appear in the list."*
> *"Only workflows with dashboard triggers appear in the list."*
> *"Only workflows with Software Catalog triggers appear in the list."*

### Trigger types

Datadog supports: Manual, Monitor, Incident, Security, Dashboard, Scheduled, API, Slack, GitHub. Each must be explicitly added.

### Visibility gating

| Invocation method | Requires trigger? |
|---|---|
| Manual from workflow page | No -- always available, but trigger-aware |
| From Monitor notification | Yes -- needs Monitor trigger |
| From Security panel | Yes -- needs Security trigger |
| From Dashboard widget | Yes -- needs Dashboard trigger |
| Via API | Yes -- needs API trigger |
| On schedule | Yes -- needs Schedule trigger |

### Model: Always runnable from workflow page (with trigger-aware inputs), but triggers gate where the workflow surfaces across the product.

---

## Tines -- Action-based entry points

**Source:** [Tines docs](https://www.tines.com/docs/actions/types/webhook/)

### Key principle

Tines uses a different architecture: "stories" (workflows) are composed of "actions" (nodes). The first action in a story defines the entry point.

### How it works

- **Webhook Action** is the primary entry point for external data
- Each Webhook has a unique URL, optional secret, access control, and match rules
- `match_rules` validate incoming data shape -- events only emit when rules match
- `access_control` supports: Public, Secret, Team, Tenant
- There is no concept of "any story can be triggered by anything"

### Model: Entry action defines the invocation channel, data contract, and access control.

---

## Multiple Triggers of the Same Type

An important design question: can a workflow have multiple triggers of the same type (e.g., two alert triggers with different rule filters)?

### GitHub Actions

**No duplicates of the same event type.** The `on:` block is a map -- each event type (`push`, `workflow_dispatch`, `schedule`) appears at most once. The exception is `schedule`, which supports multiple cron rules within a single trigger:

```yaml
on:
  schedule:
    - cron: '0 6 * * *'
    - cron: '0 18 * * *'   # multiple cron rules within one schedule trigger
  workflow_dispatch:        # only one workflow_dispatch allowed
    inputs: ...
```

Multiple different event types are supported (e.g., `push` + `workflow_dispatch` + `schedule`).

### n8n

**One trigger node per type.** Only one Manual Trigger node is allowed per workflow (error: "Only one 'Manual Trigger' node is allowed in a workflow"). The Schedule Trigger supports **multiple trigger rules** within a single node (similar to GitHub's multiple cron rules). Multiple different trigger types are supported as separate start points.

### Datadog

**Unlimited duplicates of any type.** A workflow can have multiple Monitor triggers (each tied to a different monitor), multiple Security triggers, multiple API triggers, etc. Each is an independent entry point. The docs say: *"A workflow can have multiple triggers. This allows you to trigger a workflow from a variety of different sources."*

### Tines

**Unlimited duplicates.** Stories can have multiple Webhook actions, each with its own URL, secret, and match rules. No restriction on duplicate types because actions are just nodes in a graph.

### Summary

| Platform | Multiple triggers of same type? | Multiple different trigger types? |
|---|---|---|
| GitHub Actions | No (except multiple cron rules within `schedule`) | Yes |
| n8n | No (one trigger node per type) | Yes |
| Datadog | Yes -- unlimited duplicates | Yes |
| Tines | Yes -- multiple entry actions | Yes |

### Implications for Elastic

The current Elastic model allows multiple triggers of any type in the `triggers[]` array (e.g., two alert triggers with different `rule_name` filters). This aligns with the **Datadog model** (most permissive). If adopting the hard-gate model (GitHub Actions/n8n), the design would likely constrain to one trigger per type, with multiple configurations handled within a single trigger.

---

## Comparison: Elastic vs Competitors

| Capability | Elastic (current) | GitHub Actions | n8n | Datadog | Tines |
|---|---|---|---|---|---|
| Manual trigger gates invocation | No -- any workflow callable | Yes -- needs `workflow_dispatch` | Yes -- needs Manual Trigger node | Partially -- always from page, gated elsewhere | Entry action defines channel |
| Manual trigger defines input schema | No -- `{ type: 'manual' }` only | Yes -- typed inputs | Yes -- Form Trigger | Yes -- trigger variables | Yes -- match rules |
| Triggers gate contextual visibility | No | N/A | N/A | Yes -- per product area | N/A |
| Input validation before execution | No | Yes | Yes | Yes | Yes -- match rules |
| API invocation requires explicit opt-in | No | Yes (via `workflow_dispatch`) | Yes (via Webhook node) | Yes -- needs API trigger | Yes -- Webhook action |
| Trigger-aware manual run | No -- arbitrary `Record<string, any>` | Yes | Yes | Yes | N/A |
| Multiple triggers of same type | Yes | No (except schedule cron rules) | No | Yes | Yes |
