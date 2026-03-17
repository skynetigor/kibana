# HTML Presentation: Workflow Trigger Semantics

## Tone

The presentation tone is **constructive and forward-looking**: "We can do better." It is NOT a criticism of past decisions or a "competitors are better" comparison. The framing throughout:

- Current problem slides: "Here's what we can improve" -- not "here's what's broken"
- Competitor slides: "Here's what we can learn from the industry" -- not "they're ahead of us"
- Improvements plan: "Here's our plan to level up" -- not "here's what we should have done"
- The narrative arc: opportunity, not failure

## Approach

**Design system (from reference images):**

- **Title/chapter slides**: Elastic blue (`#0077CC`) solid background, white text, Elastic multicolor logo bottom-left with "elastic | The Search AI Company" tagline, decorative geometric artwork on right side
- **Agenda slide**: White background, dark text (`#1D1D1D`), numbered items (`01`, `02`, etc.) in Elastic blue on the left, item text bold right-aligned, blue horizontal separator lines between items, "elastic" logo bottom-right
- **Content slides**: White/very light gray (`#F5F7FA`) background, dark text, open-circle bullet points, bold for emphasis, generous white space, "elastic" logo bottom-right in gray
- **Code blocks**: Light code theme (not dark) -- use Prism `prism.css` (default light theme) instead of `prism-tomorrow.css`
- **Accent colors**: Elastic blue (`#0077CC`) for highlights and links, Elastic teal (`#00BFB3`) for success/positive, Elastic pink (`#F04E98`) for warnings only when needed
- **Typography**: Clean, professional. Titles bold, body regular weight, generous line-height
- **Tables**: Clean lines, minimal borders, header row in light blue/gray

Technologies used:

- **Framework:** React app (Vite + React + TypeScript). Each slide is a React component. This enables hot reload during editing, component reuse, and clean separation of concerns.
- **Styling:** Tailwind CSS (utility-first). Custom Elastic theme colors defined in `tailwind.config.ts`. Light theme matching Elastic presentation style (see reference images in `presentation_artifacts/layout_examples/`). Blue title slides, white content slides, dark text, Inter font. Minimal custom CSS -- prefer Tailwind utilities directly on elements.
- **YAML highlighting:** `prism-react-renderer` package for syntax highlighting inside React components.
- **Slide navigation:** React state (current slide index). Keyboard arrows only (no click navigation). Progress bar and slide counter as React components. Current slide index is persisted in the URL hash (e.g., `#5`) so refreshing the page restores the same slide. On load, read the hash to initialize the slide index; on navigation, update the hash. Also listen for `hashchange` events (browser back/forward).
- **PDF export:** Must work via the browser's built-in Print dialog (Cmd+P / Ctrl+P → "Save as PDF"). The `@media print` CSS rules in `index.css` override the stacking layout: all slides become `position: static`, `opacity: 1`, each with `page-break-after: always` so every slide lands on its own page. `@page { size: landscape; margin: 0; }` sets landscape orientation with no margins. `print-color-adjust: exact` ensures background colors (title slide blue, code block gray) print correctly. Navigation chrome (progress bar, slide counter, watermark) is hidden with `display: none`. The root container switches to `overflow: visible` and `height: auto` so all slides are in the document flow. Use `.slide-wrapper` class on each slide div and `.nav-chrome` class on UI elements to target them in print rules.
- **Competitor icons:** Copy SVGs from `presentation_artifacts/icons/` into `presentation/public/icons/`. Reference with absolute paths from Vite's public dir: `<img src="/icons/github-svgrepo-com.svg">`. Do NOT use relative paths like `../../` -- Vite won't serve files outside the project root. Do NOT inline SVG -- the files are complex and break.
  - Elastic: `/icons/elastic-logo.svg`
  - GitHub: `/icons/github-svgrepo-com.svg`
  - n8n: `/icons/n8n.png`
  - Datadog: `/icons/datadoghq-icon.svg`
  - Tines: `/icons/tines.png`
