# casefile demo repo — Acme Shop (fictional)

Acme Shop is a **fictional** web store. Nothing here describes a real product,
company, release or test result; domains use the reserved `.example` TLD. The repo
exists to show casefile's file layout and to serve as the fixture for
`@casefile/core` tests. It is a single-project workspace; see
[`../demo-monorepo`](../demo-monorepo/README.md) for several projects.

## Layout

```
casefile.yaml                  workspace root: one project, `web`, at `.`
context/                       CFD context of the (fictional) product
  tests/
    _properties.yaml           custom properties: risk, owner_team, smoke
    _common.yaml               root commons
    auth/                      _common.yaml + login/ (TC-0001, TC-0002)
    checkout/                  _common.yaml + cart/ (TC-0006)
      payments/                _common.yaml + TC-0003, TC-0004, TC-0005
    catalog/                   _common.yaml + search/ (TC-0007, TC-0008)
    .runs/                     one CI run and one manual run on web-1.2.0+101
    .inbox/                    one pending intent
  releases/policy.yaml         three gates
```

## What it is designed to show

| Try | Expected |
|---|---|
| Resolve `TC-0003` | Inherits from root, `checkout/` and `checkout/payments/` commons |
| `labels.risk = payments AND automation.status != automated` | `TC-0003`, `TC-0005` (`TC-0004` is automated: a CI run matches its `automation.ref`) |
| Gates for `release:web-1.2.0` | `smoke` red (TC-0007 failed in CI, untriaged) · `payments-regression` green · `auth` green (TC-0002 failure is triaged) |
