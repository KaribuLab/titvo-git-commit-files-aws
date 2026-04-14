export enum ConfigKeys {
  S3_BUCKET_NAME = "TITVO_S3_GIT_FILES_BUCKET_NAME",

  // Claves de AWS
  AWS_STAGE = "AWS_STAGE",
  AWS_ENDPOINT = "AWS_ENDPOINT_URL",
  AWS_REGION = "AWS_REGION",

  TITVO_EVENT_BUS_NAME = "TITVO_EVENT_BUS_NAME",

  PARAMETER_TABLE_NAME = "TITVO_PARAMETER_TABLE_NAME",

  AES_KEY_PATH = "TITVO_AES_KEY_PATH",
}

export enum ParamsKeys {
  GITHUB_TOKEN_PARAM_NAME = "github_access_token",
  BITBUCKET_API_TOKEN_PARAM_NAME = "bitbucket_api_token",
  MAX_CONCURRENT_UPLOADS = "max_concurrent_uploads",
}

console.log("ConfigKeys:", ConfigKeys);
console.log("ParamsKeys:", ParamsKeys);
