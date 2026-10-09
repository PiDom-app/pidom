# Signing desktop builds

The desktop release (`.github/workflows/desktop-release.yml`) uses
electron-builder. It ships an **unsigned** Windows installer by default. Unsigned `.exe`s trigger the
SmartScreen "Windows protected your PC — unknown publisher" prompt; users install
via **More info → Run anyway**, and the release notes say so. The SHA-256 checksum
attached to every release lets anyone verify the download is byte-for-byte the CI
artifact — that is the day-one integrity guarantee, signed or not.

The preferred Windows path is the existing **SignPath Foundation** integration.
electron-builder's native signing environment variables are intentionally not
committed or exposed in app settings. The workflow currently publishes the
unsigned artifact so the desktop release cadence is not blocked, and the
release notes identify that state. Once the approved SignPath integration is
configured, it should replace the unsigned installer before enabling public
rollouts.

- **Path A — SignPath Foundation** (`if: vars.SIGNPATH_ENABLED == 'true'`):
  free managed Authenticode signing for open-source projects.
- A conventional PFX fallback may be added later through a dedicated CI signer;
  do not add certificate material, passwords, or signing variables to the
  repository or runtime.

## The 2026 reality — signing is not a "no warning" switch

Read this before spending time or money, because Microsoft changed the rules and
a lot of older advice is now wrong:

- **SmartScreen reputation is earned, not bought.** Warnings are keyed to the
  file hash *and* the publisher certificate. A correctly signed, brand-new binary
  can still warn until its certificate/publisher accrues download reputation.
- **EV certificates no longer grant instant reputation.** After the spring-2026
  Windows policy change, EV code-signing is treated like ordinary OV — the old
  "EV bypasses SmartScreen immediately" behaviour is gone. Paying hundreds for EV
  buys you very little over OV now.
- **Self-signed certificates do nothing for public trust.** They satisfy
  structural-integrity checks only. Windows still shows "unknown publisher"
  unless the certificate is installed into **Trusted Root Certification
  Authorities** on the target machine. Asking the public to install your root is
  a security anti-pattern — it is *worse* than shipping unsigned, and you should
  never do it. Self-signing is for **local testing** and **enterprise fleets you
  control via GPO/MDM**, nothing else.

So the honest value of signing here is: it establishes a stable publisher
identity, guarantees integrity, and lets reputation build over time. The checksum
covers integrity from day one either way.

## Options, ranked for a free / low-cost OSS project

| Option | Cost | Trusted by Windows | Notes |
| --- | --- | --- | --- |
| **SignPath Foundation** | Free | Yes (Authenticode) | OSS only; no personal ID; SignPath vouches the binary was built from your repo. Windows only. **Recommended.** |
| **Certum Open Source Code Signing** | ~€69 + delivery | Yes | Real CA cert for OSS/individual devs; builds SmartScreen reputation. Cloud (simplySign) or card. Validity now ≤ ~459 days (Feb 2026 rule). |
| **Azure Artifact Signing** (was Trusted Signing) | ~$9.99/mo | Yes | Managed. Individual sign-up in public preview; org validation needs a US/Canada entity with 3+ years history. |
| **Microsoft Store (MSIX)** | Free | Yes | Microsoft re-signs on certification — but it changes your distribution channel to the Store. |
| **Self-signed** | Free | **No** (public) | Testing / GPO-managed fleets only. Never ask the public to trust your root. |

Recommendation: **stay on the checksum + SignPath Foundation path.** If SignPath
is declined or you need a personal cert, **Certum Open Source** is the cheapest
publicly-trusted option, wired through Path B below.

## SignPath Foundation (free, recommended)

The Windows signing integration is not yet wired. To enable it:

1. **Make the repository public.** The Foundation only signs OSS projects.
2. **Apply to the SignPath Foundation** at <https://signpath.org/apply> and wait
   for approval. They create your organization and a code-signing certificate.
3. **Install the SignPath GitHub App** on the repository (granted during/after
   approval) so the signing service can read the workflow's build artifacts.
4. In the SignPath web console, create a **project** for this repo (note its
   _project slug_), a **signing policy** (e.g. `release-signing`; note its
   _slug_), and an **artifact configuration** named `exe` that signs the `.exe`
   inside the uploaded artifact (the step passes `artifact-configuration-slug: exe`).
