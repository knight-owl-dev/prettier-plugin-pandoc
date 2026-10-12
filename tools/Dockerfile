# The test image: Node for the suite and the tools, Pandoc for the oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test. Its binary is static: copied onto
# the Node image, it links against nothing there.

FROM pandoc/minimal:3.11.0.0@sha256:fc17da3ba8f0a70b2ad5d7d4d61fed7d25da2e091cc3139f4d371f03b18641df AS pandoc

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a

COPY --from=pandoc /usr/local/bin/pandoc /usr/local/bin/pandoc

WORKDIR /work
