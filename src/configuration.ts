import { ConfigKeys } from "./config/config.key"


const configuration = () => ({
  [ConfigKeys.AWS_STAGE]: process.env[ConfigKeys.AWS_STAGE] ?? 'prod',
  [ConfigKeys.AWS_ENDPOINT]: process.env[ConfigKeys.AWS_ENDPOINT], // Puede ser opcional, para desarrollo local (LocalStack)

  [ConfigKeys.AWS_REGION]: process.env[ConfigKeys.AWS_REGION] ?? 'us-east-1',

  [ConfigKeys.S3_BUCKET_NAME]: process.env[ConfigKeys.S3_BUCKET_NAME],

  [ConfigKeys.MAX_CONCURRENT_UPLOADS]: parseInt(
    process.env[ConfigKeys.MAX_CONCURRENT_UPLOADS] ?? '10',
    10
  ),

  [ConfigKeys.TITVO_EVENT_BUS_NAME]:
    process.env[ConfigKeys.TITVO_EVENT_BUS_NAME]
})

export default configuration