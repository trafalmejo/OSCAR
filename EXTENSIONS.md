# Extending OSCAR

OSCAR is complete on its own. An extension is a separate Node module that OSCAR loads at startup if it is there. It can live in another repository, under another licence.

The rule that makes that possible: **an extension may use anything of OSCAR's; nothing in OSCAR knows any extension exists.** A test (`test/extensions.test.js`) holds OSCAR to it.

## Try it

A working example is in `examples/sample-extension`. It uses every part described below.

```
OSCAR_EXTENSIONS=./examples/sample-extension npm run serve
```

You get a puzzle-piece button at the end of the toolbar, a "Sample Board" template in Load, and a route at `/x/sample/hello`. The startup banner names the extension, and so does the environment block of a bug report made from About.

## Which extensions are loaded

- `OSCAR_EXTENSIONS`: a comma-separated list of module names or paths. A path is relative to where OSCAR was started.
- The optional ones listed in `lib/extensions.js`. They are looked for on every start, and it is not an error if they are not installed.
- `OSCAR_NO_EXTENSIONS=1` loads none. Try this first when something misbehaves.

An extension that cannot be loaded, was written for a different API version, or throws while starting is reported in the console and left out. OSCAR carries on without it.

## What an extension is

```js
module.exports = {
  name: "example",   // lower-case letters, digits, dashes. Also its address: /x/example/
  version: "1.0.0",
  oscarApi: 1,       // must match the API constant in lib/extensions.js

  features: { PAGES: true },
  templatesDir: "/path/to/templates",
  publicDir: "/path/to/public",
  editor: { scripts: ["editor.js"], styles: ["editor.css"] },
  server(host) {},
};
```

Only `name` and `oscarApi` are required. The rest are the four things an extension can do.

### 1. Switch on a feature

`lib/features.js` lists parts of OSCAR that are built but not offered, such as Pages. An extension can turn one on. It cannot invent one; its own features are its own business.

### 2. Add templates

`templatesDir` is a folder of `.html` templates, in the same format as `public/templates`. They appear in the Load list after OSCAR's own. It may be a function returning the folder, for one that only exists once the extension has downloaded something. It is asked again on every listing.

### 3. Add to the editor

`publicDir` is served at `/x/<name>/`. The files named in `editor` are loaded by the editor page after OSCAR's own scripts. A script starts like this:

```js
window.OSCAR.ready(function (oscar) {
  oscar.addToolbarButton({ id, title, iconPath, run(editor) {} });
  oscar.openModal("Title", element);
  oscar.editor;    // the GrapesJS editor
  oscar.features;  // the switches as they stand
});
```

`ready` waits until the editor has finished loading. The surface (`/preview`, published pages) loads none of this.

### 4. Run on the server

`server(host)` is called once, after everything in OSCAR is set up.

| `host.` | |
| --- | --- |
| `api`, `version` | the extension API number, and OSCAR's version |
| `app` | the Express app. Put routes under `/x/<name>/` |
| `io` | the socket.io server the surfaces are connected to |
| `settings` | `get(key)`, `set(key, value)`, kept across restarts. Prefix keys with the extension's name |
| `projectsDir` | where projects are kept; a place for the extension's own files |
| `lock` | `isLocked()`, `setLocked(value)` |
| `surfaces` | the published surfaces: `list()`, `widgets(id)`, and `drive(id, widgetId, state)`, which puts one widget in one state. The caller never says where that goes: the destination, encoding and range come from the surface as published. Use this, not raw OSC, for anything acting on a rig: a schedule, or an instruction from somewhere untrusted |
| `features` | the resolved switches |
| `log` | `log`, `error` |
| `onShutdown(fn)` | run `fn` when OSCAR quits. It may return a promise; OSCAR waits up to two seconds |

## What is not here yet

Extensions cannot add widgets. A widget has to be in both the editor bundle and the runtime bundle that exported pages carry, which needs a build step this seam does not have. It can be added when something needs it.

## Changing the API

Everything above is a promise to code OSCAR cannot see. When any of it changes shape, raise `API` in `lib/extensions.js` and `api` in `public/src/oscar_editor.js`. Extensions written for the old number are then refused with a clear message, rather than half-working.
