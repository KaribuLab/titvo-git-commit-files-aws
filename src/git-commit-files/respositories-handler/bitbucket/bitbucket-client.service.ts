import { Injectable, Logger } from '@nestjs/common'
import axios, { AxiosRequestConfig } from 'axios'
import { RepoClient, FileInfo } from '../repo.client'
import { inspect } from 'util'
import { ParameterService } from '@lambda/parameter/parameter.service'
import { ParamsKeys } from '@lambda/config/config.key'

// URL y nombres de parámetros constantes
const ACCESS_TOKEN_URL = 'https://bitbucket.org/site/oauth2/access_token'
const BITBUCKET_API_URL = 'https://api.bitbucket.org/2.0'
const CREDENTIALS_PARAM_NAME = ParamsKeys.CREDENTIALS_PARAM_NAME

@Injectable()
export class BitbucketClientService implements RepoClient {
  private readonly apiBase = BITBUCKET_API_URL
  private readonly logger = new Logger(BitbucketClientService.name)
  private workspace = ''
  private repoSlug = ''

  private accessToken: string | null = null
  private tokenExpiryTime: number = 0

  constructor(private readonly parameterService: ParameterService) {}

  /**
   * Inicializa los parámetros de repositorio a partir de la URL.
   * (Método público de configuración)
   */
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
   * Descarga el contenido de un archivo específico de un commit.
   */
  async downloadFile(path: string, commitId: string): Promise<Buffer> {
    this.logger.log(`Bitbucket download ${path} @ ${commitId} using API /src`)

    const apiUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/${path}`

    // Usamos el Bearer Token para la autenticación
    const authConfig: AxiosRequestConfig = {
      ...(await this.getAuthHeaders()), // Agregamos los headers de Auth
      // Es crucial solicitar 'arraybuffer' para obtener el contenido binario/Buffer del archivo.
      responseType: 'arraybuffer'
    }

    const res = await axios.get(apiUrl, authConfig)

    // Si la respuesta es exitosa, res.data es el contenido del archivo.
    return Buffer.from(res.data)
  }

  /**
   * Genera el objeto de configuración de Axios con el Bearer Token.
   */
  private async getAuthHeaders(): Promise<AxiosRequestConfig> {
    const token = await this.getAccessToken()
    return {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  }

  /**
   * Obtiene un token de acceso OAuth 2.0 (Client Credentials Grant).
   * Usa un valor en caché si no ha expirado.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    // Si el token existe y todavía no expira (usamos un margen de 60 segundos)
    if (this.accessToken && this.tokenExpiryTime > now + 60000) {
      return this.accessToken
    }

    // Obtener credenciales de forma segura
    const bitbucketClientCredentialsValue: string | undefined =
      await this.parameterService.getDecryptedParameterValue(
        CREDENTIALS_PARAM_NAME
      )
    if (!bitbucketClientCredentialsValue) {
      throw new Error(
        'Bitbucket client credentials not found in Parameter Store.'
      )
    }

    const bitbucketClientCredentials = JSON.parse(
      bitbucketClientCredentialsValue
    ) as { key: string; secret: string }

    this.logger.log('Fetching new Bitbucket Access Token...')

    const accessTokenResponse = await fetch(`${ACCESS_TOKEN_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: bitbucketClientCredentials.key,
        client_secret: bitbucketClientCredentials.secret,
        grant_type: 'client_credentials'
      }).toString()
    })

    if (!accessTokenResponse.ok) {
      const errorText = await accessTokenResponse.text()
      this.logger.error(
        `Error fetching token: ${accessTokenResponse.status}. Body: ${errorText}`
      )
      throw new Error(
        `Failed to obtain Bitbucket access token. Status: ${accessTokenResponse.status}`
      )
    }

    const data = (await accessTokenResponse.json()) as {
      access_token: string
      expires_in: number
    }

    // Almacenar y cachear
    this.accessToken = data.access_token
    // expires_in está en segundos, lo convertimos a milisegundos y establecemos la hora de expiración
    this.tokenExpiryTime = now + data.expires_in * 1000

    return this.accessToken
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
      const authConfig = await this.getAuthHeaders()

      const res = await axios.get(url, authConfig)

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
    const srcUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/`

    try {
      const authConfig = await this.getAuthHeaders()

      const srcRes = await axios.get(srcUrl, authConfig)

      const files: FileInfo[] = []
      if (srcRes.data && srcRes.data.values) {
        for (const v of srcRes.data.values) {
          if (v.type === 'commit_file') {
            files.push({ path: v.path, filename: v.path })
          }
        }
      }
      return files
    } catch (err) {
      this.logger.error(
        `Strategy 2 (src endpoint) FAILED for ${commitId}: ${inspect(err, { showHidden: false, depth: 5 })}`
      )
      throw err
    }
  }
}
