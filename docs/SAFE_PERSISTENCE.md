# Account-safe persistence review

Branch: `fix/account-safe-persistence`, based on `feat/mobile-emerald-design`.
Target for the separate review PR: `feat/mobile-emerald-design`. Do not merge PR #1 or this PR automatically.

## What changed

- Every auth change/reload invalidates the previous session token and clears client detail, edit/subscription forms, credentials and loaded state. Old async reads cannot populate another session. New operations require the current Firebase uid and the token of the form that opened them. Already submitted transactions remain scoped to their original uid; their completion cannot populate the new session.
- A successful server read is required before editing. Failed/offline/cached reads cannot enable writes. Alpine's automatic `init` plus `x-init` register only one auth listener.
- Each mutation uses `runTransaction`, compares the loaded document fingerprint with the transaction snapshot and increments `_fitppRevision`. A concurrent update causes a visible conflict and requires a reload; it is never silently overwritten. Comparison also detects older writers that changed the document without a revision before our transaction.
- The transaction replaces the complete confirmed `attendance`, `attendanceOps`, `clients` and `finances` values. This makes deletion of a nested visit persist instead of being resurrected by recursive merge. Unrelated document fields and unrelated client fields are retained from the snapshot. Nothing is written during loading.
- New visit metadata records the exact subscription ID for a consumed session, or actual single-payment price and location. Reversal uses that metadata rather than whichever subscription/location is currently active.
- The UI changes its authoritative data and shows “Сохранено в Firebase” only after the transaction resolves. Rejected writes leave displayed committed data intact, show an alert and block further writes until reload. Forms do not close on a rejected save. Duplicate submission is blocked.
- Existing design, tariffs (700 / 600 / 500), subscription prices (4400 / 3800), eight sessions, 28-day validity, rent/income/profit calculations and the email/password sign-in flow remain. Mass reset is explicitly disabled. No production data, credentials, rules or Firebase configuration were changed.

## Backward compatibility

No migration runs on load. The original fields `clients`, `attendance` (string statuses) and `finances` remain in the same trainer document. Missing `_fitppRevision` is treated as zero and missing `attendanceOps` as an empty map. Existing subscription objects only acquire an ID when a new operation actually consumes from that subscription. New subscriptions have an ID from creation.

New metadata:

```
_fitppRevision: integer
attendanceOps[date][clientId]: {
  status, location, operationId,
  subscriptionId // attended
  price          // single payment
}
```

Existing visits still render normally. Legacy `attended` and `razov` records lack the information needed to safely reconstruct the original debit or amount. Reversing/changing these records is blocked with a visible explanation; there is no guessed migration or recalculation. A separate, reviewed reconciliation process will be needed for those historical reversals. Legacy non-financial marks can be cancelled normally.

## Automated checks

Run without any external service:

```sh
node --test tests/*.test.cjs
```

29 tests cover session/logout/form isolation, late account loads, failed loads/retry, simultaneous/stale tabs, legacy writes before a transaction, persisted cancellation with other clients present, exact subscription refund after reload, exact price/location refund, status transitions, legacy compatibility, denied commits, pending acknowledgement, stale in-flight operations, existing prices/subscription validity, malformed/duplicate data and sign-in UI behavior.

Browser integration uses fake Firebase and locally installed Alpine/Tailwind. All HTTP requests are fulfilled by Playwright; unknown destinations are aborted. It never accesses a Firebase project:

```sh
npm install --prefix /tmp/fitpp-test-vendors --no-package-lock alpinejs@3.15.12 tailwindcss@3.4.19
# Python Playwright and Chromium must be installed in the test environment.
python3 tests/browser_smoke.py --vendors /tmp/fitpp-test-vendors
```

Mobile Chromium checks: actual disabled buttons, pending vs confirmed save status, visible errors, account-switch clearing of open detail/subscription modal, retry after failed load, add-client workflow and all three sections at 320/390/768/1280px. Screenshots are written to a temporary directory.

## Not yet verified on real Firebase

Per the owner's instruction, no separate test project/account is currently available and no production connection or write was attempted. Before release, use a separate non-production project/account to verify:

1. Existing Firestore rules permit the required transaction read/write and new metadata, and deny access to every other uid. Verify actual SDK transaction retry and permission-denied behavior.
2. New/legacy trainer documents, two real browser tabs, simultaneous edits, auth changes, slow/failed loads, offline/reconnect, server confirmation and reload after every reversal.
3. Prices, historical-data handling, subscription identity and financial totals against known fixtures. Confirm unknown document/client fields and any real Timestamp fields survive.
4. The account receives no working-client data; seed only fictional fixtures. Do not deploy or test rules against production.

## Remaining release risks

- Older deployed clients do not enforce the revision protocol and could overwrite a new save *after* its commit. Close/reload old tabs during rollout. For server-enforced protection, test revision validation in the project's existing rules before any production rule changes. A possible condition to integrate with the actual ownership/field rules is `request.resource.data._fitppRevision == (resource.data.get('_fitppRevision', 0) + 1)` for updates (and revision 1 for creates). This is guidance, not a complete deployable ruleset; no rules are changed here.
- Safe historical reversals require original information that the old format never stored; see compatibility policy above.
- Transactions require online access; there is no offline write queue. A rejected or uncertain commit requires a server reload before retry to avoid blind duplicate sales.
- An already-sent transaction cannot be recalled on logout. Its immutable document reference is always the old uid; its result is discarded from the new session. Real rules must enforce uid ownership.
- Data and added operation metadata still share the existing single-document design and Firestore document-size limit. This PR does not restructure production storage.
- Live Firebase validation and a review of this separate PR remain release prerequisites. Passing mocks is not proof of production readiness.
