---
name: Coamb
description: A dark, compact dashboard for recorded delivery and observable usage.
colors:
  amber: "#f2b33d"
  green: "#80c9a5"
  red: "#f49b98"
  bg: "#080808"
  panel: "#141414"
  raised: "#242424"
  line: "#292929"
  control: "#444"
  text: "#f5f5f5"
  muted: "#b4b4b4"
  faint: "#949494"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  metric:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.4
  path:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  status: "4px"
  control: "6px"
  panel: "8px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  large: "24px"
  canvas: "28px"
components:
  action:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  action-hover:
    backgroundColor: "{colors.raised}"
  view-selected:
    backgroundColor: "{colors.raised}"
    textColor: "#fff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  status:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.status}"
    padding: "2px 7px"
  summary:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  chart-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "16px 18px 12px"
---

# Design System: Coamb

## Overview

**Creative North Star: "Dark, compact, clear"**

Coamb follows the user's Ponytail-like dashboard direction: neutral working surfaces, readable tables and restrained charts. Its character comes from density, alignment and honest labels, not ornament. The Coamb name sits beside an amber hexagonal C mark, without an attribution line.

This system is extracted from `scripts/board/style.css`, `render.mjs` and `client.js`. It describes the Board; Nectar's CLI remains `nectar board`. Surface composition and purpose belong in the surface brief, not in this global visual contract.

**Key Characteristics:**

- Neutral dark surfaces with amber data and focus accents.
- Compact system typography and aligned numeric columns.
- Flat panels, modest corners and native controls.
- Visible units, measurement coverage and unknown states.

## Colors

The palette separates structure through neutral lightness and reserves color for data, identity, focus and recorded state.

### Primary

**Amber** is the chart series, Coamb mark, input caret and keyboard-focus color. It is not the selected-navigation fill.

### Neutral

**Background** carries the canvas and rail; **panel** groups tables, summaries, charts and inputs; **raised** marks selected view buttons, status backgrounds, notices and button hover. **Line** separates mobile work rows; **control** gives fields and actions a visible boundary. **Text**, **muted** and **faint** separate primary content, supporting information and metadata.

Green identifies recorded done/passed states; red identifies failed, blocked or error states. Other statuses remain neutral and retain a text label.

**The Data Accent Rule.** Keep navigation neutral; use amber for plotted data, the mark and focus, and status colors only with their recorded labels.

## Typography

The system UI stack serves headings, body, controls and SVG labels; there is no separate display face. Monospace is reserved for artifact paths. The frontmatter records the observed desktop roles, not a mathematical type scale.

Page headings use the headline role, section headings the title role, and summary values the metric role. Supporting labels and table headers use the label role; table content sits between labels and body. On phones, page headings and metric values reduce to (22px), while work-row content uses the body size. The brand is (20px, weight 600), reducing to (18px) on phones.

**The Aligned Numbers Rule.** Use tabular numerals for counts and measurements, right-align numeric table columns, and keep value/unit groups together. Preserve explicit unknown markers instead of turning missing measurements into zero.

## Layout

The desktop shell uses a fixed rail (210px) and a flexible canvas. The canvas has equal gutters (28px) and a maximum width (1600px). Summaries use four equal columns; panel edges share the canvas alignment. Field groups wrap, and long identifiers can break inside their cells.

At viewport widths up to (1100px), the rail becomes a horizontal header with a native Projects disclosure; canvas gutters reduce to (24px). The project list opens above the content, and project buttons have a minimum height of (44px). At widths up to (640px), gutters reduce to (16px), header actions stack beneath the title, and summaries become two columns.

On phones, delivery rows become two-column records with visible verification labels and expandable evidence. Session data stays a horizontally scrollable table with a sticky first column; its minimum width is (800px). Interactive fields, buttons and disclosure targets have a minimum height of (44px) at this breakpoint. Desktop controls have a minimum height of (36px).

Attributed usage uses the same table language, with a minimum width of (640px)
and a readable work/skill identity column. On phones it scrolls inside its own
frame rather than breaking names into individual characters. Work/Skill filters
scope interval totals; full-session totals stay explicitly labeled separately.

## Elevation & Depth

The Board uses no shadows, gradients, blur or translucent surfaces. Depth comes from the background/panel/raised sequence, fine separators and local overlap for the project menu. Table row rules remain visible without drawing a full grid around every cell.

**The Flat Surface Rule.** Distinguish grouping and state through tone and spacing; keep panels flat.

## Shapes

Corners are modest: status labels use the status radius, controls and notices the control radius, and shared panels the panel radius. Inputs and ordinary actions have a single-pixel control border. Navigation and view buttons remove that border visually; the selected view gains a raised fill. The Coamb mark is a filled hexagonal C inspired by a honeycomb cell. Its single SVG source, `scripts/board/coamb-mark.svg`, is embedded as a data URI for both the 28px sidebar mark and favicon; no network or raster asset is required.

## Components

### Buttons and fields

Actions use panel fill, a control border and the label role; view buttons use body text and a transparent resting background. Hover moves an ordinary action to the raised tone with a short background transition (120ms, ease-out). Reduced-motion preference removes that transition. Disabled buttons use faint text. All keyboard-focusable elements receive an amber outline (2px, offset 3px). Inputs retain native editing behavior, an amber caret and faint placeholder text; selects remain native.

### Navigation

Project buttons are left-aligned with a small topic count opposite the name. Selection changes text to white without an amber fill. On narrower screens the native disclosure owns opening and closing; selecting a project closes it. Delivery and Usage & cost are mutually exclusive view buttons whose selected state is conveyed by `aria-pressed` and raised fill.

### Summaries, statuses and tables

Summary items share one panel, with a supporting label above the value and optional coverage below it. Their desktop inset is (15px 18px), reducing by breakpoint. Status labels use neutral raised backgrounds and short, literal state text. Tables use sparse row separators and desktop cell padding (13px 16px); detail lines are visually secondary and can wrap. Native disclosures reveal document links and provenance without replacing the row context.

### Charts

Charts use one amber SVG bar series, faint axis text, horizontal grid lines and a labeled native measure selector. Date positions follow UTC session start dates. The caption names that basis; cost, token and time units remain explicit. Unknown values are not plotted as zero. An adjacent Chart data disclosure exposes exact values and measurement coverage, while a no-measurements state replaces an empty plot.

## Do's and Don'ts

### Do:

- **Do** retain neutral navigation and the Data Accent Rule.
- **Do** keep numeric alignment, units, coverage and unknown states visible.
- **Do** preserve native controls, keyboard focus and the responsive target sizes.
- **Do** keep component previews and sample measurements explicitly synthetic.

### Don't:

- **Don't** replace recorded state labels with color alone.
- **Don't** present partial measurements as complete or missing values as zero.
- **Don't** add shadows or decorative gradients to the flat Board surfaces.
- **Don't** shrink the desktop table into unreadable phone columns; use the implemented reflow or scroll pattern.
