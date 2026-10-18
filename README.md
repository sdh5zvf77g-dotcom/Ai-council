# AI Council v2 — repaired build

## Run / deploy
Upload the contents of this folder to the root of a GitHub Pages repository. Open the published HTTPS URL, then use **Settings → Custom API endpoint** and select a provider preset, enter your API key, and save. API requests are sent directly from the browser to the selected provider; providers may block browser-origin requests (CORS), in which case use a trusted server-side proxy.

## Important limitations
- **Local (demo)** is a scripted demonstration, not an AI model. Connect a real API endpoint to get model-generated council replies and app builds.
- Research uses public Wikipedia and DuckDuckGo Instant Answer endpoints. It is not a full web search engine and results can be sparse.
- Browser storage is device/browser-local and may be cleared by Safari. Export important projects regularly.
- API keys are stored in this browser's local storage. Avoid shared devices; never put a private API key in a public repository.
- The build check is a lightweight iframe smoke test, not a complete security audit or guarantee of error-free output.
- Camera access requires HTTPS and browser permission.

## Files
- `index.html`: mobile-first UI and settings
- `app.js`: council logic, provider calls, projects and build pipeline
- `sw.js`: offline app-shell cache for GitHub Pages / HTTPS
- `manifest.webmanifest` and icons: home-screen installation metadata

## Validation performed
JavaScript syntax checked with Node.js. Please also test the published site on the target iPhone/browser and verify the chosen provider endpoint/key because live API connectivity depends on provider account, model availability, CORS, and quota.
