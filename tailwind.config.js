/**
 * Design tokens — see src/styles/theme.scss for the values and their source.
 *
 * Key names are VERBATIM from the design's Foundations tokens, so a
 * class reads the same as the token a designer names: `bg-01`, `text-02`,
 * `border-03`, `text-mono-sm`, `rounded-lg`.
 *
 * The 4pt spacing scale (space-1..space-8 = 4/8/12/16/20/24/32) is byte-for-byte
 * Tailwind's own 1..8 scale, so it is deliberately NOT redeclared here.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ["[data-theme='dark']"],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // `bg-01` … `bg-inverse`
      backgroundColor: {
        "01": "var(--bg-01)",
        "02": "var(--bg-02)",
        "03": "var(--bg-03)",
        "04": "var(--bg-04)",
        inverse: "var(--bg-inverse)",
        // The design fills small marks (a Timeline dot, a rule) with the TEXT
        // ramp rather than the background ramp. Exposed here so those fills
        // stay tokenised instead of dropping to bg-[var(--text-03)].
        "text-01": "var(--text-01)",
        "text-02": "var(--text-02)",
        "text-03": "var(--text-03)",
      },

      // `border-01` … `border-03`
      borderColor: {
        "01": "var(--border-01)",
        "02": "var(--border-02)",
        "03": "var(--border-03)",
        DEFAULT: "var(--border-02)",
      },

      // `text-01` … `text-on-color`
      textColor: {
        "01": "var(--text-01)",
        "02": "var(--text-02)",
        "03": "var(--text-03)",
        inverse: "var(--text-inverse)",
        "on-color": "var(--text-on-color)",
        "on-primary": "var(--text-on-primary)",
      },

      // Accent ramps — available to bg/text/border alike.
      colors: {
        primary: {
          5: "var(--primary-5)",
          10: "var(--primary-10)",
          20: "var(--primary-20)",
          300: "var(--primary-300)",
          400: "var(--primary-400)",
          500: "var(--primary-500)",
          600: "var(--primary-600)",
          700: "var(--primary-700)",
          DEFAULT: "var(--primary-500)",
        },
        success: {
          10: "var(--success-10)",
          20: "var(--success-20)",
          300: "var(--success-300)",
          400: "var(--success-400)",
          500: "var(--success-500)",
          600: "var(--success-600)",
          700: "var(--success-700)",
          DEFAULT: "var(--success-500)",
        },
        danger: {
          10: "var(--danger-10)",
          20: "var(--danger-20)",
          300: "var(--danger-300)",
          400: "var(--danger-400)",
          500: "var(--danger-500)",
          600: "var(--danger-600)",
          700: "var(--danger-700)",
          DEFAULT: "var(--danger-500)",
        },
        warning: {
          10: "var(--warning-10)",
          20: "var(--warning-20)",
          300: "var(--warning-300)",
          400: "var(--warning-400)",
          500: "var(--warning-500)",
          600: "var(--warning-600)",
          700: "var(--warning-700)",
          DEFAULT: "var(--warning-500)",
        },
        info: {
          10: "var(--info-10)",
          20: "var(--info-20)",
          400: "var(--info-400)",
          500: "var(--info-500)",
          600: "var(--info-600)",
          DEFAULT: "var(--info-500)",
        },
        teal: {
          10: "var(--teal-10)",
          20: "var(--teal-20)",
          400: "var(--teal-400)",
          500: "var(--teal-500)",
          600: "var(--teal-600)",
          DEFAULT: "var(--teal-500)",
        },
        indigo: {
          10: "var(--indigo-10)",
          20: "var(--indigo-20)",
          400: "var(--indigo-400)",
          500: "var(--indigo-500)",
          DEFAULT: "var(--indigo-500)",
        },
        pink: {
          10: "var(--pink-10)",
          500: "var(--pink-500)",
          DEFAULT: "var(--pink-500)",
        },
        yellow: {
          10: "var(--yellow-10)",
          400: "var(--yellow-400)",
          500: "var(--yellow-500)",
          DEFAULT: "var(--yellow-500)",
        },
        lime: {
          500: "var(--lime-500)",
          DEFAULT: "var(--lime-500)",
        },
        // Series colours. chart-6 is the "other"/rest series and is the one
        // that follows the ground, so it is themed while 1..5 are not.
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
          6: "var(--chart-6)",
        },
        overlay: {
          dark: "var(--overlay-dark-10)",
          light: "var(--overlay-light-10)",
        },
      },

      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },

      // The scale in Foundations > "Type Scale", exactly. Sizes the design does
      // not define (label-lg, label-2xs, body-lg) are deliberately absent: a
      // screen reaching for one is a screen drifting off the design.
      fontSize: {
        "display-lg": ["48px", { lineHeight: "56px", fontWeight: "600", letterSpacing: "-1.2px" }],
        "display-md": ["36px", { lineHeight: "44px", fontWeight: "600", letterSpacing: "-0.5px" }],
        "heading-lg": ["28px", { lineHeight: "36px", fontWeight: "600", letterSpacing: "-0.5px" }],
        "heading-md": ["24px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.5px" }],
        "heading-sm": ["20px", { lineHeight: "28px", fontWeight: "600", letterSpacing: "0px" }],
        "label-md": ["16px", { lineHeight: "24px", fontWeight: "600", letterSpacing: "0px" }],
        "label-sm": ["14px", { lineHeight: "20px", fontWeight: "600", letterSpacing: "0px" }],
        "label-xs": ["12px", { lineHeight: "16px", fontWeight: "600", letterSpacing: "0px" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400", letterSpacing: "0px" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0px" }],
        "body-xs": ["12px", { lineHeight: "16px", fontWeight: "400", letterSpacing: "0px" }],
        // Headline money figures. The design sets these on Metric Tile (32/1.15,
        // tracking -0.5) and the Donut centre (26, tracking -0.5), both mono at
        // 600 — the two biggest numbers the product shows. Neither lands on the
        // sans display/heading scale (32 sits between display-md 36 and
        // heading-lg 28), so they are mono-only steps. Names are ours.
        "mono-2xl": ["32px", { lineHeight: "37px", fontWeight: "600", letterSpacing: "-0.5px" }],
        "mono-xl": ["26px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.5px" }],
        "mono-md": ["16px", { lineHeight: "24px", fontWeight: "400", letterSpacing: "0px" }],
        "mono-sm": ["14px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0px" }],

        // --- Dense chrome. NOT declared in Foundations > Type Scale. ---
        // Foundations stops at 12px. The components go far below it and the
        // geometry depends on it: the Table header is 10px mono and its column
        // widths are cut for that, the chart axis is 11px, and 13px is the most
        // used size in the file. Snapping those up reflows real layouts, so
        // they are named here instead.
        //
        // The design's true type ramp is FINER than any token set: it steps in
        // half pixels — 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17.
        // That is not a rendering artifact. Twelve components carry BOTH a
        // half-pixel and an integer size at once (Code Block has 12 and 12.5;
        // Panel has 12.5, 13, 14 and 16), which no uniform frame scale could
        // produce. So the half steps are deliberate, and this scale deliberately
        // does NOT reproduce them: a design system with a 0.5px ramp is not a
        // system. Components round to the nearest step here, which costs up to
        // 0.5px per text run. Sizes 15 and 17 have no step at all and round a
        // full pixel.
        //
        // These six names are ours — the design leaves these sizes unnamed.
        "body-13": ["13px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0px" }],
        "label-13": ["13px", { lineHeight: "20px", fontWeight: "600", letterSpacing: "0px" }],
        "mono-13": ["13px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0px" }],
        "mono-12": ["12px", { lineHeight: "16px", fontWeight: "400", letterSpacing: "0px" }],
        "mono-xs": ["11px", { lineHeight: "16px", fontWeight: "400", letterSpacing: "0px" }],
        "mono-2xs": ["10px", { lineHeight: "14px", fontWeight: "400", letterSpacing: "0px" }],
      },

      // Read off the `effect` property of the design's own components, not
      // invented. Three distinct elevations are in use:
      //   hair   -> Button, Money Pair
      //   soft   -> Metric Tile, Panel   (the design LAYERS hair under it)
      //   lifted -> Approval Card
      // The design leans on 1px borders for most separation — only these five
      // components carry an elevation at all.
      boxShadow: {
        hair: "0 1px 2px 0 var(--shadow-hair)",
        soft: "0 1px 2px 0 var(--shadow-hair), 0 2px 6px -1px var(--shadow-soft)",
        lifted: "0 8px 28px -6px var(--shadow-soft)",
      },

      screens: {
        mobile: "390px",
        tablet: "834px",
        desktop: "1440px",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("tailwind-scrollbar")({ nocompatible: true }),
  ],
};
