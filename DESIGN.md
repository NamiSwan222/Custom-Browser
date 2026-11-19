# Custom Browser: Design direction

> **DRAFT, written by Claude from the existing branding, for the owner to rewrite.**
> PLAN.md section 6 says the direction must come from the owner. This draft exists so
> the roadmap's UI work has something consistent to follow until then. Every line
> below is a starting point to change, not a decision.

## Identity

A browser that feels like **your own place to go out into the web from**, and to
bring friends along (Browse Together). The icon is a globe: the web as a world.
It belongs to the person using it: the name, icon, colours and layout are theirs
to change (Personalize), so the defaults should be calm and good, not loud.

## Personality

- **Friendly, not cute.** Plain words, short labels, no jokes in the interface.
- **Quiet by default.** The page is the star; the browser's own surfaces recede.
- **Honest.** Settings say what they do and what they share (Browse Together says
  "only page addresses are shared").

## Palette (from the globe icon)

| Role | Colour | Use |
|---|---|---|
| Deep navy | `#071E54` | the globe's ocean; installer, dark backgrounds, splash |
| Teal | `#4FB3A9` | the Americas; secondary accent, success, "connected" |
| Warm yellow | `#F2C14E` | Europe/Africa; highlights, the Browse Together "live" mark |
| Orange | `#E8835A` | warnings, attention without alarm |
| Accent | the person's own (`--zen-primary-color`) | everything interactive |

Interface surfaces follow light/dark and the person's accent; the brand colours
are for brand moments (new tab page, about page, installer, empty states), not
for every button.

## Typography

- The system interface font everywhere (`font: menu`), so the browser feels
  native on each OS.
- One bigger weight for titles (600), body at the platform size.
- Numbers that people read out (room codes) use wide letter spacing.

## Shape and motion

- Rounded corners from the person's Roundness choice (Layout); default Zen's.
- Motion only to explain a change (a tab opening, a panel appearing), 150-250 ms,
  and none with "reduce motion".

## Mood

Morning light over a map: clear, open, a little warm. Not neon, not glassy for its
own sake; the see-through window (Mica) is a choice, not the default.

## Optional theme: the mascot

The purple witch mascot (`branding/icon-original.png`) stays available as a
**Mascot theme** (purple, light + dark), not as the default identity.
