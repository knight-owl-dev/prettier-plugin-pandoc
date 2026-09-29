# Test image: Node for the suite, Pandoc for its oracle.
#
# The oracle asks Pandoc whether formatting changed what a document means, so
# the Pandoc here is the reader under test, not a tool. Its binary is static:
# copied onto the Node image, it links against nothing there.

FROM pandoc/minimal:3.10.0.0@sha256:098ebfc3e08e85539fe5f51dc8a952281258d3b356013206eb4285ce2a5bdb8a AS pandoc

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

COPY --from=pandoc /usr/local/bin/pandoc /usr/local/bin/pandoc

WORKDIR /work
