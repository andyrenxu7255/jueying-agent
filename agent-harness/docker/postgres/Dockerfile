FROM postgres:16-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    flex \
    bison \
    postgresql-server-dev-16 \
  && rm -rf /var/lib/apt/lists/*

# Install pgvector
RUN git clone --branch v0.8.0 --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
  && cd /tmp/pgvector \
  && make \
  && make install \
  && rm -rf /tmp/pgvector

# Install Apache AGE
RUN git clone --branch PG16/v1.5.0-rc0 --depth 1 https://github.com/apache/age.git /tmp/age \
  && cd /tmp/age \
  && make PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config \
  && make install PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config \
  && rm -rf /tmp/age

# Clean up build-time dependencies (no longer needed, reduce image size by ~500MB)
RUN apt-get purge -y build-essential flex bison postgresql-server-dev-16 git \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
