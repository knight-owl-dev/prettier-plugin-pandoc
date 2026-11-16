# The test image: Node for the suite and the tools, Pandoc for the oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test: the static binary its release
# publishes, pinned per architecture as <tag>@sha256:<tarball digest>. Moving
# it: docs/bumping-pandoc.md.

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

# renovate: datasource=github-release-attachments depName=jgm/pandoc
ARG PANDOC_AMD64=3.14@sha256:c5f4720cdefb3f7bdc5d07202ef579feef0d1370773c873804dd8fdaa8c4f1b8
# renovate: datasource=github-release-attachments depName=jgm/pandoc
ARG PANDOC_ARM64=3.14@sha256:c692f3d78a415741bbbac4cdbbbe26fa7edca1f43d2301b982fbf4009cc8cf7f

ARG TARGETARCH

SHELL ["/bin/ash", "-eo", "pipefail", "-c"]

RUN case "${TARGETARCH}" in \
      amd64) pin="${PANDOC_AMD64}" ;; \
      arm64) pin="${PANDOC_ARM64}" ;; \
      *) echo "no Pandoc release for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    version="${pin%@sha256:*}"; \
    name="pandoc-${version}-linux-${TARGETARCH}"; \
    wget -q -O /tmp/pandoc.tar.gz \
      "https://github.com/jgm/pandoc/releases/download/${version}/${name}.tar.gz"; \
    echo "${pin#*@sha256:}  /tmp/pandoc.tar.gz" | sha256sum -c -s; \
    tar -xzf /tmp/pandoc.tar.gz -C /tmp; \
    cp "/tmp/pandoc-${version}/bin/pandoc" /usr/local/bin/pandoc; \
    rm -rf /tmp/*

WORKDIR /work
