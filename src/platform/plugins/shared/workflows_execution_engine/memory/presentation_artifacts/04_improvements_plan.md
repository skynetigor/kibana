# Improvements Plan: Aligning with Industry Trigger Patterns

This chapter maps each common pattern from the industry analysis to a concrete improvement in Elastic Workflows, following a **hybrid approach**: production runs are hard-gated (only the `manual` trigger is invocable as a production run), while test runs are soft-gated (any trigger can be invoked manually with `isTestRun: true`). Triggers gate contextual visibility across the product.

The core mental model: **you don't call a workflow -- you call a trigger of a workflow.**

---

## Improvement 1: Enforce trigger contracts at runtime

**Addresses Pattern 1: Triggers are contracts**

### Current state

The execution engine ignores `workflow.definition.triggers`. The run API accepts any data. `triggeredBy` is set by the caller, not derived from the workflow.

### Target state

Before execution starts, the system validates:
1. The caller specifies **which trigger** is being invoked
2. The provided data **matches the trigger's event schema**
3. If validation fails, the call is **rejected before any step executes**

---

## Improvement 2: Change the invocation model to "call a trigger"

**Addresses Pattern 2: You invoke a trigger, not a workflow**

### Current state

The caller doesn't specify which trigger. The system doesn't know how to validate.

### Target state

The caller specifies which trigger to invoke. The system validates against that trigger's schema and injects data into `event`.

- **Production runs**: Only the `manual` trigger can be invoked. Automatic triggers (alert, scheduled, custom) fire only through their system channels.
- **Test runs**: Any trigger can be invoked. Execution is flagged with `isTestRun: true`.

---

## Improvement 3: Hybrid production/test gate for manual invocation

**Addresses Pattern 3: Manual invocation requires an explicit mechanism**

### The hybrid model

Production runs and test runs follow different rules:

| Scenario | Allowed? | Execution context |
|---|---|---|
| **Production** + `manual` trigger | Yes -- validated against manual trigger schema | `isTestRun: false` |
| **Production** + alert/scheduled/custom trigger | No -- system channels only | N/A |
| **Production** + no `manual` trigger | Rejected | N/A |
| **Test** + any trigger | Yes -- user selects trigger, provides matching data | `isTestRun: true` |

**Production runs are hard-gated.** Only the `manual` trigger can be invoked as a production run via API or UI. Automatic triggers (alert, scheduled, custom) fire only through their system channels (alert connector, task manager, event bus). Without a `manual` trigger, no production manual invocation is possible. This prevents accidental or agent-triggered production executions.

**Test runs are soft-gated.** Any trigger can be invoked manually as a test run. The execution context has `isTestRun: true`. This lets developers test alert-only or schedule-only workflows without adding a `manual` trigger.

### The `manual` trigger's role

The `manual` trigger serves a distinct purpose: it lets users **define a custom event shape** for production callers (humans, agents, API consumers). It is needed when:

- The workflow should be callable in production without a real alert/event
- The workflow needs a custom invocation shape for Agent Builder (e.g., `alert_id` + `priority`)
- The workflow has no other triggers (purely manual workflow)

The `manual` trigger supports:
- **Custom JSON Schema**: user defines the event shape
- **Predefined shape references**: `$ref: alert`, `$ref: case` to inherit a known event contract

```yaml
# Custom shape for agent callers
triggers:
  - type: manual
    event:
      properties:
        alert_id: { type: string }
        priority: { type: string, enum: [low, medium, high, critical] }
      required: [alert_id, priority]
```

```yaml
# Predefined shape -- inherits alert event contract
triggers:
  - type: alert
  - type: manual
    event:
      $ref: alert
```

### Editor UX for test runs

The workflow editor provides two ways to run tests:

1. **"Test" button** (top-level): Opens a modal where the user selects which trigger to invoke. The system renders input fields derived from the selected trigger's event schema. Submitting creates a test run with `isTestRun: true`.

2. **Per-trigger "play" button**: Each trigger in the YAML definition has a play icon (similar to the existing per-step run feature). Clicking it skips trigger selection and goes straight to the input form for that trigger. This is a shortcut for developers who know which trigger they want to test.

Both produce executions with `isTestRun: true`.

### Existing test/prod branching

Workflows already use `execution.isTestRun` to branch between test and production paths. For example, posting to a playground Slack channel in test mode vs the production SOC channel:

