import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  CloneableRepoClient,
  FileInfo,
  RepoClient,
} from '../repo.client'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { ParamsKeys } from '@lambda/config/config.key'

const BITBUCKET_SSH_PRIVATE_KEY_PARAM_NAME =
  ParamsKeys.BITBUCKET_SSH_PRIVATE_KEY

interface GitRunner {
  clone(cloneUrl: string, targetDir: string, ref: string): void
  fetchCommit(cloneDir: string, cloneUrl: string, sha: string): void
  checkout(cloneDir: string, sha: string): void
  revParseHead(cloneDir: string): string
  lsFiles(cloneDir: string): string[]
  readFile(cloneDir: string, filePath: string): Buffer
  resolveRemoteRef(cloneUrl: string, ref: string): string
}

@Injectable()
export class SshGitRepoClient implements CloneableRepoClient {
  private readonly logger = new Logger(SshGitRepoClient.name)

  private cloneUrl = ''
  private workspace = ''
  private repoSlug = ''
  private resolvedSha: string | null = null

  private localDir: string | null = null
  private sshKeyPath: string | null = null

  private readonly gitRunner: GitRunner

  constructor(
    private readonly parameterService: ParameterService,
    gitRunner?: GitRunner,
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

    return {
      clone: (cloneUrl, targetDir, ref) => {
        // Rama/tag: clonar directo esa ref con --single-branch (funciona en
        // clones shallow y crea la branch local). SHA: clonar HEAD y dejar el
        // fetch del SHA para prepare() (fetchCommit + checkout).
        // El '--' aísla cloneUrl para que un repo con nombre tipo '--algo'
        // no se interprete como flag de git (argument injection).
        if (ref && !/^[0-9a-f]{40}$/i.test(ref)) {
          execFileSync(
            'git',
            [
              'clone',
              '--depth',
              '1',
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
            ['clone', '--depth', '1', '--', cloneUrl, targetDir],
            { env: buildEnv() },
          )
        }
      },
      fetchCommit: (cloneDir, cloneUrl, sha) => {
        run(['fetch', '--depth', '1', '--', cloneUrl, sha], {
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

  initFromRepoUrl(repoUrl: string): void {
    const cleaned = repoUrl
      .replace(/(^git\+|\.git$)/g, '')
      .replace(/^git@/, 'git@')
    // git@bitbucket.org:workspace/repo  o  https://bitbucket.org/workspace/repo
    const withoutScheme = cleaned
      .replace(/^git@/, '')
      .replace(/^https?:\/\//, '')
    const hostStripped = withoutScheme.replace(/^bitbucket\.org[/:]/, '')
    const parts = hostStripped.split(/[/:]/)
    this.workspace = parts[0]
    this.repoSlug = parts[1] ?? ''
    this.cloneUrl = repoUrl.startsWith('git@')
      ? repoUrl
      : `git@bitbucket.org:${this.workspace}/${this.repoSlug}.git`
    this.logger.log(
      `SSH client initialized for ${this.workspace}/${this.repoSlug}`,
    )
  }

  async prepare(ref: string): Promise<void> {
    const key = await this.parameterService.getDecryptedParameterValue(
      BITBUCKET_SSH_PRIVATE_KEY_PARAM_NAME,
    )
    if (!key) {
      throw new Error(
        `Bitbucket SSH private key not found in Parameter Store (${BITBUCKET_SSH_PRIVATE_KEY_PARAM_NAME}).`,
      )
    }

    this.sshKeyPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-key-')),
      'id_ed25519',
    )
    fs.writeFileSync(this.sshKeyPath, key, { mode: 0o600 })

    this.localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clone-'))

    this.logger.log(`Cloning ${this.cloneUrl} @ ${ref} into ${this.localDir}`)
    this.gitRunner.clone(this.cloneUrl, this.localDir, ref)

    if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
      this.gitRunner.fetchCommit(this.localDir, this.cloneUrl, ref)
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

  async getCommitFiles(_commitId: string): Promise<FileInfo[]> {
    return this.getAllFiles(this.resolvedSha ?? _commitId)
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
