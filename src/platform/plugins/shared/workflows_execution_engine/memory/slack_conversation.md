https://elastic.slack.com/archives/C08TKN4P51V/p1773220327648189

# Slack Discussion: Workflow Triggers & Execution Metadata

**Channel:** #one-workflow-eng
**Date:** Mar 10–11, 2025

---

## Context

Tal opened a discussion about exposing optional execution metadata in workflow APIs, linking to [security-team#16293](https://github.com/elastic/security-team/issues/16293). The conversation evolved into a broader design discussion about the role and semantics of workflow triggers.

---

## Conversation

### Tal Borenstein — 10:12 AM

Team, I plan on exposing optional execution metadata for this use case in our APIs — here's the ticket I created for it: [security-team#16293](https://github.com/elastic/security-team/issues/16293) — any thoughts or objections?

> **Original question (from thread):** Is there a way to pass the ID of the calling agent from an Agent Builder workflow tool — as metadata — to the workflow? This is so that the workflow can determine which agent called it.

**Ticket summary:** Add first-class support for execution metadata on workflow runs — a separate, system-controlled data channel that is distinct from user-defined workflow inputs. This allows callers (e.g. Agent Builder agents) to attach contextual information (like the calling agent's ID) to a workflow execution without polluting the workflow's input schema.

**Current state:**
- The workflow execution API (`POST /api/workflows/{id}/run`) accepts only `inputs: Record<string, any>` in its body.
- `WorkflowsManagementApi.runWorkflow` builds a flat context object (`{ event, spaceId, inputs }`) and passes it to the execution engine.

---

### Ihor Panasiuk — 10:14 AM

LGTM 👍

---

### Ihor Panasiuk — 10:22 AM

Thinking out loud: By implementing an "agent" trigger to restrict execution, we could pass this metadata directly as the trigger's event data. That means, if a workflow does not have an "agent" trigger, the user restricts agents from calling such workflow, so an agent can't trigger it.

The current need for this feature stems from our model allowing workflows to be called externally, regardless of their defined triggers.

---

### Tal Borenstein — 10:30 AM

> *"The current need for this feature stems from our model allowing workflows to be called externally, regardless of their defined triggers."*

The way I see it — every workflow should also be able to be invoked "manually", where "manually" can be API / agent / human / whatever.

I don't see a reason where we'd want to enforce specifics around manual executions, other than their inputs.

---

### Ihor Panasiuk — 10:39 AM

Consider this workflow with only an "alert" trigger:

```yaml
name: New workflow
enabled: false
description: This is a new workflow
triggers:
  - type: alert

inputs:
  - name: message
    type: string
    default: "hello world"

steps:
  - name: hello_world_step
    type: console
    foreach: ${{ event.alerts }}
    with:
      message: "{{ foreach.item | json }}"

  - name: restart_api_service
    if: 'event.alerts[0].name:"OOM in Payment API"'
    type: console
    with:
      message: restart
```

If I trigger this workflow manually, what would be the inputs for this workflow?

As the user, I design this workflow specific to alerts, and I expect it to be triggered only by alerts — because otherwise it could lead to unexpected results. And someone, from another place, triggers this workflow manually without providing the inputs, or the inputs are incorrect. This could happen because we allow any workflow to be triggered manually.

---

### Tal Borenstein — 10:41 AM

I think somewhere in the near future, we'll have an alert input (based on JSONSchema work we previously did), or it will automatically be implied from the trigger (you were the one to suggest that triggers and inputs are combined 😉).

> *"And someone, from another place, triggers this workflow manually, without providing the inputs, or inputs are incorrect."*

I guess the workflow should then just fail with an indicative message.

---

### Ihor Panasiuk — 10:44 AM

Another story — a workflow with both alert and manual triggers:

```yaml
name: New workflow
enabled: false
description: This is a new workflow
triggers:
  - type: alert
  - type: manual
    inputs:
      properties:
        alerts:
          type: array
          items:
            properties:
              name: string

inputs:
  - name: message
    type: string
    default: "hello world"

steps:
  - name: hello_world_step
    type: console
    foreach: ${{ event.alerts }}
    with:
      message: "{{ foreach.item | json }}"

  - name: restart_api_service
    if: 'event.alerts[0].name:"OOM in Payment API" or inputs.alerts[0].name'
    type: console
    with:
      message: restart
```

As the user, I design this workflow so it can be triggered either manually or by an alert. I acknowledge what I'm doing — so it's no longer a risk for someone to trigger this workflow manually, because I enforce specific inputs for the manual trigger.

> *"The workflow should then just fail with an indicative message."*

It will fail (maybe), but before failing it could perform some harmful action, because it's not ready for manual inputs, and I expect the workflow to trigger only from alerts.

---

### Tal Borenstein — 10:47 AM

Again, I can't think of a reason we'd want to explicitly enforce users not to do something they might want to do (manually invoke a workflow that has an alert trigger). If they explicitly don't want that workflow to be manually executed, they can add that as a guardrail first step with an `if` condition, no?

---

### Ihor Panasiuk — 10:47 AM

It's like having a TypeScript function:

```typescript
function doAction(params: { foo, bar }) {
  ...
}
```

But then we allow its unsafe calling like `doAction({ lorem: 'ipsum' } as any)`.

---

### Tal Borenstein — 10:47 AM

We sometimes tend to forget this is similar, but not a coding language 😅

Anyway, this is how I think about it — @workflows-eng thoughts?

---

### Ihor Panasiuk — 10:48 AM

I'm a biased GitHub Actions user, and they have this triggers mental model.

---

### Ihor Panasiuk — 10:52 AM

I think it's a **whitelist vs blacklist** problem.

Whitelist (specify only triggers that can run a workflow) vs blacklist (specify where it should not trigger) — I think whitelist is better.

But users can still run a workflow manually as a **test run**. If the user has several triggers and wants to test how the workflow behaves for a specific trigger, they can click "Test workflow", and the UI will suggest inputs specific to the chosen trigger for testing. The test flow will call the workflow as if it were an alert, for example.

---

### Marco Liberati — 10:53 AM

It sounds like triggers and workflow are starting to diverge to me. Workflow would be only task definitions, and triggers should live somewhere else.

I agree any workflow should be callable via API at any time, but the current model kind of enforces some constraints that are not respected, as @ihor.panasiuk raises.

Anyway, this could be easily handled via composition in a clean way (workflow with no trigger + workflow with only trigger + call the clean one by ID) for now. Just my 2 cents.

---

### Tal Borenstein — 11:01 AM

Anyhow, I think this is a broader discussion that also connects with some of the writing @shahar.glazner has been doing around what "workflows as an operating system for agents" means.

For the time being, @ihor.panasiuk — tell me if you agree: we can continue with the metadata part to unblock the AB team. WDYT?

I can think of other use cases for metadata for workflows as well.

---

### Ihor Panasiuk — 11:05 AM

Yes, I agree, let's do that. Just wanted to raise the triggers issue that I see — I just feel that triggers don't make sense in the way we use them…

---

### Tal Borenstein — 11:06 AM

💯 Signing it up for a discussion next week on the check-in session where @tin will be back too.

---

### Sergi Massaneda — 11:06 AM

Good points. I don't think we should restrict executions if the trigger doesn't match "who" starts the run. I think we should be flexible. What would make sense is to check the **"what"**: the input matches the expected shape for the workflow to run.

---

### Tal Borenstein — 11:06 AM

We can sync on the agenda for it on our 1:1.

---

### Yngrid Coello — 11:09 AM

> *"What would make sense is to check the 'what': the input matches the expected shape for the workflow to run"*

And early fail if that's not the case.

---

### Ihor Panasiuk — 11:11 AM

But the question is — what shape should it validate the call against? Say I have "alert", "agent", "scheduled" triggers in the same workflow.

If I have a manual trigger and I call the workflow manually — it's clear, the manual trigger specifies the shape.

---

### Sergi Massaneda — 11:12 AM

> *"I just feel that triggers don't make sense in the way we use them…"*

I agree with @ihor.panasiuk on that. Currently a trigger has different meanings depending on the type. Some define the expected input, others don't. Some apply specific execution behaviors, others don't:

| Trigger | Shape definition | Behavior |
|---------|-----------------|----------|
| `scheduled` | No shape definition | Auto-execution with no input |
| `alert` | Expects a specific input shape | No subscription (done on the rules side) |
| `manual` | No shape definition | No extra functionality |
| `custom` | Trigger input shape definition | Subscription to events |

So, the definition of "trigger" is a bit confusing.

---

### Ihor Panasiuk — 11:14 AM

If the user wants a workflow to be called from everywhere, we can have a specific trigger allowing it:

```yaml
triggers:
  - type: anything  # didn't come up with a better name
```

Then it will be on the user's responsibility to specify steps in a way that works for any event.

---

### Yngrid Coello — 11:15 AM

> *"alert: expects a specific input shape, no subscription (is done on the rules side)"*

Could you subscribe to a workflow that doesn't have `triggers: alerts` from an alert?

---

### Ihor Panasiuk — 11:16 AM

You mean if the user can set any workflow (without alert trigger) as a rule action? Yes — this is basically why I raised this question.

---

### Yngrid Coello — 11:17 AM

Then we are not even restricting them there — why here? Definitely confusing, and feeling that we need something to stick to in this area.

---

### Ihor Panasiuk — 11:20 AM

I think about a trigger as a **contract** that specifies:

1. **Who** triggers the workflow
2. **When** the workflow triggers
3. **What** event shape will be during execution

---

### Sergi Massaneda — 11:30 AM

I think the concept of **resource** or **entity** would help a lot here:

```yaml
inputs:
  - resource: alert  # pre-defined (e.g. rule, case, generic ES document...)
```

---

### Ihor Panasiuk — 11:40 AM

Looks good! But the trigger by itself could be a resource identifier:

```yaml
triggers:
  alerts:
    filter: 'name:OOM'
  cases: true  # true when no configuration for trigger needed
  manual:
    inputs:
      ... JSON schema shape
  webhook:
    headersSchema:
      ...
    bodySchema:
      ...
```

---

### Sergi Massaneda — 11:49 AM

Not sure about trigger-specific inputs — the workflow definition should have a clear expectation of what is going in. We are doing it today, but it creates inconsistencies. This is possible:

```yaml
triggers:
  - type: alert
  - type: case.update
```

---

### Sergi Massaneda — 11:56 AM

IMO, I would remove `alert`, `manual`, and `scheduled` triggers 😂

Make the `triggers` prop optional, and define it only for event-triggers, which have a clear meaning: **subscribe to events**.

Then:

- **`scheduled`** → could be a top-level prop:
  ```yaml
  enabled: true
  schedule:
    every: 1h
  ```

- **`alert`** → could be just a predefined input resource (this has nothing to do with triggering actually):
  ```yaml
  inputs:
    - resource: alert
  ```

- **`manual`** → no trigger definition needed

---

### Ihor Panasiuk — 12:00 PM

> *"This has nothing to do with triggering actually"*

True, but this is what I wanted to improve — so triggers do what they intend to.

**Reference links from competitors:**
- [Datadog — Trigger a workflow](https://docs.datadoghq.com/actions/workflows/trigger/)
- [n8n — Manual Trigger node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/)
- [Tines — Actions](https://www.tines.com/docs/actions/)

Our competitors have a trigger concept that works like GitHub Actions. I think this concept could fit our product too.

---

### Sergi Massaneda — 12:15 PM

Yep, we are more flexible, which is not bad IMO. We could actually integrate all these triggers into the event-triggers pattern Yngrid is creating.

The main inconsistency I see is the **alert trigger**, which uses the workflow connector and does not subscribe to anything automatically.

---

### Tal Borenstein — 12:16 PM

I got kinda lost in the discussion 😄 but will wrap up the thoughts with @ihor.panasiuk tomorrow on 1:1 to present something next week.

---

### Ihor Panasiuk — 12:19 PM

I'll grab everything and put into a presentation with current vs suggested behavior so we can discuss on the next check-in.

Thanks for this great discussion team! ❤️ True team work! 🎉

---

### Sergi Massaneda — 2:21 PM

> *"The main inconsistency I see is the alert trigger, which uses the workflow connector, and does not subscribe to anything automatically"*

👆 This is what we just discussed in the meeting.

---

## Follow-up (Next Day)

### Tal Borenstein — 8:58 AM

In the meantime, I've created this PR: [kibana#257342](https://github.com/elastic/kibana/pull/257342) — if someone could take a first look.

> **PR: [WIP] [One Workflow] Support execution metadata for workflows**
>
> Adds first-class support for execution metadata on workflow runs — a separate, system-controlled data channel distinct from user-defined workflow inputs.
> - Accept an optional `metadata: Record<string, unknown>` field in `POST /api/workflows/{id}/run` alongside `inputs`
> - Forward and persist metadata on the `EsWorkflowExecution` document, separate from the execution context
> - Expose metadata in the template rendering context so workflow authors can reference it via `{{ metadata.agent_id }}`, etc.

Haven't tested it yet at all.

---

## Key Takeaways

1. **Execution metadata** — Agreed to proceed with adding a `metadata` field to unblock Agent Builder team ([PR #257342](https://github.com/elastic/kibana/pull/257342)).
2. **Trigger semantics** — Current trigger types are inconsistent in what they define (input shape, subscription, execution behavior). Needs a broader design discussion.
3. **Whitelist vs blacklist** — Ihor advocates for triggers as a whitelist (only specified triggers can run the workflow); Tal prefers keeping manual invocation always open.
4. **Resource/entity concept** — Sergi proposes decoupling input shape from triggers via a `resource` concept (e.g., `inputs: [{ resource: alert }]`).
5. **Sergi's proposal** — Remove `alert`, `manual`, `scheduled` as trigger types; make `triggers` optional and only for event subscriptions; use top-level `schedule` and input `resource` instead.
6. **Next steps** — Ihor to prepare a presentation (current vs suggested behavior) for next check-in; Tal and Ihor to sync on 1:1.
