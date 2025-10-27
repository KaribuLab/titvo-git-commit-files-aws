import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { RepoClient, FileInfo } from '../repo.client'
import { inspect } from 'util'

@Injectable()
export class BitbucketClientService implements RepoClient {
  private readonly apiBase = 'https://api.bitbucket.org/2.0'
  private readonly logger = new Logger(BitbucketClientService.name)
  private workspace = ''
  private repoSlug = ''
  private username = process.env.BITBUCKET_USERNAME || ''
  private appPassword = process.env.BITBUCKET_APP_PASSWORD || ''

  initFromRepoUrl(repoUrl: string) {
    const parts = repoUrl.replace(/(^git\+|\.git$)/g, '').split('/')
    this.workspace = parts[parts.length - 2]
    this.repoSlug = parts[parts.length - 1]
  }

  /**
   * Obtiene los archivos modificados en un commit, probando dos estrategias.
   */
  async getCommitFiles(commitId: string): Promise<FileInfo[]> {
    this.logger.log(
      `Bitbucket getting files for commit ${commitId} in ${this.workspace}/${this.repoSlug}`
    )

    const filesFromCommit =
      await this.getCommitFilesFromCommitEndpoint(commitId)

    if (filesFromCommit) {
      return filesFromCommit
    }

    this.logger.log(
      `Strategy 1 (commit) failed, falling back to Strategy 2 (src) for ${commitId}`
    )
    return this.getCommitFilesFromSrcEndpoint(commitId)
  }

  /**
   * Intenta obtener los archivos usando el endpoint /commit/{hash}/.
   * Devuelve 'null' si no encuentra los archivos para intentar otra estrategia.
   */
  private async getCommitFilesFromCommitEndpoint(
    commitId: string
  ): Promise<FileInfo[] | null> {
    const url = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/commit/${commitId}/`
    try {
      const res = await axios.get(url, {
        auth: { username: this.username, password: this.appPassword }
      })

      if (res.data && res.data.files && Array.isArray(res.data.files)) {
        this.logger.log(
          `Strategy 1 (commit endpoint) succeeded for ${commitId}`
        )
        const files: FileInfo[] = []
        for (const f of res.data.files) {
          files.push({ path: f.path, filename: f.path })
        }
        return files
      }

      this.logger.log(
        `Strategy 1 (commit endpoint) did not return 'files' array for ${commitId}.`
      )
      return null
    } catch (err) {
      this.logger.warn(
        `Strategy 1 (commit endpoint) failed with error for ${commitId}: ${(err as Error).message}`
      )
      return null
    }
  }

  /**
   * Obtiene la lista de archivos listando el contenido del directorio raíz
   * en un commit específico, usando el endpoint /src/{hash}/.
   */
  private async getCommitFilesFromSrcEndpoint(
    commitId: string
  ): Promise<FileInfo[]> {
    // NOTA: La barra (/) al final es crucial para que la API no devuelva 404.
    const srcUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/`

    try {
      const srcRes = await axios.get(srcUrl, {
        auth: { username: this.username, password: this.appPassword }
      })

      const files: FileInfo[] = []
      if (srcRes.data && srcRes.data.values) {
        // Filtramos la respuesta para incluir solo archivos ('commit_file')
        for (const v of srcRes.data.values) {
          if (v.type === 'commit_file') {
            files.push({ path: v.path, filename: v.path })
          }
        }
      }
      return files
    } catch (err) {
      this.logger.error(
        `Strategy 2 (src endpoint) FAILED for ${commitId}: ${inspect(err, false, 5)}`
      )
      throw err
    }
  }

  async downloadFile(path: string, commitId: string): Promise<Buffer> {
    this.logger.log(`Bitbucket download ${path} @ ${commitId} using API /src`)

    // Usamos el endpoint de la API, no la URL 'raw'.
    // La estructura es: /repositories/{workspace}/{repo_slug}/src/{commitId}/{path}
    const apiUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/${path}`

    // Usamos la autenticación en todo momento.
    const res = await axios.get(apiUrl, {
      // Es crucial solicitar 'arraybuffer' para obtener el contenido binario/Buffer del archivo.
      responseType: 'arraybuffer',
      auth: {
        username: this.username,
        password: this.appPassword
      }
    })

    // Si la respuesta es exitosa, res.data es el contenido del archivo.
    return Buffer.from(res.data)
  }
}