```yaml
- name: notify
  type: if
  condition: ${{ execution.isTestRun == true }}
  steps:
    - name: post_test
      type: slack
      connector-id: playground
      with:
        message: "[TEST] {{ steps.analysis.output }}"
  else:
    - name: post_prod
      type: slack
      connector-id: soc-alerts
      with:
        message: "{{ steps.analysis.output }}"
```

This pattern works unchanged with the hybrid model. Test runs via any trigger land in the test path; production runs via the `manual` trigger land in the production path.

## Improvement 4: Unify event flow across all trigger types

**Addresses Pattern 4: All triggers produce events through a consistent path**

### Current state

- Alert trigger: system provides `event.alerts`, `event.rule` via alert connector
- Scheduled trigger: system provides `{ type: 'scheduled', timestamp, source: 'task-manager' }`
- Custom trigger: system provides `{ ...payload, timestamp, spaceId }`
- Manual call: caller provides `inputs` -- lands in `inputs`, NOT in `event`

The event context is inconsistent. Manual calls produce a fundamentally different execution context than trigger-driven calls.

### Target state

All invocations -- automatic, production manual, or test manual -- produce `event` in the execution context:

- **Alert trigger (automatic)**: System constructs `event` from alert connector
- **Alert trigger (test run)**: Caller provides alert-shaped data, validated and injected into `event` (`isTestRun: true`)
- **Scheduled trigger (automatic)**: System constructs `event` from task manager
- **Custom trigger (automatic)**: System constructs `event` from emitted payload
- **Custom trigger (test run)**: Caller provides trigger-shaped data, validated and injected into `event` (`isTestRun: true`)
- **Manual trigger (production run)**: Caller provides data matching manual trigger schema, validated and injected into `event`

Workflow steps reference `event.X` regardless of invocation source. `execution.triggeredBy` distinguishes the trigger type; `execution.isTestRun` distinguishes test vs production.
---

## Improvement 5: Gate workflow visibility by trigger type

**Addresses Pattern 5: Triggers gate visibility and discoverability**

### Current state

All workflows are visible and callable everywhere. The rule actions dropdown shows all workflows regardless of triggers. Agent Builder can call any workflow.

### Target state

Triggers control where a workflow surfaces in the product:

| Product context | Required trigger | Effect |
|---|---|---|
| Rule actions dropdown | `alert` | Only workflows with alert trigger appear |
| Case automation settings | `cases.*` | Only matching workflows appear |
| Agent Builder tool list | `manual` (with event schema) | Only workflows with manual trigger appear |
| Scheduled execution | `scheduled` | Task Manager only registers for these |
| Security panel "Run Workflow" | `alert` or `manual` | Only relevant workflows appear |
| Editor "Run" (production) | `manual` | Only if workflow has manual trigger |
| Editor "Test" | Any trigger | Always available -- select trigger to invoke |
| Per-trigger play button | Any trigger | Always available -- test run for that trigger |

### Changes required

- **Rule actions UI**: Filter workflow list to those with `alert` trigger
- **Agent Builder integration**: Only expose workflows with `manual` trigger; use the trigger's event schema as the tool input contract
- **Editor "Run" button**: Only show for workflows with `manual` trigger (production run)
- **Editor "Test" button**: Always available; show trigger selector modal
- **Per-trigger play buttons**: Add play icon next to each trigger in the editor (test run shortcut)
- **Any future integration points**: Follow the same pattern -- check for the relevant trigger type before listing

---

## Improvement 6: Expose trigger-derived event shapes

**Addresses Pattern 6: The trigger type determines the event shape**

### Current state

Each trigger type implies an event shape, but this knowledge is scattered:
- Alert shape: hardcoded in `AlertEventPropsSchema`
- Custom trigger shapes: registered in `triggerSchemas` singleton
- Scheduled shape: hardcoded in `plugin.ts` where task manager constructs the event
- Manual trigger: no shape at all (`{ type: 'manual' }`)

The run API, UI, and Agent Builder have no access to these shapes. Callers cannot discover what data a workflow expects.

### Target state

Every trigger type exposes a discoverable event schema:

- **Alert trigger**: `AlertEventPropsSchema` exposed via trigger definition
- **Scheduled trigger**: Schedule event schema exposed via trigger definition
- **Custom triggers**: Already have `eventSchema` in the trigger registry
- **Manual trigger**: User-defined schema (custom JSON Schema or predefined shape)

