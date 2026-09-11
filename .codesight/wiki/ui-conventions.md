# Shared UI styling and navigation

`src/theme/variables.scss` owns the light/dark colour palettes, typography, spacing, radii and interaction tokens. `src/global.scss` owns shared controls, grouped sections, modal headers, focus states and reduced-motion behaviour. Page SCSS should contain layout and feature-specific rules instead of redefining these shared styles.

Primary button text uses `--ion-color-primary-contrast` so it remains readable against the olive background in both themes. Native `.text-btn` controls share the same minimum 44px touch target in headers and footers.

Settings is available from Wardrobe and Analytics. Its Ionic header remains visible while the settings content scrolls, and Back uses the entry screen with Wardrobe as the default. Getting Started accepts Builder or Settings as its return destination; first-use and Wardrobe entry points return to Wardrobe.

The outfit detail sheet uses a bounded height and a fully open breakpoint. The body scrolls independently of its action footer. Avoid partially translating a full-height sheet with a footer: that moves its actions below the viewport. Favourite writes show a disabled pending state in the detail sheet.
