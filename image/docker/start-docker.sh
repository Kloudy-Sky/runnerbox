#!/usr/bin/env bash
# Starts the job's own Docker daemon and waits until it answers, so the job's first `docker` call
# doesn't race it.
set -euo pipefail
dockerd >/var/log/dockerd.log 2>&1 &
for _ in $(seq 60); do
  if docker info >/dev/null 2>&1; then exit 0; fi
  sleep 0.5
done
echo "dockerd didn't start; see /var/log/dockerd.log" >&2
tail -20 /var/log/dockerd.log >&2
exit 1
