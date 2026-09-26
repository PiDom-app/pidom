# Signing the Windows build

The desktop release (`.github/workflows/ci.yml` → `desktop-release`) currently
ships an **unsigned** Windows installer. Unsigned `.exe`s trigger the SmartScreen
"Windows protected your PC — unknown publisher" prompt; users install via **More
info → Run anyway**, and the release notes say so. The SHA-256 checksum attached
to every release lets anyone verify the download is byte-for-byte the CI artifact.

There is **no free trusted CA** for ad-hoc Authenticode certificates. The only
free path for open-source projects is the **SignPath Foundation**, which grants a
managed code-signing certificate and signs artifacts through a GitHub Action. The
release job already contains the signing step, gated **off** by default.

## Enabling SignPath Foundation signing

1. **Make the repository public.** The Foundation only signs OSS projects.
2. **Apply to the SignPath Foundation** at <https://signpath.org/apply> and wait
   for approval. They create your organization and a code-signing certificate.
3. **Install the SignPath GitHub App** on the repository (granted during/after
   approval) so the signing service can read the workflow's build artifacts.
4. In the SignPath web console, create:
   - a **project** for this repo (note its _project slug_),
   - a **signing policy** (e.g. `release-signing`; note its _slug_),
   - an **artifact configuration** named `exe` that signs the `.exe` inside the
     uploaded artifact (the step passes `artifact-configuration-slug: exe`).
5. **Pin the action to a full commit SHA.** In `desktop-release`, the step
   `Sign installer (SignPath)` references
   `SignPath/github-action-submit-signing-request@v1`. Before enabling, replace
   `@v1` with the full commit SHA of the release you vet — every other action in
   this workflow is SHA-pinned, and a signing action must not float.
6. **Upload the built installer as a workflow artifact** before the signing step
   (SignPath signs a GitHub Actions artifact by id). Add an
   `actions/upload-artifact` step (SHA-pinned) after `Build Windows installer`
   and point `github-artifact-id` at it, then download the signed result back
   over the staged `release/` copy. See the action's README for the exact
   input wiring for your SignPath project.
7. **Add the config** to the `production` environment:
   - Variables: `SIGNPATH_ENABLED=true`, `SIGNPATH_ORGANIZATION_ID`,
     `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`.
   - Secret: `SIGNPATH_API_TOKEN`.

   ```bash
   gh variable set SIGNPATH_ENABLED --env production --body "true"
   gh variable set SIGNPATH_ORGANIZATION_ID --env production --body "<org-id>"
   gh variable set SIGNPATH_PROJECT_SLUG --env production --body "<project-slug>"
   gh variable set SIGNPATH_POLICY_SLUG --env production --body "<policy-slug>"
   gh secret set SIGNPATH_API_TOKEN --env production
   ```

Once `SIGNPATH_ENABLED` is `true`, the guarded step runs, the installer is signed,
and the SmartScreen "unknown publisher" warning goes away. Until then, builds ship
unsigned and the checksum is the integrity guarantee.

## Versioning

`desktop/package.json` `version` is the human-facing installer version. Per-merge
releases share that version but get a unique tag
`v<version>-desktop.<run_number>`. Cutting a "real" version is a manual bump of
the `version` field in `desktop/package.json` (commit it; the next merge to `main`
releases under the new number).
