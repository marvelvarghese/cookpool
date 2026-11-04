terraform {
  required_version = ">= 1.15.0"

  # State lives on the platform (SB1): the runner exports TF_HTTP_* per job, so
  # this block stays empty — no S3 bucket, no AWS role, no workspaces.
  backend "http" {}

  required_providers {
    # v5, pinned exactly (SM-3): the v4 provider's cloudflare_d1_database has
    # no location hint (account_id and name only, through 4.52.10), so the
    # database could not be created in Asia–Pacific. 5.28.1 has
    # primary_location_hint and upgrades the v4 state of this resource
    # (schema 0 → 500) on its own. This root has no lock file, so the pin is
    # what keeps a later 5.x from arriving unreviewed. Only this root moves:
    # cloudflare-kv and cloudflare-domain keep their own v4 lock files.
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

# --- Providers ---

# Authenticates via the CLOUDFLARE_API_TOKEN env var (provider-native): the
# token is an orun-managed secret resolved into the job env at run time, so it
# never transits Terraform variables.
provider "cloudflare" {}

# --- Variables (standard Orun parameters) ---

variable "cloudflare_account_id" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Cloudflare account ID (from CLOUDFLARE_ACCOUNT_ID env var)"
}

variable "orgName" {
  type    = string
  default = "sourceplane"
}

variable "owner" {
  type    = string
  default = "sourceplane"
}

variable "repo" {
  type    = string
  default = "cookpool"
}

variable "namespace" {
  type    = string
  default = "sourceplane"
}

variable "namespacePrefix" {
  type    = string
  default = ""
}

variable "lane" {
  type    = string
  default = "verify"
}

variable "environment" {
  type    = string
  default = "stage"
}

variable "component" {
  type    = string
  default = "cloudflare-d1"
}

variable "stackName" {
  type    = string
  default = "cloudflare-d1"
}

variable "terraformDir" {
  type    = string
  default = "terraform"
}

variable "terraformVersion" {
  type    = string
  default = "1.15.3"
}

# --- The platform database ---
#
# One D1 database per environment holds every bounded context's tables. They
# are separated by name prefix (`identity_users`, `membership_organizations`,
# …) rather than by Postgres schema, because SQLite has no schemas — the
# bounded-context boundary is enforced in the repositories, as it always was.
#
# Why one database and not one per context: D1 offers no cross-database query
# or foreign key, and the console's read paths join across contexts (an org's
# members and their user records, an invoice and its subscription). Splitting
# would move those joins into the workers, which is a much larger change than
# the isolation is worth at this size.

locals {
  # Brand-namespaced with var.repo so the name is unique to this fork. D1
  # database names are unique per account, and a fork may share an account with
  # the baseline. Workers resolve the database by ID through the wiring secret,
  # so the name is free to change.
  #
  # The `-apac` suffix (SM-3): the database before this one keeps the bare
  # name (`cookpool-stage`, `cookpool-prod`) until the owner deletes it, and
  # names are unique per account. The Workers' wrangler templates name this
  # one (tests/config-worker keeps the two in step).
  database_name = "${var.namespacePrefix}${var.repo}-${var.environment}-apac"
}

# The database lives in Asia–Pacific (SM-3, cookpool-simpler design §1.2 item
# 3): Cookpool's people are in India, and a database created with no hint
# lands near whoever created it, which was the CI runner (most likely North
# America), so every query crossed the Pacific. D1 cannot move a database, so
# this is a new one and it starts empty (risk SM-A, approved by the owner).
#
# The location is chosen once, at creation. Cloudflare never reads the hint
# back, so an imported database (adopt.tf) has none in state; without
# ignore_changes that would plan a replacement, which deletes every row. To
# move the database again, export it, create another one and import the data.
resource "cloudflare_d1_database" "platform_apac" {
  account_id            = var.cloudflare_account_id
  name                  = local.database_name
  primary_location_hint = "apac"

  lifecycle {
    ignore_changes = [primary_location_hint]
  }
}

# The database before SM-3, created with no hint (near the CI runner). Terraform
# stops managing it and does NOT delete it: every Worker stays bound to it,
# with its data and its tables, until that Worker's own deploy in the same
# run binds the new one (each waits on this root and on db-migrate). A delete
# here would leave the whole fleet bound to a database that no longer exists
# for the length of the run, or longer if a deploy failed. The owner deletes
# `cookpool-stage` and `cookpool-prod` in the dashboard once the run is green
# (ai/context/deployment.md). Inert on a fresh state.
removed {
  from = cloudflare_d1_database.platform

  lifecycle {
    destroy = false
  }
}

# --- Wiring manifest (BF5, via orun secrets) ---
#
# The consumable outputs are published by the composition's wire-secrets step
# as the WIRING_CLOUDFLARE_D1 secret on the project/{{env}} rung; worker
# deploys read it back as WIRING_CLOUDFLARE_D1_<ENV> secretEnv and render the
# committed @@wiring(...)@@ tokens from it (BF6). The `db-migrate` component
# reads the same document to find the database it migrates.

output "wiring" {
  description = "Wiring document for downstream deploy-time binding resolution (pushed to orun secrets)"
  value = jsonencode({
    d1_database_id   = cloudflare_d1_database.platform_apac.id
    d1_database_name = cloudflare_d1_database.platform_apac.name
  })
}

# --- Outputs (non-secret) ---

output "d1_database_id" {
  description = "Cloudflare D1 database ID (the Workers binding's database_id)"
  value       = cloudflare_d1_database.platform_apac.id
}

output "d1_database_name" {
  description = "Cloudflare D1 database name (human-readable identifier)"
  value       = cloudflare_d1_database.platform_apac.name
}
