# Critical Analysis: Workflow Trigger Semantics

**Date:** Mar 13, 2025
**Context:** Analysis of the team discussion in [slack_conversation.md](./slack_conversation.md), cross-referenced with the actual codebase implementation in `@kbn/workflows` and the execution engine.

---

## The Verdict: Ihor Is Right -- About Both the Problem and the Direction

The core diagnosis is correct: **the current trigger model is semantically broken**. The codebase confirms every concern raised in the conversation, and in some cases, the reality is worse than what was described.

Furthermore, the proposed direction -- triggers as enforced contracts that gate invocation channels and define data shapes -- is the correct model. It aligns with industry standards (GitHub Actions, n8n, Tines) and resolves the semantic confusion in the current implementation.

---

## Evidence from the Code

### 1. Triggers are a lie at runtime

There is **zero enforcement** of trigger type against invocation source. The execution engine never inspects `workflow.definition.triggers` to decide whether a call is permitted. The `POST /api/workflows/{id}/run` route does not check if the workflow has a `manual` trigger. The alert connector does not check if the workflow has an `alert` trigger. Any workflow can be called from anywhere, period.

The `triggeredBy` field on executions is set by the **caller**, not derived from the workflow definition. It is even inconsistent: when the alert connector runs in summary mode via `runWorkflow`, it does not pass `triggeredBy: 'alert'`, so those executions are silently recorded as `triggeredBy: 'manual'`.

### 2. Each trigger type means something completely different

The example YAML in `workflow_with_all_triggers.yaml` perfectly illustrates the incoherence. Looking at the actual schemas:

- **`manual`**: `{ type: 'manual' }` -- literally nothing else. No input shape, no behavior, no subscription. It is a no-op declaration.
- **`alert`**: Defines an optional rule filter (`rule_id` or `rule_name`), but the event shape (`alerts`, `rule`, `params`) is hardcoded separately in `AlertEventPropsSchema`. The trigger does not subscribe to anything -- the rules side pushes to the workflow connector independently.
- **`scheduled`**: Defines real execution behavior (`every` / `rrule`), but the event it produces at runtime is just `{ type: 'scheduled', timestamp, source: 'task-manager' }` -- no schedule metadata, no next/previous run info.
- **`custom`**: The only trigger type with proper semantics -- a registered `eventSchema`, KQL `on.condition` filtering, and actual event subscription via `emitEvent`.

Four "trigger" types, four completely different contracts.

### 3. The harmful side-effect argument is valid and undersold

Tal's counter was "the workflow should just fail with an indicative message." Ihor's response -- that it could perform harmful actions before failing -- is correct, and the code proves it. Consider the example:

```yaml
steps:
  - name: hello_world_step
    foreach: ${{ event.alerts }}
    ...
  - name: restart_api_service
    if: 'event.alerts[0].name:"OOM in Payment API"'
    ...
```

If this is called manually with no event data, the `foreach` on `event.alerts` will iterate over `undefined` or `null`. Depending on how the template engine handles this, it could: silently skip (masking the error), throw mid-execution (after other steps already ran), or produce garbage data in downstream steps. For a **security automation product**, "it'll probably fail eventually" is not an acceptable safety model.

### 4. The TypeScript analogy is apt, despite the pushback

Tal said "this is similar, but not a coding language." That is a dangerous framing. Workflows in this product can restart services, create cases, call Elasticsearch APIs, invoke Kibana APIs, and trigger sub-workflows. They have real-world side effects. The argument that type safety matters less because it's YAML instead of TypeScript does not hold when the consequence of bad input is the same -- or worse, because workflows are often unattended.

---

## The Correct Model: Triggers as Enforced Contracts

### The key insight: `manual` is the most important trigger

Sergi correctly observed that `alert`, `manual`, and `scheduled` behave inconsistently. His proposed fix was to remove them as triggers and decompose them into separate concerns (top-level `schedule`, input `resource`, no trigger for manual).

But this misses a critical point: **`manual` should be a real trigger that gates manual invocation**. In the current broken implementation, `manual` is a no-op because every workflow is manually invocable regardless. That is the bug, not the design. In a correct implementation:

- **No `manual` trigger** = workflow cannot be invoked manually (via API or UI)
- **`manual` trigger present** = workflow can be invoked manually, and the trigger defines the input contract

This is exactly how it works across the industry (verified against official documentation as of March 2025):

#### GitHub Actions (`workflow_dispatch`)

From [GitHub Actions docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_dispatch):

> *"To enable a workflow to be triggered manually, you need to configure the `workflow_dispatch` event."*

Without `workflow_dispatch`, the "Run workflow" button does not appear in the UI, and the workflow cannot be triggered via API or CLI. The trigger defines typed inputs:

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

Inputs are accessed via `inputs.logLevel`, `inputs.environment` -- exactly the model proposed here.

