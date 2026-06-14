/** Viewport at or below this width uses hamburger + slide-out nav (sidebar rail hidden). */
export const NAV_COMPACT_MAX_PX = 899;

/** Viewport at or below this width stacks multi-column dashboard layouts (Tailwind `lg` − 1). */
export const PAGE_STACK_MAX_PX = 1023;

export const NAV_COMPACT_MEDIA = `(max-width: ${NAV_COMPACT_MAX_PX}px)` as const;
export const PAGE_STACK_MEDIA = `(max-width: ${PAGE_STACK_MAX_PX}px)` as const;
