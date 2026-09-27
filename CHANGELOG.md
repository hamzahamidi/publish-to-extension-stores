# Changelog

## 1.1.0

Runs Chrome 1.2.2, Firefox 1.1.0, Edge 1.0.0 and google-github-actions/auth 3.0.0.

- Adds `firefox-compatibility`, passed to the Firefox action's `compatibility` input: AMO's applications and versions for the version, as JSON. Without it AMO reads them from `manifest.json`, as before.

## 1.0.0

First release. Runs Chrome 1.2.2, Firefox 1.0.0, Edge 1.0.0 and google-github-actions/auth 3.0.0.

- Publishes one release to the Chrome Web Store, Firefox Add-ons and Microsoft Edge Add-ons from one step by running `hamzahamidi/publish-to-chrome-web-store`, `hamzahamidi/publish-to-firefox-add-ons` and `hamzahamidi/publish-to-edge-add-ons`, each pinned to the commit of its release.
- Takes every store input that shapes a submission under a `chrome-`, `firefox-` or `edge-` prefix, with the store action's default and description, plus one `dry-run` for every store. Chrome `rollout-only` and the Firefox `wait`, `wait-timeout` and `signed-xpi` inputs stay with the store actions, because they act on a version already out or hold the job after submission.
- Chrome credentials as a Workload Identity provider and service account, for which the action runs `google-github-actions/auth` and passes a 30-minute token to the Chrome action, as an access token, or as the refresh token trio. Firefox and Edge take their API keys.
- Runs a store when one of its credential inputs is set. Refuses incomplete or conflicting inputs before any store runs, including a store identifier without any credential and Workload Identity in a job without `id-token: write`, and reports every problem at once.
- Runs every configured store even when an earlier one failed, then fails the step with one error naming the failed stores.
- Returns each store's outputs and a `success`, `failure` or `skipped` outcome per store, also when the step fails, and writes a table of the stores to the step summary.
- Two scripts with no dependencies decide which stores run and report what they did. They read presence flags, step outcomes and store outputs, never a credential value, and need `node` 18 or later on the runner's `PATH`.