#### n8n (Manual Trigger node)

From [n8n docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/):

> *"Workflows always need a trigger, or start point."*
> *"The Manual Trigger node serves as the workflow trigger for workflows that don't have an automatic trigger."*

Only one Manual Trigger node is allowed per workflow. n8n also has a Form Trigger -- essentially a manual trigger with a structured input schema (typed form fields), which is very close to the model proposed here. n8n distinguishes between production executions (automatic triggers) and manual executions; manual executions don't count toward quotas.

#### Datadog Workflows (closest competitor -- security product)

From [Datadog docs](https://docs.datadoghq.com/actions/workflows/trigger/):

Datadog uses a **hybrid model** with explicitly declared trigger types: Manual, Monitor, Incident, Security, Dashboard, Scheduled, API, Slack, GitHub. There are two layers:

**Layer 1 -- Any workflow can be run from its own page (no trigger required):**

> *"To trigger a workflow manually: 1. From the workflow page, click Run. 2. Enter the values for existing trigger variables. 3. When you're ready to run the workflow, click Save & Run."*

This is always available. The user is on the workflow page, sees the triggers and their variables, and provides data manually. This is conceptually equivalent to the "test run with trigger selection and mock data" concept proposed in the Slack conversation -- but in Datadog it is a regular run, not a test run.

**Layer 2 -- Triggers gate contextual visibility in the product:**

> *"Only workflows with monitor triggers appear in the list."*
> *"Only workflows with security triggers appear in the list."*
> *"Only workflows with dashboard triggers appear in the list."*
> *"Only workflows with Software Catalog triggers appear in the list."*

A workflow without a "Security" trigger cannot be selected from a security signal panel. A workflow without an "API" trigger cannot be invoked via the API. Triggers determine where a workflow **surfaces** as an option throughout the product, not just whether it can be executed.

**Summary of Datadog's model:**

| Invocation method | Requires trigger? |
|---|---|
| Manual from workflow page | No -- always available |
| From Monitor notification | Yes -- needs Monitor trigger |
| From Security panel | Yes -- needs Security trigger |
| From Dashboard widget | Yes -- needs Dashboard trigger |
| Via API | Yes -- needs API trigger |
| On schedule | Yes -- needs Schedule trigger |

This is a softer gate than GitHub Actions (where no `workflow_dispatch` = no manual run at all), but a much stronger gate than the current Elastic implementation (no gating whatsoever).

#### Tines

Tines uses a different architecture (action-based stories rather than declarative triggers), but the same principle holds: the starting action in a story defines what can trigger it and what data it receives. A Webhook action defines the entry point, with `match_rules` and `access_control` to gate and validate incoming data. There is no concept of "any story can be triggered by anything."

### Each trigger consistently answers the same questions

Under this model, every trigger type is an explicit declaration of an invocation channel with a data contract:

| Trigger | What it means | What it defines |
|---|---|---|
| `manual` | This workflow can be invoked manually (API/UI/agent) | Input schema for manual callers |
| `alert` | This workflow can be invoked by alert rules | Implies `event.alerts`, `event.rule` shape; optional rule filter |
| `scheduled` | This workflow runs on a schedule | Schedule config (`every`, `rrule`); schedule metadata in event |
| `custom` | This workflow subscribes to domain events | Event schema, KQL condition |

Every trigger answers: **can this workflow be invoked this way?** and **what data does it get?**

### Example: alert-only workflow (safe by default)

```yaml
# Cannot be triggered manually -- no manual trigger declared
triggers:
  - type: alert

steps:
  - name: process_alerts
    foreach: ${{ event.alerts }}
    with:
      message: "{{ foreach.item | json }}"
```

The system rejects any manual invocation of this workflow. No risk of garbage data, no harmful side-effects.

### Example: workflow accepting both alert and manual invocation

```yaml
triggers:
  - type: alert
  - type: manual
    inputs:
      properties:
        alerts:
          type: array
          items:
            properties:
              name:
                type: string

steps:
  - name: process_alerts
    foreach: ${{ event.alerts }}
    with:
      message: "{{ foreach.item | json }}"
```

The workflow author explicitly opts into manual invocation and defines the expected input shape. The system validates manual calls against this schema before execution starts. The author acknowledges responsibility for handling both invocation channels.

### Test runs are a separate concept

A natural objection: "If I can't trigger manually, how do I test my alert-only workflow?"

Answer: a **test run** is not a production invocation. The UI can offer "Test this workflow" for any workflow, presenting trigger-specific mock inputs (e.g., a sample alert payload). Test runs bypass trigger gating because they are developer tools, not production invocations. They are flagged with `isTestRun: true` in the execution context -- which already exists in `WorkflowExecutionContextSchema`.

---

## Where Each Participant Stood

### The "whitelist" framing muddied the waters

When Ihor said "whitelist vs blacklist," several team members heard "restrict users from doing things." Tal explicitly pushed back on that framing. But the actual argument is about **type safety and contract enforcement**, not about restricting users. A better framing: "Triggers define the contract. The system validates inputs against the contract. This doesn't prevent invocation -- it prevents invocation with garbage data."

Ihor partly got there with the "test run" idea (UI suggests trigger-specific inputs for testing), which was the right instinct. But the conversation moved on before that point landed.

### Sergi's decomposition was half-right

Sergi correctly identified that the trigger concept is overloaded. But his solution -- remove `alert`, `manual`, `scheduled` and make triggers only for event subscriptions -- goes too far. It enshrines the current broken behavior (everything is manually invocable) as the design, and moves input typing to a separate `resource` concept that doesn't gate invocation.

The better synthesis: keep triggers as the unified concept for invocation channels, but make them consistent. Every trigger defines both the gate (can this workflow be invoked this way?) and the contract (what data does the caller provide?). Sergi's `resource: alert` idea can live inside this model as a shorthand for the alert event shape, but the trigger remains the container.

### The "agent" trigger idea was premature but directionally correct

Ihor's opening suggestion -- adding an `agent` trigger type -- was premature as a specific proposal, but the underlying instinct was correct: if agents can invoke workflows, there should be an explicit opt-in with a defined contract. Whether that's a separate `agent` trigger type or a parameter on the `manual` trigger (e.g., `allow: [ui, api, agent]`) is a design detail.

## Scoreboard

| Participant | Right about | Wrong about |
|---|---|---|
| **Ihor** | The problem is real; triggers are semantically broken; side-effects before failure are dangerous; contract enforcement matters; triggers should gate invocation (industry standard) | The "whitelist" framing obscured the type-safety argument; the initial `agent` trigger idea was premature |
| **Tal** | Metadata is the right short-term fix; testing workflows should be flexible | "It should just fail" is insufficient for a security product; "not a coding language" is a dangerous dismissal of type safety; resistance to invocation gating contradicts industry norms |
| **Sergi** | Correctly identified trigger overloading; good analysis of per-type inconsistencies; the `resource` concept has merit as input typing | Removing `manual` as a trigger enshrines the broken status quo; decomposition goes too far by losing the invocation-gating role of triggers |
| **Marco** | Triggers and workflow logic are diverging and should be examined | The composition workaround (workflow with no trigger + workflow with only trigger) is too complex for users |
| **Yngrid** | Validate the "what" and early-fail | Didn't address _which_ schema to validate against when multiple triggers exist (Ihor's follow-up question) |

