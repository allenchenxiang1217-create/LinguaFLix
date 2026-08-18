# Platform Builds

LinguaFLix shares the React renderer, but platform integration is separated by
the runtime layer and the packaging configuration.

## macOS

```bash
npm install
npm run build
npx electron-builder --mac dmg zip
```

Artifacts are written to `release/`. macOS distribution requires Developer ID
signing and notarization before sending the app to other users.

## Windows

Use the Windows command prompt:

```bat
windows-fixes\build-windows-installer.cmd
```

This downloads the Windows binaries, builds the renderer and creates:

- `LinguaFLix-<version>-win-setup.exe`
- `LinguaFLix-<version>-win.zip`

Windows-specific path normalization, executable lookup, yt-dlp output decoding,
and bundled FFmpeg support are already part of the main source tree. The patch
file in `windows-fixes/` is retained only as historical reference.

## Web development

macOS/Linux:

```bash
./start.sh
```

Windows:

```bat
start.cmd
```

Both launch the local Node backend and Vite frontend. The backend remains bound
to `127.0.0.1`; this mode is for local development, not public SaaS hosting.
