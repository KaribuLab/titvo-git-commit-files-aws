locals {
  region        = get_env("AWS_REGION")
  stage         = get_env("AWS_STAGE")
  account_id    = get_env("AWS_ACCOUNT_ID", "")
  bucket_suffix = local.account_id == "" ? "" : "-${local.account_id}"
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
  service_name   = "tvo-mcp-git-commit-files"
  service_bucket = "${local.service_name}-${local.region}${local.bucket_suffix}"
  log_retention  = 7
  parameter_path = "/tvo/security-scan"
  common_tags = {
    Project = "Titvo"
  }
}
