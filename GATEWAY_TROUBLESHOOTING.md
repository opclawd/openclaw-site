# OpenClaw Gateway - Guia de Resolucion de Problemas

**Servidor**: Hetzner 178.156.164.157 | **Dominio**: back.pulpouplatform.com
**Fecha**: 2026-02-06 | **Version**: OpenClaw 2026.2.3

---

## Arquitectura del Sistema

```
HOST (Ubuntu 24.04)
├── /root/.openclaw/              -> Container: /home/node/.openclaw/
│   ├── openclaw.json             (config principal)
│   └── workspace/                (workspace del bot - aqui escribe el agente)
│       ├── exports/
│       ├── scripts/
│       ├── apps/
│       ├── public/projects/      (paginas generadas por tests)
│       └── ...
├── /opt/openclaw/workspace/      -> Container: /home/node/workspace/
│   ├── public/                   (website publico - lo sirve nginx via clawdbot-web)
│   │   ├── index.html
│   │   └── projects/             (sync desde bot workspace cada 10s)
│   ├── skills/
│   ├── scripts/
│   └── run-all-tests.sh
└── Docker containers
    ├── openclaw-gateway (port 18789) - el bot/agente
    └── clawdbot-web (port 8080) - homepage estatica
```

**El bot corre como UID 1000 (node) dentro del container.**

---

## Errores y Soluciones

### 1. Permission denied: `/workspace` o mkdir/touch fallan

**Error**:
```
mkdir: cannot create directory '/workspace': Permission denied
touch: cannot touch '/home/node/.openclaw/workspace/logs/file': Permission denied
sh: 1: sudo: Permission denied
sh: 1: pip: Permission denied
```

**Causa**: El bot intenta usar `/workspace/` como path absoluto (no existe) o los directorios no tienen permisos para UID 1000.

**Solucion**:
```bash
# Dar ownership al user node (UID 1000) en TODO el workspace del bot
chown -R 1000:1000 /root/.openclaw/workspace/
chmod -R 775 /root/.openclaw/workspace/

# Crear todos los subdirectorios que el bot pueda necesitar
for dir in exports apps scripts downloads/images data sports accounts reports viz alerts logs public/projects; do
  mkdir -p /root/.openclaw/workspace/$dir
done
chown -R 1000:1000 /root/.openclaw/workspace/

# Verificar desde dentro del container
docker exec openclaw-gateway sh -c "touch /home/node/.openclaw/workspace/exports/test && rm /home/node/.openclaw/workspace/exports/test && echo OK"
```

**En los prompts al bot**: NUNCA usar `/workspace/` como path absoluto. Usar rutas relativas (`exports/file.csv`) o la ruta completa del container (`/home/node/.openclaw/workspace/exports/file.csv`).

---

### 2. browser.executablePath not found: /usr/bin/chromium

**Error**:
```
[tools] browser failed: Can't reach the OpenClaw browser control service.
(Error: browser.executablePath not found: /usr/bin/chromium)
```

**Causa**: Chromium no esta instalado dentro del container Docker.

**Solucion**:
```bash
# Instalar chromium dentro del container (como root)
docker exec -u root openclaw-gateway apt-get update
docker exec -u root openclaw-gateway apt-get install -y chromium

# Verificar
docker exec openclaw-gateway chromium --version
# Debe mostrar: Chromium 144.x.x.x

# Test funcional
docker exec openclaw-gateway chromium --no-sandbox --headless --dump-dom https://example.com 2>/dev/null | head -3
```

**Config en openclaw.json** (ya deberia estar):
```json
"browser": {
  "enabled": true,
  "headless": true,
  "executablePath": "/usr/bin/chromium",
  "noSandbox": true
}
```

**IMPORTANTE**: Si el container se recrea (docker-compose up --force-recreate), chromium se pierde. Opciones:
- Agregar un script de post-start que lo instale
- Crear un Dockerfile custom con chromium pre-instalado
- Usar docker commit para guardar la imagen con chromium

---

### 3. No module named 'requests' / pip Permission denied

