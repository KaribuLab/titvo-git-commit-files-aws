import { Injectable, Logger } from '@nestjs/common'
import { RepoClient, FileInfo } from '../repo.client'
import { Octokit } from '@octokit/rest'
import { ParameterService } from '@lambda/parameter/parameter.service' // ⬅️ NUEVA INYECCIÓN
import { ParamsKeys } from '@lambda/config/config.key'

// Nombre del parámetro en SSM
const GITHUB_TOKEN_PARAM_NAME = ParamsKeys.GITHUB_TOKEN_PARAM_NAME

@Injectable()
export class GitHubClientService implements RepoClient {
  private octokit: Octokit | null = null
  private readonly logger = new Logger(GitHubClientService.name)
  private owner: string = ''
  private repo: string = ''

  // Inyectamos ParameterService en lugar de ConfigService para el token.
  constructor(private readonly parameterService: ParameterService) {}

  /**
   * Inicializa la instancia de Octokit de forma asíncrona usando el token
   * obtenido de forma segura desde Parameter Service.
   * Utiliza un singleton implícito para la instancia de octokit.
   */
  private async getOctokitClient(): Promise<Octokit> {
    if (this.octokit) {
      return this.octokit
    }

    const token = await this.parameterService.getDecryptedParameterValue(
      GITHUB_TOKEN_PARAM_NAME
    )

    if (!token) {
      this.logger.error(
        `GitHub token parameter '${GITHUB_TOKEN_PARAM_NAME}' not found or empty.`
      )
      throw new Error('GitHub access token not available.')
    }

    this.octokit = new Octokit({ auth: token })
    return this.octokit
  }

  /**
   * Inicializa el cliente a partir de la URL del repo
   */
  initFromRepoUrl(repoUrl: string) {
    const cleaned = repoUrl.replace(/(^git\+|\.git$)/g, '')
    const parts = cleaned.split('/')
    this.owner = parts[parts.length - 2]
    this.repo = parts[parts.length - 1]
    this.logger.log(`GitHub client initialized for ${this.owner}/${this.repo}`)
  }

  /**
   * Obtiene los archivos modificados en un commit
   */
  async getCommitFiles(commitId: string): Promise<FileInfo[]> {
    this.logger.log(
      `Fetching commit ${commitId} files for ${this.owner}/${this.repo}`
    )

    const client = await this.getOctokitClient()

    const res = await client.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: commitId
    })

    const files: FileInfo[] = (res.data.files || []).map((f) => ({
      path: f.filename,
      filename: f.filename
    }))

    return files
  }

  async getAllFiles(ref: string): Promise<FileInfo[]> {
    this.logger.log(`Fetching all files for ${this.owner}/${this.repo} @ ${ref}`)

    const client = await this.getOctokitClient()
    const commit = await client.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref
    })

    const tree = await client.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: commit.data.commit.tree.sha,
      recursive: 'true'
    })

    return (tree.data.tree || [])
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
      .map((entry) => ({ path: entry.path as string, filename: entry.path as string }))
  }

  async resolveRef(ref: string): Promise<string> {
    this.logger.log(`Resolving ref ${ref} for ${this.owner}/${this.repo}`)

    const client = await this.getOctokitClient()
    const commit = await client.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref
    })

    return commit.data.sha
  }

  /**
   * Descarga el contenido de un archivo de un commit específico
   */
  async downloadFile(path: string, ref: string): Promise<Buffer> {
    this.logger.log(`Downloading file ${path} @ ${ref}`)

    const client = await this.getOctokitClient()

    const resp = await client.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref
    })

    if (Array.isArray(resp.data)) {
      throw new Error('Expected single file content, got a directory')
    }

    const data: any = resp.data
    if (data.content === undefined)
      throw new Error('No content found in GitHub response')

    return Buffer.from(data.content, data.encoding as BufferEncoding)
  }
}
