---
name: Generate HTML presentation
overview: Create a self-contained HTML presentation file with Elastic branding, competitor product icons, YAML syntax highlighting, and slide navigation, based on the 4 chapter artifacts.
todos:
  - id: create-html
    content: Create the single self-contained index.html with all slides, CSS, JS, and inlined SVG icons
    status: pending
isProject: false
---

# HTML Presentation: Workflow Trigger Semantics

## Approach

Single self-contained HTML file at `src/platform/plugins/shared/workflows_execution_engine/memory/presentation/index.html` using:

- **Styling:** Custom CSS with Elastic brand colors (dark navy `#1B1B3A`, teal `#00BFB3`, pink `#F04E98`, blue `#0077CC`), Inter/system font stack
- **YAML highlighting:** Prism.js from CDN (lightweight, supports YAML)
- **Slide navigation:** Custom JS -- keyboard arrows, click navigation, progress bar
- **Competitor icons:** SVG logos inlined for GitHub, n8n, Datadog, Tines
- **No external dependencies beyond CDN links** (Prism.js CSS/JS)

## Slide Structure (13 slides total)

**Chapter 1: The Current Problem**

- Title slide: "The Current Problem"
- Slide: Root cause summary (triggers decorative, API accepts anything, `inputs` vs `event` gap)
- Slide: Example 1 -- Payment API restart (YAML + what goes wrong + agent scenario)
- Slide: Example 2 -- Block IP / Jira sync (condensed, pattern summary table)

**Chapter 2: How Competitors Do It**

- Title slide: "Industry Analysis"
- Slide: GitHub Actions + n8n (hard gate model, `workflow_dispatch` example YAML, key quotes)
- Slide: Datadog + Tines (soft gate model, visibility gating table, key quotes)
- Slide: Comparison table (Elastic vs all 4 competitors)

**Chapter 3: Solution A -- Hard Gate**

- Title slide: "Solution A: Hard Gate"
- Slide: Principle + mental model ("call a trigger, not a workflow") + flow diagram
- Slide: Predefined shapes + alert-shape example YAML
- Slide: Agent Builder integration example + system changes table

**Chapter 4: Solution B -- Soft Gate**

- Title slide: "Solution B: Soft Gate"
- Slide: Principle + two layers (manual run + contextual visibility) + flow diagram
- Slide: Workflow page "Run" mockup + alert-only example
- Slide: Hard gate vs soft gate comparison table + recommendation

