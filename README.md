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
- **Text over the page.** The editor's third step, *Text*, adds notes on top
  of a scan: tap the page (or *Add text*), type, and pick one of nine
  colored backgrounds, all 30% transparent so the page shows through, or
  none. Text color (black/white) follows the background automatically, in
  three sizes. Drag notes to move them, and tap one to edit or delete it.
  The text is saved into the page, so it appears in PDF and JPG exports.
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
- **Gas photos.** The red pump button on the home screen opens a quick
  camera for things like the odometer, pump display and receipt. Each tap
  takes a plain JPG instantly (no editing or enhancement), and the screen
  prompts for the usual three shots. Tap *Done* and the photos are saved
  straight to the device. On a phone the share sheet opens with them
  attached, so one tap on *Save Images* puts them in Photos. Each session
  is kept together as its own group, marked with a red pump. Each photo
  also gets a small red pump stamped in its top-right corner, so fuel
  photos stand out in the phone's photo album (switch it off in the menu).
- **Quick delete.** Press and hold a group on the home screen (or
  right-click it on a computer) and a red garbage can pops up; tap it to
  delete the group with all its pages or photos. An *Undo* button shows for a
  few seconds afterwards.
- **Menu.** The ☰ button sets the default export format (PDF or JPG) and
  *Always save to device*. With that on, a group's main button saves
  straight away in the default format; email and WhatsApp stay in the
  group's ⋮ menu under *Share or export…*.
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
| `js/watermark.js` | The red pump stamped on fuel log photos |
| `js/annotate.js` | Text notes: layout, wrapping, see-through backgrounds, hit testing |
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
