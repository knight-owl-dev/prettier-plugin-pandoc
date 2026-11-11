# The test image: Node for the suite and the tools, Pandoc for the oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test: the static binary its release
# publishes, pinned per architecture as <tag>@sha256:<tarball digest>. Moving
# it: docs/bumping-pandoc.md.

FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216

# renovate: datasource=github-release-attachments depName=jgm/pandoc
ARG PANDOC_AMD64=3.11@sha256:37edb3bbcf722f921a009941bf5874e2e0c09263226c9b4a2d980788cb062ab6
# renovate: datasource=github-release-attachments depName=jgm/pandoc
ARG PANDOC_ARM64=3.11@sha256:56ed5566ec41d22ec9ee0704e6ac0b98ba102e92384efd5306173a22d314c79a

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
