# GitHub Workflow Updates

This directory contains updated workflow files that require `workflows` permission to push.

## Required Changes

### test-lint.yml

Added Playwright browser installation step after dependency installation:

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium
```

This step is required for browser environment testing added in this PR. It installs Chromium browser and system dependencies needed to run `npm run test:browser` and `npm run test:all` in CI.

## How to Apply

1. Review the changes in `.github_temp/workflows/test-lint.yml`
2. Manually apply the changes to `.github/workflows/test-lint.yml` in the main branch
3. Or: Grant the GitHub App `workflows` permission and re-run the push

## Reference

- Playwright CI Documentation: https://playwright.dev/docs/ci-intro
