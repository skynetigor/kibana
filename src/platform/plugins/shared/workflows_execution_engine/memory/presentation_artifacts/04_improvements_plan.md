# Improvements Plan: Aligning with Industry Trigger Patterns

This chapter maps each common pattern from the industry analysis to a concrete improvement in Elastic Workflows, following the **Datadog soft-gate approach**: any trigger can be invoked manually with trigger-aware validation, and triggers gate contextual visibility across the product.

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

```
POST /api/workflows/{id}/run
Body: { inputs: Record<string, any> }
```

The caller doesn't specify which trigger. The system doesn't know how to validate.

### Target state

```
POST /api/workflows/{id}/run
Body: { trigger: "alert", event: { alerts: [...], rule: {...} } }
```

The caller specifies which trigger to invoke. The system validates against that trigger's schema and injects data into `event`. Any trigger defined on the workflow can be invoked this way -- not just `manual`.

---

## Improvement 3: Make any trigger manually invocable (soft gate)

**Addresses Pattern 3: Manual invocation requires an explicit mechanism**

Following the Datadog model: any workflow can be invoked manually by selecting a trigger and providing data matching that trigger's schema. No separate `manual` trigger is needed to enable manual invocation of existing trigger types.

### How it works

- The run API accepts `{ trigger: "alert", event: {...} }` for any trigger on the workflow
- The system validates caller data against the selected trigger's schema
- UI "Run" button shows a **trigger selector** and renders the selected trigger's input form
- Data is validated and injected into `event`

### The `manual` trigger's role

The `manual` trigger serves a distinct purpose: it lets users **define a custom event shape** not covered by any other trigger type. It is needed when:
- The workflow has no other triggers (purely manual workflow)
- The workflow needs a custom invocation shape for agents or API consumers (e.g., `alert_id` + `priority`)

The `manual` trigger supports:
- **Custom JSON Schema**: user defines the event shape
- **Predefined shapes**: `shape: alert`, `shape: case` to inherit a known event contract

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
      shape: alert
```

## Improvement 4: Unify event flow across all trigger types

**Addresses Pattern 4: All triggers produce events through a consistent path**

### Current state

- Alert trigger: system provides `event.alerts`, `event.rule` via alert connector
- Scheduled trigger: system provides `{ type: 'scheduled', timestamp, source: 'task-manager' }`
- Custom trigger: system provides `{ ...payload, timestamp, spaceId }`
- Manual call: caller provides `inputs` -- lands in `inputs`, NOT in `event`

The event context is inconsistent. Manual calls produce a fundamentally different execution context than trigger-driven calls.

### Target state

All invocations -- automatic or manual -- produce `event` in the execution context:

- **Alert trigger (automatic)**: System constructs `event` from alert connector
- **Alert trigger (manual invocation)**: Caller provides alert-shaped data, validated and injected into `event`
- **Scheduled trigger (automatic)**: System constructs `event` from task manager
- **Scheduled trigger (manual invocation)**: Caller provides schedule-shaped data, validated and injected into `event`
- **Custom trigger (automatic)**: System constructs `event` from emitted payload
- **Custom trigger (manual invocation)**: Caller provides trigger-shaped data, validated and injected into `event`
- **Manual trigger**: Caller provides custom-shaped data, validated and injected into `event`

Workflow steps reference `event.X` regardless of invocation source. `execution.triggeredBy` distinguishes automatic vs manual.
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
| Workflow page "Run" button | Any trigger | Always available -- select trigger to invoke |

### Changes required

- **Rule actions UI**: Filter workflow list to those with `alert` trigger
- **Agent Builder integration**: Only expose workflows with `manual` trigger; use the trigger's event schema as the tool input contract
- **Workflow page**: Always show "Run" with trigger selector (soft gate -- no restriction)
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

## What does NOT change

- **Workflow YAML syntax**: `triggers`, `steps`, `inputs`, `consts` remain the same
- **Existing trigger types**: `alert`, `scheduled`, `manual`, custom triggers all remain
- **Execution engine internals**: Step execution, template rendering, error handling unchanged
- **Custom trigger registration**: `eventSchema` already works correctly -- this is the model to follow for built-in triggers
- **Manual invocability**: Any workflow remains manually runnable from its page (soft gate) -- the change is that manual runs become trigger-aware and validated
