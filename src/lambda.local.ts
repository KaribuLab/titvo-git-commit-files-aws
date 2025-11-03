import { handler } from './entrypoint'

await handler(
  {
    Records: [
      {
        messageId: '1',
        receiptHandle: '1',
        body: '{"repoUrl":"https://github.com/user/repo","branch":"main","commitId":"abc123","status":"success"}',
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '0',
          SenderId: 'local',
          ApproximateFirstReceiveTimestamp: '0'
        },
        messageAttributes: {}, // Se deja vacío, pero debe estar presente
        md5OfBody: '...', // Valor MD5 del cuerpo. Puedes usar un placeholder para testing.
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:MyQueueName',
        awsRegion: 'us-east-1'
      }
    ]
  },
  {} as any,
  () => {
    console.log('done')
  }
)

console.log('Lambda local execution complete.')
