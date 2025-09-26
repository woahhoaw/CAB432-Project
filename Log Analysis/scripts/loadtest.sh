#!/bin/bash
# Usage: ./loadtest.sh BASE_URL TOKEN LOGID COUNT PARALLEL
# Example: ./loadtest.sh http://13.211.175.202:3000 $TOKEN $LOGID 200 16

BASE_URL=$1
TOKEN=$2
LOGID=$3
COUNT=$4
PARALLEL=$5

if [ -z "$BASE_URL" ] || [ -z "$TOKEN" ] || [ -z "$LOGID" ] || [ -z "$COUNT" ] || [ -z "$PARALLEL" ]; then
  echo "Usage: ./loadtest.sh BASE_URL TOKEN LOGID COUNT PARALLEL"
  exit 1
fi

echo "Sending $COUNT requests in parallel batches of $PARALLEL..."
seq $COUNT | xargs -n1 -P$PARALLEL curl -s -o /dev/null \
  -H "Authorization: Bearer $TOKEN" \
  -X POST $BASE_URL/logs/$LOGID/analyze

echo "Done: sent $COUNT requests with parallelism $PARALLEL"
