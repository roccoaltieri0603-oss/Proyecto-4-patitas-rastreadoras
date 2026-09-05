# Imagen del microservicio de sugerencia de lotes.
#
# Sirve para correrlo en un servidor en vez de en la máquina de cada uno: quien
# clona el repo no necesita Python ni bajar torch, sólo apuntar IA_LOTES_URL al
# servidor. El código no cambia en absoluto.
FROM python:3.12-slim

# OpenCV (que entra como dependencia de ultralytics) necesita estas dos
# bibliotecas del sistema; sin ellas falla al importar con libGL.so.1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch desde el índice CPU: el de PyPI arrastra las bibliotecas CUDA y hace
# crecer la imagen varios GB para nada, porque acá se corre en CPU.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Los pesos se bajan en el build y quedan dentro de la imagen. Cuesta tamaño,
# pero evita que la primera consulta después de cada arranque se vaya en la
# descarga y choque contra el timeout de Express.
ARG PESOS=DelineateAnythingv2.pt
ENV IA_LOTES_PESOS=${PESOS}
ENV HF_HOME=/app/.cache/huggingface
RUN python -c "from huggingface_hub import hf_hub_download; \
    hf_hub_download(repo_id='MykolaL/DelineateAnything', filename='${PESOS}')"

# Muchas plataformas (Cloud Run, Render, Railway) inyectan el puerto por $PORT.
ENV PORT=8001
EXPOSE 8001
CMD ["sh", "-c", "python -m uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
