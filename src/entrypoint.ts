import { NestFactory } from '@nestjs/core'
import {
  Context,
  Handler,
  SQSEvent,
  SQSRecord
} from 'aws-lambda'
import { AppModule } from '@lambda/app.module'
import { INestApplicationContext, Logger as NestLogger } from '@nestjs/common'
import { Logger } from 'nestjs-pino'
import { GitCommitFilesService } from '@lambda/git-commit-files/git-commit-files.service'
import { GitCommitFilesInputDto } from '@lambda/git-commit-files/git-commit-files.dto'

const logger = new NestLogger('git-commit-filesLambdaHandler')

async function initApp(): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.init()
  app.flushLogs()

  return app
}

let app: INestApplicationContext | undefined;

if (app === undefined) {
  app = await initApp();
}

const service = app.get(GitCommitFilesService)

interface GitCommitFilesEvent {
  detail: {
    job_id: string,
    data: {
      repository: string,
      commit_id: string,
    }
  }
}

export const handler: Handler<SQSEvent> = async (
  event: SQSEvent,
  _context: Context
): Promise<void> => {
  if (event && event.Records && Array.isArray(event.Records)) {
    try {
      logger.log(`Iniciando git-commit-filesLambdaHandler: ${JSON.stringify(event)}`)

      const records: GitCommitFilesEvent[] = event.Records.map(
        (record: SQSRecord) => JSON.parse(record.body) as GitCommitFilesEvent
      )

      const promises = records.map(async (record) => {
        logger.debug(`Procesando mensaje: ${JSON.stringify(record)}`)
        return service.process({
          jobId: record.detail.job_id,
          data: {
            repository: record.detail.data.repository,
            commitId: record.detail.data.commit_id,
          }
        })
      })

      await Promise.all(promises)

      logger.log('git-commit-filesLambdaHandler finalizado.')
    } catch (e) {
      logger.error('Error al procesar el servicio')
      logger.error(e)
      throw e
    }
  }
}
