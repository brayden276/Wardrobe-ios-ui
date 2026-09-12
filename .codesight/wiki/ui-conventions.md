# Shared UI styling and navigation

`src/theme/variables.scss` owns the light/dark colour palettes, typography, spacing, radii and interaction tokens. `src/global.scss` owns shared controls, grouped sections, modal headers, focus states and reduced-motion behaviour. Page SCSS should contain layout and feature-specific rules instead of redefining these shared styles.

Primary button text uses `--ion-color-primary-contrast` so it remains readable against the olive background in both themes. Native `.text-btn` controls share the same minimum 44px touch target in headers and footers.

Settings is available from Wardrobe and Analytics. Its Ionic header remains visible while the settings content scrolls, and Back uses the entry screen with Wardrobe as the default. Getting Started accepts Builder or Settings as its return destination; first-use and Wardrobe entry points return to Wardrobe.

Item and Outfit Detail share image stages, titles, wear actions and metrics through `src/theme/detail.scss`, loaded by `src/global.scss`. Detail images use a tall, viewport-aware stage with `object-fit: contain`; image controls sit outside the image so they cannot obscure it. Both views place the primary wear action below the title and use the global inset grouped sections.

The outfit detail sheet opens at full breakpoint with 95% height on phones. Its body scrolls, while the editing footer stays visible above the safe area. Avoid partially translating a full-height sheet with a footer: that moves actions below the viewport. Edit and More stay in the header; More contains Delete. Favourite writes show a disabled pending state in the detail view, and garment rows are keyboard-accessible buttons that open Item Detail.
