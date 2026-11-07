# The minimal image one job runs in, thrown away afterwards. Add your project's tools in your own
# image: start FROM this one, install as root, and end with USER runner.
# Dependabot updates the FROM line. Update the runner and Node versions and checksums by hand.
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c
ARG RUNNER_VERSION=2.338.2
ARG RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
ARG NODE_VERSION=24.22.2
ARG NODE_SHA256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    sudo curl git jq ca-certificates xz-utils zip unzip
RUN useradd -m -s /bin/bash runner && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
WORKDIR /home/runner
RUN curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" -o r.tgz \
  && echo "${RUNNER_SHA256}  r.tgz" | sha256sum -c - && tar -xzf r.tgz && rm r.tgz && ./bin/installdependencies.sh
# actions/setup-node finds this and skips its download.
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o n.txz \
  && echo "${NODE_SHA256}  n.txz" | sha256sum -c - \
  && mkdir -p "/opt/hostedtoolcache/node/${NODE_VERSION}/x64" \
  && tar -xJf n.txz --strip-components=1 -C "/opt/hostedtoolcache/node/${NODE_VERSION}/x64" && rm n.txz \
  && touch "/opt/hostedtoolcache/node/${NODE_VERSION}/x64.complete"
RUN mkdir -p /home/runner/_work && chown -R runner:runner /home/runner /opt/hostedtoolcache
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache
USER runner
# The single-use registration arrives on stdin, so it never appears in `docker inspect`. It does
# become an argument of the runner process, which jobs and root in the VM can see.
ENTRYPOINT ["/bin/bash", "-c", "read -r JIT && exec ./run.sh --jitconfig \"$JIT\""]
