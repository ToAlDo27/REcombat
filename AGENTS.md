# REcombat maintenance

- Product: **REcombat**, author **ToAlDo27**. Keep the existing repository and install URL.
- Preserve `com.toaldo27.recombat` metadata keys and the schema-1 scene journal. Opening the tracker must never reset a scene. Token metadata is a portable mirror of confirmed journal data.
- Each published update must increase the semantic version in package.json, package-lock.json, and public/manifest.json, and add notes to src/releases.json and CHANGELOG.md. Keep older release notes. Run `npm run check:release`.
- Validate changes with `npm test`, `npm run lint`, and `npm run package`. Run relevant Playwright scenarios for changes to token data, LSS integration, and playback. Sound checks must measure real synthetic audio, without recording the user's desktop.
- Only audio.html owns the AudioContext. User activation must occur directly inside that iframe; broadcasts cannot unlock a background AudioContext.
- Keep LSS capability claims accurate: the official OBR bridge exposes rolls, not HP/AC. A direct SDK sheet requires LSS host authorization; health events are experimental. Bind by character ID, not by name. Keep origin/source checks and repeat-delivery protection.
- Register token context-menu actions in the background. Token windows must work with the action panel closed. Keep multi-token additions idempotent.
- The Vortex view is adapted from the official MIT bridge; retain its attribution. Share the official room binding, permit changes only after a GM selection or explicit GM action, and preserve the official logger and notification settings. Opening a token must not change the room.
- Source links must point to https://github.com/ToAlDo27/REcombat. Do not add downloadable source archives to the site.
