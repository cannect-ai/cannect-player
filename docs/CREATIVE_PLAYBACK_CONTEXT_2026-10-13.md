# Playback context and restoration of deployed event features

Version 0.1.9 restores the deployed event functionality missing from Git main
0.1.7, then makes creative attribution follow actual playback. This source update
and its CI artifacts do not publish a release or activate a station.

## Attribution contract

- The primary `<video>` `playing` event creates a random UUID `playbackId` and
  `startedAt`. Calling `play()` or starting a mirror creates no impression.
- Repeated `playing` events keep the same session. Every replay of the same file
  gets a different ID. Placement changes replace the session even when the file
  URL stays the same.
- Completion, errors, playlist replacement, game interruption, renderer reload,
  renderer crash and application shutdown close the original session. Both sinks
  receive the same `playbackId`, original `startedAt`, video and placement.
- Defaults explicitly notify the camera with `isDefault: true` and clear paid
  attribution. A late end cannot close a different active playback.
- The main process reannounces the current camera context every five seconds,
  only until its original expected end. It keeps the original ID/start/duration,
  allowing camera restarts to recover without extending a clip's lifetime.
- `/report` receives completed paid clips only. The existing backend counts
  incomplete `billable: false` reports as bonus plays, so interruption events
  belong only in the lifecycle sinks. They do not consume billing quotas.
- Failed/unstarted media advances after a bounded timeout; repeated decode
  failures have a one-second delay. Local camera failures never block playback.

The compatible camera receiver accepts `playback_started`, `playback_changed`,
`playback_ended`, `playbackId`, `startedAt`, `expectedDuration`, `isDefault`,
`videoId` and either `bookingId` or `campaignId`. Its default URL is
`http://127.0.0.1:8081/current-ad`; existing `CAMERA_BASE` overrides are preserved.
The web endpoint must persist `playbackId` and reject mismatched terminal events
(cannect PR #155). Forced process/power loss still relies on receiver expiry;
there is no retroactive claim that an unacknowledged local interval was observed.

## Restored deployed behavior

Reference: ALM-008 AppImage `0.1.8-alm002.1`, ASAR SHA-256
`a7cf21ea50d281545734974d0bc2d96481d5ca01aec30d222baf1bc6beae9b69`.
The local uncommitted event source was reconciled with the extracted installed
main/renderer bundles. No compiled React bundle or whole ASAR is committed.

- `EVENT_QUEUE_MODE=cannect` keeps the normal Cannect ad queue and overlays opt-in
  Shecker games/celebrations. Paused ads close their session and restart when the
  overlay finishes. With no event credentials the normal fleet player is used.
- `EVENT_QUEUE_MODE=event` retains the separate event playlist and immutable
  rounds. Existing partner/promo scheduling and guest uploads are preserved.
- The WebSocket feedback stream has reconnect/acknowledgement handling. Durable
  celebration acknowledgements cannot block fresh state or the tablet's Home
  command. Event requests support the installed `X-Player-Key` header and legacy
  bearer header, both sent only to the configured event service.
- Shecker retains Russian/Kazakh game text, non-looping discounted celebration,
  timeout recovery, one soundtrack and original media choices.
- Digital Bridge retains server-selected cached videos and overlays, media
  revision acknowledgement and the requirement that all three strips are ready
  before acknowledging a gift. Its finish screen remains tablet-controlled.
- Bundled media/fonts and CSS were checked against installed asset hashes. Only
  imported runtime assets are included; unrelated preview videos are excluded.
- Event installations continue to skip automatic updates, matching the installed
  custom build. Ordinary fleet releases still use the existing release channel.

## Configuration and delivery

Station IDs, tokens and event keys remain external. Event settings are read from
`/etc/cannect-player/event.env` after station identity, or environment variables.
Secrets are never sent through the renderer bridge. Do not copy one station's
configuration onto another.

`npm run typecheck`, `npm test` and `npm run build` run in CI. CI additionally
packages a Linux x64 AppImage and runs an unprovisioned Xvfb startup smoke. It
uploads an artifact with `--publish never`; no station or release API is called.
Full-screen hardware playback, audio and live game/API acceptance remain required
before publishing or replacing a fleet binary. `npm run release` is a separate,
explicit operation that publishes to the existing `k-batyrbek/cannect-player`
release channel and can trigger device auto-updates.