- **Best practices:** Active slide titles, 6x6 rule for bullets, parallelism, F-pattern layout, generous white space
- **YAML blocks:** Must fit the slide without scrolling. Keep examples short (10-15 lines max). If a longer example is needed, trim to the essential lines and use comments like `# ...` for omitted parts. No `max-height`, no `overflow: auto` on code blocks.
- **YAML styling must match the workflow editor.** All YAML code blocks (both `CodeBlock` component and inline editor mockups) must use the same color scheme as the Kibana workflow YAML editor (`workflows_management/public/widgets/workflow_yaml_editor/`). The editor uses a custom Monaco theme derived from EUI light theme tokens. Colors for the presentation:
  - **Keys** (property names before `:`): `#007871` (EUI `textSuccess`, teal-green)
  - **String values**: `#343741` (EUI `textPrimary`, dark gray)
  - **Comments** (`#`): `#69707D` (EUI `textSubdued`, gray)
  - **Delimiters** (`:`, `-`, `?`, `[`, `]`): `#69707D` (EUI `textSubdued`)
  - **Numbers**: `#BA3D76` (EUI `textAccent`, pink)
  - **Booleans/keywords** (`true`, `false`, `null`): `#343741` (EUI `textPrimary`)
  - **Tags** (`!tag`): `#BD271E` (EUI `textDanger`, red)
  - **Default text**: `#343741` (EUI `textParagraph`)
  - **Background**: `#F5F7FA` (EUI `backgroundBaseSubdued`)
  - **Font**: `Roboto Mono` (same as `@kbn/code-editor`), loaded from Google Fonts in `index.html`
  - Apply these in the `CodeBlock` component via a custom `prism-react-renderer` theme object (not `themes.github`). For inline editor mockups (like slide 15), use the same hex values in Tailwind arbitrary color classes.

**Project structure:**

```
presentation/
  serve.sh                # runs `npm install && npm run dev` (Vite on port 5000)
  package.json            # deps: react, react-dom, vite, tailwindcss, prism-react-renderer, @elastic/eui, @elastic/datemath, @emotion/react, @emotion/css, moment
  vite.config.ts          # dev server config (port 5000)
  tailwind.config.ts      # Elastic theme colors, Inter font
  postcss.config.js       # Tailwind PostCSS plugin
  index.html              # Vite entry point
  src/
    main.tsx              # React entry, renders <App />
    App.tsx               # Deck: slide state, keyboard nav, progress bar
    index.css             # Tailwind directives (@tailwind base/components/utilities) + minimal overrides
    slides/
      index.ts            # exports ordered array of all slide components
      01_Title.tsx
      02_Agenda.tsx
      02b_WhatIsATrigger.tsx
      03_Ch1Title.tsx
      03b_CurrentTriggers.tsx
      04_ValidationGap.tsx
      04c_ManualBypass.tsx
      07_Opportunities.tsx
      08_Ch2Title.tsx
      09_GithubN8n.tsx
      10_DatadogTines.tsx
      11_CommonPatterns.tsx
      12_Ch3Title.tsx
      12b_RealTriggers.tsx
      13_MentalModel.tsx
      14_HybridGate.tsx
      15_EditorUx.tsx
      16_EventFlow.tsx
      17_TriggersNamespace.tsx
      18_Schemas.tsx
      19_Visibility.tsx
      20_Discussion.tsx
    components/
      TitleSlide.tsx       # reusable: blue bg, chapter label, h1, subtitle, elastic logo
      ContentSlide.tsx     # reusable: white bg, h2, children wrapper
      TwoColumns.tsx       # reusable: two-column grid layout
      CodeBlock.tsx        # wraps prism-react-renderer for YAML highlighting
      FlowDiagram.tsx      # reusable: flow-box -> arrow -> flow-box chains
      LogoRow.tsx          # reusable: competitor icon + name + optional badge
      Card.tsx             # reusable: info/success/warn card with title + content
      SlideTable.tsx       # reusable: styled table with header + rows
      Badge.tsx            # reusable: colored inline badge
      BulletList.tsx       # reusable: styled list with open-circle bullets
```

**Component reuse principle:** Common patterns across slides (two-column layout, code blocks, flow diagrams, cards, tables, logo rows, badges, bullet lists) are extracted into shared components. Slide files compose these components with content -- they should contain minimal styling logic, mostly Tailwind utility classes for spacing and alignment.

