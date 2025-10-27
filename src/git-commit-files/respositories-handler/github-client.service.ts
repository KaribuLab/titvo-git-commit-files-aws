import { Injectable, Logger } from '@nestjs/common'
import { RepoClient, FileInfo } from './repo.client'
import { Octokit } from '@octokit/rest'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class GitHubClientService implements RepoClient {
  private readonly octokit: Octokit
  private readonly logger = new Logger(GitHubClientService.name)
  private owner: string
  private repo: string

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('GITHUB_TOKEN') || ''
    this.octokit = new Octokit({ auth: token })
    this.owner = ''
    this.repo = ''
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
    const res = await this.octokit.rest.repos.getCommit({
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

  /**
   * Descarga el contenido de un archivo de un commit específico
   */
  async downloadFile(
    path: string,
    commitId: string
  ): Promise<Buffer> {
    this.logger.log(`Downloading file ${path} @ commit ${commitId}`)
    const resp = await this.octokit.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref: commitId
    })

    if (Array.isArray(resp.data)) {
      throw new Error('Expected single file content, got a directory')
    }

    const data: any = resp.data
    if (data.content === undefined) throw new Error('No content found in GitHub response')

    return Buffer.from(data.content, data.encoding)
  }
}
