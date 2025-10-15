locals {
  region = get_env("AWS_REGION")
  stage  = get_env("AWS_STAGE")
  stages = {
    localstack = {
      name = "Localstack"
    }
    test = {
      name = "Testing"
    }
    prod = {
      name = "Production"
    }
  }
  service_name   = "git-commit-files"
  service_bucket = "${local.service_name}-${local.region}"
  log_retention  = 7
  parameter_path = "/tvo/security-scan"
  common_tags = {}
}
