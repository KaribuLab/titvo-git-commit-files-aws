/**
 * Input DTO que representa la estructura del evento recibido por la Lambda.
 * Este DTO se utilizará para validar o tipar los datos de entrada.
 */
export class GitCommitFilesInputDto {
  taskId: string
  data: {
    status: string
    commitId: string
    repository: string
    branch?: string
    commitMessage?: string
    commitAuthor?: string
    commitDate?: string
  }
}

export interface BaseOutputDto {
  taskId: string
  success: boolean
  message: string
  data: unknown
}

export interface GitCommitFilesOutputDto extends BaseOutputDto {
  data: {
    uploadedFiles: string[]
    commitId?: string
  }
}
