# Publish to Extension Stores

[![CI](https://github.com/hamzahamidi/publish-to-extension-stores/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hamzahamidi/publish-to-extension-stores/actions/workflows/ci.yml)
[![CodeQL](https://github.com/hamzahamidi/publish-to-extension-stores/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/hamzahamidi/publish-to-extension-stores/actions/workflows/codeql.yml)
[![codecov](https://codecov.io/gh/hamzahamidi/publish-to-extension-stores/branch/main/graph/badge.svg)](https://codecov.io/gh/hamzahamidi/publish-to-extension-stores)
[![GitHub Marketplace](https://img.shields.io/github/v/release/hamzahamidi/publish-to-extension-stores?label=Marketplace&logo=github)](https://github.com/marketplace/actions/publish-to-extension-stores)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-2ea44f)](package.json)
[![license](https://img.shields.io/github/license/hamzahamidi/publish-to-extension-stores)](LICENSE)

Publish one extension release to the Chrome Web Store, Firefox Add-ons and Microsoft Edge Add-ons from one GitHub Actions step.

- **One step, three stores.** It runs [publish-to-chrome-web-store](https://github.com/hamzahamidi/publish-to-chrome-web-store), [publish-to-firefox-add-ons](https://github.com/hamzahamidi/publish-to-firefox-add-ons) and [publish-to-edge-add-ons](https://github.com/hamzahamidi/publish-to-edge-add-ons) one after another, each pinned to the commit of a release.
- **One store failing does not stop the others.** Every configured store runs even when an earlier one failed. The step fails at the end and reports each store's outcome and outputs.
- **Checked before anything uploads.** Half of the Chrome refresh token trio, a Firefox key without a channel or an Edge key without a product ID stops the run before any store receives a request.
- **Short-lived Chrome token.** With Workload Identity Federation the action gets a 30-minute Google token itself. Firefox and Edge take their stores' API keys.
- **Every option that shapes a release.** Signed CRX uploads and partial rollouts on Chrome, listed or unlisted Firefox versions with source code and notes, Edge drafts and certification notes, and one shared dry run.

**One job holds every credential.** This action publishes to all three stores from one step in one job. Every credential you pass is present in that job, the AMO and Edge secrets live in the same environment as your Chrome route, and with Workload Identity Federation every step of the job, the Firefox and Edge actions included, can request the GitHub OIDC token that Google accepts for your Chrome item. The recommended setup is the three store actions in three jobs, each with its own environment that holds only its store's credential: see [Three separate jobs](#three-separate-jobs). Use this action when one approval and a shorter workflow matter more to you than keeping each store's credential away from the other stores' code.

## Quick start

After the [one-time setup](#before-you-start) on each store and the [credentials](#credentials) in an `extension-stores` environment, add this workflow:

```yaml
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      # ... build dist/chrome/, dist/firefox/ and dist/edge/ ...
      - run: |
          (cd dist/chrome && zip -qr ../../chrome.zip .)
          (cd dist/firefox && zip -qr ../../firefox.zip .)
          (cd dist/edge && zip -qr ../../edge.zip .)
      - uses: actions/upload-artifact@v7
        with:
          name: extension
          path: |
            chrome.zip
            firefox.zip
            edge.zip

  publish:
    needs: build
    runs-on: ubuntu-latest
    environment: extension-stores
    permissions:
      id-token: write
    timeout-minutes: 75
    concurrency:
      group: extension-stores
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: extension
      - uses: hamzahamidi/publish-to-extension-stores@v1
        with:
          chrome-workload-identity-provider: ${{ vars.CWS_WIF_PROVIDER }}
          chrome-service-account: ${{ vars.CWS_SERVICE_ACCOUNT }}
          chrome-publisher-id: your-publisher-id
          chrome-item-id: abcdefghijklmnopabcdefghijklmnop
          chrome-zip: chrome.zip
          firefox-api-key: ${{ secrets.AMO_API_KEY }}
          firefox-api-secret: ${{ secrets.AMO_API_SECRET }}
          firefox-addon-id: my-extension@example.com
          firefox-zip: firefox.zip
          firefox-channel: listed
          edge-api-key: ${{ secrets.EDGE_API_KEY }}
          edge-client-id: ${{ secrets.EDGE_CLIENT_ID }}
          edge-product-id: d34f98f5-f9b7-42b1-bebb-98707202b21d
          edge-zip: edge.zip
```

The build runs in its own job without credentials. Add `dry-run: true` to the last step for a first run that uploads nothing. When one ZIP suits every browser, pass the same file to the three `*-zip` inputs; Firefox needs `browser_specific_settings.gecko.id` in its manifest.

## Why this action

- **One approval per release.** One environment, one reviewer approval and one publish job of about 30 lines, where three jobs take three environments, three approvals and about 70 lines.
- **Three store actions that fit together.** Each release of this action pins the three store actions and `google-github-actions/auth` by commit. CI runs it against each store action's own mock at those commits, then runs that store's own verifier.
- **The store actions do the work.** This action sends no request of its own. Each store action keeps its own checks, its safe re-runs and its masking of credentials; this action decides which of them run and reports what they did.

Not affiliated with or endorsed by Google, Mozilla or Microsoft. Chrome Web Store is a trademark of Google LLC. Firefox is a trademark of the Mozilla Foundation. Microsoft Edge is a trademark of Microsoft Corporation.

## Before you start

Each store needs a one-time setup that no API can do, the same as with the store actions:

- **Chrome Web Store.** The item exists in the Developer Dashboard, with its Store listing and Privacy tabs filled out, and the publisher account has 2-step verification. See the Chrome action's [Before you start](https://github.com/hamzahamidi/publish-to-chrome-web-store#before-you-start).
- **Firefox Add-ons.** The add-on exists on addons.mozilla.org, and the package carries its ID in `browser_specific_settings.gecko.id`. See the Firefox action's [Before you start](https://github.com/hamzahamidi/publish-to-firefox-add-ons#before-you-start).
- **Microsoft Edge Add-ons.** The extension was published once through Partner Center, and you have its product ID, the GUID on its overview page. The API key expires after 72 days. See the Edge action's [Before you start](https://github.com/hamzahamidi/publish-to-edge-add-ons#before-you-start) and [Rotating the API key](https://github.com/hamzahamidi/publish-to-edge-add-ons#rotating-the-api-key).
- **Every store.** Raise `version` in `manifest.json` for every release.
- **One writer per item.** Nothing else should upload to the same Chrome item, Firefox add-on or Edge product while a run is going: not the dashboards, not another workflow. The `extension-stores` concurrency group in the quick start keeps two releases of this workflow apart.

## Credentials

### One environment

The job has one environment, so every store's credential lives in it. Create an environment named `extension-stores` with a required reviewer and a deployment rule that only allows your release tags, such as `v*`, then store the Firefox and Edge credentials as its secrets:

```bash
gh secret set AMO_API_KEY --env extension-stores --repo OWNER/REPO
gh secret set AMO_API_SECRET --env extension-stores --repo OWNER/REPO
gh secret set EDGE_API_KEY --env extension-stores --repo OWNER/REPO
gh secret set EDGE_CLIENT_ID --env extension-stores --repo OWNER/REPO
```

- Use environment secrets, not repository secrets: anyone with write access can read repository secrets from a workflow on any branch.
- Store each value as its own secret, never several values in one JSON secret. The runner prints a step's inputs before any action can mask them, and GitHub redacts values taken out of a structured secret poorly.
- Pass the Edge client ID from a secret too. The runner lists a step's `with:` values at the top of its log and redacts only values that come from secrets.

The AMO key and secret come from the [API Credentials page](https://addons.mozilla.org/developers/addon/api/key/) of the Developer Hub; see the Firefox action's [The credential](https://github.com/hamzahamidi/publish-to-firefox-add-ons#the-credential). The Edge API key and client ID come from Partner Center, Microsoft Edge, Publish API; see the Edge action's [Credentials](https://github.com/hamzahamidi/publish-to-edge-add-ons#credentials).

### Chrome

Pass exactly one of three credential forms. The action refuses a mix before any store runs.

| Form | Inputs | What this action does | Your job needs |
| --- | --- | --- | --- |
| Workload Identity Federation (recommended) | `chrome-workload-identity-provider`, `chrome-service-account` | Runs `google-github-actions/auth` with the Chrome action's settings (access token, `chromewebstore` scope, 1800 s, no credentials file, no exported variables) and passes the token to the Chrome action | `permissions: id-token: write`, and the environment the provider condition names |
| Access token | `chrome-access-token` | Passes it to the Chrome action | A step before this one that gets the token |
| Refresh token | `chrome-client-id`, `chrome-client-secret`, `chrome-refresh-token` | Passes the three to the Chrome action, which exchanges them and masks the token it gets | Three secrets in `extension-stores` |

**Workload Identity Federation.** Follow the Chrome action's [Setting up Workload Identity Federation](https://github.com/hamzahamidi/publish-to-chrome-web-store#setting-up-workload-identity-federation). Its provider condition restricts owner ID, repository ID and release tags, and ends in `assertion.environment == 'chrome-web-store'`. This job runs in `extension-stores`, so update the condition once. Set `OWNER_ID` and `REPO_ID` to the numeric IDs the first line prints, as in steps 1 and 4 of the Chrome setup:

```bash
gh api repos/OWNER/REPO --jq '"owner \(.owner.id), repository \(.id)"'
OWNER_ID=12345678
REPO_ID=987654321
gcloud iam workload-identity-pools providers update-oidc github \
  --location=global --workload-identity-pool=cws-publish \
  --attribute-condition="assertion.repository_owner_id == '$OWNER_ID' && assertion.repository_id == '$REPO_ID' && assertion.ref_type == 'tag' && assertion.ref.startsWith('refs/tags/v') && assertion.environment == 'extension-stores'"
```

To avoid any Google Cloud change, run the publish job in your existing `chrome-web-store` environment instead and add the four AMO and Edge secrets there. It works at once, but the environment's name no longer says what it holds.

The OIDC token describes the caller's job: its repository, owner, ref and environment. Nothing in it names this action, so the rest of the Chrome setup applies unchanged. The action checks for `permissions: id-token: write` before any store runs, because a composite action cannot request it.

**Access token.** For a token with another lifetime, or from a service account key, get it in your own step and pass it in:

```yaml
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.CWS_WIF_PROVIDER }}
          service_account: ${{ vars.CWS_SERVICE_ACCOUNT }}
          token_format: access_token
          access_token_scopes: https://www.googleapis.com/auth/chromewebstore
          access_token_lifetime: 3600s
          create_credentials_file: false
          export_environment_variables: false
      - uses: hamzahamidi/publish-to-extension-stores@v1
        with:
          chrome-access-token: ${{ steps.auth.outputs.access_token }}
          chrome-publisher-id: your-publisher-id
          chrome-item-id: abcdefghijklmnopabcdefghijklmnop
          chrome-zip: chrome.zip
```

A service account key is a long-lived JSON secret. This action never takes one as an input; with this form it stays in your own auth step.

**Refresh token.** The refresh token is long-lived and can publish every item of the publisher, and here it sits in the same job as the AMO and Edge credentials. Prefer Workload Identity Federation.

```yaml
          chrome-client-id: ${{ secrets.CWS_CLIENT_ID }}
          chrome-client-secret: ${{ secrets.CWS_CLIENT_SECRET }}
          chrome-refresh-token: ${{ secrets.CWS_REFRESH_TOKEN }}
```

## Usage

### One or two stores

A store runs when any of its credential inputs is set. Leave out every input of a store you do not publish to:

| Store | Runs when any of these is set |
| --- | --- |
| Chrome | `chrome-workload-identity-provider`, `chrome-service-account`, `chrome-access-token`, `chrome-client-id`, `chrome-client-secret`, `chrome-refresh-token` |
| Firefox | `firefox-api-key`, `firefox-api-secret` |
| Edge | `edge-api-key`, `edge-client-id` |

"Any" rather than "all": a store with part of its credentials, such as a mistyped secret name that evaluates to an empty string, fails with a message naming the empty input instead of being skipped. For the same reason, the action fails when `chrome-item-id`, `firefox-addon-id` or `edge-product-id` is set while every credential input of that store is empty: that is most often a job without its `environment:`, or a secret missing from it. To switch a store off, remove its identifier together with its credentials.

### Trying it first

`dry-run: true` goes to every store action that runs. Each one checks its inputs and its package and reports what a real run would do, without uploading:

| Store | What its dry run does |
| --- | --- |
| Chrome | Reads the package, gets the token and reads the item status, so it proves that the credentials can read the item |
| Firefox | Runs every local check and every read (the site status, the add-on, your author role, the version and the upload list) and sends no POST or PATCH, so it proves that the credentials work |
| Edge | Checks the inputs and the ZIP and sends nothing to Microsoft, so it proves nothing about the credentials |

With Workload Identity Federation, the auth step still runs, because the Chrome dry run reads the store with the token. To start a dry run by hand, give the workflow a `workflow_dispatch` trigger with a boolean `dry-run` input, pass `dry-run: ${{ inputs.dry-run }}` to this action, and pick a release tag under "Use workflow from", because the environment admits only tag runs. A push run leaves the input empty, which means `false`.

### Partial rollout on Chrome

```yaml
          chrome-deploy-percentage: 10
```

Google allows a rollout percentage only for items with more than 10,000 seven-day active users, and only upward. To raise the published version later, run the release again with `chrome-deploy-percentage: 50`: Chrome finds its version published and raises it (`chrome-result: raised`), while Firefox finds its version and ends `skipped`. Edge uploads again and fails with `InProgressSubmission` while its version is in certification (see [Re-running a release](#re-running-a-release)), so for a rollout change alone, prefer the Chrome action's `rollout-only` in its own job. See the Chrome action's [Partial rollout](https://github.com/hamzahamidi/publish-to-chrome-web-store#partial-rollout). `chrome-skip-review` and `chrome-block-on-warnings` pass the matching store options.

### A signed CRX for Chrome

For an item opted in to Verified CRX Uploads, sign in a job of its own, with the key in its own environment, and pass the CRX to `chrome-crx` instead of `chrome-zip`:

```yaml
  sign:
    needs: build
    runs-on: ubuntu-latest
    environment: crx-signing
    permissions: {}
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: extension
      - id: sign
        uses: hamzahamidi/publish-to-chrome-web-store/sign@v1
        with:
          zip: chrome.zip
          private-key: ${{ secrets.CRX_PRIVATE_KEY }}
      - uses: actions/upload-artifact@v7
        with:
          name: extension-crx
          path: ${{ steps.sign.outputs.crx }}
```

The publish job then needs `sign` too, downloads `extension-crx` next to `extension`, and passes `chrome-crx: chrome.crx`. The signing key and the store credentials never share a job. See the Chrome action's [With Verified CRX Uploads](https://github.com/hamzahamidi/publish-to-chrome-web-store#with-verified-crx-uploads-optional).

### Unlisted on Firefox

`firefox-channel: unlisted` submits the version for signing for self-distribution. The run ends once AMO accepts the version. To wait for the signed file and download it, run the Firefox action with its `signed-xpi` input in a later job; see the Firefox action's [Unlisted, with the signed file](https://github.com/hamzahamidi/publish-to-firefox-add-ons#unlisted-with-the-signed-file).

### A draft on Edge

`edge-publish: false` uploads the ZIP into the Edge draft and submits nothing, so you can check it in Partner Center and publish there. See the Edge action's [Uploading a draft, publishing by hand](https://github.com/hamzahamidi/publish-to-edge-add-ons#uploading-a-draft-publishing-by-hand). `chrome-publish: false` does the same on Chrome. AMO has no drafts.

### Notes for reviewers and testers

```yaml
          firefox-source: firefox-source.zip
          firefox-release-notes: Adds a settings page.
          firefox-approval-notes: npm ci && npm run build
          edge-certification-notes: |
            Test account: reviewer@example.com
            Click the toolbar button.
```

See the Firefox action's [Source code and notes](https://github.com/hamzahamidi/publish-to-firefox-add-ons#source-code-and-notes) and the Edge action's [Notes for the certification testers](https://github.com/hamzahamidi/publish-to-edge-add-ons#notes-for-the-certification-testers).

### Reading the outputs

Outputs are set even when the step fails. Read them from a later step with `if: always()`:

```yaml
      - id: stores
        uses: hamzahamidi/publish-to-extension-stores@v1
        with:
          firefox-api-key: ${{ secrets.AMO_API_KEY }}
          firefox-api-secret: ${{ secrets.AMO_API_SECRET }}
          firefox-addon-id: my-extension@example.com
          firefox-zip: firefox.zip
          firefox-channel: listed
      - if: always() && steps.stores.outputs.firefox-edit-url != ''
        env:
          VERSION: ${{ steps.stores.outputs.firefox-version }}
          STATE: ${{ steps.stores.outputs.firefox-state }}
          EDIT_URL: ${{ steps.stores.outputs.firefox-edit-url }}
        run: |
          echo "Firefox $VERSION is $STATE on AMO: $EDIT_URL" >> "$GITHUB_STEP_SUMMARY"
```

## Failures and re-runs

### One store fails

The stores run in the order Chrome, Firefox, Edge. When one fails, the next ones still run, and the step fails at the end with one error naming the stores that failed. Each store's own error message stays on its own step in the log. The step summary holds a table with each store's outcome, result, state, version and, for Firefox, a link to the version's Developer Hub page.

A failure of `google-github-actions/auth` counts as a Chrome failure: the Chrome action does not run, `chrome-outcome` is `failure`, and Firefox and Edge still run.

Format errors in a store's inputs, such as a product ID that is not a GUID, are found by that store's action when its step runs. By then the stores before it have published. The action checks presence and combinations before any store runs; each store action checks the values.

### Re-running a release

A re-run of the job runs all three stores again:

- Chrome finds its version in the store and ends `skipped`.
- Firefox finds its version on AMO and ends `skipped`, completing the release notes if the first run stopped before them.
- Edge uploads again and asks to publish. While its first submission is in certification, Microsoft answers `InProgressSubmission` and the step fails, or `NoModulesUpdated`, which ends `skipped`.

To retry only the store that failed, run that store's action in a job of its own for this release, such as the matching job from [Three separate jobs](#three-separate-jobs) in a `workflow_dispatch` workflow, or wait until the Edge certification ends and re-run.

If you prefer the "earlier submission is in certification" case green, set `continue-on-error: true` on the step and fail on anything else:

```yaml
      - id: stores
        continue-on-error: true
        uses: hamzahamidi/publish-to-extension-stores@v1
        with:
          # ... as in the quick start ...
      - if: >-
          steps.stores.outcome == 'failure' && !(
            steps.stores.outputs.chrome-outcome != 'failure' &&
            steps.stores.outputs.firefox-outcome != 'failure' &&
            steps.stores.outputs.edge-error-code == 'InProgressSubmission')
        run: exit 1
```

The price is the one the Edge action's [Re-running a release](https://github.com/hamzahamidi/publish-to-edge-add-ons#re-running-a-release) states: a newer version held back by an older review also ends green, and it waits in the draft until someone publishes it.

## Inputs

Each store input keeps its store action's name behind a prefix: `chrome-`, `firefox-` or `edge-`. Descriptions in `action.yml` quote the store action's own description, so input names inside them are the store action's names, without the prefix. Defaults are the store actions' defaults. Paths resolve against the workspace, as `working-directory` does not apply to actions.

### Shared and Chrome token inputs

| Input | Goes to | Default | Notes |
| --- | --- | --- | --- |
| `dry-run` | `dry-run` of every store action that runs | `false` | `true` or `false`, in the spellings the store actions accept |
| `chrome-workload-identity-provider` | `workload_identity_provider` of `google-github-actions/auth` | | Full resource name of the provider. An identifier, not a secret: store it as a repository variable |
| `chrome-service-account` | `service_account` of `google-github-actions/auth` | | Email of the service account linked to the publisher. Pass it with `chrome-workload-identity-provider` |

### Chrome

| Input | Chrome action input | Default | Notes |
| --- | --- | --- | --- |
| `chrome-access-token` | `access-token` | | Also receives the token from `google-github-actions/auth` in the Workload Identity form |
| `chrome-client-id` | `client-id` | | Refresh token form, with the next two |
| `chrome-client-secret` | `client-secret` | | Refresh token form |
| `chrome-refresh-token` | `refresh-token` | | Refresh token form |
| `chrome-publisher-id` | `publisher-id` | | Required when Chrome runs |
| `chrome-item-id` | `item-id` | | Required when Chrome runs |
| `chrome-zip` | `zip` | | Exactly one of `chrome-zip` and `chrome-crx` when Chrome runs |
| `chrome-crx` | `crx` | | A CRX3 signed in another job |
| `chrome-publish` | `publish` | `true` | `false` uploads a draft |
| `chrome-deploy-percentage` | `deploy-percentage` | | Initial rollout on submit, or a raise for the version already published |
| `chrome-skip-review` | `skip-review` | `false` | |
| `chrome-block-on-warnings` | `block-on-warnings` | `false` | |
| `chrome-publish-type` | `publish-type` | `default` | `staged` holds the approved version |

### Firefox

| Input | Firefox action input | Default | Notes |
| --- | --- | --- | --- |
| `firefox-api-key` | `api-key` | | Required when Firefox runs |
| `firefox-api-secret` | `api-secret` | | Required when Firefox runs |
| `firefox-addon-id` | `addon-id` | | Required when Firefox runs |
| `firefox-zip` | `zip` | | Required when Firefox runs. A `.zip` or `.xpi` |
| `firefox-channel` | `channel` | | Required when Firefox runs: `listed` or `unlisted`. No default, so nothing is published publicly by accident |
| `firefox-source` | `source` | | ZIP of the source code |
| `firefox-release-notes` | `release-notes` | | In English (en-US) |
| `firefox-approval-notes` | `approval-notes` | | For Mozilla reviewers |
| `firefox-compatibility` | `compatibility` | | JSON, AMO's applications and versions for the version. Omit to use `manifest.json` |

### Edge

| Input | Edge action input | Default | Notes |
| --- | --- | --- | --- |
| `edge-api-key` | `api-key` | | Required when Edge runs |
| `edge-client-id` | `client-id` | | Required when Edge runs. Pass it from a secret |
| `edge-product-id` | `product-id` | | Required when Edge runs. The GUID from Partner Center |
| `edge-zip` | `zip` | | Required when Edge runs |
| `edge-publish` | `publish` | `true` | `false` uploads into the draft only |
| `edge-certification-notes` | `certification-notes` | | For the certification testers |

## What it leaves to the store actions

Four store inputs and one output stay out, because they act on a version that is already out or hold the job after submission, in a job that holds every store's credential:

| Store input or output | Why it stays out | Where to use it |
| --- | --- | --- |
| Chrome input `rollout-only` | Raises the rollout of the published version without uploading anything: an operation on a version already out | The Chrome action in its own job; see [Partial rollout](https://github.com/hamzahamidi/publish-to-chrome-web-store#partial-rollout) |
| Firefox input `wait` | Holds the step until AMO signs or rejects the version, up to 360 minutes | The Firefox action in a later job; see [After a listed submission](https://github.com/hamzahamidi/publish-to-firefox-add-ons#after-a-listed-submission) |
| Firefox input `wait-timeout` | Applies only with `wait` or `signed-xpi` | Same |
| Firefox input `signed-xpi` | Unlisted only: waits for signing, then downloads the signed file | The Firefox action in its own job; see [Unlisted, with the signed file](https://github.com/hamzahamidi/publish-to-firefox-add-ons#unlisted-with-the-signed-file) |
| Firefox output `signed-xpi` | Always empty without the `signed-xpi` input | Same |

## Outputs

| Output | Value |
| --- | --- |
| `chrome-outcome` | `success`, `failure` or `skipped`. `failure` also when `google-github-actions/auth` failed |
| `chrome-result` | `submitted`, `uploaded`, `skipped`, `raised` or `dry-run` |
| `chrome-state` | Store state of the version when the Chrome action finished, such as `PENDING_REVIEW` |
| `chrome-version` | Version read from the package |
| `firefox-outcome` | `success`, `failure` or `skipped` |
| `firefox-result` | `submitted`, `skipped` or `dry-run` |
| `firefox-state` | AMO file status: `unreviewed`, `public` or `disabled` |
| `firefox-version` | Version read from `manifest.json` |
| `firefox-version-id` | AMO's numeric version ID |
| `firefox-edit-url` | The version's Developer Hub page |
| `edge-outcome` | `success`, `failure` or `skipped` |
| `edge-result` | `submitted`, `uploaded`, `skipped` or `dry-run`. Empty when the run fails |
| `edge-version` | Version read from `manifest.json` |
| `edge-error-code` | Microsoft's `errorCode` of a failed operation, such as `InProgressSubmission`. Set also when the step fails |

The `*-outcome` outputs are GitHub's step outcomes. `skipped` there means the store action did not run: the store had no credential inputs, or the action refused the run before any store started. The step's own outcome tells the two apart. The `*-result` outputs are each store's own words: `skipped` in `chrome-result` or `firefox-result` means the version was already in the store, and in `edge-result` that Microsoft reported no change since the last submission. Firefox writes each output as soon as it knows it, so `firefox-result: submitted` with `firefox-outcome: failure` means the version was created and a later request failed. No output carries a token.

## What it does

| Step | Runs when | Does |
| --- | --- | --- |
| 1. Check which stores run | Always | Checks presence and combinations of the inputs, decides which stores run, and stops the run with every problem it found |
| 2. Chrome token through Workload Identity Federation | Chrome runs with the Workload Identity inputs | `google-github-actions/auth` with the Chrome action's settings |
| 3. Chrome Web Store | Chrome runs and step 2 did not fail | The Chrome action |
| 4. Firefox Add-ons | Firefox runs | The Firefox action, even when Chrome failed |
| 5. Microsoft Edge Add-ons | Edge runs | The Edge action, even when Chrome or Firefox failed |
| 6. Report each store | Step 1 passed | Writes one log line per store and the summary table, and fails when a store failed |

A failed store does not skip the ones after it: each later step runs when the condition in its row holds, unless step 1 failed or the workflow was cancelled. Edge runs last because it takes longest.

What this action adds to the store actions is two small scripts, `scripts/preflight.mjs` and `scripts/report.mjs`, with no dependencies. The first reads only `true` or `false` for each input it checks, plus the `dry-run` value, and whether `ACTIONS_ID_TOKEN_REQUEST_URL` is set, which tells it that the job can request an OIDC token. The second reads only step outcomes and store outputs. Neither reads a credential value, and neither sends a request. With `id-token: write` the runner gives every `run:` step, these two included, `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`; the scripts read only whether the URL is set. No input reaches a `run:` script through an expression.

## Three separate jobs

The recommended setup keeps each store's credential in its own job and environment. Give each environment a required reviewer and a deployment rule that only allows your release tags:

- `chrome-web-store` for Chrome, as the Chrome action's [Setting up Workload Identity Federation](https://github.com/hamzahamidi/publish-to-chrome-web-store#setting-up-workload-identity-federation) creates it. Its provider condition must name `chrome-web-store`: if you applied the `extension-stores` update under [Chrome](#chrome), run that `gcloud` command again with `chrome-web-store` in its place.
- `firefox-add-ons` for Firefox, holding `AMO_API_KEY` and `AMO_API_SECRET`. See the Firefox action's [The credential](https://github.com/hamzahamidi/publish-to-firefox-add-ons#the-credential).
- `edge-add-ons` for Edge, holding `EDGE_API_KEY` and `EDGE_CLIENT_ID`. See the Edge action's [Credentials](https://github.com/hamzahamidi/publish-to-edge-add-ons#credentials).

```yaml
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      # ... build dist/chrome/, dist/firefox/ and dist/edge/ ...
      - run: |
          (cd dist/chrome && zip -qr ../../chrome.zip .)
          (cd dist/firefox && zip -qr ../../firefox.zip .)
          (cd dist/edge && zip -qr ../../edge.zip .)
      - uses: actions/upload-artifact@v7
        with:
          name: extension
          path: |
            chrome.zip
            firefox.zip
            edge.zip

  chrome:
    needs: build
    runs-on: ubuntu-latest
    environment: chrome-web-store
    permissions:
      id-token: write
    concurrency:
      group: chrome-web-store
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: extension
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.CWS_WIF_PROVIDER }}
          service_account: ${{ vars.CWS_SERVICE_ACCOUNT }}
          token_format: access_token
          access_token_scopes: https://www.googleapis.com/auth/chromewebstore
          access_token_lifetime: 1800s
          create_credentials_file: false
          export_environment_variables: false
      - uses: hamzahamidi/publish-to-chrome-web-store@v1
        with:
          access-token: ${{ steps.auth.outputs.access_token }}
          publisher-id: your-publisher-id
          item-id: abcdefghijklmnopabcdefghijklmnop
          zip: chrome.zip

  firefox:
    needs: build
    runs-on: ubuntu-latest
    environment: firefox-add-ons
    permissions: {}
    concurrency:
      group: firefox-add-ons
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: extension
      - uses: hamzahamidi/publish-to-firefox-add-ons@v1
        with:
          api-key: ${{ secrets.AMO_API_KEY }}
          api-secret: ${{ secrets.AMO_API_SECRET }}
          addon-id: my-extension@example.com
          zip: firefox.zip
          channel: listed

  edge:
    needs: build
    runs-on: ubuntu-latest
    environment: edge-add-ons
    permissions: {}
    timeout-minutes: 40
    concurrency:
      group: edge-add-ons
      cancel-in-progress: false
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: extension
      - uses: hamzahamidi/publish-to-edge-add-ons@v1
        with:
          api-key: ${{ secrets.EDGE_API_KEY }}
          client-id: ${{ secrets.EDGE_CLIENT_ID }}
          product-id: d34f98f5-f9b7-42b1-bebb-98707202b21d
          zip: edge.zip
```

| | This action, one job | The store actions, three jobs |
| --- | --- | --- |
| Jobs after the build | 1 | 3 |
| Environments and approvals | 1 environment, 1 approval | 3 environments, 3 approvals (a reviewer can approve several at once) |
| Who can read each credential | Every step of the job: the three store actions, auth, and this action's scripts (which read only presence flags) | Only the steps of that store's job |
| Who can request an OIDC token Google accepts | Every step of the job | Only the Chrome job |
| Where the AMO and Edge secrets live | The environment the Workload Identity condition names | Their own environments |
| One store fails | The others still run; the step fails at the end | The other jobs are unaffected; each job has its own status |
| Re-running after a failure | Re-runs all three: Chrome and Firefox end `skipped`, Edge can fail with `InProgressSubmission` | "Re-run failed jobs" repeats only the store that failed |
| Time | The sum of the three, about 70 minutes at worst | The longest one, since the jobs run in parallel |
| Concurrency and time limit | One group and one limit for all three | One per store |
| Store options | Every submission input; not Chrome `rollout-only` or the Firefox waits | Every input of every store action |
| Version pins in your workflow | One: this action, which fixes the four inner pins | Three store actions plus `google-github-actions/auth` |
| A store action fix reaches you | After a release of this action | When the store action is released |
| Logs | One job log, one step group per store | One log per store |
| Workflow size | One publish job, about 30 lines | Three publish jobs, about 70 lines |

## Trust and security

- **Pinned by commit.** Every action this one runs is pinned to the full commit SHA of a release, listed under [Versions](#versions). A tag moved on another repository does not change what runs.
- **No credential in this action's code.** The two scripts read presence flags, outcomes and store outputs, never a credential value. The credentials go only to the `with:` of the store actions and of `google-github-actions/auth`.
- **Masking.** Each store action masks its credentials before its first log line, and `google-github-actions/auth` masks the token it mints. The token reaches only the Chrome action's input, never an output. Secrets forwarded through this action's inputs stay redacted in the log, because the runner redacts every job secret wherever it appears.
- **Requests.** Each store action lists every request it makes: [Chrome](https://github.com/hamzahamidi/publish-to-chrome-web-store#every-request-the-action-makes), [Firefox](https://github.com/hamzahamidi/publish-to-firefox-add-ons#every-request-the-action-makes), [Edge](https://github.com/hamzahamidi/publish-to-edge-add-ons#every-request-the-action-makes). This action makes none.
- **The OIDC token.** `id-token: write` covers the whole job, so every step of it could request a GitHub OIDC token: the Firefox and Edge actions, and every `run:` step, this action's two scripts included, which get `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` from the runner. Neither store action requests one, and the scripts read only whether the URL is set. The Workload Identity condition decides what Google accepts; see [Three separate jobs](#three-separate-jobs) to keep that token out of reach of the other stores' code.
- **Store output values are data.** A version comes from a manifest inside the package. The report step joins line breaks and defuses workflow commands before printing a value, and escapes table syntax and HTML in the step summary.

## Versions

This release runs:

| Action | Version | Commit |
| --- | --- | --- |
| [google-github-actions/auth](https://github.com/google-github-actions/auth) | v3.0.0 | `7c6bc770dae815cd3e89ee6cdf493a5fab2cc093` |
| [hamzahamidi/publish-to-chrome-web-store](https://github.com/hamzahamidi/publish-to-chrome-web-store) | v1.2.2 | `c8919147f8de0d6f1129bec36345e4a9aa638af9` |
| [hamzahamidi/publish-to-firefox-add-ons](https://github.com/hamzahamidi/publish-to-firefox-add-ons) | v1.1.0 | `d68c8e16ec0a95a8370cc3c77d85455627aa2441` |
| [hamzahamidi/publish-to-edge-add-ons](https://github.com/hamzahamidi/publish-to-edge-add-ons) | v1.0.0 | `4efbcdd7ee5fef9612ff586e4ad4a9adda919e02` |

Each store action release needs a release of this action, which Dependabot proposes. A store release with a security fix gets a release of this action the same day, other store releases within a week. The version moves at least as far as the largest inner move:

| Change in the release | Version bump |
| --- | --- |
| Inner patch releases only, or a fix in this action | Patch |
| An inner minor release, which may bring inputs or outputs that this action maps or leaves out | Minor |
| An inner major release, an input or output removed or renamed, or a mapped input moved to the table of inputs left out | Major |

Use `@v1`, which follows the newest immutable `1.x.y` release. Where your organization requires full SHAs, pin the release commit with its version as a comment: `hamzahamidi/publish-to-extension-stores@<commit> # v1.0.0`. Every action nested inside is pinned by SHA too.

## Limits

- One job and one environment for every store, with the consequences under [Three separate jobs](#three-separate-jobs).
- The stores run one after another. The worst case is about 70 minutes: Chrome about 15, Firefox about 22 and Edge about 32. Normal runs take a few minutes. Composite steps have no `timeout-minutes`, so the job's limit is the only one; the quick start sets 75.
- Paths are relative to the workspace. `working-directory` does not apply to actions, and a job's `defaults.run.working-directory` applies only to `run:` steps.
- `node` must be on the runner's `PATH`, version 18 or later, for the two scripts. GitHub-hosted runners have it. On a self-hosted runner without it, the first step fails and no store runs; add `actions/setup-node` before this action. The store actions themselves run on the runner's own Node.
- No Chrome `rollout-only` and no Firefox waits or signed file download; see [What it leaves to the store actions](#what-it-leaves-to-the-store-actions).
- No Safari, Opera add-ons or other stores. Brave, Opera and Vivaldi users can install from the Chrome Web Store.
- One set of credentials per store. To publish two Chrome items, use two steps.
- Everything each store cannot do applies here: see the Limits sections of the [Chrome](https://github.com/hamzahamidi/publish-to-chrome-web-store#limits), [Firefox](https://github.com/hamzahamidi/publish-to-firefox-add-ons#limits) and [Edge](https://github.com/hamzahamidi/publish-to-edge-add-ons#limits) actions.

## FAQ

### Do I need all three stores?

No. A store runs only when its credential inputs are set. With one store, its own action is the simpler choice.

### Does it store a secret?

No. It passes your secrets to the store actions for one run and stores none. It writes only step outputs and the step summary, and neither holds a credential. With Workload Identity Federation, Chrome needs no stored secret at all.

### Is a re-run safe?

Yes for Chrome and Firefox, which skip a version already in the store. Edge uploads again and, while the first submission is in certification, fails with `InProgressSubmission` without cancelling anything. See [Re-running a release](#re-running-a-release).

### Can I pin a store action version myself?

No. This action fixes the four inner versions. To choose them yourself, use the store actions in [three separate jobs](#three-separate-jobs).

### Why not a reusable workflow?

A reusable workflow could give each store its own job and environment, but it cannot be listed on the GitHub Marketplace. The three-job workflow above gives the same isolation with the store actions directly.

### Does it need Google Cloud?

Only for the Chrome Workload Identity Federation form. The access token and refresh token forms, Firefox and Edge need none.

### Is it made by Google, Mozilla or Microsoft?

No.

## Development

Node.js 24 or later:

```bash
npm ci
node scripts/fetch-stores.ts
npm run typecheck
npm test
```

`scripts/fetch-stores.ts` clones each store action at the commit `action.yml` pins into `stores/`, which the parity test reads. The parity test fails when a store action declares an input or output this action neither maps nor leaves out, and prints the YAML to add. `node scripts/check-pins.ts` checks that each version comment in `action.yml` names the tag of the pinned commit. The mock jobs in `.github/workflows/ci.yml` run the action against each store action's own mock and verifier at the pinned commits.

## License

[MIT](LICENSE)
