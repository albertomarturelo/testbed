# casefile demo monorepo — Acme (fictional)

A **fictional** workspace with two projects, used as the fixture for workspace
tests in `@casefile/core`. Nothing here describes a real product; domains use the
reserved `.example` TLD. For a single-project repo see
[`../demo-repo`](../demo-repo/README.md).

## Layout

```
casefile.yaml                  workspace root: projects `web` and `api` + workspace commons
apps/web/context/tests/        project `web`: _common.yaml, _properties.yaml, login/ (TC-0001, TC-0002), .runs/
services/api/context/tests/    project `api`: _common.yaml, _properties.yaml, orders/ (TC-0001), .runs/
```

## What it is designed to show

| Try | Expected |
|---|---|
| Resolve `web/TC-0001` | Inherits from `casefile.yaml` commons, then `apps/web/context/tests/_common.yaml`; `owner_team` is `storefront` (project overrides workspace) |
| Resolve `api/TC-0001` | A different case with the same id: ids are unique per project |
| `casefile validate` | No findings. The workspace label `owner_team` is declared in each project's `_properties.yaml` |
| `automation.status = automated` | `web/TC-0001`, `api/TC-0001`: each matched by a CI run in its own project's `.runs/` |
| `casefile overview` | Features `login` (web) and `orders` (api); `web/TC-0001` and `api/TC-0001` last ran `passed` (2026-10-14 07:00 and 07:05 UTC), `web/TC-0002` never ran |
