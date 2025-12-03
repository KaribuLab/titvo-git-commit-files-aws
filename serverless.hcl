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
  service_name   = "tvo-mcp-git-commit-files"
  service_bucket = "tvo-mcp-tfstate-git-commit-files"
  log_retention  = 7
  parameter_path = "/tvo/security-scan"
  common_tags = {}
}
