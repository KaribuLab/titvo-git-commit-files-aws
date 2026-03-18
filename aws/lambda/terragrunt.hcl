terraform {
  source = "git::https://github.com/KaribuLab/terraform-aws-function.git?ref=v0.10.0"
}

locals {
  serverless    = read_terragrunt_config(find_in_parent_folders("serverless.hcl"))
  function_name = "${local.serverless.locals.service_name}-lambda-${local.serverless.locals.stage}"
  common_tags   = local.serverless.locals.common_tags
  base_path     = "${local.serverless.locals.parameter_path}/${local.serverless.locals.stage}"
}

include {
  path = find_in_parent_folders()
}

dependency log {
  config_path = "${get_parent_terragrunt_dir()}/aws/cloudwatch"
  mock_outputs = {
    log_arn = "arn:aws:logs:us-east-2:123456789012:log-group:/aws/lambda/mock"
  }
}

dependency parameters {
  config_path = "${get_parent_terragrunt_dir()}/aws/parameter"
  mock_outputs = {
    parameters = {
      "/tvo/security-scan/prod/infra/sqs/mcp/git-commit-files/input/queue_arn" = "arn:aws:sqs:us-east-2:123456789012:tvo-mcp-git-commit-files-input-prod"
      "/tvo/security-scan/prod/infra/s3/git-commit-files/bucket_arn"           = "arn:aws:s3:::tvo-mcp-git-commit-files-prod"
      "/tvo/security-scan/prod/infra/s3/git-commit-files/bucket_name"          = "tvo-mcp-git-commit-files-prod"
      "/tvo/security-scan/prod/infra/eventbridge/eventbus_arn"                 = "arn:aws:events:us-east-2:123456789012:event-bus/tvo-mcp-eventbus-prod"
      "/tvo/security-scan/prod/infra/eventbridge/eventbus_name"                = "tvo-mcp-eventbus-prod"
      "/tvo/security-scan/prod/infra/secrets/bitbucket/secret_arn"             = "arn:aws:secretsmanager:us-east-2:123456789012:secret:/tvo/mcp/prod/bitbucket_credentials"
      "/tvo/security-scan/prod/infra/secrets/github/secret_arn"                = "arn:aws:secretsmanager:us-east-2:123456789012:secret:/tvo/mcp/prod/github_access_token"
      "/tvo/security-scan/prod/infra/secret/manager/arn"                       = "arn:aws:secretsmanager:us-east-2:123456789012:secret:/tvo/security-scan/prod"
      "/tvo/security-scan/prod/infra/dynamo/parameter-table-arn"               = "arn:aws:dynamodb:us-east-2:123456789012:table/tvo-security-scan-configuration-table-prod"
      "/tvo/security-scan/prod/infra/dynamo/parameter-table-name"              = "tvo-security-scan-configuration-table-prod"
      "/tvo/security-scan/prod/infra/kms/encryption-key-name"                  = "/tvo/security-scan/prod/infra/encryption-key"
    }
  }
}

inputs = {
  function_name = local.function_name
  iam_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource" : "${dependency.log.outputs.log_arn}:*"
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "sqs:ChangeMessageVisibility",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
        ],
        "Resource" : dependency.parameters.outputs.parameters["${local.base_path}/infra/sqs/mcp/git-commit-files/input/queue_arn"]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "s3:GetObject",
          "s3:PutObject"
        ],
        "Resource" : "${dependency.parameters.outputs.parameters["${local.base_path}/infra/s3/git-commit-files/bucket_arn"]}/*"
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "events:PutEvents",
        ],
        "Resource" : dependency.parameters.outputs.parameters["${local.base_path}/infra/eventbridge/eventbus_arn"]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "secretsmanager:GetSecretValue",
        ],
        "Resource" : dependency.parameters.outputs.parameters["${local.base_path}/infra/secret/manager/arn"]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
        ],
        "Resource" : dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/parameter-table-arn"]
      },
    ]
  })
  environment_variables = {
    AWS_STAGE                = local.serverless.locals.stage
    LOG_LEVEL                = local.serverless.locals.stage != "prod" ? "debug" : "info"
    TITVO_EVENT_BUS_NAME     = dependency.parameters.outputs.parameters["${local.base_path}/infra/eventbridge/eventbus_name"]
    PARAMETER_TABLE_NAME     = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/parameter-table-name"]
    S3_GIT_FILES_BUCKET_NAME = dependency.parameters.outputs.parameters["${local.base_path}/infra/s3/git-commit-files/bucket_name"]
    AES_KEY_PATH             = dependency.parameters.outputs.parameters["${local.base_path}/infra/kms/encryption-key-name"]
    NODE_OPTIONS             = "--enable-source-maps",
  }
  event_sources_arn = [
    dependency.parameters.outputs.parameters["${local.base_path}/infra/sqs/mcp/git-commit-files/input/queue_arn"]
  ]
  runtime       = "nodejs22.x"
  handler       = "src/entrypoint.handler"
  bucket        = local.serverless.locals.service_bucket
  file_location = "${get_parent_terragrunt_dir()}/build"
  zip_location  = "${get_parent_terragrunt_dir()}/dist"
  zip_name      = "${local.function_name}.zip"
  common_tags = merge(local.common_tags, {
    Name = local.function_name
  })
}
