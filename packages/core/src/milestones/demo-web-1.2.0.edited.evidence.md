# Milestone evidence: Web 1.2.0

| | |
|---|---|
| Milestone | web-1.2.0 (project web) |
| Release | web-1.2.0 |
| Due | — |
| Scope | state = active |
| Build | web-1.2.0+101 |
| Opened | 2026-10-10T09:00:00Z by qa@acme.example |
| Edited | 2026-10-12T14:30:00Z by qa@acme.example: due, scope |
| Edited | 2026-10-15T08:05:00Z by lead@acme.example: title |
| Closed | 2026-10-20T16:00:00Z by lead@acme.example |

## Totals

| In scope | Executed | Passed | Failed | Blocked | Not run |
|---:|---:|---:|---:|---:|---:|
| 5 | 5 | 3 | 2 | 0 | 0 |

## Gates

| Gate | Verdict | Cases | Reasons |
|---|---|---:|---|
| smoke | red | 2 | failures: failures are not allowed (TC-0007) |
| payments-regression | green | 2 | — |
| auth | green | 2 | — |

## Cases

| Case | Title | Priority | Result | Attempts | Executor | Date | Build | Note | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| TC-0001 | Sign in with valid credentials | P0 | passed | 1 | ci:github-actions | 2026-10-14T07:00:00Z | web-1.2.0+101 | — | — |
| TC-0002 | Lock the account after five failed sign-in attempts | P2 | failed | 1 (1 failed) | human:qa@acme.example | 2026-10-14T10:20:00Z | web-1.2.0+101 | triage known_issue ACME-310 until 2026-11-01 | — |
| TC-0007 | Search the catalog by keyword | P1 | failed | 1 (1 failed) | ci:github-actions | 2026-10-14T07:02:00Z | web-1.2.0+101 | — | ci/artifacts/search.log |
| TC-0003 | Pay with a saved card | P1 | passed | 1 | human:qa@acme.example | 2026-10-14T10:00:00Z | web-1.2.0+101 | — | — |
| TC-0004 | Refund a captured payment | P1 | passed | 1 | ci:github-actions | 2026-10-14T07:01:00Z | web-1.2.0+101 | — | — |

## Requirements

| Requirement | Cases | Verdict |
|---|---|---|
| ACME-101#AC-1 | TC-0001 | passed |
| ACME-101#AC-3 | TC-0002 | failed |
| ACME-202#AC-1 | TC-0003 | passed |
| ACME-202#AC-4 | TC-0004 | passed |

Cases that name no requirement: TC-0007.

## Not executed

Every case in scope was executed.

## Close note

Search (TC-0007) fails on staging data only; ACME-412 tracks it.
