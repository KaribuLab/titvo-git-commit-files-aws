import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { RepoClient, FileInfo } from "../repo.client";
import { inspect } from "util";
import { ParameterService } from "@lambda/parameter/parameter.service";
import { ParamsKeys } from "@lambda/config/config.key";

// URL y nombres de parámetros constantes
const BITBUCKET_API_URL = "https://api.bitbucket.org/2.0";
const BITBUCKET_API_TOKEN_PARAM_NAME =
  ParamsKeys.BITBUCKET_API_TOKEN_PARAM_NAME;

@Injectable()
export class BitbucketClientService implements RepoClient {
  private readonly apiBase = BITBUCKET_API_URL;
  private readonly logger = new Logger(BitbucketClientService.name);
  private workspace = "";
  private repoSlug = "";

  private apiToken: string | null = null;

  constructor(private readonly parameterService: ParameterService) {}

  /**
   * Inicializa los parámetros de repositorio a partir de la URL.
   * (Método público de configuración)
   */
  initFromRepoUrl(repoUrl: string) {
    const parts = repoUrl.replace(/(^git\+|\.git$)/g, "").split("/");
    this.workspace = parts[parts.length - 2];
    this.repoSlug = parts[parts.length - 1];
  }

  /**
   * Obtiene los archivos modificados en un commit, probando dos estrategias.
   */
  async getCommitFiles(commitId: string): Promise<FileInfo[]> {
    this.logger.log(
      `Bitbucket getting files for commit ${commitId} in ${this.workspace}/${this.repoSlug}`,
    );

    const filesFromDiffstat = await this.getCommitFilesFromDiffstat(commitId);

    if (filesFromDiffstat) {
      return filesFromDiffstat;
    }

    this.logger.log(
      `Strategy 1 (diffstat) failed, falling back to Strategy 2 (src) for ${commitId}`,
    );
    return this.getCommitFilesFromSrcEndpoint(commitId);
  }

