# StudyHub

Offline-first student productivity app built with Expo development builds. Data is stored locally in SQLite; the optional Gemini API key is held in Android secure storage.

## Run locally

```powershell
npm install
npx expo prebuild
npm run android
```

## Build an installable Android APK

1. Install and authenticate the EAS CLI: `npm install --global eas-cli` then `eas login`.
2. Run `eas init` once to connect this local project to your EAS account.
3. Run `eas build -p android --profile preview`.

`preview` produces an APK suitable for direct installation. Android exact-alarm permission is declared for weekly class alerts; users can still turn notifications off at OS level.
