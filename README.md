# Scanify

Scanify turns photos of documents into clean, square PDFs. It runs in the
browser and installs on phones like a native app (it's a Progressive Web
App), with no server and no accounts. Scans stay on the device.

<img src="icons/icon-192.png" width="96" alt="Scanify logo: an S that is half standard font, half 8-bit">

## Features

- **Scan with the camera.** A live outline shows the document as Scanify
  detects it. Tap the shutter to take the picture. You can also import
  existing photos, several at once.
- **Square, uniform edges.** Scanify finds the page's four corners
  automatically, and you can drag them into place with a magnifier. The
  photo is then perspective-corrected into a straight rectangle. *Clean
  edges* trims the last slivers of background so every side of the page is
  even.
- **Print quality.** Make the page lighter or darker, adjust contrast,
  and choose a filter: *Original*, *Enhanced* (auto-levels, whiter paper),
  *Grayscale* or *Black & white*, which uses adaptive thresholding for
  crisp text. Rotate in 90° steps. You can re-edit any page later.
- **Groups.** Related scans are kept together in a group, such as all pages
  of a contract or a month of receipts. You can reorder pages, move a page
  to another group, and rename or delete groups. Each group exports as one
  multi-page PDF.
- **Export as PDF or JPG.** A PDF holds the whole group, on A4, US Letter
  or fit-to-image pages. JPG gives one image per page (named
  `Group - page 1.jpg`, and so on). Choose Standard, High or Maximum
  quality for either. Then:
  - **Save to device.** Desktop browsers use a save dialog or a download.
    Phones open the share sheet, which includes *Save to Files*.
  - **Email.** Shares the PDF or images as attachments through the
    device's mail app. Where file sharing isn't supported, Scanify
    downloads the files and opens a pre-filled email.
  - **WhatsApp.** On phones, the files are shared straight to a chat
    (choose WhatsApp in the share sheet). On desktop, Scanify opens a
    `wa.me` link with a pre-filled message and downloads the files so you
    can attach them.
- **Dark mode.** The button next to the version number cycles through
  Automatic (matches the phone), Dark and Light. The choice is remembered.
- Works offline once loaded, and can be installed to the home screen.

## Running it

The camera needs a secure origin: `https://`, or `http://localhost`.

```sh
npm start          # serves the app at http://localhost:8080
```

To use it on a phone, host the folder on any static HTTPS host. The
included GitHub Actions workflow (`.github/workflows/pages.yml`) tests the
app and deploys it to **GitHub Pages** on every push to `main`. Turn it on
under *Settings → Pages → Source: GitHub Actions*. Open the site on your
phone and choose *Add to Home Screen* or *Install app*.

## Development

There are no runtime dependencies or build step. The app is plain HTML,
CSS and ES modules.

| Path | What it does |
| --- | --- |
| `js/app.js` | UI: screens, camera, crop handles, editor, groups, export/sharing |
| `js/imaging.js` | Edge detection, perspective correction, filters (pure functions) |
| `js/pdf.js` | Small PDF writer that embeds the JPEG pages directly |
| `js/db.js` | IndexedDB storage for groups and scans |
| `sw.js`, `manifest.webmanifest` | Offline cache and installability |
| `tools/make-logo.cjs` | Generates the logo and icons |

The version shown on the home screen comes from `js/version.js`. Bump it,
and `"version"` in `package.json`, with each release; a test checks they
match.

```sh
npm test           # unit tests (imaging + PDF), Node 20+
npm run test:e2e   # full flow in headless Chromium with a fake camera (needs Playwright)
npm run logo       # regenerate icons/ (needs Playwright)
```

### The logo

The "S" is drawn once as a smooth path. The left half shows that path as a
standard letterform. The right half is the same path rasterised onto a
coarse 20×20 grid, which gives the 8-bit look. Because both halves come
from one shape, they meet exactly in the middle.