**Error**:
```
ModuleNotFoundError: No module named 'requests'
sh: 1: pip: Permission denied
sh: 1: pip3: Permission denied
```

**Causa**: El container tiene Python pero no tiene pip ni requests instalados.

**Solucion**:
```bash
# Instalar via apt (como root)
docker exec -u root openclaw-gateway apt-get install -y python3-pip python3-requests

# Verificar
docker exec openclaw-gateway python3 -c "import requests; print('OK')"
```

**Alternativa en prompts**: Indicarle al bot que use la stdlib:
- `urllib.request` en vez de `requests`
- `json`, `csv`, `sqlite3`, `xml.etree.ElementTree` ya estan disponibles

---

### 4. ENOENT: public/projects/index.json

**Error**:
```
[tools] read failed: ENOENT: no such file or directory, access '/home/node/.openclaw/workspace/public/projects/index.json'
```

**Causa**: El directorio public/projects no existe en el workspace del bot.

**Solucion**:
```bash
# Crear directorio y archivo inicial
mkdir -p /root/.openclaw/workspace/public/projects
echo '[]' > /root/.openclaw/workspace/public/projects/index.json
chown -R 1000:1000 /root/.openclaw/workspace/public/
```

---

### 5. message failed: Action send requires a target

**Error**:
```
[tools] message failed: Action send requires a target.
[tools] message failed: Unknown target "telegram" for Telegram. Hint: <chatId>
```

**Causa**: El bot intenta enviar mensaje por Telegram pero no tiene el chat_id correcto. Cuando se usa hooks/agent, el `"to"` debe ser el chat_id numerico, no un username.

**Solucion en el script de tests**:
```json
{
  "channel": "telegram",
  "to": "8482372960"
}
```

**NO** usar:
- `"to": "telegram"` (incorrecto)
- `"to": "@username"` (puede no funcionar si el bot no inicio chat)

**Como obtener el chat_id**: Enviar un mensaje al bot desde Telegram, luego:
```bash
curl https://api.telegram.org/bot<TOKEN>/getUpdates | python3 -m json.tool | grep chat -A5
```

---

### 6. embedded run timeout

**Error**:
```
[agent/embedded] embedded run timeout: runId=xxx timeoutMs=120000
```

**Causa**: El agente tardo mas del timeout configurado. Tareas complejas (scraping 50 paginas, downloads) necesitan mas tiempo.

**Solucion en hooks/agent**:
```json
{
  "timeoutSeconds": 240
}
```

**Valores recomendados**:
- Tareas simples (API call, generar archivo): `120` (2 min)
- Tareas medianas (scraping, code gen): `180` (3 min)
- Tareas pesadas (scraping multi-pagina, downloads, research): `240-300` (4-5 min)

---

### 7. gateway timeout after 60000ms

**Error**:
```
announce queue drain failed: Error: gateway timeout after 60000ms
Subagent announce failed: Error: gateway timeout after 60000ms
```

**Causa**: El gateway no pudo completar la tarea o comunicar el resultado al canal (Telegram) dentro del timeout interno de 60s.

**Solucion**:
- Verificar que Telegram esta conectado: `docker logs openclaw-gateway 2>&1 | grep telegram`
- Reiniciar gateway si hay muchas tareas encoladas: `docker restart openclaw-gateway`
- Reducir `maxConcurrent` si hay saturacion:
```json
"agents": {
  "defaults": {
    "maxConcurrent": 2
  }
}
```

---

### 8. WebSocket disconnected (1006/1008)

**Error en el panel web**:
```
disconnected (1006): no reason
disconnected (1008): unauthorized: gateway token missing
disconnected (1008): pairing required
```

**Solucion completa** (3 partes):

**Parte A - Nginx** (`/etc/nginx/sites-available/back.pulpouplatform.com`):
```nginx
# DEBE estar en nginx.conf (http block):
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# Root location proxea al gateway para WebSocket
location = / {
    proxy_pass http://127.0.0.1:18789/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
}
```

