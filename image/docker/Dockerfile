# runnerbox-base plus a Docker Engine that runs inside the job's own container, for runner kinds
# with "docker": true. Those run under the sysbox runtime, so this daemon needs no privileges on
# the VM and is gone with the container. Build it after the base image:
#   docker build -t runnerbox-base-docker image/docker
ARG BASE=runnerbox-base
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends docker.io docker-compose-v2 docker-buildx iptables \
  && rm -rf /var/lib/apt/lists/* && usermod -aG docker runner
COPY start-docker.sh /usr/local/bin/start-docker.sh
USER runner
# The registration still arrives on stdin, read after the daemon is up.
ENTRYPOINT ["/bin/bash", "-c", "sudo /usr/local/bin/start-docker.sh && read -r JIT && exec ./run.sh --jitconfig \"$JIT\""]
