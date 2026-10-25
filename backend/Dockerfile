# ---- ffmpeg stage ----
# A minimal ffmpeg for one job: converting recorded voice messages (WebM/Ogg with Opus or Vorbis) to AAC .m4a so
# every browser, iPhones included, can play them (src/voice_audio.rs). Audio only, a few MB, instead of Debian's
# ~450 MB package. The release tarball is pinned by SHA-256 (verified against FFmpeg's release signing key
# FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8 when the pin was set).
FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=7.1.1
ARG FFMPEG_SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
 && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
 && tar -xJf ffmpeg.tar.xz --strip-components=1 \
 && ./configure --disable-everything --disable-autodetect --disable-doc --disable-network --disable-ffplay --disable-ffprobe \
      --disable-x86asm --enable-small --disable-debug \
      --enable-protocol=file,pipe --enable-demuxer=matroska,ogg,mov,wav --enable-muxer=mp4,ipod \
      --enable-decoder=opus,vorbis,aac,flac,pcm_s16le --enable-encoder=aac --enable-parser=opus,vorbis,aac,flac \
      --enable-filter=abuffer,abuffersink,aformat,aresample,anull --enable-swresample \
 && make -j"$(nproc)" ffmpeg && strip ffmpeg && install -m 0755 ffmpeg /usr/local/bin/ffmpeg

# ---- build stage ----
FROM rust:1-bookworm AS builder
WORKDIR /app
# Cache dependencies
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src target/release/deps/parley_backend*
ARG PARLEY_VERSION=dev
ENV PARLEY_VERSION=$PARLEY_VERSION
COPY . .
RUN cargo build --release

# ---- runtime stage ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /app/target/release/parley-backend /usr/local/bin/parley-backend
COPY migrations ./migrations
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fs http://localhost:8080/health || exit 1
CMD ["parley-backend"]
