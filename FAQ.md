# OSCAR FAQ

## What can I paste into Import?

A snippet of HTML, or a whole HTML file with its CSS. Import replaces everything on the canvas.

OSCAR keeps:

- everything inside `<body>`
- every `<style>` block, wherever it is
- `data-osc-style` and `data-osc-appearance` on `<body>`, which choose the widget style

OSCAR ignores:

- the whole `<head>` apart from its `<style>` blocks: `<title>`, `<meta>`, `<link>` and `<script>` are dropped
- any other attributes on `<body>`, such as `class` or `style`

The head is dropped because OSCAR loads its fonts and widget styles into the canvas head, and an imported head would replace them.

Your CSS always wins over OSCAR's default widget styling, so you can restyle anything from a `<style>` block. To change a style's colours, set them on the surface:

```css
body, [data-osc-style] { --osc-primary: hotpink; }
```

To set a widget's OSC settings in the code, use `data-gjs-*` attributes:

```html
<button data-gjs-message="/scene/1" data-gjs-mode="toggle">Scene 1</button>
```

The templates in the Load list are files in this format, so open one to see a full example.

## Why does my exported page do nothing on a phone?

Because the phone opened it from its own storage. Android hands a downloaded
page to Chrome through a sandbox (the address starts with `content://`), and
iOS will not run one at all, so the page never reaches OSCAR. The same file
works on a computer, where it opens as an ordinary `file://` page.

On a phone or tablet, use **Publish on this OSCAR**, the main button of the
Publish dialog, rather than the file download under Advanced. OSCAR then serves the very same page at an address, shown
with a QR code, and any browser on the network can open it.

The phone has to be on the same network as the computer running OSCAR, and
that computer's firewall has to let it in. If `/preview` opens on the phone,
a published page will too.
