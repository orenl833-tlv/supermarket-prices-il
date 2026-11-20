#!/usr/bin/env bash
# Open, update or close a run's failure issue (GitHub emails the owner).
# Usage: report-ingest.sh <issue title> <success|failure> [report file]
# The report file (written by the pipeline) names each failed chain or
# branch, so the cause can be read in the email without opening the log.
set -euo pipefail
TITLE=$1
RESULT=$2
REPORT=${3:-}
RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
DETAILS="The run log has the details."
if [ -n "$REPORT" ] && [ -s "$REPORT" ]; then DETAILS=$(cat "$REPORT"); fi
NUMBER=$(gh issue list -R "$GITHUB_REPOSITORY" --state open --search "\"$TITLE\" in:title" --json number --jq '.[0].number')

if [ "$RESULT" = "success" ]; then
  if [ -n "$NUMBER" ]; then
    gh issue close "$NUMBER" -R "$GITHUB_REPOSITORY" --comment "Recovered: $RUN_URL"
  fi
elif [ -n "$NUMBER" ]; then
  gh issue comment "$NUMBER" -R "$GITHUB_REPOSITORY" --body "Failed again: $RUN_URL

$DETAILS"
else
  gh issue create -R "$GITHUB_REPOSITORY" --title "$TITLE" --body "The run failed: $RUN_URL

$DETAILS

This issue closes itself after the next good run."
fi
