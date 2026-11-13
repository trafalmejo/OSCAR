# OSCAR FAQ

## What can I paste into Import?

A snippet of HTML, or a whole HTML file with its CSS. Import replaces everything on the canvas.

OSCAR keeps:

- everything inside `<body>`
- every `<style>` block, wherever it is
- `<script>` tags inside `<body>`, including `type="module"` ones that import a library from the web. They run in the editor, in the preview and on a published page. The OSCAR Showcase template uses one for its three.js background
- `data-osc-style` and `data-osc-appearance` on `<body>`, which choose the widget style

OSCAR ignores:

- the whole `<head>` apart from its `<style>` blocks: `<title>`, `<meta>`, `<link>` and `<script>` are dropped
- any other attributes on `<body>`, such as `class` or `style`

The head is dropped because OSCAR loads its fonts and widget styles into the canvas head, and an imported head would replace them.

Your CSS always wins over OSCAR's default widget styling, so you can restyle anything from a `<style>` block. To change a style's colours, set them on the page's body:

```css
body, [data-osc-style] { --osc-primary: hotpink; }
```

To set a widget's OSC settings in the code, use `data-gjs-*` attributes:

```html
<button data-gjs-message="/scene/1" data-gjs-mode="toggle">Scene 1</button>
```

The templates under File → Open project or template… are files in this format, so open one to see a full example.

## Why does my exported page do nothing on a phone?

Because the phone opened it from its own storage. Android hands a downloaded
page to Chrome through a sandbox (the address starts with `content://`), and
iOS will not run one at all, so the page never reaches OSCAR. The same file
works on a computer, where it opens as an ordinary `file://` page.

On a phone or tablet, use **Publish**, in the top bar, rather than a
downloaded file (**Download as a file**, in a published interface's menu in
the Running on this OSCAR window).
OSCAR then serves the very same page at an address, shown with a QR code, and
any browser on the network can open it.

The phone has to be on the same network as the computer running OSCAR, and
that computer's firewall has to let it in. If `/preview` opens on the phone,
a published page will too.

## Why does the OSCAR app not find my OSCAR?

The app listens for the announcement OSCAR makes on the local network, which
OSCAR 2.2 and later make; an older OSCAR makes none, and is opened by its QR
code or its address instead. With 2.2, three things keep a phone from hearing it:

- **A different network.** A phone on mobile data, or on a guest Wi-Fi that
  keeps devices apart, hears nothing. Both on the same Wi-Fi, with the
  computer's firewall letting OSCAR in, is where it starts.
- **The computer on a cable.** Many routers do not pass multicast between
  their Ethernet and Wi-Fi sides, so a phone on Wi-Fi never hears a computer
  on Ethernet, though it can still open the page by address. Put the computer
  on the Wi-Fi, or switch on multicast (IGMP) passthrough, sometimes called
  mDNS reflection, on the router.
- **A VPN on the computer.** Its tunnel can take the announcement instead of
  the Wi-Fi. OSCAR 2.2 announces on its own address to avoid that.

The QR code in the Publish window needs no announcement: scanning it, or
typing the address, opens the interface whatever the router does.