**EUI components:** `@elastic/eui` is installed as a package and can be used where it fits naturally (e.g., `EuiTable`, `EuiBadge`, `EuiCode`, `EuiIcon`). Wrap the app in `EuiProvider` in `main.tsx`. Prefer Tailwind for layout/spacing and EUI for interactive or complex components where it saves effort.

## Known pitfalls (from previous builds)

These issues were encountered and fixed during implementation. Address them upfront:

- **EUI v99+ has no CSS file.** Do NOT import `@elastic/eui/dist/eui_theme_light.css` -- it doesn't exist. `EuiProvider` handles styles via Emotion. Just wrap in `<EuiProvider colorMode="light">` and import nothing else.
- **EUI reset breaks Tailwind borders.** EUI's CSS reset (Eric Meyer-based, injected via Emotion at runtime) applies `border: none` to most HTML elements (`div`, `span`, `pre`, `td`, `th`, `blockquote`, etc.) with element-level specificity (0-0-1). This overrides Tailwind Preflight's `* { border-style: solid; border-width: 0 }` (specificity 0-0-0), which utilities like `border`, `border-2` rely on. Note: `*` has zero specificity, so `html *` is only 0-0-1 — tied with EUI, and EUI wins via cascade order since Emotion injects at runtime. Fix: `index.css` includes `html body * { border-style: solid; border-width: 0; }` (specificity 0-0-2, since `*` contributes 0) that definitively beats EUI's element selectors.
- **`${{` in template literals breaks TypeScript.** YAML strings containing `${{ triggers.alert }}` or `{{ event.* }}` cannot be in backtick template literals because `${` starts an expression. Use `['line1', 'line2'].join('\n')` for YAML strings that contain `${{` or `{{`.
- **ContentSlide title prop must accept ReactNode.** Some slides pass JSX (e.g., inline `<code>`) as the title. Type the prop as `React.ReactNode`, not `string`.
- **Icon SVGs must NOT be inlined.** The competitor SVG files are complex multi-path files. Inlining approximations breaks them. Always use `<img src="...">` with relative paths to the actual SVG files.
- **Vite needs the port free.** If port 5000 is occupied from a previous run, Vite auto-picks another port. The `serve.sh` should kill any existing process on port 5000 before starting, or accept the auto-assigned port.
- **Tailwind content paths.** Ensure `tailwind.config.ts` includes `'./index.html'` and `'./src/**/*.{ts,tsx}'` so Tailwind scans all template files.
- **node_modules in .gitignore.** Add `presentation/node_modules` to the project's `.gitignore` or a local `.gitignore` in the presentation directory.
- **Static assets must be in `public/`.** Vite's dev server only serves files from the project root and `public/` directory. Files outside the project root (like `../../presentation_artifacts/icons/`) are NOT accessible via relative URL paths in `<img src>`. Copy static assets into `presentation/public/` and reference with absolute paths (e.g., `/icons/github.svg`). Relative `../../` paths silently fail -- images appear broken with no console error.
- **All YAML examples must be correctly formatted.** Every YAML snippet shown in the presentation -- whether in a `CodeBlock`, inline mockup, or editor mockup -- must use proper indentation that matches real YAML syntax. HTML collapses whitespace by default, so any container rendering YAML with leading spaces must use `white-space: pre` (or be inside a `<pre>` tag). When building editor-style mockups with per-line rendering, store the raw indented text (e.g., `'  - type: alert'`, `'      severity: critical'`) and ensure the container preserves it. Never rely on invisible `<span>` padding or repeated `&nbsp;` for indentation -- use real space characters with `white-space: pre`.

## Source material

All content derived from:
- `presentation_artifacts/01_current_problem.md`
- `presentation_artifacts/02_competitor_analysis.md`
- `presentation_artifacts/03_common_trigger_patterns.md`
- `presentation_artifacts/04_improvements_plan.md`

## Slide Structure

### Title slide
- "Workflow Trigger Semantics"
- Subtitle: "How we can make triggers work the way users expect"
- Ihor Panasiuk, One Workflow Team, March 2025

### Agenda slide
- What Is a Trigger
- Where We Are Today
- What the Industry Does
- How We Can Improve
- Discussion

