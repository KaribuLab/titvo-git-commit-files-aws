export enum ConfigKeys {
  S3_BUCKET_NAME = 'S3_GIT_FILES_BUCKET_NAME',

  // Claves de AWS
  AWS_STAGE = 'AWS_STAGE',
  AWS_ENDPOINT = 'AWS_ENDPOINT',
  AWS_REGION = 'AWS_REGION',

  TITVO_EVENT_BUS_NAME = 'TITVO_EVENT_BUS_NAME',

  PARAMETER_TABLE_NAME = 'PARAMETER_TABLE_NAME',

  AES_KEY_PATH = 'AES_KEY_PATH'
}

export enum ParamsKeys {
  GITHUB_TOKEN_PARAM_NAME = 'github_access_token',
  CREDENTIALS_PARAM_NAME = 'bitbucket_client_credentials',
  MAX_CONCURRENT_UPLOADS = 'max_concurrent_uploads'
}


console.log('ConfigKeys:', ConfigKeys);
console.log('ParamsKeys:', ParamsKeys);