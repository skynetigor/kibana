# Common Patterns in Workflow Trigger Systems

Despite different architectures (declarative YAML, visual node graphs, action-based stories), all four competitors converge on the same fundamental patterns for triggers. These are not product-specific design choices -- they are industry consensus.

---

## Pattern 1: Triggers are contracts

In every system examined, a trigger -- it is a **binding contract** between the workflow and its invocation source. The contract defines:

- **The invocation channel** -- how the workflow can be triggered (manual, alert, schedule, webhook, API)
- **The data shape** -- what event data the trigger provides (typed inputs, event schema, payload structure)
- **Validation** -- the system enforces the contract before execution starts

| System | How the contract is defined |
|---|---|
| GitHub Actions | `on:` block with event types; `workflow_dispatch.inputs` for manual |
| n8n | Trigger node type + configuration (Form Trigger defines fields) |
| Datadog | Trigger type + trigger variables (exposed in UI and API) |
| Tines | Entry action type + `match_rules` + `access_control` |

---

## Pattern 2: You invoke a trigger, not a workflow

The mental model across all systems is consistent: **callers interact with triggers, not directly with workflows.**

- In GitHub Actions, you dispatch a `workflow_dispatch` event -- not "run the workflow"
- In Datadog, you fill in trigger variables for a specific trigger type -- not "call the workflow with arbitrary data"
- In n8n, data enters through a trigger node -- not through a generic execution endpoint
- In Tines, data enters through a Webhook action with match rules -- not through an open API

This means the trigger acts as a typed entry point. The workflow itself is an implementation detail behind the trigger contract.

---

## Pattern 3: Manual invocation requires an explicit mechanism

No system allows arbitrary, untyped manual calls to any workflow. Every system requires one of:

- **An explicit manual trigger declaration** (GitHub Actions `workflow_dispatch`, n8n Manual Trigger node) that must be added by the workflow author
- **Trigger-aware manual invocation** (Datadog) where the system presents the existing trigger's schema as the input form

In both cases, the caller must provide data matching a known contract. The difference is only whether the contract comes from a dedicated manual trigger or from an existing trigger being invoked manually.

---

## Pattern 4: All triggers produce events through a consistent path

Regardless of trigger type, the data always flows through the same execution context path:

- GitHub Actions: All triggers populate `github.event` -- push events, PR events, dispatch events all land in the same context
- Datadog: All triggers populate trigger variables accessible in the same way
- n8n: All trigger nodes output data that flows to the next node in the same format
- Tines: All entry actions emit events that downstream actions consume uniformly

This means workflow steps don't need to know which trigger fired. They reference `event.X` (or the system's equivalent) and it works regardless of the invocation source.

---

## Pattern 5: Triggers gate visibility and discoverability

Beyond validation, triggers determine **where a workflow appears** in the product:

- Datadog: Only workflows with Monitor triggers appear in monitor notification settings. Only workflows with Security triggers appear in security panels.
- GitHub Actions: Only workflows with `workflow_dispatch` show the "Run workflow" button in the UI.
- n8n: A workflow without a trigger node cannot be activated (published for production).

Triggers are not just runtime contracts -- they are the **discovery mechanism** that connects workflows to the rest of the product. A workflow without the right trigger is invisible in the relevant context.

---

## Pattern 6: The trigger type determines the event shape

Each trigger type implies a specific event structure. The system knows the shape and can:

- **Render input forms** derived from the trigger's schema (Datadog trigger variables, GitHub Actions dispatch inputs)
- **Validate incoming data** against the expected shape before execution
- **Provide autocomplete** in the workflow editor based on what fields the trigger makes available

This is possible because triggers are not generic -- each type carries a well-defined event contract. An alert trigger always provides alert-shaped data. A schedule trigger always provides schedule-shaped data. The system leverages this knowledge throughout the product.
