/**
 * Integración local del SshGitRepoClient contra un repo real de Bitbucket.
 *
 * NO es un unit test: clona de verdad vía SSH usando la llave en
 * process.env.TITVO_TEST_SSH_KEY (o ~/.ssh/titvo_bitbucket por defecto).
 * Valida el flujo completo de producción sin AWS:
 *   initFromRepoUrl -> prepare(ref) -> getAllFiles -> downloadFile -> cleanup
 *
 * Salta si no hay llave disponible (para no romper CI).
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SshGitRepoClient } from './ssh-git-repo-client.service'
import { ParameterService } from '@lambda/parameter/parameter.service'

const KEY_PATH =
  process.env.TITVO_TEST_SSH_KEY ||
  path.join(os.homedir(), '.ssh', 'titvo_bitbucket')

const REPO_URL = 'git@bitbucket.org:karibu-cl/sucursal-virtual-ui.git'
const BRANCH = 'feature/titvo-integration'
const COMMIT_SHA = 'b479a381723090babbaea2d47f2721009e86d474'

const hasKey = fs.existsSync(KEY_PATH)

const maybe = hasKey ? describe : describe.skip

maybe('SshGitRepoClient integración local (clone SSH real)', () => {
  const keyContents = hasKey ? fs.readFileSync(KEY_PATH, 'utf8') : ''

  // Mock mínimo de ParameterService: devuelve la llave local como si viniera
  // de DynamoDB/Parameter Store. Esto es lo único que abstrae el test de AWS.
  const fakeParameterService = {
    getDecryptedParameterValue: jest
      .fn()
      .mockResolvedValue(keyContents),
  } as unknown as ParameterService

  let client: SshGitRepoClient

  beforeAll(() => {
    client = new SshGitRepoClient(fakeParameterService)
    client.initFromRepoUrl(REPO_URL)
  })

  afterAll(async () => {
    await client.cleanup()
  })

  it(
    'prepara por rama, lista archivos y lee uno sin 429',
    async () => {
      await client.prepare(BRANCH)

      const files = await client.getAllFiles(BRANCH)
      expect(files.length).toBeGreaterThan(0)
      console.log(`[INTEG] archivos listados: ${files.length}`)

      const sample = files[0].path
      const content = await client.downloadFile(sample, BRANCH)
      expect(Buffer.isBuffer(content)).toBe(true)
      expect(content.length).toBeGreaterThan(0)
      console.log(`[INTEG] leído ${sample} (${content.length} bytes)`)
    },
    180_000,
  )

  it(
    'prepara por commit SHA exacto (full scan por hash)',
    async () => {
      await client.prepare(COMMIT_SHA)

      const files = await client.getAllFiles(COMMIT_SHA)
      expect(files.length).toBeGreaterThan(0)
      console.log(
        `[INTEG] full scan por SHA ${COMMIT_SHA.slice(0, 8)}: ${files.length} archivos`,
      )
    },
    180_000,
  )
})