The system uses these schemas to:
1. **Render input forms** in the UI when user selects a trigger in the "Run" dialog
2. **Validate incoming data** at the API layer before execution
3. **Expose tool contracts** to Agent Builder (for workflows with `manual` trigger)
4. **Provide autocomplete** in the YAML editor (already partially done for custom triggers)

---

## Improvement 7: Referenceable event schemas for manual triggers

**Addresses the usability gap in manual trigger configuration**

### Problem

When a user adds a `manual` trigger and wants callers to provide alert-shaped or case-shaped data, they must write the full JSON Schema by hand. This is tedious, error-prone, and can drift from the actual event shapes the system uses.

### Key insight

Workflow `inputs` already support JSON Schema (`JsonModelSchema`). The manual trigger's `event` definition should follow the same pattern -- it's a JSON Schema. The system already maintains event schemas for all trigger types (`AlertEventPropsSchema`, custom trigger `eventSchema` in the registry). Users should be able to **reference** these schemas instead of rewriting them.

### Target state

The manual trigger's `event` field is a JSON Schema that supports referencing predefined schemas via `$ref`. The YAML editor autocompletes available schema references.

### Syntax

**Reference a predefined schema:**

```yaml
triggers:
  - type: manual
    event:
      $ref: alert    # resolves to AlertEventPropsSchema
```

```yaml
triggers:
  - type: manual
    event:
      $ref: case     # resolves to case event schema
```

```yaml
triggers:
  - type: manual
    event:
      $ref: cases.updated    # resolves to the registered eventSchema for cases.updated
```

**Extend a referenced schema with extra fields (allOf composition):**

```yaml
triggers:
  - type: manual
    event:
      allOf:
        - $ref: alert
        - properties:
            priority:
              type: string
              enum: [low, medium, high, critical]
            analyst_notes:
              type: string
          required: [priority]
```

The caller provides alert-shaped data plus `priority` and optional `analyst_notes`. Both the base schema and extensions are validated.

**Inline custom schema (no reference):**

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
      required: [source_ip, host_name]
```

### Available schema references

| Reference | Resolves to | Provides in `event` |
|---|---|---|
| `alert` | `AlertEventPropsSchema` | `event.alerts`, `event.rule`, `event.params` |
| `case` | Case event base schema | `event.case`, `event.user` |
| Any custom trigger ID (e.g., `cases.updated`) | The trigger's registered `eventSchema` | Whatever the custom trigger defines |

The list grows automatically as new custom triggers are registered. No hardcoded catalog to maintain -- the trigger registry is the source of truth.

### Future: User-defined schema registry

As the system matures, we can introduce a **schema registry** where users store and manage their own reusable schemas. Workflows would reference them via `$ref` the same way they reference built-in schemas today.

The predefined schemas (`alert`, `case`, custom trigger schemas) would live in this registry as system-provided entries alongside user-defined ones. This creates a single, unified mechanism for schema references -- whether the schema comes from the platform or the user.

```yaml
triggers:
  - type: manual
    event:
      $ref: my-team/enriched-alert    # user-defined schema from the registry
