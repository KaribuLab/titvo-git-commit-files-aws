import { Logger, Optional } from '@nestjs/common'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  CloneableRepoClient,
  FileInfo,
  PrepareOptions,
} from '../repo.client'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { ParamsKeys } from '@lambda/config/config.key'

export interface SshRepositoryConfig {
  cloneUrl: string
  displayName: string
  privateKeyParameter:
    | ParamsKeys.GITHUB_SSH_PRIVATE_KEY
    | ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY
}

/** Profundidad por defecto del clone shallow (solo el commit objetivo). */
export const DEFAULT_CLONE_DEPTH = 1

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i

interface GitRunner {
  clone(cloneUrl: string, targetDir: string, ref: string, depth: number): void
  fetchCommit(cloneDir: string, cloneUrl: string, sha: string, depth: number): void
  checkout(cloneDir: string, sha: string): void
  revParseHead(cloneDir: string): string
  /** true si `<sha>^` existe en el clon (false en commit raíz). */
  hasParent(cloneDir: string, sha: string): boolean
  /** Archivos A/C/M/R entre el primer padre y `<sha>`. */
  diffTreeFiles(cloneDir: string, sha: string): string[]
  /** Árbol completo rastreado en `<sha>`. */
  lsTreeFiles(cloneDir: string, sha: string): string[]
  lsFiles(cloneDir: string): string[]
  readFile(cloneDir: string, filePath: string): Buffer
  resolveRemoteRef(cloneUrl: string, ref: string): string
}

export class SshGitRepoClient implements CloneableRepoClient {
  private readonly logger = new Logger(SshGitRepoClient.name)

  private cloneUrl = ''
  private displayName = ''
  private privateKeyParameter: SshRepositoryConfig['privateKeyParameter'] | null = null
  private resolvedSha: string | null = null

  private localDir: string | null = null
  private sshKeyPath: string | null = null

  private readonly gitRunner: GitRunner

  constructor(
    private readonly parameterService: ParameterService,
    @Optional() gitRunner?: GitRunner,
  ) {
    this.gitRunner = gitRunner ?? this.createDefaultGitRunner()
  }

