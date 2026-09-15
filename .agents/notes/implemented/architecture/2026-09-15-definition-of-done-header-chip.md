# Agent Note: Definition-of-done record in a Session-header chip

Status: implemented

English | [中文](2026-09-15-definition-of-done-header-chip.zh.md)

## Problem

The definition-of-done record occupied the `conversation.input.dock` list in the composer's context stack, where it was always visible above the input: a fixed-height contract row, the turn receipt, and the checkpoint row. A reader consults that record at two moments — while the work is being stated, and when the evidence is filed — so the always-visible strip spent composer height and transcript width on chrome the reader was not reading, next to the todo, goal, and queue panels that do act on the next input. Users reported the strip as invasive.

## Decision

`packages/client/ui-done` registers into `conversation.session.header.utilities`, the right-aligned Session utilities list in the Conversation header. That seat is declared as a `list` at `session` scope and rendered by the header component, so the move needed no edit to `ui-conversation` and adds no slot; the registration keeps its `order: 5`, behind the header's own controls. The session readout about the work belongs in the header, not in the composer's context stack.

The chip is one ellipsised line sized to the header's own controls — a 28px minimum height at 12px text, bounded to 46ch — carrying the status ring, the `STATED` or `PROVEN` label, the statement, the evidence once proven, and a chevron. Below 720px the statement line drops out and the ring, label, and chevron remain, so the header never grows on a narrow window. A Session with neither a contract nor a checkpoint renders no chip at all; a Session holding only checkpoints keeps the seat and reads the checkpoint title.

Clicking the chip opens the panel that carries the whole record: the statement and its evidence, the inline editor, the three verbs (prove, edit, clear), the turn receipt, and the checkpoint row. The panel is portaled to `document.body` and positioned against the chip through `useAnchoredPosition`, so the header's own clipping and stacking cannot cut it; it is a 380px surface bounded to the viewport width. Dismissal is an outside pointer press, Escape, or the chip itself, and Escape hands focus back to the chip. The editor owns Escape while it is open, because closing the panel there would discard the statement being amended.

The panel takes the shared glass material owned by `packages/client/ui-theme` — `--dsw-glass-surface`, `--dsw-glass-filter`, and `--dsw-glass-elevation`, declared once in the theme sheet with their reduced-transparency and no-backdrop-filter fallbacks ([Web styling](../../../../docs/web-styling.md)) — and the CSS module passes a pre-glass fallback to each token, so the panel stays a surface wherever the glass sheet is absent. `react-dom` and `@types/react-dom` join `devDependencies`, where the other portal-using client packages declare them.

## Testing

`tests/turn-receipt.client.spec.tsx` drives the chip and its panel directly: a Session with neither half renders nothing, one click swaps the one-line chip for the record, the panel's receipt joins the contract's verdict with the turn's published paths, Escape closes it and returns focus to the chip, the open editor keeps Escape for itself, an outside pointer press dismisses the panel, and each of the three verbs reaches the injected command call with a rejected verb surfacing its failure line. The same file keeps the receipt's own cases: `NOT_ASSESSED` for a stated contract, for a proven contract carrying no evidence, and for an absent capability, which the panel states outright rather than implying a turn that changed nothing.

## Alternatives considered

**Keep the record in the composer dock and slim it.** A shorter contract row would have cut the vertical cost while leaving the panel in front of the input, and it would have kept the seam already wired. It lost because the complaint was placement, not height: the record still read as part of the composer, and the receipt and checkpoint row had nowhere to go but a scroll region inside a strip that must not grow.

**Pin a strip to the top of the transcript.** A strip above the conversation would never grow the composer and never be scrolled away. No seat exists there, so it would have meant adding one to the shared `ui-conversation` package — a wider change to a package that owns the transcript, for a surface whose reader-facing job is a Session readout that the header already provides.

**Open a modal dialog instead of a popover.** A modal would escape the header's clipping without a portal and could hold the whole record without a size bound. It also takes the rest of the interface away, which is too much ceremony for a record the reader consults beside the conversation; the anchored panel keeps the transcript readable while the record is open.

**Keep the turn receipt and checkpoint row always visible.** The receipt carries the paths the current turn produced, and the checkpoints are the restore points for the Session — the two halves a reader might want without a click. Keeping them in the header would have made the always-visible surface taller than the strip it replaced, which is the property the change was made to remove.

## Consequences

The composer's context stack holds only the panels that act on the next input, and the contract, its verdict, and its receipt live in the header as a standing readout about the Session. The record is always one click away rather than always on screen: an ellipsised statement with a `title` carrying the full statement and evidence is what a reader sees without opening the panel.

The chip sizes itself from the header's own controls rather than from the record, so a long statement never widens the bar and never wraps it. The panel is drawn outside the header's box, which is what removes the clipping constraint, at the cost of a portal: the component now depends on `react-dom`, and its tests must supply a live `document.body`. Panel dismissal owns three routes (outside pointer, Escape, and the chip), with Escape delegated to the editor while that editor is open so a keystroke cannot discard an in-progress statement.
