# ---- build stage ----
FROM rust:1-bookworm AS builder
WORKDIR /app
# Cache dependencies
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src target/release/deps/y99_backend*
COPY . .
RUN cargo build --release

# ---- runtime stage ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/y99-backend /usr/local/bin/y99-backend
COPY migrations ./migrations
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fs http://localhost:8080/health || exit 1
CMD ["y99-backend"]