5. **Pin the action to a full commit SHA.** The step references
   `SignPath/github-action-submit-signing-request@v1`. Before enabling, replace
   `@v1` with the full commit SHA of the release you vet — every other action in
   this workflow is SHA-pinned, and a signing action must not float.
6. **Upload the built installer as a workflow artifact** before the signing step
   (SignPath signs a GitHub Actions artifact by id). Add an SHA-pinned
   `actions/upload-artifact` step after `Build Windows installer`, point
   `github-artifact-id` at it, then download the signed result back over the
   staged `release/` copy so the checksum step covers the signed bytes.
7. **Add the config** to the `production` environment:

   ```bash
   gh variable set SIGNPATH_ENABLED --env production --body "true"
   gh variable set SIGNPATH_ORGANIZATION_ID --env production --body "<org-id>"
   gh variable set SIGNPATH_PROJECT_SLUG --env production --body "<project-slug>"
   gh variable set SIGNPATH_POLICY_SLUG --env production --body "<policy-slug>"
   gh secret set SIGNPATH_API_TOKEN --env production
   ```

## macOS notarization

macOS DMG/ZIP artifacts are built in CI for validation, but stable macOS
publication and automatic updates remain gated until a Developer ID signing and
notarization credential strategy is deliberately configured. No Apple ID,
App-Specific Password, Team ID, or API key is stored in this repository.

### Local signing with signtool (any PFX)

`signtool.exe` ships with the **Windows SDK** (install via the Windows SDK
installer or "Desktop development with C++" in the Visual Studio Installer). Once
you have a `.pfx`:

```powershell
# From a Developer PowerShell (signtool on PATH), against the built installer:
signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.sectigo.com `
  /f cert.pfx /p "<pfx-password>" `
  "out\make\squirrel.windows\x64\Pidom Desktop-<version> Setup.exe"

signtool verify /pa /v "out\make\squirrel.windows\x64\Pidom Desktop-<version> Setup.exe"
```

`/tr` (RFC-3161 timestamp) is required so signatures stay valid after the
certificate expires; `/fd SHA256 /td SHA256` sets the file and timestamp digests.

### Generate a self-signed PFX (testing / internal fleets ONLY)

This produces a certificate that Windows will **not** trust for the public — use
it only to exercise the signing pipeline or on machines where you push the cert
to Trusted Root via GPO/MDM.

```powershell
# 1. Create a self-signed code-signing cert in the current user's store.
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Pidom (Self-Signed, Internal)" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature `
  -HashAlgorithm SHA256

# 2. Export it (with private key) to a password-protected PFX.
$pwd = ConvertTo-SecureString -String "<choose-a-password>" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath cert.pfx -Password $pwd
```

Then base64-encode `cert.pfx` and wire it through Path B exactly as above. On a
managed fleet you would also export the public cert (`Export-Certificate`) and
deploy it to **Trusted Root Certification Authorities** via Group Policy — never
by asking end users to do it.

### Applying for a Certum Open Source certificate

1. Go to the Certum store's **Open Source Code Signing** product and start an
   order (<https://shop.certum.eu/open-source-code-signing.html>).
2. Provide the required evidence: your public OSS repository URL and the identity
   documents Certum requests for an individual/open-source developer.
3. Pay (~€69 at time of writing, plus card/delivery if you choose the hardware
   option) and complete Certum's identity verification.
4. Enroll the certificate. With **simplySign / proximaSign** (cloud) you sign
   without shipping a token; for CI you can export the issued certificate to a
   `.pfx` and wire it through Path B. With a hardware card, sign locally or via a
   self-hosted runner that has the card reader attached.
5. Because the cert is issued by a CA Windows trusts, signed builds establish a
   real publisher identity and begin accruing SmartScreen reputation.

## Versioning

`desktop/package.json` `version` is the human-facing installer version and must
match the release tag `v<version>`. Cutting a release is a manual bump of
the `version` field in `desktop/package.json` (commit it; the next merge to `main`
releases under the new number).

## Do not

- Do **not** ship a self-signed public build and tell users to install your root
  CA — it is a security anti-pattern and worse than the checksum-only default.
- Do **not** commit the `.pfx`, its password, or the base64 blob.
- Do **not** enable both signing paths at once.
