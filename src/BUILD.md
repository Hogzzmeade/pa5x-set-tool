# Сглобяване

1. `index.html` = `app3.html` с вмъкнати `core.js` (`/*__CORE__*/`), `player.js` (`/*__PLAYER__*/`) и `korf.js` (`/*__KORF__*/`) и `factory.js` (`/*__FACTORY__*/`).
2. `spessa.bundle.js`: `npm i spessasynth_lib esbuild` и
   `npx esbuild tools/spessa-entry.js --bundle --format=iife --minify --outfile=spessa.bundle.js`;
   `spessasynth_processor.min.js` се копира от `node_modules/spessasynth_lib/dist/`.
3. `gm.sf3` = MuseScore_General_Lite.sf3 (MIT, Debian пакет musescore-general-soundfont-small).
4. Windows: Electron 45.3.0 win32-x64 от GitHub; `electron.exe` -> `PA5X Set Tool.exe`,
   иконата и версията с `node tools/setres.mjs <exe> tools/icon.ico`; файловете на `app/` в `resources/app/`.
5. Обновление: увеличи версията в `app/package.json` и пусни
   `node tools/make_update.js <appDir> <този репо> "бележки"`, после commit + push.
