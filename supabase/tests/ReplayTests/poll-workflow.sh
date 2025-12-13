#!/bin/bash
# Poll GitHub workflow status for PR #13
# Exits 0 on success, 1 on failure, 2 on timeout

PR_NUMBER=13
REPO="IngrediCheck/IngrediCheck-Backend"
MAX_ATTEMPTS=60  # 30 minutes with 30s intervals
POLL_INTERVAL=30

echo "Polling workflow status for PR #$PR_NUMBER..."

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
    # Get the latest workflow run for this PR's head SHA
    WORKFLOW_INFO=$(gh pr view $PR_NUMBER --repo $REPO --json headRefOid,statusCheckRollup 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo "[$i/$MAX_ATTEMPTS] Failed to fetch PR info, retrying..."
        sleep $POLL_INTERVAL
        continue
    fi

    # Extract check status
    STATUS=$(echo "$WORKFLOW_INFO" | jq -r '.statusCheckRollup[] | select(.name == "test" or .name == "End-to-End Tests" or .context == "test") | .status // .state' 2>/dev/null | head -1)
    CONCLUSION=$(echo "$WORKFLOW_INFO" | jq -r '.statusCheckRollup[] | select(.name == "test" or .name == "End-to-End Tests" or .context == "test") | .conclusion // empty' 2>/dev/null | head -1)

    # If no specific test workflow found, check all statuses
    if [ -z "$STATUS" ]; then
        ALL_STATUSES=$(echo "$WORKFLOW_INFO" | jq -r '.statusCheckRollup[].status // .statusCheckRollup[].state' 2>/dev/null)
        ALL_CONCLUSIONS=$(echo "$WORKFLOW_INFO" | jq -r '.statusCheckRollup[].conclusion // empty' 2>/dev/null)

        # Check if any are still pending/in_progress
        if echo "$ALL_STATUSES" | grep -qi "pending\|queued\|in_progress"; then
            echo "[$i/$MAX_ATTEMPTS] Workflow still running... (waiting ${POLL_INTERVAL}s)"
            sleep $POLL_INTERVAL
            continue
        fi

        # Check if any failed
        if echo "$ALL_CONCLUSIONS" | grep -qi "failure\|cancelled\|timed_out"; then
            echo "WORKFLOW FAILED"
            echo "$WORKFLOW_INFO" | jq '.statusCheckRollup'
            exit 1
        fi

        # Check if all completed successfully
        if echo "$ALL_CONCLUSIONS" | grep -qi "success"; then
            echo "WORKFLOW SUCCEEDED"
            echo "$WORKFLOW_INFO" | jq '.statusCheckRollup'
            exit 0
        fi

        # No checks yet
        echo "[$i/$MAX_ATTEMPTS] Waiting for checks to start... (waiting ${POLL_INTERVAL}s)"
        sleep $POLL_INTERVAL
        continue
    fi

    echo "[$i/$MAX_ATTEMPTS] Status: $STATUS, Conclusion: $CONCLUSION"

    case "$STATUS" in
        COMPLETED|completed)
            if [ "$CONCLUSION" = "SUCCESS" ] || [ "$CONCLUSION" = "success" ]; then
                echo "WORKFLOW SUCCEEDED"
                exit 0
            else
                echo "WORKFLOW FAILED with conclusion: $CONCLUSION"
                exit 1
            fi
            ;;
        PENDING|pending|QUEUED|queued|IN_PROGRESS|in_progress)
            echo "Waiting ${POLL_INTERVAL}s before next check..."
            sleep $POLL_INTERVAL
            ;;
        *)
            echo "Unknown status: $STATUS, waiting..."
            sleep $POLL_INTERVAL
            ;;
    esac
done

echo "TIMEOUT: Workflow did not complete within $((MAX_ATTEMPTS * POLL_INTERVAL / 60)) minutes"
exit 2
