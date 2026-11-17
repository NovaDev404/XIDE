<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/XIDE_full_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="public/XIDE_full.png">
  <img alt="XIDE" src="public/XIDE_full.png" width="600">
</picture>
<p>An alternative to Xcode for Windows & Linux</p>
</div>

## Features
- [ ] Xcode-like IDE design
- [ ] Error checking, suggestions, and debugging
- [ ] Build/compile apps with xtool
- [ ] Install apps directly to device
- [ ] Preview apps with iOS VM
- [ ] Visual "storyboard" editor
- [ ] Import xcodeproj apps
- [ ] iOS device log

## Getting started

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs).

```sh
npm install
npm run tauri:dev    # run the app in dev mode
npm run tauri:build  # build a release bundle
```

## Built with
- Tauri + React
- xtool
- SourceKit-LSP
- isideload
- CodeMirror
- HackiOS