# Megapot Club brand assets

This is the canonical partner asset folder. These files reproduce Club's existing cobalt/orange identity; they do not represent the official Megapot operator.

## Profile image

Use `png/megapot-club-icon-color.png` for an X profile photo or a square logo for partners.

## Send to partners

- `svg/megapot-club-logo-color.svg`: primary horizontal logo for light backgrounds. Text is outlined; no font installation is required.
- `svg/megapot-club-logo-on-dark.svg`: primary horizontal logo for dark backgrounds.
- `svg/megapot-club-logo-black.svg` and `svg/megapot-club-logo-white.svg`: monochrome lockups.
- `svg/megapot-club-icon-*.svg`: matching square marks.
- `png/`: transparent PNG counterparts; horizontal logos are 2400 px wide and icons are 512 × 512 px.

Keep the aspect ratio and the existing spacing. Give the logo at least half an icon's width of clear space around it. Use the icon below 160 px horizontal-logo width. Do not alter the letters, colors or Club badge. Choose a variant with clear contrast against its background.

Palette: cobalt `#244BE9`, orange `#FF9365`, ink `#19212D`, light ink `#EDF1F9`, badge `#FFE6D8` / `#AA410C`.

Typography is Outfit, with its SIL Open Font License included in `licenses/`. The website's reusable lockup is `src/Brand.tsx`; the icon is also used in `public/favicon.svg`. Partner artwork lives here, outside the application build.

## X banner

Use `social/megapot-club-x-banner.png` (1500 × 500) for the Club profile header. The minimalist cobalt artwork reads **“$213,017 jackpot was hit!”** with **“THE INTERNET LOTTERY”** at the bottom right. The headline sits near the golden-ratio height measured from the bottom; the lower-left area stays clear for the profile photo.

This is a historical win announcement, not a live prize-pool counter. The higher-resolution flattened master is `social/megapot-club-x-banner-master.png`; vector logo masters are in `svg/`. The banner's headline is rasterized in both PNGs.
