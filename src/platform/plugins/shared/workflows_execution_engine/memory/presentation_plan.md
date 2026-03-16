# HTML Presentation: Workflow Trigger Semantics

## Tone

The presentation tone is **constructive and forward-looking**: "We can do better." It is NOT a criticism of past decisions or a "competitors are better" comparison. The framing throughout:

- Current problem slides: "Here's what we can improve" -- not "here's what's broken"
- Competitor slides: "Here's what we can learn from the industry" -- not "they're ahead of us"
- Improvements plan: "Here's our plan to level up" -- not "here's what we should have done"
- The narrative arc: opportunity, not failure

## Approach

Multi-file structure at `src/platform/plugins/shared/workflows_execution_engine/memory/presentation/` for easier manual editing:

```
presentation/
  index.html              # entry point -- loads styles, slides, and JS
  styles.css              # all CSS styles
  slides.js               # navigation logic + Prism init
  slides/
    01_title.html         # one file per slide
    02_agenda.html
    03_ch1_title.html
    04_validation_gap.html
    05_guardrails.html
    06_agent_contracts.html
    07_opportunities.html
    08_ch2_title.html
    09_github_n8n.html
    10_datadog_tines.html
    11_common_patterns.html
    12_ch3_title.html
    13_mental_model.html
    14_hybrid_gate.html
    15_editor_ux.html
    16_event_flow.html
    17_triggers_namespace.html
    18_schemas.html
    19_visibility.html
    20_discussion.html
```

`index.html` loads `styles.css`, includes all slide files (via inline or build step), and loads `slides.js`. Each slide file contains only the slide's HTML (the `<div class="slide">...</div>` block) so individual slides can be edited without touching the rest.

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
      03_Ch1Title.tsx
      04_ValidationGap.tsx
      05_Guardrails.tsx
      06_AgentContracts.tsx
      07_Opportunities.tsx
      08_Ch2Title.tsx
      09_GithubN8n.tsx
      10_DatadogTines.tsx
      11_CommonPatterns.tsx
      12_Ch3Title.tsx
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
- Where We Are Today
- What the Industry Does
- How We Can Improve
- Discussion

---

### Chapter 1: Where We Are Today

**Title slide:** "Where We Are Today"
- Subtitle: "Opportunities to strengthen trigger enforcement"

**Slide: Inputs and Triggers Are Disconnected**
- Source: 01, Problem 1
- Two-column layout, each column shows a different workflow YAML with a problem card below it
- **Left column — Problem 1: Inputs disconnected from triggers.** YAML: workflow with `triggers: [manual, scheduled]` and workflow-level `inputs: [message: string]`. The scheduled trigger fires every 10s — but `inputs` are defined globally, not per-trigger. Who provides `message` when the schedule fires? The relationship between inputs and triggers is ambiguous.
- **Right column — Problem 2: No trigger enforcement on API calls.** YAML: workflow with only `triggers: [alert]`, no `inputs` defined. Since there are no inputs to validate, any caller can POST /run with arbitrary data and the workflow executes — the alert trigger declaration is not enforced at runtime. The caller doesn't need to match the declared trigger.
- Flow diagram below both columns: POST /run → arbitrary data → no trigger check → executes

**Slide: Production Workflows Need Stronger Guardrails**
- Source: 01, Problem 2
- YAML example: Payment API restart workflow (alert-only, no inputs)
- Right column: What can happen (4 bullets, verb-first), agent scenario card
- Key message: trigger declaration should be the guardrail -- authors shouldn't need defensive `if` conditions

**Slide: Agent Integration Needs Typed Contracts**
- Source: 01, Problem 3
- Key message: as Agent Builder grows, workflows need discoverable schemas so agents know what data to provide
- Today: tool contract is `Record<string, any>` -- agents have no guidance

**Slide: Opportunities Summary**
- Source: 01, pattern table
- 4-row table: Area / Today / Opportunity
- Framing: "today" and "opportunity" columns, not "problem" and "consequence"

---

### Chapter 2: What the Industry Does

**Title slide:** "What the Industry Does"
- Subtitle: "Patterns we can learn from"

**Slide: GitHub Actions, n8n, and Tines (hard-gate)**
- Source: 02, GitHub Actions + n8n + Tines sections
- Two-column layout: GitHub Actions (left, with YAML example), n8n + Tines stacked (right, with bullet points each)
- All three share the same model: strict entry-point enforcement, no trigger = no invocation
- GitHub Actions: `workflow_dispatch` with typed inputs, key doc quote
- n8n: requires trigger node, offers Form Trigger with typed fields, separates production vs manual runs
- Tines: webhook entry action is the only way in, Send to Story requires defined inputs (fails on missing), testing always replays through the webhook entry point — there is no "bypass the trigger" option. Tines does NOT have named trigger types or trigger-type selection like Datadog. It belongs in the strict-enforcement group.
- Model badge: "No trigger = no invocation, period."

**Slide: Datadog Uses Trigger-Aware Invocation (soft-gate) **
- Source: 02, Datadog section
- Full-width single-competitor slide (Datadog only — Tines moved to previous slide)
- Datadog's unique model: multiple named trigger types per workflow (Monitor, Security, API, etc.), manual runs are trigger-aware (UI presents trigger-specific input form), visibility gating across the product (Monitor notification needs Monitor trigger, Security panel needs Security trigger, etc.)
- Two-column: left = trigger-aware invocation bullets + visibility table, right = key differentiator explanation (why this is the closest to what we want)
- Datadog badge: "Closest competitor"

**Slide: Common Patterns Across the Industry**
- Source: 03, common trigger patterns
- 6 patterns distilled: triggers are contracts, invoke trigger not workflow, manual requires mechanism, consistent event path, visibility gating, trigger determines shape
- Key message: these are not product-specific choices -- they are industry consensus that we can adopt

---

### Chapter 3: How We Can Improve

**Title slide:** "How We Can Improve"
- Subtitle: "8 improvements following industry patterns"

**Slide: New Mental Model**
- "You don't call a workflow -- you call a trigger of a workflow"
- Flow diagrams: Today (arbitrary data) vs Proposed (trigger-validated)
- Hybrid model: production hard-gated (manual trigger), test soft-gated (any trigger)

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
- `triggers.alert.event.alerts` for runtime data
- `triggers.alert.with.rule_name` for static YAML config
- Truthy/falsy: `if: ${{ triggers.alert }}`
- YAML example with conditional branching
- **Scalability emphasis:** The `triggers.*` namespace makes adding new trigger types (case, scheduled, custom, etc.) trivial — each new trigger automatically gets its own `triggers.<type>.event.*` / `triggers.<type>.with.*` subtree, conditional branching via `if: ${{ triggers.<type> }}`, and editor autocomplete. No refactoring of existing steps or event paths needed — the namespace pattern scales to any number of triggers without touching existing code.

**Slide: Visibility Gating**
- Source: 04, Improvement 5
- Table: Product context / Required trigger / Effect
- Rule actions -> alert trigger, Agent Builder -> manual trigger, Editor Test -> always available

---

### Discussion slide
- "Let's discuss."
- Subtitle: "We have a clear plan. Let's align on priorities and next steps."