**Parte B - Config** (`/root/.openclaw/openclaw.json`):
```json
"gateway": {
  "mode": "local",
  "controlUi": {
    "allowInsecureAuth": true
  }
}
```

**Parte C - URL con token**:
El panel debe abrirse con el token en la URL:
```
https://back.pulpouplatform.com/clawdbot/panel/?token=<GATEWAY_TOKEN>
```

Para obtener el token:
```bash
docker exec openclaw-gateway cat /home/node/.openclaw/gateway-token 2>/dev/null || \
docker logs openclaw-gateway 2>&1 | grep -i token | head -5
```

**Causa raiz**: El panel JS construye el WebSocket URL como `wss://${location.host}` - siempre conecta a la raiz `/`, ignora subpaths. Por eso `location = /` debe proxear al gateway.

**Issues de referencia**:
- #1679: gateway.controlUi.allowInsecureAuth con reverse proxy
- #7749: dashboard doesn't include token in URL

---

### 9. edit failed: Found N occurrences / text must be unique

**Error**:
```
[tools] edit failed: Found 6 occurrences of the text in public/projects/index.json. The text must be unique.
```

**Causa**: El bot intenta editar index.json con el tool "edit" que requiere texto unico. En un JSON array con entries similares, hay duplicados.

**Solucion en prompts**: Indicarle al bot:
```
Para actualizar index.json: lee el archivo completo, parsea el JSON, agrega la nueva entrada al array, y REESCRIBE el archivo completo. NO uses edit parcial.
```

---

### 10. sqlite3: Permission denied

**Error**:
```
sh: 1: sqlite3: Permission denied
```

**Causa**: sqlite3 CLI no esta instalado o no tiene permisos.

**Solucion**:
```bash
docker exec -u root openclaw-gateway apt-get install -y sqlite3
```

**Alternativa**: Usar Python sqlite3 module (ya incluido en stdlib):
```python
import sqlite3
conn = sqlite3.connect('data/books.db')
```

---

### 11. Proxy headers / untrusted address

**Warning**:
```
Proxy headers detected from untrusted address. Connection will not be treated as local.
Configure gateway.trustedProxies to restore local client detection.
```

**Causa**: Nginx envia headers X-Forwarded-For pero el gateway no confia en el proxy.

**Solucion** (opcional, no bloquea funcionalidad):
```json
"gateway": {
  "trustedProxies": ["10.0.0.0/8", "172.16.0.0/12", "127.0.0.1"]
}
```

---

## Paths dentro del Container (CRITICO)

| Concepto | Path en HOST | Path en CONTAINER |
|----------|-------------|-------------------|
| Config OpenClaw | `/root/.openclaw/openclaw.json` | `/home/node/.openclaw/openclaw.json` |
| Workspace del bot | `/root/.openclaw/workspace/` | `/home/node/.openclaw/workspace/` |
| Website publico | `/opt/openclaw/workspace/public/` | `/home/node/workspace/public/` |
| Gateway token | `/root/.openclaw/gateway-token` | `/home/node/.openclaw/gateway-token` |
| Logs gateway | `docker logs openclaw-gateway` | `/tmp/openclaw/openclaw-*.log` |

**Regla de oro para prompts al bot**:
- Usar paths RELATIVOS: `exports/file.csv`, `scripts/algo.py`
- El bot los resuelve a `/home/node/.openclaw/workspace/exports/file.csv`
- NUNCA usar `/workspace/` como path absoluto

---

## Sync: Bot Workspace -> Website

El bot escribe en su workspace (`/root/.openclaw/workspace/public/projects/`) pero el website se sirve desde `/opt/openclaw/workspace/public/`. Se necesita un sync:

```bash
# Script de sync (correr con nohup)
cat > /opt/openclaw/workspace/scripts/sync-projects.sh <<'EOF'
#!/bin/bash
while true; do
  rsync -a --delete /root/.openclaw/workspace/public/projects/ /opt/openclaw/workspace/public/projects/ 2>/dev/null
  sleep 10
done
EOF
chmod +x /opt/openclaw/workspace/scripts/sync-projects.sh
nohup /opt/openclaw/workspace/scripts/sync-projects.sh > /dev/null 2>&1 &
```

