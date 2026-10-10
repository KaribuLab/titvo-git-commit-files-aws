export interface FileInfo {
  path: string
  filename: string
}

export interface RepoClient {
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
export interface PrepareOptions {
  /**
   * Profundidad del clone shallow. Un scan por commit necesita 2 para que el
   * primer padre exista y se pueda calcular el diff; un full scan basta con 1.
   */
  depth?: number
}

export interface CloneableRepoClient extends RepoClient {
  /** Clona (o deja listo) el repo en un directorio local para el ref dado. */
  prepare(ref: string, options?: PrepareOptions): Promise<void>
  /** Libera los recursos locales (directorio de clon, llaves temporales). */
  cleanup(): Promise<void>
}
