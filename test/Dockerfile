# Test image: Node for the suite, Pandoc for its oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test. Its binary is static: copied onto
# the Node image, it links against nothing there.

FROM pandoc/minimal:3.11.0.0@sha256:fc17da3ba8f0a70b2ad5d7d4d61fed7d25da2e091cc3139f4d371f03b18641df AS pandoc

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

COPY --from=pandoc /usr/local/bin/pandoc /usr/local/bin/pandoc

WORKDIR /work