---

### What Is a Trigger?

**Slide: What Is a Trigger?**
- Standalone definition slide before Chapter 1
- Sets the universal benchmark: what a trigger should be in any workflow system
- Definition text above the cards: "Trigger — a declarative entry point that fires a workflow in response to an event (alert, schedule, or manual invocation), optionally filtered by a condition."
- Two-column card layout with the two properties:
  - **Autonomous** — fires on its own, without human intervention. Configure once in YAML, it starts working automatically.
  - **Self-contained** — carries all the context the workflow needs. Defines the event shape, data contract, and invocation mechanism in one place.
- Key message card: "You configure it in YAML, and it starts working. No manual wiring in other UIs, no external setup required."

---

### Chapter 1: Where We Are Today

**Title slide:** "Where We Are Today"
- Subtitle: "Opportunities to strengthen trigger enforcement"

**Slide: Current Trigger Types**
- Three-column layout, one column per trigger type: `manual`, `alert`, `scheduled`
- Each column: trigger name as monospace heading + colored badge + short YAML snippet + one-line description
- **`manual`** — badge: "decorative" (pink). Doesn't affect anything. The "Run workflow" button in the UI works regardless of whether you have a manual trigger in YAML or not.
- **`alert`** — badge: "decorative" (pink). Not a real trigger. You have to manually connect the workflow to a rule from the Rules UI, and it doesn't enforce anything — even without an alert trigger, you can still attach and run a workflow from a rule.
- **`scheduled`** — badge: "real trigger" (teal). The only real trigger. Configure it in YAML — the workflow runs automatically on the configured schedule.
- Key message card at bottom: "Two out of three trigger types are decorative — they don't actually trigger anything and don't enforce how the workflow is invoked."

**Slide: Inputs and Triggers Are Disconnected**
- Source: 01, Problem 1
- Two-column layout, each column shows a different workflow YAML with a problem card below it
- **Left column — Problem 1: Inputs disconnected from triggers.** YAML: workflow with `triggers: [manual, scheduled]` and workflow-level `inputs: [message: string]`. The scheduled trigger fires every 10s — but `inputs` are defined globally, not per-trigger. Who provides `message` when the schedule fires? The relationship between inputs and triggers is ambiguous.
- **Right column — Problem 2: No trigger enforcement on invocation.** YAML: workflow with only `triggers: [alert]`, no `inputs` defined. Since there are no inputs to validate, any invoker can execute the workflow — the alert trigger declaration is not enforced at runtime. Three invokers that all bypass: API call (POST /run with arbitrary data), "Run" button in the UI, Agent call. None need to match the declared trigger.
- Flow diagram below both columns: API / UI / Agent → arbitrary data → no trigger check → executes

**Slide: Invocation Isn't Trigger-Aware**
- Two-column layout
- **Left column:** YAML example — alert-only workflow ("Restart on OOM Alert") with steps that reference `event.rule.name`. Warning card: "Designed for alert — but nothing stops other callers."
- **Right column:** Three invocation paths that all bypass the trigger (3 items with icons/labels): **API call** (any client can POST /run), **Manual run from UI** (user clicks "Run workflow" button), **Agent call** (AI agent invokes workflow as a tool). All three execute the workflow without alert context — `event.rule.name` is undefined, no alert data provided. Info card: "The author has no way to prevent this. Trigger declarations are metadata — they don't gate invocation."
- Flow diagram: three parallel paths (API / UI / Agent) all converging → trigger ignored → no event data → executes
- Key message: any caller — API, UI, or agent — can bypass the configured triggers. The workflow runs without the context it was designed for, and the author cannot prevent it.

**Slide: Opportunities Summary**
- Source: 01, pattern table
- 4-row table: Area / Today / Opportunity
- Rows: Trigger types (2 of 3 decorative → autonomous & self-contained), Trigger enforcement (declarative only → validate at runtime), Invocation bypass (any caller bypasses → require specific trigger), Execution context (flat event → typed triggers.* namespace)
- Framing: "today" and "opportunity" columns, not "problem" and "consequence"

---

### Chapter 2: What the Industry Does