  /**
   * Construye el runner por defecto que ejecuta comandos git reales con
   * autenticación SSH (GIT_SSH_COMMAND) usando la llave privada del secreto.
   */
  private createDefaultGitRunner(): GitRunner {
    // Env mínimo y explícito: NO heredamos process.env completo porque un
    // atacante podría setear GIT_CONFIG / GIT_SSH_COMMAND / GIT_EXEC_PATH y
    // alterar cómo se ejecuta el clone (env hijacking -> RCE). Solo pasamos
    // PATH/HOME (necesarios para resolver git/ssh) y nuestro GIT_SSH_COMMAND.
    const buildEnv = (extra?: Record<string, string>) => {
      const minimal: Record<string, string> = {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
      }
      if (this.sshKeyPath) {
        minimal.GIT_SSH_COMMAND = [
          'ssh',
          '-i', this.sshKeyPath,
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'IdentitiesOnly=yes',
        ].join(' ')
      }
      return { ...minimal, ...extra }
    }

    const run = (args: string[], opts: ExecFileSyncOptions = {}) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        ...opts,
      }) as string

    // Salida separada por NUL (-z) para soportar rutas con espacios o saltos
    // de línea.
    const splitNul = (out: string) => out.split('\0').filter(Boolean)

    return {
      clone: (cloneUrl, targetDir, ref, depth) => {
        // Rama/tag: clonar directo esa ref con --single-branch (funciona en
        // clones shallow y crea la branch local). SHA: clonar HEAD y dejar el
        // fetch del SHA para prepare() (fetchCommit + checkout).
        // El '--' aísla cloneUrl para que un repo con nombre tipo '--algo'
        // no se interprete como flag de git (argument injection).
        if (ref && !FULL_SHA_PATTERN.test(ref)) {
          execFileSync(
            'git',
            [
              'clone',
              '--depth',
              String(depth),
              '--branch',
              ref,
              '--single-branch',
              '--',
              cloneUrl,
              targetDir,
            ],
            { env: buildEnv() },
          )
        } else {
          execFileSync(
            'git',
            ['clone', '--depth', String(depth), '--', cloneUrl, targetDir],
            { env: buildEnv() },
          )
        }
      },
      fetchCommit: (cloneDir, cloneUrl, sha, depth) => {
        run(['fetch', '--depth', String(depth), '--', cloneUrl, sha], {
          cwd: cloneDir,
          env: buildEnv(),
        })
      },
      checkout: (cloneDir, sha) => {
        run(['checkout', sha], { cwd: cloneDir, env: buildEnv() })
      },
      revParseHead: (cloneDir) =>
        run(['rev-parse', 'HEAD'], {
          cwd: cloneDir,
          encoding: 'utf8',
        }).trim(),
      // Los SHA llegan validados (40 hex) desde el cliente, así que no pueden
      // interpretarse como flags de git.
      hasParent: (cloneDir, sha) => {
        try {
          run(['rev-parse', '--verify', '--quiet', `${sha}^`], {
            cwd: cloneDir,
            stdio: ['ignore', 'pipe', 'ignore'],
          })
          return true
        } catch {
          return false
        }
      },
      diffTreeFiles: (cloneDir, sha) =>
        splitNul(
          run(
            [
              'diff-tree',
              '-r',
              '-z',
              '--name-only',
              '--diff-filter=ACMR',
              `${sha}^`,
              sha,
            ],
            { cwd: cloneDir, encoding: 'utf8' },
          ),
        ),
      lsTreeFiles: (cloneDir, sha) =>
        splitNul(
          run(['ls-tree', '-r', '-z', '--name-only', sha], {
            cwd: cloneDir,
            encoding: 'utf8',
          }),
        ),
      lsFiles: (cloneDir) =>
        run(['ls-files'], { cwd: cloneDir, encoding: 'utf8' })
          .split('\n')
          .filter(Boolean),
      readFile: (cloneDir, filePath) =>
        fs.readFileSync(path.join(cloneDir, filePath)),
      resolveRemoteRef: (cloneUrl, ref) => {
        const out = execFileSync(
          'git',
          ['ls-remote', '--heads', '--tags', '--', cloneUrl, ref],
          { encoding: 'utf8', env: buildEnv() },
        )
        const line = out.split('\n').find((l) => l.trim().length > 0)
        if (!line) {
          throw new Error(`Could not resolve ref ${ref} for ${cloneUrl}`)
        }
        return line.split(/\s+/)[0]
      },
    }
  }

  initialize(config: SshRepositoryConfig): void {
    this.cloneUrl = config.cloneUrl
    this.displayName = config.displayName
    this.privateKeyParameter = config.privateKeyParameter
    this.logger.log(`SSH client initialized for ${this.displayName}`)
  }

  async prepare(ref: string, options: PrepareOptions = {}): Promise<void> {
    if (!this.privateKeyParameter || !this.cloneUrl) {
      throw new Error('SSH repository client must be initialized before prepare()')
    }
    const depth = options.depth ?? DEFAULT_CLONE_DEPTH

    const key = await this.parameterService.getDecryptedParameterValue(
      this.privateKeyParameter,
    )
    if (!key) {
      throw new Error(
        `SSH private key not found in Parameter Store (${this.privateKeyParameter}).`,
      )
    }

    this.sshKeyPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-key-')),
      'id_ed25519',
    )
    fs.writeFileSync(this.sshKeyPath, key, { mode: 0o600 })

    this.localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clone-'))

    this.logger.log(
      `Cloning ${this.cloneUrl} @ ${ref} (depth ${depth}) into ${this.localDir}`,
    )
    this.gitRunner.clone(this.cloneUrl, this.localDir, ref, depth)

    if (ref && FULL_SHA_PATTERN.test(ref)) {
      this.gitRunner.fetchCommit(this.localDir, this.cloneUrl, ref, depth)
      this.gitRunner.checkout(this.localDir, ref)
    }

    this.resolvedSha = this.gitRunner.revParseHead(this.localDir)
    this.logger.log(`Clone ready. HEAD resolved to ${this.resolvedSha}`)
  }

  async cleanup(): Promise<void> {
    try {
      if (this.localDir && fs.existsSync(this.localDir)) {
        fs.rmSync(this.localDir, { recursive: true, force: true })
      }
      if (this.sshKeyPath) {
        const dir = path.dirname(this.sshKeyPath)
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }
    } catch (err) {
      this.logger.warn(
        `cleanup failed: ${(err as Error).message}`,
      )
    } finally {
      this.localDir = null
      this.sshKeyPath = null
      this.resolvedSha = null
    }
  }

  /**
   * Archivos añadidos/copiados/modificados/renombrados por el commit respecto
   * a su primer padre. Nunca lista el árbol completo salvo en un commit raíz.
   * Requiere que prepare() haya clonado con profundidad >= 2 para que el
   * padre exista en el clon shallow.
   */
  async getCommitFiles(commitId: string): Promise<FileInfo[]> {
    if (!this.localDir) {
      throw new Error('prepare() must be called before getCommitFiles()')
    }
    const sha = this.resolvedSha ?? commitId
    if (!FULL_SHA_PATTERN.test(sha)) {
      throw new Error(
        `getCommitFiles() requires a resolved 40-hex commit SHA, got: ${sha}`,
      )
    }

    if (!this.gitRunner.hasParent(this.localDir, sha)) {
      const tree = this.gitRunner.lsTreeFiles(this.localDir, sha)
      this.logger.log(
        `commit ${sha} has no parent in clone; selecting full tree (${tree.length} files)`,
      )
      return tree.map((p) => ({ path: p, filename: p }))
    }

    const changed = this.gitRunner.diffTreeFiles(this.localDir, sha)
    this.logger.log(`commit ${sha} touches ${changed.length} files`)
    return changed.map((p) => ({ path: p, filename: p }))
  }

  async resolveRef(ref: string): Promise<string> {
    if (/^[0-9a-f]{40}$/i.test(ref)) {
      return ref
    }
    if (this.resolvedSha) {
      return this.resolvedSha
    }
    return this.gitRunner.resolveRemoteRef(this.cloneUrl, ref)
  }

  async getAllFiles(_ref: string): Promise<FileInfo[]> {
    if (!this.localDir) {
      throw new Error('prepare() must be called before getAllFiles()')
    }
    const files = this.gitRunner.lsFiles(this.localDir)
    return files.map((p) => ({ path: p, filename: p }))
  }

  async downloadFile(filePath: string, _ref: string): Promise<Buffer> {
    if (!this.localDir) {
      throw new Error('prepare() must be called before downloadFile()')
    }
    return this.gitRunner.readFile(this.localDir, filePath)
  }
}
