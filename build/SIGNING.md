# Code Signing & Notarization

## macOS

### Requirements
- Apple Developer account ($99/year)
- Developer ID Application certificate installed in Keychain
- App-specific password for `notarytool`

### Local build with signing

Set these environment variables before running `npm run dist:mac`:

```bash
export CSC_LINK=/path/to/Certificate.p12          # or auto-detected from Keychain
export CSC_KEY_PASSWORD=<certificate password>
export APPLE_ID=<your apple id email>
export APPLE_APP_SPECIFIC_PASSWORD=<app password> # create at appleid.apple.com
export APPLE_TEAM_ID=<10-char team id>
```

Then enable notarization in `package.json`:
```json
"mac": {
  ...
  "notarize": {
    "teamId": "YOUR_TEAM_ID"
  }
}
```

### GitHub Actions

Add the above as repository secrets. See `.github/workflows/release.yml`.

## Windows

### Requirements
- Code signing certificate (EV or standard) — `.pfx` or `.p12`

### Local build

```bash
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=<cert password>
npm run dist:win
```

electron-builder auto-detects and signs if CSC_* env vars are set.
