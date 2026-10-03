# createwithoscar

Connects an AI assistant to [OSCAR](https://www.createwithoscar.site), the
free, open-source editor and server for control interfaces: pages of buttons,
sliders and other controls that phones and tablets open, and that send OSC,
MIDI and DMX to show software, instruments and lights.

With it, an assistant such as Claude can:

- **Find out why something does not respond.** It reads the OSCAR running on
  your computer: its projects, what is published, every widget's settings,
  the MIDI ports, and what OSCAR lately received and sent.
- **Draft an interface for you.** It writes one, OSCAR's own validators check
  it, and it appears in OSCAR under **File > Open project or template** with a
  Draft badge, for you to open, check and publish yourself.

It **never** sends anything to your rig, publishes, or changes a project.

## Connect

OSCAR 2.1 or later must be running on the same computer, with the **MCP**
pill in its top bar green.

**Claude Code**

```
claude mcp add oscar -- npx -y createwithoscar
```

**Claude Desktop**: download `OSCAR.mcpb` from
[createwithoscar.site](https://www.createwithoscar.site/how-it-works) and
double-click it. Nothing else to install.

**Cursor, VS Code, Windsurf, Codex, Gemini CLI and other MCP apps**: add a server with the command `npx`
and the arguments `-y createwithoscar`. In most apps that is:

```json
{
  "mcpServers": {
    "oscar": { "command": "npx", "args": ["-y", "createwithoscar"] }
  }
}
```

If it does not start on Windows, use the command `cmd` with the arguments
`/c npx -y createwithoscar`.

Then ask, for example:

- "Build me an OSCAR interface with four faders and a blackout button for my
  lighting desk."
- "My OSCAR slider is not moving the light. Can you see why?"

## How it works

This is a small program with no dependencies. The assistant starts it and
speaks MCP to it; it passes each request to OSCAR on this computer and
nowhere else. It finds OSCAR through a file OSCAR writes when it starts
(`~/.oscar/mcp.json`), which holds OSCAR's local address and a token that
changes at every start. Switching the MCP pill off in OSCAR closes the door.

If OSCAR is not running, the assistant still sees the tools, and is told to
ask you to start OSCAR.

Needs Node 18 or later (the Claude Desktop bundle uses Claude's own).

## Licence

BSD-3-Clause, as OSCAR is. Source:
[github.com/trafalmejo/OSCAR](https://github.com/trafalmejo/OSCAR/tree/master/createwithoscar).
