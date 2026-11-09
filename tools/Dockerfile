# The test image: Node for the suite and the tools, Pandoc for the oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test. Its binary is static: copied onto
# the Node image, it links against nothing there.

FROM pandoc/minimal:3.11.0.0@sha256:fc17da3ba8f0a70b2ad5d7d4d61fed7d25da2e091cc3139f4d371f03b18641df AS pandoc

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94

COPY --from=pandoc /usr/local/bin/pandoc /usr/local/bin/pandoc

WORKDIR /work
