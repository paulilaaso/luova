# Security Policy

## Reporting a vulnerability

Please report security issues privately, not in public issues or discussions.

Use GitHub's private reporting: open the [Security tab](https://github.com/paulilaaso/luova/security) of this repository and choose **Report a vulnerability**.

Helpful details to include:

- what an attacker can do, and what they need first (for example "any website the user visits" or "a device on the same Wi-Fi")
- steps to reproduce, or a proof of concept
- the Luova version or commit, your OS and browser

You'll get a reply as soon as possible. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## Supported versions

Luova is pre-1.0. Security fixes go into the latest release only, so please update before reporting.

## How Luova is designed

Luova runs on your own computer. Knowing what it does and doesn't protect against makes reports easier to judge.

- **Local only.** `npm run dev` and `npm run start` listen on `127.0.0.1`, so other devices can't reach Luova. It isn't designed to be hosted or exposed to a network. Don't run it with `-H 0.0.0.0` or behind a public proxy.
- **Its API only answers Luova itself.** Requests from other websites, from other apps on `localhost`, and from hostnames other than `localhost`/`127.0.0.1` (DNS rebinding) are rejected.
- **Your API keys stay in your browser.** Keys and your ChatGPT sign-in are stored in the browser's local storage for the Luova page. They're sent to Luova's local server only to call the AI provider you selected, and they're never stored on disk by Luova.
- **The MCP endpoint needs a token.** A random token is created on first use and stored in `.luova/mcp-token` (gitignored). Treat it like a password. To replace it, delete the file and restart Luova.

### Code you open runs inside Luova

Luova renders components by running their code directly in the Luova page. That code has the same access as Luova itself, including your stored API keys. This applies to:

- components the AI generates
- `.luova` projects and `.tsx` files you open or drop onto the canvas
- code sent by a connected MCP client.

**Only open projects and component files from people you trust.**

A `.luova` file can also carry its own AI system prompt. Luova shows a notice when an opened file includes one. Connected MCP agents receive it marked as project content, not as instructions from you.

### Exported projects

An export includes a `setup.js` that creates a Next.js app and installs its packages. It only installs package versions that already existed when the project was exported, pinned exactly. Only run a `setup.js` from an export you made yourself or got from someone you trust.

## Scope

**In scope:**

- another website, another device, or an MCP client without the token being able to read your projects, read your keys, or run code in Luova
- anything that exposes stored keys or tokens without you opening untrusted content
- flaws in the ChatGPT sign-in flow
- an export installing packages or running commands it shouldn't

**Out of scope:**

- code running from components or files you chose to open (see above)
- running Luova on a non-loopback address or exposing it to a network
- problems in the AI providers' own services
- attacks that require an already compromised computer or browser
