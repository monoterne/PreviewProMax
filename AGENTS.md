# Project guidance

Preview Pro Max is a desktop PDF viewer built with Electron, Bun, TypeScript, React, Radix UI, and PDF.js. Use `bun run typecheck` and `bun run build` after renderer changes.

## UI rules

- Keep the interface functional and restrained. The first screen is the viewer or a simple open-file state, never a marketing hero.
- Use the existing light and dark CSS tokens. The sidebar, toolbar, page, and thumbnail should follow the same theme. Keep light PDF pages white and dark PDF pages dark.
- Use Radix primitives for interactive patterns such as tabs and switches. Keep native buttons and inputs simple and accessible.
- Use a system sans-serif font, a consistent 4/8/12/16/24/32px spacing scale, subtle borders, and 6–10px control radii.
- Avoid decorative gradients, glows, floating cards, oversized headings, eyebrow labels, mottos, filler descriptions, and large shadows.
- Keep hover effects to color or border changes. Reserve motion for functional state changes.
- Make labels and focus states clear. Check narrow windows, long file names, empty states, selected states, loading, and errors.

## UI review

Before finishing a UI change, check that navigation remains usable, controls have accessible names, tabs work by keyboard, the PDF and thumbnail themes agree, and the screen has no decoration without a task. Review both light and dark screenshots with a real PDF.
