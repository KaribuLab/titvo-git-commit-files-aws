export interface FileInfo {
  path: string
  filename: string
}

export interface RepoClient {
  initFromRepoUrl(repoUrl: string): void
  getCommitFiles(commitId: string): Promise<FileInfo[]>
  getAllFiles(ref: string): Promise<FileInfo[]>
  downloadFile(path: string, ref: string): Promise<Buffer>
}
