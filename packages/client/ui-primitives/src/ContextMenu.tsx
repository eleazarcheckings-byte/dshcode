/**
 * Cursor-anchored context menu: the one mechanism every surface uses to offer
 * right-click actions.
 *
 * It reuses the dropdown card from `Menu.module.css` — surface, elevation,
 * radius, row metrics, danger row, heading and hairline — so a context menu
 * and an anchored dropdown are the same object to the eye. What it adds is
 * everything a *context* menu needs and an anchored dropdown does not:
 *
 * - a point anchor (the pointer) beside the element anchor the dropdown uses;
 * - roving keyboard focus over the rows, so the menu is fully operable from
 *   the keyboard (the context-menu key / Shift+F10 route lands here);
 * - focus return to the invoking element when the menu closes from a keyboard
 *   path;
 * - dismissal on Escape, outside pointer, scroll, resize, and window blur, so
 *   a menu anchored to a viewport point can never float over content that has
 *   since moved out from under it.
 *
 * It portals to `document.body` and layers above every in-app surface, so no
 * `overflow: hidden` or scroll container can clip it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { MenuItem, MenuLabel, MenuSeparator } from './Menu.tsx'
import css from './Menu.module.css'

/**
 * One selectable context-menu row. The anchored dropdown's nested-submenu field
 * is deliberately absent: this surface has no hover-dwell submenu, and leaving
 * the field out makes a submenu row a type error rather than a row that renders
 * and then silently does nothing.
 */
export type ContextMenuItem = Omit<MenuItem, 'submenu'>

/** One context-menu entry: a selectable row, a hairline, or a heading. */
export type ContextMenuEntry = ContextMenuItem | MenuSeparator | MenuLabel

/**
 * Where the card opens from. `point` is a viewport coordinate (a pointer or a
 * context-menu key); `element` is an existing trigger's rect, which keeps an
 * overflow "…" button's menu exactly where the anchored dropdown put it.
 */
export type ContextMenuTarget =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'element'; rect: DOMRect }

/** Viewport inset kept clear on every edge. */
const MARGIN = 8

/** Gap between an element anchor and its card (the anchored dropdown's 4px). */
const ANCHOR_GAP = 4

/**
 * Placed hidden at the origin for the measuring pre-render: the placement
 * effect reads real `offsetWidth`/`offsetHeight` in the same commit, so the
 * first painted frame is already at the final position.
 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

function isSeparator(entry: ContextMenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: ContextMenuEntry): entry is MenuLabel {
  return 'type' in entry && entry.type === 'label'
}

function isRow(entry: ContextMenuEntry): entry is ContextMenuItem {
  return !('type' in entry)
}

/**
 * Render a context menu at a pointer or element anchor.
 * @param props.open - whether the card is showing (owner-controlled).
 * @param props.target - pointer position or trigger rect.
 * @param props.items - rows, headings and hairlines.
 * @param props.onSelect - row activation; never called for a disabled row.
 * @param props.onClose - dismissal request (outside pointer, Escape, scroll, resize, blur, Tab).
 * @param props.align - horizontal edge placed at the anchor: card's start (default) or end.
 * @param props.returnFocusTo - element that regains focus on a keyboard close;
 * defaults to whatever held focus when the card opened.
 * @param props.label - accessible name for the `role="menu"` container.
 * @returns the portalled card while open; null otherwise.
 */
