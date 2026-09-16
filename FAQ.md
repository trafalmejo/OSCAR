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