```

A user-defined schema registry has already been requested by users in the community. Designing the `$ref` pattern now ensures forward-compatibility -- we don't need to build the full registry for the initial implementation, but when we do, the workflow syntax is ready for it.

### YAML editor autocomplete

The YAML editor should provide autocomplete at two levels:

1. **Schema references**: When typing `$ref:`, suggest available schema names (`alert`, `case`, registered custom trigger IDs)
2. **Event properties**: After the reference is resolved, provide autocomplete for the schema's properties inside `steps` (e.g., `event.alerts[0].host.name` for `$ref: alert`)

This extends the existing autocomplete system, which already resolves custom trigger `eventSchema` for step context. The same mechanism works for manual trigger references.

### How the system resolves references

1. User writes `$ref: alert` on a manual trigger's event
2. Schema resolver looks up `alert`: finds `AlertEventPropsSchema`
3. If `allOf` is used, resolver merges the referenced schema with inline extensions
4. The resolved schema is used for:
   - **API validation**: Validate caller data before execution
   - **UI form rendering**: Render input fields in the "Run" dialog
   - **Agent Builder**: Expose as tool input contract
   - **YAML autocomplete**: Provide `event.*` property suggestions in steps

### Changes required

- **Schema resolver**: New utility that resolves `$ref` names to Zod schemas. Built-in names (`alert`, `case`) map to existing schemas. Custom trigger IDs delegate to the trigger registry.
- **`ManualTriggerSchema`**: The `event` field accepts JSON Schema with `$ref` support (referencing the schema resolver, not external URLs)
- **YAML editor**: Extend autocomplete to suggest `$ref` values and resolve referenced schemas for step-level `event.*` autocomplete
- **UI "Run" dialog**: Resolve the schema reference before rendering the input form

---

## Improvement 8: `triggers.*` namespace in execution context

**Enables typed, trigger-aware access to event data and trigger configuration in workflow steps**

### Problem

Today, trigger event data lands in a flat `event` object. When a workflow has multiple triggers (e.g., alert + manual), steps have no clean way to know which trigger fired or to access trigger-specific data. The only option is checking the `execution.triggeredBy` string:

```yaml
# Current: awkward string check, no type safety
- name: check_source
  type: if
  condition: 'execution.triggeredBy: "alert"'
  steps:
    - name: log_alert
      type: console
      with:
        message: "{{ event.alerts[0].host.name }}"
```

The YAML editor can't reliably autocomplete `event.*` properties because the shape depends on which trigger fires at runtime -- it's ambiguous.

### Target state

A new `triggers.*` namespace in the execution context that:

1. **Mirrors the YAML trigger definitions** -- users access trigger data via the same structure they defined
2. **Separates runtime event data from static config** -- `triggers.<type>.event` for the event payload, `triggers.<type>.*` for YAML-defined configuration
3. **Only the trigger that fired is populated** -- all others are `null`/falsy, enabling clean conditional branching
4. **Coexists with `event`** -- backward compatible; `event` remains as a flattened view with `unknown` shape, but the same object at runtime as in `triggers.<type>.event`. 

### The namespace structure

For a workflow with these triggers:

```yaml
triggers:
  - type: alert
    with:
      rule_name: "OOM in Payment API"
  - type: manual
    event:
      $ref: alert
```

When the **alert trigger** fires:

| Expression | Value | Source |
|---|---|---|
| `triggers.alert` | truthy (populated object) | Runtime |
| `triggers.alert.event.alerts` | Array of alert objects | Runtime event data |
| `triggers.alert.event.rule.name` | "OOM in Payment API" | Runtime event data |
| `triggers.alert.with.rule_name` | "OOM in Payment API" | Static YAML config |
| `triggers.manual` | `null` | Not the active trigger |

When the **manual trigger** fires:

| Expression | Value | Source |
|---|---|---|
| `triggers.manual` | truthy (populated object) | Runtime |
| `triggers.manual.event.alerts` | Caller-provided alert data | Runtime event data |
| `triggers.manual.event.rule.name` | Caller-provided rule name | Runtime event data |
| `triggers.alert` | `null` | Not the active trigger |

### Accessing static trigger configuration

`triggers.<type>.*` mirrors the YAML definition, so users can access any field from the trigger's configuration:

| Expression | Resolves to |
|---|---|
| `triggers.alert.with.rule_name` | The `rule_name` from the alert trigger's `with` block |
| `triggers.alert.with.rule_id` | The `rule_id` if configured instead |
| `triggers.scheduled.with.every` | The schedule interval (e.g., "1h") |
| `triggers.scheduled.with.rrule.freq` | The rrule frequency (e.g., "WEEKLY") |
| `triggers.cases_updated.on.condition` | The KQL condition from the custom trigger's `on` block |

This is useful when steps need to reference the trigger's configuration -- for example, logging which rule filter was configured, or branching based on schedule frequency.

### Real-world example

A workflow that blocks malicious IPs, triggered by either alerts or manual SOC analyst action. Steps use `triggers.*` for clean conditional logic and typed data access:

```yaml
name: Block malicious IP
enabled: true
description: |
  Blocks a malicious IP via firewall API. Can be triggered by a network
  threat alert or manually by a SOC analyst providing alert-shaped data.

triggers:
  - type: alert
    with:
      rule_name: "Network Threat Detected"
  - type: manual
    event:
      $ref: alert

