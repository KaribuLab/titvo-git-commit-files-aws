# Root alternativo para desplegar el servicio en MiniStack (emulador AWS local).
# Uso: AWS_STAGE=local TG_ROOT_FILE=ministack.hcl terragrunt run --all apply
locals {
  serverless       = read_terragrunt_config(find_in_parent_folders("serverless.hcl"))
  endpoint         = get_env("AWS_ENDPOINT_URL", "http://localhost:4566")
  provider_version = try(local.serverless.locals.provider_version, "6.46.0")
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
  terraform {
    required_providers {
      aws = {
        source  = "hashicorp/aws"
        version = "${local.provider_version}"
      }
    }
  }
  provider "aws" {
    region                      = "${local.serverless.locals.region}"
    access_key                  = "test"
    secret_key                  = "test"
    s3_use_path_style           = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true

    endpoints {
      apigateway     = "${local.endpoint}"
      cloudwatchlogs = "${local.endpoint}"
      dynamodb       = "${local.endpoint}"
      ecr            = "${local.endpoint}"
      eventbridge    = "${local.endpoint}"
      iam            = "${local.endpoint}"
      lambda         = "${local.endpoint}"
      s3             = "${local.endpoint}"
      secretsmanager = "${local.endpoint}"
      sqs            = "${local.endpoint}"
      ssm            = "${local.endpoint}"
      sts            = "${local.endpoint}"
    }
  }
EOF
}

generate "backend" {
  path      = "backend.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
  terraform {
    backend "s3" {}
  }
EOF
}

# El state vive dentro de MiniStack: si el emulador se reinicia, state y recursos se pierden juntos.
remote_state {
  backend = "s3"
  config = {
    bucket                             = "${local.serverless.locals.service_bucket}"
    key                                = "${path_relative_to_include()}/terraform.tfstate"
    region                             = "${local.serverless.locals.region}"
    access_key                         = "test"
    secret_key                         = "test"
    endpoints                          = { s3 = local.endpoint }
    use_path_style                     = true
    use_lockfile                       = true
    skip_region_validation             = true
    skip_credentials_validation        = true
    skip_metadata_api_check            = true
    skip_requesting_account_id         = true
    skip_s3_checksum                   = true
    skip_bucket_versioning             = true
    skip_bucket_ssencryption           = true
    skip_bucket_root_access            = true
    skip_bucket_enforced_tls           = true
    skip_bucket_public_access_blocking = true
  }
}

inputs = merge(local.serverless.locals)