**Title slide:** "What the Industry Does"
- Subtitle: "Patterns we can learn from"

**Slide: GitHub Actions, n8n, and Tines — Triggers Gate All Invocation**
- Source: 02, GitHub Actions + n8n + Tines sections
- Mental model statement above the columns: "You don't run a workflow — you invoke a trigger of a workflow. Triggers are the only entry points. They are autonomous and self-contained."
- Key emphasis: triggers don't just control automatic invocation — they are the ONLY entry points. If you define `pull_request` in GitHub Actions, that workflow can ONLY be triggered by pull requests. There is no way to run it manually unless you explicitly add `workflow_dispatch`.
- Two-column layout
- **Left column (GitHub Actions):** Two YAML examples stacked. First: `on: pull_request` only — this workflow runs ONLY on PRs, no manual invocation possible. Second: `on: [pull_request, workflow_dispatch]` — now manual runs are enabled. The point: manual invocation is opt-in, not the default.
- **Right column (n8n + Tines):** Same principle applies. n8n: if you use a Webhook Trigger node, the workflow only fires on webhooks — add Manual Trigger node explicitly for test runs. Tines: webhook entry action is the only way in, no bypass. Testing always replays through the configured entry point.
- Model badge: "Triggers are the only entry points. No trigger = no invocation."

**Slide: Datadog Uses Trigger-Aware Invocation (soft-gate)**
- Source: 02, Datadog section
- Mental model statement above the columns (same as previous slide): "You don't run a workflow — you invoke a trigger of a workflow. Triggers are the only entry points. They are autonomous and self-contained."
- Full-width single-competitor slide (Datadog only — Tines moved to previous slide)
- Datadog's unique model: multiple named trigger types per workflow (Monitor, Security, API, etc.), manual runs are trigger-aware (UI presents trigger-specific input form), visibility gating across the product (Monitor notification needs Monitor trigger, Security panel needs Security trigger, etc.)
- Two-column: left = trigger-aware invocation bullets + visibility table, right = key differentiator explanation (why this is the closest to what we want)
- Datadog badge: "Closest competitor"

**Slide: Common Patterns Across the Industry**
- Source: 03, common trigger patterns
- Mental model statement above the patterns: "You don't run a workflow — you invoke a trigger of a workflow."
- 8 patterns distilled: triggers are autonomous (fire on their own once configured), triggers are self-contained (carry all context the workflow needs), triggers are contracts, invoke trigger not workflow, manual requires explicit mechanism, consistent event path, visibility gating, trigger determines shape
- Key message: these are not product-specific choices -- they are industry consensus that we can adopt

---

### Chapter 3: How We Can Improve

**Title slide:** "How We Can Improve"
- Subtitle: "Improvements following industry patterns"

**Slide: Make Triggers Real Triggers**
- First content slide of Chapter 3 — sets the vision before diving into specific improvements
- Two-column layout
- **Left column:** Triggers should be autonomous and self-contained. Bullets: configured entirely in the workflow YAML, declare what they connect to and under what conditions, system reads the config and sets up routing automatically, no manual wiring in other UIs required. Success card: "The workflow is the single source of truth. If it's not in the YAML, it doesn't happen."
- **Right column:** Alert trigger example YAML — trigger declares the rule name, severity, condition. The system reads this and automatically routes matching alert events to the workflow. Info card contrasts today (declare `type: alert` then manually connect in Rules UI) vs proposed (system reads YAML and wires the connection for you).

**Slide: New Mental Model**
- "You don't call a workflow -- you call a trigger of a workflow"
- Flow diagrams: Today (arbitrary data) vs Proposed (trigger-validated)

**Slide: Hybrid Production/Test Gate**
- Source: 04, Improvement 3
- Matrix table: Production + manual = allowed, Production + alert = system-only, Test + any = allowed
- API: POST /run (production, manual trigger) vs POST /test (test, any trigger)

