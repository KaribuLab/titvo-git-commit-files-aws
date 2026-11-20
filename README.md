# git-commit-files

Obtiene archivos para scans `commit` y `full` mediante Git sobre SSH.

## URLs y credenciales

Se aceptan URLs HTTPS y SCP SSH de GitHub y Bitbucket. Estas entradas Bitbucket
usan el mismo remoto `git@ssh.bitbucket.org:workspace/repo.git`:

- `https://bitbucket.org/workspace/repo.git`
- `git@bitbucket.org:workspace/repo.git`
- `git@ssh.bitbucket.org:workspace/repo.git`

La credencial sigue siendo `bitbucket_ssh_private_key`, seleccionada internamente.
GitHub mantiene `github.com` y `github_ssh_private_key`. Las URLs HTTPS y los
payloads de los consumidores no necesitan cambiar. Los hosts se validan por
coincidencia exacta, no por sufijo.

Los ejemplos de `harness/ssh-clone.harness.{ts,js}` usan el endpoint SSH nuevo.
El cliente actual usa `StrictHostKeyChecking=no`; esta migración solo cambia
el destino, no esa política de confianza.

Referencia: [formatos SSH oficiales de Atlassian](https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/).

## Verificación local

```bash
npm ci
npm test -- --runInBand
npx eslint 'src/**/*.{ts,js}'
```
