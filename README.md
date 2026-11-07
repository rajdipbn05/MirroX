# MirroX

Mirror an Android phone (and later an iPhone) on a Windows computer over USB. Nothing needs to be installed on the phone.

See **[PLAN.md](PLAN.md)** for progress.

## For developers

- Electron app. The main process lives in `src/main`, the interface in `src/renderer`.
- Mirroring engine: [scrcpy](https://github.com/Genymobile/scrcpy) + ADB, downloaded by `scripts/fetch-engines.js` into `vendor/<os>/` and bundled into the app.
- OS-specific engine paths are kept in `src/main/engines.js`.

```
npm install
npm run fetch-engines   # downloads scrcpy for this OS
npm start               # run in development
npm test
npm run dist:win        # builds dist/MirroX-<version>-portable.exe
```