**Slide: Editor UX for Test Runs**
- Source: 04, Improvement 3 editor UX
- Two-column layout with visual mockups derived from the existing workflow management UI
- **Key difference from today's modal:** the current `WorkflowExecuteModal` trigger tabs (Alert, Document, Manual, Historical) are disconnected from the workflow's actual trigger definitions -- they are generic input methods for passing arbitrary data. The proposed modal instead shows the workflow's declared triggers as the selection options. Each card corresponds to a `type` defined in the YAML `triggers:` section. The modal reads the workflow definition and only offers the triggers the author declared.
- **Trigger types shown in both the modal and the YAML mockup:** Alert (corresponds to `- type: alert`), Case (corresponds to `- type: case`), Manual (corresponds to `- type: manual`). The YAML and the modal must always match -- the modal options are derived from the YAML triggers.
- **Left: Trigger-selector modal mockup** — mirrors the existing `WorkflowExecuteModal` layout (in `workflows_management/public/features/run_workflow/ui/workflow_execute_modal.tsx`): `EuiModal`, a row of radio-card `EuiButton` cards, a trigger-specific form below, and a green Run button in the footer. But the cards now show the workflow's actual triggers (Alert, Case, Manual) instead of generic input methods. Below the cards: a form rendered from the selected trigger's schema. Footer: green `EuiButton` with `iconType="play"`, `color="success"`, text "Run".
- **Right: Per-trigger play button mockup** — mirrors the existing per-step `RunStepButton` (in `workflows_management/public/widgets/workflow_yaml_editor/ui/run_step_button.tsx`). The existing pattern: when a step is focused in the YAML editor, a floating pill appears at the step's top-right (`position: absolute`, `boxShadow`, `borderRadius`, white bg) containing a green play `EuiButtonIcon` (`iconType="play"`, `color="success"`, `iconSize="s"`) + a context menu button. The slide shows a mini YAML editor mockup with triggers: alert, case, manual -- each with a floating play button, demonstrating the proposed per-trigger play button reuses the existing step-run pattern.
- Both produce `isTestRun: true`

**Slide: Referenceable Schemas**
- Source: 04, Improvement 7
- `$ref: alert` inherits AlertEventPropsSchema
- `allOf` for extension
- Future: user-defined schema registry (community request)
- YAML examples: $ref, allOf, inline custom

**Slide: Unified Event Flow**
- Source: 04, Improvement 4
- All triggers produce `event` -- including manual calls
- No normalization boilerplate
- YAML example: steps reference `event.alerts` regardless of trigger source

**Slide: `triggers.*` Namespace**
- Source: 04, Improvement 8
- **Motivation / problems solved** (left column, above YAML):
  - Today: workflows with multiple triggers have no way to know WHICH trigger fired — steps can't branch based on trigger type
  - Today: runtime event data and static YAML config are mixed together — no clean separation
  - Today: adding a new trigger type requires rethinking how steps access data — no consistent pattern
  - Today: editor suggestions for `event` field are a union of all trigger schemas — hard to implement and confusing to use when a workflow has multiple triggers
- **Solution:** `triggers.*` namespace in execution context
  - `triggers.alert.event.alerts` for runtime data
  - `triggers.alert.with.rule_name` for static YAML config
  - Truthy/falsy: `if: ${{ triggers.alert }}` — branch based on which trigger fired
  - YAML example with conditional branching
- **Scalability emphasis:** The `triggers.*` namespace makes adding new trigger types (case, scheduled, custom, etc.) trivial — each new trigger automatically gets its own `triggers.<type>.event.*` / `triggers.<type>.with.*` subtree, conditional branching via `if: ${{ triggers.<type> }}`, and editor autocomplete. No refactoring of existing steps or event paths needed — the namespace pattern scales to any number of triggers without touching existing code.

**Slide: From Manual Wiring to Automatic Routing**
- Source: 04, Improvement 5
- Attention-grabbing note/card ABOVE the table: With fully autonomous triggers, manual wiring (e.g., connecting workflows to rules from the Rules UI) can likely be omitted entirely — the system reads the trigger config and does the routing. If manual wiring is still needed for some cases, visibility gating ensures only workflows with the right trigger type appear.
- Table: Product context / Required trigger / Effect
- Rule actions -> alert trigger, Agent Builder -> manual trigger, Editor Test -> always available

---

### Discussion slide
- "Let's discuss."
- Subtitle: "We have a clear plan. Let's align on priorities and next steps."
