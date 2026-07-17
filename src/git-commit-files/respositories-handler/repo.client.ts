export interface FileInfo {
  path: string
  filename: string
}

export interface RepoClient {
  initFromRepoUrl(repoUrl: string): void
  getCommitFiles(commitId: string): Promise<FileInfo[]>
  resolveRef(ref: string): Promise<string>
  getAllFiles(ref: string): Promise<FileInfo[]>
  downloadFile(path: string, ref: string): Promise<Buffer>
}

/**
 * Extensión de RepoClient para clientes que clonan el repositorio al disco
 * (p.ej. vía SSH) en lugar de descargar archivo por archivo por la API.
 *
 * Esto evita el rate limit (HTTP 429) del API de Bitbucket/GitHub en full scan:
 * se hace un único `git clone` y luego se lee del working tree local.
 */
export interface CloneableRepoClient extends RepoClient {
  /** Clona (o deja listo) el repo en un directorio local para el ref dado. */
  prepare(ref: string): Promise<void>
  /** Libera los recursos locales (directorio de clon, llaves temporales). */
  cleanup(): Promise<void>
}
