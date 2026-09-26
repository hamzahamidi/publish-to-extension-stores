# Security

Report a vulnerability through [GitHub private vulnerability reporting](https://github.com/hamzahamidi/publish-to-extension-stores/security/advisories/new). Do not open a public issue for it.

Expect an acknowledgement within 7 days. A fix ships as a patch release of the latest major version, the major tag moves to it, and the advisory is published once the release is out.

A vulnerability in a store action goes to that action's repository: [Chrome](https://github.com/hamzahamidi/publish-to-chrome-web-store/security/advisories/new), [Firefox](https://github.com/hamzahamidi/publish-to-firefox-add-ons/security/advisories/new) or [Edge](https://github.com/hamzahamidi/publish-to-edge-add-ons/security/advisories/new). When a store action or `google-github-actions/auth` releases a security fix, this action releases the new pin the same day.

The action sends no request itself and stores nothing. It passes credentials only to the inputs of the store actions it runs and of `google-github-actions/auth`, which masks the token it mints. That token goes to the Chrome action's input and never to an output. The action's two scripts receive presence flags, step outcomes and store outputs, never a credential value. Every action it runs is pinned to a full commit SHA, and the README lists those versions and links each store action's list of requests.
