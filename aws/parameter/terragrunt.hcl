terraform {
  source = "git::https://github.com/KaribuLab/terraform-aws-parameter-lookup.git?ref=v0.1.0"
}

locals {
  serverless = read_terragrunt_config(find_in_parent_folders("serverless.hcl"))
  base_path  = "${local.serverless.locals.parameter_path}/${local.serverless.locals.stage}/infra"
}

include {
  path = find_in_parent_folders()
}

inputs = {
  base_path = local.base_path
}
