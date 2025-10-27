import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GitCommitFilesInputDto,
  GitCommitFilesOutputDto
} from './git-commit-files.dto'
import { RepoFactoryService } from './respositories-handler/repo-factory.service'
import { FileInfo } from './respositories-handler/repo.client'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'
import { inspect } from 'util'
import { EventBridgeService } from '@lambda/aws/eventbridge'

/**
 * Servicio principal que maneja el flujo completo de procesamiento del commit.
 * Detecta el proveedor, obtiene los archivos modificados y los sube a S3.
 */
@Injectable()
export class GitCommitFilesService {
  private readonly logger = new Logger(GitCommitFilesService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly repoFactory: RepoFactoryService,
    private readonly s3Service: S3ParallelETLService,
    private readonly eventBridgeService: EventBridgeService // **NUEVA INYECCIÓN**
  ) {}

  /**
   * Procesa un commit recibido desde un evento Lambda.
   * @param input Datos del commit.
   */
  async process(
    input: GitCommitFilesInputDto
  ): Promise<GitCommitFilesOutputDto> {
    const { taskId, data } = input
    let success = false
    let message = ''
    let uploadedFiles: string[] = []
    
    const taskContext = `[Task: ${taskId}]` 

    this.logger.log(`Iniciando procesamiento del commit ${data.commitId}...`, taskContext)

    if (!this.shouldProcess(data)) {
      message = 'El commit no está en estado success. Proceso omitido.'
      this.logger.warn(message, taskContext)
      
      return {
        taskId,
        success: false,
        message,
        data: { uploadedFiles, commitId: data.commitId }
      }
    }

    try {
      const repoClient = this.repoFactory.getClientForRepoUrl(data.repository)

      
      const files: FileInfo[] = await repoClient.getCommitFiles(data.commitId)
      this.logger.log(`Se encontraron ${files.length} archivos modificados.`, taskContext)

      uploadedFiles = await this.s3Service.initETLBatch(
        { files, commitId: data.commitId },
        repoClient
      )

      success = true
      message = `Commit ${data.commitId} procesado correctamente.`
      this.logger.log('Todos los archivos fueron procesados exitosamente.', taskContext)
    } catch (error) {
      const errorMessage = `Error procesando el commit ${data.commitId}. Mensaje: ${(error as Error).message}`
      
      this.logger.error(
        `${errorMessage} | Detalles: ${inspect(error, false, 5)}`,
        (error as Error).stack, 
        taskContext 
      )

      message = `Error procesando el commit: ${(error as Error).message}`
      uploadedFiles = []
    }
    
    await this.sendEventBridgeResult(taskId, success, message, data.commitId, uploadedFiles)

    return {
      taskId,
      success,
      message,
      data: { uploadedFiles, commitId: data.commitId }
    }
  }
  
  /**
   * Determina si el commit debe ser procesado.
   * @param data Datos del commit.
   * @returns true si el commit está en estado 'success', false en caso contrario.
   */
  private shouldProcess(data: GitCommitFilesInputDto['data']): boolean {
    return data.status === 'success'
  }

  /**
   * Envía el resultado final del procesamiento del commit a EventBridge.
   * @param taskId ID de la tarea.
   * @param success Indicador de éxito.
   * @param message Mensaje de resultado.
   * @param commitId ID del commit procesado.
   * @param uploadedFiles Lista de archivos subidos.
   */
  private async sendEventBridgeResult(
    taskId: string, 
    success: boolean, 
    message: string, 
    commitId: string, 
    uploadedFiles: string[]
  ): Promise<void> {
    const eventBusName = this.configService.get<string>('titvoEventBusName') as string

    if (!eventBusName) {
      this.logger.warn(`No se encontró 'titvoEventBusName' en la configuración. EventBridge event omitido para tarea ${taskId}.`)
      return
    }

    try {
      await this.eventBridgeService.putEvents([{
        Source: 'mcp.repo.files.processor', // Fuente apropiada para este servicio
        DetailType: 'output',
        Detail: JSON.stringify({
          task_id: taskId,
          success: success,
          message: message,
          data: {
            commit_id: commitId,
            uploaded_files: uploadedFiles 
          }
        }),
        EventBusName: eventBusName
      }])
      
      this.logger.log(`EventBridge event enviado exitosamente para tarea ${taskId}.`)
    } catch (error) {
      this.logger.error(
        `Error al enviar EventBridge event para tarea ${taskId}: ${(error as Error).message}`,
        (error as Error).stack,
        `[Task: ${taskId}]`
      )
    }
  }
}