  /**
   * Descarga el contenido de un archivo específico de un commit.
   */
  async downloadFile(path: string, commitId: string): Promise<Buffer> {
    this.logger.log(`Bitbucket download ${path} @ ${commitId} using API /src`);

    const apiUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/${path}`;

    // Usamos el Bearer Token para la autenticación
    const authConfig: AxiosRequestConfig = {
      ...(await this.getAuthHeaders()), // Agregamos los headers de Auth
      // Es crucial solicitar 'arraybuffer' para obtener el contenido binario/Buffer del archivo.
      responseType: "arraybuffer",
    };

    const res = await axios.get(apiUrl, authConfig);

    // Si la respuesta es exitosa, res.data es el contenido del archivo.
    return Buffer.from(res.data);
  }

  async getAllFiles(ref: string): Promise<FileInfo[]> {
    this.logger.log(
      `Bitbucket listing all files for ${this.workspace}/${this.repoSlug} @ ${ref}`,
    );

    const files: FileInfo[] = [];
    const authConfig = await this.getAuthHeaders();
    let pendingUrls: string[] = [
      `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${ref}/?pagelen=100`,
    ];

    while (pendingUrls.length > 0) {
      const currentUrl = pendingUrls.shift() as string;
      let nextUrl: string | null = currentUrl;

      while (nextUrl) {
        const res: AxiosResponse = await axios.get(nextUrl, authConfig);
        const data: any = res.data;

        if (!data || !Array.isArray(data.values)) {
          throw new Error(`Bitbucket src endpoint did not return values for ${ref}`);
        }

        for (const value of data.values) {
          if (value.type === "commit_file") {
            files.push({ path: value.path, filename: value.path });
          } else if (value.type === "commit_directory" && value.path) {
            pendingUrls.push(
              `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${ref}/${value.path}?pagelen=100`,
            );
          }
        }

        nextUrl = typeof data.next === "string" ? data.next : null;
      }
    }

    return files;
  }

  /**
   * Genera el objeto de configuración de Axios con el Bearer Token.
   */
  private async getAuthHeaders(): Promise<AxiosRequestConfig> {
    const token = await this.getAPIToken();
    return {
      headers: {
        Authorization: `Basic ${token}`,
      },
    };
  }

  /**
   * Obtiene un token de acceso OAuth 2.0 (Client Credentials Grant).
   * Usa un valor en caché si no ha expirado.
   */
  private async getAPIToken(): Promise<string> {
    // Si el token existe
    if (this.apiToken) {
      return this.apiToken;
    }

    // Obtener credenciales de forma segura
    const bitbucketAPIToken: string | undefined =
      await this.parameterService.getDecryptedParameterValue(
        BITBUCKET_API_TOKEN_PARAM_NAME,
      );
    if (!bitbucketAPIToken) {
      throw new Error(
        "Bitbucket client credentials not found in Parameter Store.",
      );
    }
    this.apiToken = bitbucketAPIToken;
    return this.apiToken;
  }

  /**
   * Intenta obtener los archivos modificados usando el endpoint /diffstat/{hash}.
   *
   * Este endpoint devuelve la lista paginada de cambios del commit (comparado
   * contra su primer padre). Cada entrada trae 'status' y los objetos 'old'/'new'
   * con su 'path'. Aqui solo extraemos las rutas que siguen existiendo en el
   * commit (added/modified/renamed) para poder descargarlas completas despues.
   * Se omiten los archivos eliminados porque ya no se pueden descargar.
   *
   * Devuelve 'null' si la respuesta no tiene la forma esperada o falla, para
   * intentar otra estrategia.
   */
  private async getCommitFilesFromDiffstat(
    commitId: string,
  ): Promise<FileInfo[] | null> {
    try {
      const authConfig = await this.getAuthHeaders();
      const files: FileInfo[] = [];

      let nextUrl: string | null = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/diffstat/${commitId}?pagelen=500`;

      while (nextUrl) {
        const res: AxiosResponse = await axios.get(nextUrl, authConfig);
        const data: any = res.data;

        if (!data || !Array.isArray(data.values)) {
          this.logger.log(
            `Strategy 1 (diffstat) did not return 'values' array for ${commitId}.`,
          );
          return null;
        }

        for (const change of data.values) {
          // Los archivos eliminados no existen en este commit, no se descargan.
          if (change?.status === "removed") {
            continue;
          }
          // Para added/modified/renamed el path vigente esta en 'new'.
          const path: string | undefined = change?.new?.path;
          if (path) {
            files.push({ path, filename: path });
          }
        }

        nextUrl = typeof data.next === "string" ? data.next : null;
      }

      this.logger.log(
        `Strategy 1 (diffstat) succeeded for ${commitId} with ${files.length} files`,
      );
      return files;
    } catch (err) {
      this.logger.warn(
        `Strategy 1 (diffstat) failed with error for ${commitId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Obtiene la lista de archivos listando el contenido del directorio raíz
   * en un commit específico, usando el endpoint /src/{hash}/.
   */
  private async getCommitFilesFromSrcEndpoint(
    commitId: string,
  ): Promise<FileInfo[]> {
    const srcUrl = `${this.apiBase}/repositories/${this.workspace}/${this.repoSlug}/src/${commitId}/`;

    try {
      const authConfig = await this.getAuthHeaders();

      const srcRes = await axios.get(srcUrl, authConfig);

      const files: FileInfo[] = [];
      if (srcRes.data && srcRes.data.values) {
        for (const v of srcRes.data.values) {
          if (v.type === "commit_file") {
            files.push({ path: v.path, filename: v.path });
          }
        }
      }
      return files;
    } catch (err) {
      this.logger.error(
        `Strategy 2 (src endpoint) FAILED for ${commitId}: ${inspect(err, { showHidden: false, depth: 5 })}`,
      );
      throw err;
    }
  }
}
