export enum ConfigKeys {
  S3_BUCKET_NAME = 'S3_GIT_FILES_BUCKET_NAME',
  MAX_CONCURRENT_UPLOADS = 'MAX_CONCURRENT_UPLOADS',

  // Claves de AWS
  AWS_STAGE = 'AWS_STAGE',
  AWS_ENDPOINT = 'AWS_ENDPOINT',
  AWS_REGION = 'AWS_REGION',

  TITVO_EVENT_BUS_NAME = 'TITVO_EVENT_BUS_NAME',

  PARAMETER_TABLE_NAME = 'parameterTableName',

  AES_KEY_PATH = 'aesKeyPath',
}


export enum ParamsKeys {
  GITHUB_TOKEN_PARAM_NAME = 'github_secret_token',
  CREDENTIALS_PARAM_NAME = 'bitbucket_client_credentials'
}