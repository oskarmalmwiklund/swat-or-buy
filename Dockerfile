# Swat or Buy, hosted. Needs ~4 GB RAM per instance. The 1.1 GB MaleCNS download and the
# graph compile happen on first start into /data (mount a volume to keep them).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends g++ libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY swatorbuy ./swatorbuy
RUN pip install --no-cache-dir .

ENV SWAT_DATA=/data SWAT_RESULTS=/results PORT=8000
VOLUME ["/data", "/results"]
EXPOSE 8000

CMD ["sh", "-c", "swat prepare && swat gate && swat serve --port ${PORT}"]
