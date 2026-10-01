<p align="center">
  <img src="public/logo-mark.svg" width="96" height="96" alt="KiloCrop logo">
</p>

<h1 align="center">KiloCrop</h1>

<p align="center">
  <b>Crop to any ratio. Shrink to any size.</b><br>
  Passport, visa and upload-ready photos.
</p>

<p align="center"><a href="https://mavi-cyber.github.io/KiloCrop/"><b>Open KiloCrop →</b></a></p>

---

KiloCrop (formerly **IDPhotoResizer**) crops photos to exact shapes and pixel sizes for passports, visas, profile
pictures and upload forms. Everything runs on your own device: no uploads, no account, no tracking.

## Features

- **Passport & visa presets** - Pakistan, US, UK, Schengen, Canada, Australia, China, India, Japan, South Korea,
  Russia and UAE, with the output size, background and framing rules shown alongside.
- **Aspect ratios** - square, 4:5, 3:4, 2:3, 5:7, 9:16, 16:9 and more, plus original-ratio and free crop.
- **Darkroom studio** - a full-screen editor: tool rail, floating edit dock and an inspector panel on desktop; photo,
  bottom sheet and tab bar on phones (portrait and landscape).
- **Crop frame** - drag to move, drag corners to resize (ratio stays locked), drag edges in free mode, arrow keys to
  nudge. Works with mouse, touch and pen. Live size labels sit right on the frame.
- **Edit dock** - undo/redo, rotate, mirror, reset, and a head-position guide for document photos.
- **File-size meter** - the real exported size in KB, measured against the document's limit, in JPEG, PNG or WebP.
- **Private by design** - the photo is never uploaded. Exports drop location (GPS) and camera details by default;
  you can choose to keep either one in JPEG or PNG. Serial numbers and the hidden thumbnail are always removed.
- **Installable & offline** - add it to your home screen on Android or iOS and use it without internet.
- **Keyboard shortcuts** - Ctrl+Z / Ctrl+Shift+Z undo/redo, R / Shift+R rotate, F mirror, G guide, Ctrl+S export,
  Ctrl+O open.

## Roadmap

KiloCrop v2 is being built in phases:

| Phase | What | Status |
| --- | --- | --- |
| 0 | Vite + TypeScript foundation, tests, CI deploy | ✅ |
| 1 | New brand, logo and "Darkroom" design system | ✅ |
| 2 | Studio layout for desktop, phones (bottom sheet, landscape, safe areas), large-photo handling | ✅ |
| 3 | Crop engine: rotate, mirror, undo/redo, head guide ✅ · zoom/pinch, straighten ⏳ | 🟡 |
| 4 | Size engine: target KB/MB, mm + DPI, JPEG/PNG/WebP | ⏳ |
| 5 | Preset audit with official sources, more presets, 4×6 print sheet | ⏳ |
| 6 | Accessibility & performance pass | ⏳ |
| 7 | Device testing and v2.0.0 release | ⏳ |

## Development

Requires Node.js 20+.

```sh
git clone https://github.com/mavi-cyber/KiloCrop.git
cd KiloCrop
npm install
npm run dev        # http://localhost:5173/KiloCrop/
```

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run icons` | Regenerate favicons, PWA icons and the social image from `public/logo-mark.svg` |

### Project layout

```
src/
  core/        pure logic - presets, crop geometry, rendering, formatting (unit-tested)
  ui/          crop studio canvas, icons
  styles/      design tokens, base, components, layout
  main.ts      studio page
  about.ts     about page
tests/         Vitest specs
public/        logo, icons, social image
```

Pushing to `main` runs lint, tests and the build, then deploys `dist/` to GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

## Contributing

Issues and pull requests are welcome. Please run `npm run lint && npm test` before opening a PR.

## License

[MIT](LICENSE) © Mavi ([@mavi-cyber](https://github.com/mavi-cyber))
