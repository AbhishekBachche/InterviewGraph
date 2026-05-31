# Hireeaze UI (shadcn + Tailwind)

Stack: **React 18**, **TypeScript**, **Vite**, **Tailwind CSS**, **shadcn/ui**, **Framer Motion**, **lucide-react**.

## Professional palette (`src/styles/palette.css`)

| Purpose | Color | Hex |
|---------|-------|-----|
| Main Background | Soft White | `#F8FAFC` |
| Card Background | White | `#FFFFFF` |
| Primary Brand Color | Deep Navy | `#1E3A8A` |
| Main Button / Links | Professional Blue | `#2563EB` |
| Button Hover | Dark Blue | `#1D4ED8` |
| Heading Text | Dark Slate | `#0F172A` |
| Normal Text | Slate Gray | `#334155` |
| Secondary Text | Muted Gray | `#64748B` |
| Border / Divider | Light Gray | `#E2E8F0` |
| Success / Selected | Green | `#16A34A` |
| Warning | Amber | `#F59E0B` |
| Error / Reject | Red | `#DC2626` |

### Tailwind mapping

| Token | Use |
|-------|-----|
| `bg-background` | Main background |
| `bg-card` | Cards |
| `bg-brand` / `text-brand` | Navy brand (sidebar, eyebrow) |
| `bg-primary` / `text-primary` | Blue buttons & links |
| `hover:bg-[hsl(var(--primary-hover))]` | Button hover |
| `text-heading` | Headings (`h1`–`h6`) |
| `text-foreground` | Body copy |
| `text-muted-foreground` | Secondary labels |
| `border-border` | Dividers |
| `bg-success` / `bg-warning` / `text-destructive` | Status |
