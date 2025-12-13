#!/bin/bash
# Poll GitHub workflow status for main branch commit
# Exits 0 on success, 1 on failure, 2 on timeout

COMMIT_SHA="8e200941ec27b1680a86289ba0a471cdcb746dc5"
REPO="IngrediCheck/IngrediCheck-Backend"
MAX_ATTEMPTS=60  # 30 minutes with 30s intervals
POLL_INTERVAL=30

echo "Polling workflow status for commit $COMMIT_SHA on main..."

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
    # Get workflow runs for this commit
    RUNS_INFO=$(gh api "repos/$REPO/commits/$COMMIT_SHA/check-runs" 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo "[$i/$MAX_ATTEMPTS] Failed to fetch check runs, retrying..."
        sleep $POLL_INTERVAL
        continue
    fi

    TOTAL_COUNT=$(echo "$RUNS_INFO" | jq '.total_count')

    if [ "$TOTAL_COUNT" = "0" ]; then
        echo "[$i/$MAX_ATTEMPTS] No checks found yet, waiting..."
        sleep $POLL_INTERVAL
        continue
    fi

    # Extract status info
    IN_PROGRESS=$(echo "$RUNS_INFO" | jq '[.check_runs[] | select(.status != "completed")] | length')
    FAILED=$(echo "$RUNS_INFO" | jq '[.check_runs[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")] | length')
    SUCCEEDED=$(echo "$RUNS_INFO" | jq '[.check_runs[] | select(.conclusion == "success" or .conclusion == "skipped")] | length')

    echo "[$i/$MAX_ATTEMPTS] Checks: $TOTAL_COUNT total, $IN_PROGRESS in progress, $SUCCEEDED succeeded, $FAILED failed"

    # If any failed, report and exit
    if [ "$FAILED" -gt 0 ]; then
        echo ""
        echo "WORKFLOW FAILED"
        echo "$RUNS_INFO" | jq '[.check_runs[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") | {name, conclusion, html_url}]'
        exit 1
    fi

    # If none in progress and all completed, we're done
    if [ "$IN_PROGRESS" = "0" ] && [ "$TOTAL_COUNT" -gt 0 ]; then
        echo ""
        echo "ALL WORKFLOWS SUCCEEDED"
        echo "$RUNS_INFO" | jq '[.check_runs[] | {name, conclusion, html_url}]'
        exit 0
    fi

    sleep $POLL_INTERVAL
done

echo "TIMEOUT: Workflows did not complete within $((MAX_ATTEMPTS * POLL_INTERVAL / 60)) minutes"
exit 2