steps:
  - name: log_trigger_source
    type: console
    with:
      message: |
        {% if triggers.alert %}
          Triggered by alert rule: {{ triggers.alert.with.rule_name }}
          Alerts count: {{ triggers.alert.event.alerts | size }}
        {% elsif triggers.manual %}
          Triggered manually. Caller provided {{ triggers.manual.event.alerts | size }} alerts.
        {% endif %}

  - name: extract_ip
    type: data.set
    with:
      source_ip: "{{ triggers.alert.event.alerts[0]._source.source.ip | default: triggers.manual.event.alerts[0]._source.source.ip }}"
      rule_name: "{{ triggers.alert.event.rule.name | default: triggers.manual.event.rule.name }}"

  - name: block_ip
    type: http
    with:
      url: "https://firewall.internal/api/v1/rules"
      method: POST
      body:
        action: block
        source: "{{ steps.extract_ip.output.source_ip }}"
        comment: "Blocked due to {{ steps.extract_ip.output.rule_name }}"
        ttl: 86400

  - name: notify_soc
    type: slack
    connector-id: soc-alerts
    with:
      message: |
        :no_entry: *IP Blocked: {{ steps.extract_ip.output.source_ip }}*
        Rule: {{ steps.extract_ip.output.rule_name }}
        Source: {% if triggers.alert %}Automatic (alert){% else %}Manual (SOC analyst){% endif %}
```

### YAML editor autocomplete

Because `triggers.*` mirrors the YAML definition, the editor knows the shape **statically**:

- User types `triggers.alert.event.` -- editor resolves `AlertEventPropsSchema` and suggests: `alerts`, `rule`, `params`
- User types `triggers.manual.event.` -- editor resolves the `$ref: alert` schema and suggests the same properties
- User types `triggers.alert.with.` -- editor suggests: `rule_name`, `rule_id` (from `AlertRuleTriggerSchema`)
- User types `triggers.scheduled.with.` -- editor suggests: `every`, `rrule` (from `ScheduledTriggerSchema`)

No runtime ambiguity. The editor knows exactly what's available for each trigger.

### Comparison with current state

| Aspect | Current | With `triggers.*` |
|---|---|---|
| Know which trigger fired | `execution.triggeredBy` (string) | `triggers.alert` (truthy/falsy) |
| Access event data | `event.alerts` (flat, ambiguous) | `triggers.alert.event.alerts` (namespaced) |
| Conditional branching | `if: 'execution.triggeredBy: "alert"'` | `if: ${{ triggers.alert }}` |
| Access trigger config | Not available at runtime | `triggers.alert.with.rule_name` |
| Editor autocomplete | Ambiguous `event.*` shape | Static `triggers.<type>.event.*` shape |
| Backward compatibility | N/A | `event` remains as flattened view |

### Datadog parallel

Datadog provides `Source.{{triggered_by}}` to access the trigger context in workflow steps. The `triggers.*` namespace is the Elastic equivalent, with the advantage of mirroring the YAML structure directly.

### Changes required

- **Execution context schema**: Add `triggers` object to `WorkflowContextSchema` / `StepContextSchema`, populated with the active trigger's data
- **`buildWorkflowContext`**: Populate `triggers.<type>.event` with the event data and `triggers.<type>.*` with the static YAML trigger config
- **Template rendering**: Ensure the Liquid/template engine can resolve `triggers.alert.event.alerts` paths
- **YAML editor autocomplete**: Extend the context schema builder to include `triggers.<type>` with resolved event schemas and static trigger config schemas
- **Backward compatibility**: Keep `event` populated as today (flattened view); `triggers.*` is an additional, namespaced access path

---

## What does NOT change

- **Workflow YAML syntax**: `triggers`, `steps`, `inputs`, `consts` remain the same
- **Existing trigger types**: `alert`, `scheduled`, `manual`, custom triggers all remain
- **Execution engine internals**: Step execution, template rendering, error handling unchanged
- **Custom trigger registration**: `eventSchema` already works correctly -- this is the model to follow for built-in triggers
- **Test run concept**: `isTestRun` already exists in `WorkflowExecutionContextSchema` -- we extend its use to test-run any trigger
- **Production manual invocation**: Requires an explicit `manual` trigger (hard gate for production)
- **Test manual invocation**: Any trigger invocable as a test run (soft gate for testing)