---

## Recommended Design Direction

Triggers should be **enforced invocation contracts**. Each trigger consistently defines:

1. **An invocation channel** -- who/how can this workflow be triggered
2. **A data contract** -- what event/input shape the invocation provides
3. **Runtime enforcement** -- the system validates both the channel and the data before execution begins

The `manual` trigger is not a non-concept -- it is the most important trigger in the system, because it is the one that prevents untyped, unvalidated invocations from entering through the API.

All four competitors were verified against official documentation as of March 2025. The industry uses two distinct models:

**Model A -- Hard gate (GitHub Actions, n8n):** No trigger declaration = no invocation of that type, period. GitHub Actions requires `workflow_dispatch` for any manual/API invocation. n8n requires a Manual Trigger node.

**Model B -- Contextual visibility gate (Datadog):** Triggers gate where a workflow surfaces in the product (security panels, monitor notifications, dashboards, API), but any workflow can always be run manually from its own page with user-provided data.

Both models are valid and both are drastically better than the current Elastic implementation (no gating at all). The choice depends on product philosophy:

- **Model A** is safer: prevents accidental invocation entirely. Better for a product where workflows have dangerous side-effects (which a security automation product does).
- **Model B** is more flexible: lets developers always run from the workflow page while still gating external integrations. Datadog's model is especially relevant as the closest competitor (security/monitoring product with workflow automation).

A reasonable synthesis for Elastic: adopt **Model B as the baseline** (triggers gate contextual availability; manual run from the workflow page is always available with trigger-specific input forms), with the option to evolve toward **Model A** (hard-gating manual runs behind a `manual` trigger) if the product requirements demand it. Either way, triggers must define and enforce input contracts -- the current state of zero validation is not defensible.

---

**Bottom line:** Ihor was right to raise this. The trigger-as-contract model is the correct architectural direction. The industry offers two valid approaches: hard gating (GitHub Actions/n8n -- no trigger = no invocation) and contextual visibility gating (Datadog -- triggers gate where workflows surface, manual run from workflow page is always available). Both are vastly better than the current Elastic implementation of zero enforcement. The team should choose a model and enforce triggers at runtime -- the current state is not defensible for a security automation product.
