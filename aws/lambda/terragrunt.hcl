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
    log_arn = "log_arn"
  }
}

dependency parameters {
  config_path = "${get_parent_terragrunt_dir()}/aws/parameter"
  mock_outputs = {
    parameters = {
      "/tvo/security-scan/prod/infra//tvo/security-scan/local/infra/sqs/mcp/git-commit-files/input/queue_arn" = "arn:aws:sqs:us-east-1:000000000000:test-queue"
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
        "Resource" : dependency.parameters.outputs.parameters["${local.base_path}/infra/sqs/git-commit-files/queue_arn"]
      },
    ]
  })
  environment_variables = {
    AWS_STAGE = local.serverless.locals.stage
    LOG_LEVEL = local.serverless.locals.stage != "prod" ? "debug" : "info"
  }
  event_sources_arn = [
    dependency.parameters.outputs.parameters["${local.base_path}/infra//tvo/security-scan/local/infra/sqs/mcp/git-commit-files/input/queue_arn"]
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
