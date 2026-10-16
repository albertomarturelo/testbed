# casefile demo monorepo — Acme (fictional)

A **fictional** workspace with two projects, used as the fixture for workspace
tests in `@casefile/core`. Nothing here describes a real product; domains use the
reserved `.example` TLD. For a single-project repo see
[`../demo-repo`](../demo-repo/README.md).

## Layout

```
casefile.yaml                  workspace root: projects `web` and `api` + workspace commons
apps/web/context/tests/        project `web`: _common.yaml, login/ (TC-0001, TC-0002), .runs/
services/api/context/tests/    project `api`: _common.yaml, orders/ (TC-0001), .runs/
```

## What it is designed to show

| Try | Expected |
|---|---|
| Resolve `web/TC-0001` | Inherits from `casefile.yaml` commons, then `apps/web/context/tests/_common.yaml`; `owner_team` is `storefront` (project overrides workspace) |
| Resolve `api/TC-0001` | A different case with the same id: ids are unique per project |
| `automation.status = automated` | `web/TC-0001`, `api/TC-0001`: each matched by a CI run in its own project's `.runs/` |