---

## Hooks/Webhook API

**Endpoint**: `POST http://127.0.0.1:18789/hooks/agent`
**Auth**: `Authorization: Bearer test-runner-2026-secure`
**Docs**: `/opt/openclaw/repo/docs/automation/webhook.md`

**Config necesaria** en openclaw.json:
```json
"hooks": {
  "enabled": true,
  "token": "test-runner-2026-secure"
}
```

**Ejemplo funcional**:
```bash
curl -s -X POST http://127.0.0.1:18789/hooks/agent \
  -H "Authorization: Bearer test-runner-2026-secure" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Dime hola",
    "name": "Test",
    "channel": "telegram",
    "to": "8482372960",
    "wakeMode": "now",
    "deliver": true,
    "timeoutSeconds": 60
  }'
# Respuesta esperada: {"ok":true,"runId":"uuid"} con HTTP 202
```

**Errores comunes de hooks**:
- `401`: Token incorrecto o no enviado
- `400`: Payload invalido (falta "message")
- `405`: Method not allowed (hooks no habilitados en config)

---

## Checklist Pre-Tests

Antes de lanzar tests, verificar TODO esto:

```bash
# 1. Gateway corriendo
docker ps | grep openclaw-gateway

# 2. Telegram conectado
docker logs openclaw-gateway --tail 20 2>&1 | grep telegram

# 3. Hooks habilitados
curl -s -X POST http://127.0.0.1:18789/hooks/agent \
  -H "Authorization: Bearer test-runner-2026-secure" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping"}' | python3 -m json.tool

# 4. Permisos OK
docker exec openclaw-gateway sh -c "
  touch /home/node/.openclaw/workspace/exports/t && rm /home/node/.openclaw/workspace/exports/t && echo 'exports OK'
  touch /home/node/.openclaw/workspace/public/projects/t && rm /home/node/.openclaw/workspace/public/projects/t && echo 'projects OK'
  cat /home/node/.openclaw/workspace/public/projects/index.json | head -1 && echo 'index.json OK'
"

# 5. Chromium
docker exec openclaw-gateway chromium --version

# 6. Python requests
docker exec openclaw-gateway python3 -c "import requests; print('requests OK')"

# 7. Sync corriendo
pgrep -f sync-projects && echo "Sync OK" || echo "Sync NOT running"

# 8. Website accesible
curl -s -o /dev/null -w '%{http_code}' https://back.pulpouplatform.com/clawdbot/
```

---

## Comandos de Emergencia

```bash
# Reiniciar todo
docker restart openclaw-gateway
systemctl restart clawdbot-web
sudo systemctl reload nginx

# Ver errores en tiempo real
docker logs openclaw-gateway -f 2>&1 | grep -E "(error|failed|timeout)"

# Limpiar agent sessions encoladas
docker restart openclaw-gateway

# Reinstalar dependencias perdidas (post recreate)
docker exec -u root openclaw-gateway sh -c "apt-get update && apt-get install -y chromium python3-pip python3-requests sqlite3"

# Verificar estado completo
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
systemctl status clawdbot-web --no-pager
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/
```

---

## Prompt Template Optimo para Tests

Cuando envies tareas al bot via hooks/agent, incluye este contexto:

```
INSTRUCCIONES TECNICAS:
- Paths RELATIVOS a tu workspace: exports/file.csv, scripts/algo.py
- Para HTML publico: public/projects/test-N/index.html
- Para indice: public/projects/index.json (leer, agregar, reescribir completo)
- Python: requests, urllib, json, csv, sqlite3, xml.etree disponibles
- Chromium: /usr/bin/chromium --no-sandbox
- NO uses sudo, NO uses /workspace/ absoluto, NO uses pip install
- Si algo falla, intenta alternativa antes de reportar error
```

---

*Generado: 2026-02-06 | Basado en errores reales de 3 iteraciones de test runner*
