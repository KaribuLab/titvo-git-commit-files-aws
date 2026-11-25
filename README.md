# Git scan ingestion

Commit and full scans transport the root `.titvoignore.yml` independently of
changed-file selection. An unchanged policy is checked with `downloadFile` at
the scan revision and added once to the existing ETL batch. A missing policy
(`ENOENT`) preserves legacy ingestion; other policy read errors fail the scan.
Policy bytes are not parsed or applied by this service.

Source selection, storage prefixes, revision selection, cleanup and result
events retain their existing contracts.

## How does it work?

Retrieves files for `commit` and `full` scans using Git over SSH.

## URLs and credentials

HTTPS and SCP-style SSH URLs from GitHub and Bitbucket are supported. The following Bitbucket URLs resolve to the same remote `git@ssh.bitbucket.org:workspace/repo.git`:

- `https://bitbucket.org/workspace/repo.git`
- `git@bitbucket.org:workspace/repo.git`
- `git@ssh.bitbucket.org:workspace/repo.git`

The credential remains `bitbucket_ssh_private_key` and is selected internally.
GitHub continues to use `github.com` and `github_ssh_private_key`.
HTTPS URLs and consumer payloads do not require any changes.
Hosts are validated using exact matching rather than suffix matching.

The examples in `harness/ssh-clone.harness.{ts,js}` use the new SSH endpoint.
The current client uses `StrictHostKeyChecking=no`; this migration only changes
the destination, not the host trust policy.

Reference: [Official Atlassian SSH formats](https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/).

## Local verification

```bash
npm ci
npm test -- --runInBand
npx eslint 'src/**/*.{ts,js}'
```