export function ContextMenu({
  open, target, items, onSelect, onClose, align = 'start', returnFocusTo, label, className,
}: {
  open: boolean
  target: ContextMenuTarget | null
  items: readonly ContextMenuEntry[]
  onSelect: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  returnFocusTo?: HTMLElement | null | undefined
  label: string
  className?: string | undefined
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Captured before a row takes focus, so a keyboard close has somewhere to go.
  const invokerRef = useRef<HTMLElement | null>(null)
  const focusMovedRef = useRef(false)
  const [placed, setPlaced] = useState<CSSProperties | null>(null)
  const [openedUpward, setOpenedUpward] = useState(false)

  /** Indices of the rows the keyboard may land on, in render order. */
  const enabledRows = useMemo(
    () => items.map((entry, index) => (isRow(entry) && entry.disabled !== true ? index : -1))
      .filter(index => index >= 0),
    [items],
  )

  const close = useCallback((restoreFocus: boolean) => {
    const invoker = invokerRef.current
    onClose()
    // Only a keyboard close returns focus: an outside pointerdown has already
    // put focus where the user clicked, and stealing it back would be hostile.
    if (restoreFocus && invoker !== null) {
      window.requestAnimationFrame(() => { invoker.focus({ preventScroll: true }) })
    }
  }, [onClose])

  // Placement runs before paint and before the focus effect below, so the
  // invoker is still `document.activeElement` when that effect captures it.
  useLayoutEffect(() => {
    if (!open || target === null) {
      setPlaced(null)
      return
    }
    const list = listRef.current
    /* v8 ignore next -- the node is committed before this layout effect runs. */
    if (list === null) return
    const width = list.offsetWidth
    const height = list.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x: number
    let y: number
    let upward = false
    if (target.kind === 'element') {
      const { rect } = target
      x = align === 'end' ? rect.right - width : rect.left
      y = rect.bottom + ANCHOR_GAP
      if (y + height + MARGIN > vh && rect.top - ANCHOR_GAP - height - MARGIN >= 0) {
        y = rect.top - ANCHOR_GAP - height
        upward = true
      }
    } else {
      x = target.x
      y = target.y
      if (target.y + height + MARGIN > vh && target.y - height - ANCHOR_GAP - MARGIN >= 0) {
        y = target.y - height - ANCHOR_GAP
        upward = true
      }
    }
    // Shift back inside the viewport. A card taller or wider than the margin
    // band is pinned at the near edge rather than pushed off the far one.
    if (width > 0) x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - width - MARGIN))
    if (height > 0) y = Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - height - MARGIN))
    setOpenedUpward(upward)
    setPlaced({ left: x, top: y })
  }, [open, target, items, align])

  // Move focus into the menu once per open. Opening upward lands on the last
  // row: the card grows away from the anchor, so the row nearest the anchor is
  // the one the pointer is already next to.
  useLayoutEffect(() => {
    if (!open) {
      focusMovedRef.current = false
      return
    }
    if (focusMovedRef.current || placed === null) return
    focusMovedRef.current = true
    invokerRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const landing = openedUpward ? enabledRows[enabledRows.length - 1] : enabledRows[0]
    if (landing !== undefined) rowRefs.current[landing]?.focus({ preventScroll: true })
  }, [open, placed, openedUpward, enabledRows, returnFocusTo])

  useEffect(() => {
    if (!open) return
    const inside = (node: EventTarget | null): boolean =>
      node instanceof Node && listRef.current?.contains(node) === true
    const onPointerDown = (event: PointerEvent): void => {
      if (inside(event.target)) return
      close(false)
    }
    // A context menu is anchored to a viewport point, not to an element: the
    // moment anything scrolls, that point stops meaning what it meant.
    const onScroll = (event: Event): void => {
      if (inside(event.target)) return
      close(false)
    }
    // Capture phase: Escape belongs to the open menu, not to a dialog behind it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close(true)
    }
    const onResize = (): void => { close(false) }
    const onWindowBlur = (): void => { close(false) }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, close])

  if (!open || target === null) return null

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Tab leaves the menu rather than walking out of it row by row.
    if (event.key === 'Tab') {
      event.preventDefault()
      close(true)
      return
    }
    if (enabledRows.length === 0) return
    // `noUncheckedIndexedAccess` makes every read `number | undefined`; the two
    // ends are the only indices the switch below needs, so narrow them once.
    const first = enabledRows[0]
    const last = enabledRows[enabledRows.length - 1]
    if (first === undefined || last === undefined) return
    const current = enabledRows.findIndex(index => rowRefs.current[index] === document.activeElement)
    const step = (delta: number): number => (
      current < 0
        ? (delta > 0 ? first : last)
        : (enabledRows[(current + delta + enabledRows.length) % enabledRows.length] ?? first)
    )
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); rowRefs.current[step(1)]?.focus(); break
      case 'ArrowUp': event.preventDefault(); rowRefs.current[step(-1)]?.focus(); break
      case 'Home': event.preventDefault(); rowRefs.current[first]?.focus(); break
      case 'End': event.preventDefault(); rowRefs.current[last]?.focus(); break
      default: break
    }
  }

  return createPortal((
    <div
      ref={listRef}
      className={clsx(css.list, css.context, css.scrollable, className)}
      style={placed ?? MEASURE_STYLE}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onListKeyDown}
      // React portal clicks must not activate the invoking row behind the card.
      onClick={(event) => { event.stopPropagation() }}
      // Right-clicking the card itself must not open a menu on the menu.
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
    >
      <div className={css.viewport} role="presentation">
        {items.map((entry, index) => {
          if (isSeparator(entry)) {
            return <div key={entry.id} className={css.separator} role="separator" />
          }
          if (isLabel(entry)) {
            return <div key={entry.id} className={css.label} role="presentation">{entry.text}</div>
          }
          return (
            <button
              key={entry.id}
              ref={(node) => { rowRefs.current[index] = node }}
              type="button"
              role="menuitem"
              className={clsx(css.item, entry.danger === true && css.danger)}
              disabled={entry.disabled}
              onClick={() => { onSelect(entry.id) }}
            >
              {entry.icon !== undefined && <span className={css.itemIcon}>{entry.icon}</span>}
              <span className={css.itemLabel}>{entry.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  ), document.body)
}
