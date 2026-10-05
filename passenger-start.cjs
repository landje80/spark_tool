// Opstartbestand voor Passenger (Plesk). Passenger's node-loader laadt het opstartbestand met
// require(), maar deze app is een ES-module ("type": "module") en Node < 22.12 kan zo'n module
// niet require()-en (ERR_REQUIRE_ESM): de app startte dan stilletjes nooit, zonder logregel.
// Een dynamische import() werkt vanuit CommonJS op elke Node-versie. Lokaal: `npm start`.
import('./dist/server/src/server/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
